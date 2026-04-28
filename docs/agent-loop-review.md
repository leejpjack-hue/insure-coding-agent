# Agent Loop Review — InsureAgent vs. Claude-Code-style Working

> Scope: `src/core/agent-loop.ts`, `src/core/thinking-loop.ts`, `src/core/context-assembler.ts`,
> `src/core/llm-client.ts` (commit `aa0a42e..HEAD`).
> Reviewer: Claude — comparing to how I structure my own work in coding-agent harnesses.

## TL;DR

The loop is structurally sound and matches the v3.0 design. Streaming, reasoning,
checkpointing, the safety gate, and the per-iteration history append are all there.
There are **three real gaps** that show up the moment a non-trivial task lands:

| # | Gap | Severity | Fixed in this PR |
|---|-----|----------|------------------|
| 1 | Multiple `tool_calls` in a single assistant turn were silently dropped to one | **High** (correctness) | ✅ |
| 2 | No explicit plan stage; the loop just iterates until a completion marker matches | Medium (depth) | Documented; not yet implemented |
| 3 | No history compaction; old messages never get summarised | Medium (will bite at iteration ~12+) | Not yet |

Below is a section-by-section walk-through with concrete pointers.

---

## 1. Context assembly — good, with one caveat

`ContextAssembler.assemble()` packs the system prompt, project context, tool list,
full conversation history, current task, optional LSP diagnostics, and AMS context
into a single string sent as the system prompt. That mirrors my own pattern.

**Gap:** the conversation history is appended verbatim with no truncation. By
iteration 10–15 on a real task you'll be re-sending tens of thousands of tokens
of stale tool output. I trim aggressively in my own runs:

- Keep the **first** user message verbatim (the task).
- Keep the **last 4–6 turns** verbatim.
- Replace older turns with a short summary line (`<assistant: ran 3 tool calls, modified commission.service.ts>`).

**Suggested fix:** add a `compactHistory(messages, budgetTokens)` helper called
inside `assemble()` when `messages.length > 8`. Cheap to write; big payoff.

## 2. Tool-call dispatch — the real bug

Before this PR the streaming path collected every `tool_call` chunk into an array
but only executed the **first** one:

```ts
// llm-client.ts — chatStream collected ALL deltas
toolCalls.push({ id, name, arguments: '' })
// ...
// agent-loop.ts — but returned only [0]
return { toolCall: toolCalls[0] }
```

Modern OpenAI / Zhipu / Anthropic models routinely return 2–5 parallel tool calls
when they decide to read several files at once — exactly the access pattern I
use most. Dropping calls 2..N forces the loop to spin extra iterations and the
LLM to re-issue the same calls, wasting tokens and confusing it.

**Fix in this PR:**
- `LLMResponse` gained `toolCalls?: ToolCall[]` (plural).
- `parseResponse` (Anthropic + OpenAI-compatible) returns the full list.
- `chatStream` returns the full list at end-of-stream.
- `run()` iterates over `response.toolCalls` and executes them serially within
  the same iteration, recording each result before the next call sees it.
- `tool_call_start` is now emitted inside `handleToolUse` so each call is
  announced exactly once, in the order it actually runs.

**Why serial, not parallel?** Side-effecting tools (`file_edit`, `file_write`,
`bash_execute`) often depend on what the previous one did. Serialising within
an iteration keeps the session-history invariants clean. For pure-read parallelism
the right knob is to mark tools with a `parallelSafe: true` flag and dispatch
those in `Promise.all`. That's a follow-up — easy to add, but not required for
correctness today.

## 3. Completion detection — fragile string match

```ts
const COMPLETION_MARKERS = [
  'task complete', 'task completed', '[done]', '[finished]',
  '## summary', '### summary', '## final result', ...
];
const isCompletion = COMPLETION_MARKERS.some(m => lower.includes(m));
```

This works in the easy case and fails the moment the model writes a perfectly
fine final answer that just happens not to contain "complete" or "summary".
You then fall through to `iteration > 1 ? completed : continue`, which usually
saves you but is a coincidence, not a contract.

**Suggested fix:** ask the model for a structured stop signal. Options:

1. Anthropic `stop_reason === 'end_turn'` (already provided; just plumb it through
   `LLMResponse.stopReason`).
2. OpenAI `finish_reason === 'stop'` vs `tool_calls` — if `stop` and no tool_calls,
   the turn is final.
3. Or: append a short instruction to the system prompt — "When the task is
   done, output a single line `[[DONE]]` on its own line." Then the marker is
   unambiguous and your `COMPLETION_MARKERS` becomes one entry.

Pick one — the current heuristic shouldn't be the long-term answer.

## 4. Plan stage — missing

How I work, every time, on a non-trivial task:

1. Read the task. Restate it in one sentence to confirm I understood.
2. Write a short numbered plan (3–7 items).
3. Mark items in-progress / done as I go.
4. Verify (run tests / build / health-check).
5. Final summary.

The current loop has no plan primitive. The `Pipeline` interface in
`src/pipeline/types.ts` *looks* like it could be that, but nothing in the loop
references `PipelineStep`. The model is on its own to decide depth.

**Two options to fix:**

- **Cheap:** prepend a system-prompt nudge — "For tasks longer than one tool call,
  start your reply with a numbered plan in `<plan>...</plan>` tags. Update the plan
  as you finish items." Then have the CLI parse `<plan>` blocks and pin them to
  the top of the screen.
- **Proper:** add a `plan_tracker` tool with `set_plan(items)`, `mark_done(n)`,
  `get_plan()`. Now the plan lives in tool state, the agent treats it as a real
  artefact, and you can render it as a checklist in the chat UI.

I'd ship the cheap version first; it gets ~70% of the value with one paragraph
of system prompt.

## 5. Safety / approval — well-structured but the gate is too late

`SafetyManager.checkTool` runs *after* the model commits to the tool call. For
genuinely dangerous operations (`bash_execute "rm -rf /"`) that's fine — you
intercept before execution. But the model has already burned tokens deciding
to call the dangerous thing.

For your AMS domain the bigger ask is: **`bash_execute` on production paths
should never be the first answer**. Push some of the safety knowledge into the
*system prompt* so the model self-censors:

> "Never run a bash command that touches `/etc`, `~/.ssh`, or any path under
> `data/`. Read DB schemas with `schema_reader`, not `sqlite3` shell."

That + the existing post-hoc gate is belt-and-braces.

## 6. Token / cost accounting — works, easy to mis-trust

`addTokenUsage` averages input and output cost per 1k tokens, then divides by
4 to estimate tokens from char count. Two issues:

- **Char/4** wildly underestimates Chinese (1 char ≈ 1 token) and CJK-heavy
  prompts (the AMS domain text is bilingual). For Zhipu / GLM models this matters.
- **Average cost** fudges the input vs. output split. For Sonnet, output is 5×
  input cost; the average is wrong by ~2.5×.

Easy fix: track `inputTokens` and `outputTokens` separately, multiply each by
its own per-1k cost. The fields already exist on `ModelConfig`.

## 7. Things that already match how I work — keep them

- Streaming with reasoning_content split into a separate `thinking` channel ✓
- Per-iteration checkpoint via `CheckpointManager` ✓
- `ToolRegistry` validates params before execution ✓
- Event bus + Hook engine for cross-cutting concerns ✓
- `SessionManager` persisting messages with role discrimination ✓
- Provider-agnostic `LLMClient` with retry/backoff ✓

## 8. Concrete next steps (ordered by ROI)

1. **(Done in this PR)** Multi-tool-call support — kills a class of wasted iterations.
2. **Plan-tag system-prompt** — one paragraph; massive UX improvement.
3. **History compaction** at >8 messages — keeps the loop running past iter 15.
4. **Structured stop signal** instead of `COMPLETION_MARKERS`.
5. **Per-direction token cost** — accuracy in dashboards.
6. **`parallelSafe` flag on read-only tools** + `Promise.all` dispatch — speed.
7. **Plan_tracker tool** — only after #2 proves the model uses plans.

— Reviewed against `agent-loop.ts` rev `aa0a42e+1` on 2026-04-28.
