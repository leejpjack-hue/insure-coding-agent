# InsureAgent — Insurance AMS Coding Agent

> A coding agent specialised for the insurance industry. Knows the system
> landscape (AMS, AS400 Life, Underwriting, BPM, DW, POS, portals, Payment
> Gateway, AML), the regulatory hot-spots (HK IA / SG MAS / EU IDD / US NAIC),
> and the commission / licensing / PII rules that bite when you change code.

---

## Table of Contents

1. [Install](#1-install)
2. [Configure (`.env`)](#2-configure-env)
3. [Authenticate (GitHub Copilot)](#3-authenticate-github-copilot)
4. [CLI — `insure-agent` command](#4-cli--insure-agent-command)
5. [Interactive Chat](#5-interactive-chat)
6. [HTTP API](#6-http-api)
7. [Tools (10)](#7-tools-10)
8. [Knowledge Base](#8-knowledge-base)
9. [Insurance-system catalogue](#9-insurance-system-catalogue)
10. [Hooks](#10-hooks)
11. [Project layout](#11-project-layout)
12. [Architecture](#12-architecture)
13. [Troubleshooting](#13-troubleshooting)
14. [Development](#14-development)

---

## 1. Install

Requirements: **Node.js 22+** and **npm 10+**.

```bash
git clone https://github.com/leejpjack-hue/insure-coding-agent.git
cd insure-coding-agent
npm install
npm run build
```

Make the `insure-agent` command available on your `PATH`:

```bash
npm link              # global symlink → ./dist/cli/index.js
# or — without npm link:
ln -sf "$PWD/dist/cli/index.js" ~/.local/bin/insure-agent
```

Verify:

```bash
insure-agent --help
```

## 2. Configure (`.env`)

Copy the template and fill in only the keys you need. The agent reads `.env`
from the project root regardless of where you invoke it from.

```bash
cp .env.example .env
```

| Variable                 | What it does                                    |
| ------------------------ | ----------------------------------------------- |
| `ANTHROPIC_API_KEY`      | Claude (Sonnet/Opus) via Anthropic API          |
| `OPENAI_API_KEY`         | GPT-4o, GPT-4.1, o4-mini via OpenAI API         |
| `GOOGLE_API_KEY`         | Gemini 2.5 Pro                                  |
| `DEEPSEEK_API_KEY`       | DeepSeek V4 / Flash                             |
| `ZHIPU_API_KEY`          | GLM 5.1 (BigModel) — `id.secret` format         |
| `DEFAULT_MODEL_PROVIDER` | `anthropic`, `openai`, `google`, `deepseek`, `zhipu`, `copilot` |
| `DEFAULT_MODEL`          | Model id, e.g. `claude-sonnet-4`, `gpt-4.1`     |
| `INSURE_AGENT_PORT`      | HTTP port (default `7008`)                      |
| `INSURE_AGENT_HOST`      | Bind host (default `0.0.0.0`)                   |
| `INSURE_AGENT_DB_PATH`   | SQLite path for sessions / messages             |
| `INSURE_AGENT_API_KEY`   | If set, requires `Authorization: Bearer …` on `/api/*` |
| `AMS_JURISDICTION`       | `HK` (default), `SG`, `EU`, `US`                |
| `MAX_ITERATIONS`         | Agent-loop hard cap per task (default 20)       |
| `MAX_CONSECUTIVE_FAILS`  | Auto-stop after this many tool/LLM failures (default 5) |

> `.env` is git-ignored. Never commit it.

## 3. Authenticate (GitHub Copilot)

GitHub Copilot uses an OAuth device flow instead of a static API key. You only
need this if you set `DEFAULT_MODEL_PROVIDER=copilot`.

```bash
insure-agent auth login
```

You'll be shown a verification URL and an 8-character user code. Open the URL
in any browser, enter the code, approve. The CLI polls until you confirm and
caches the token in `~/.config/insure-agent/copilot.json` (mode 0600).

Useful sub-commands:

```bash
insure-agent auth status     # show login + verify token exchange
insure-agent auth logout     # clear cached credentials
```

The cached GitHub token is exchanged on every chat request for a short-lived
Copilot bearer (~25 min lifetime). Refresh is automatic.

You must hold an active GitHub Copilot subscription for the API to grant a
token.

## 4. CLI — `insure-agent` command

```
insure-agent chat                       Interactive chat (default if no args)
insure-agent serve                      Start the HTTP API on $INSURE_AGENT_PORT
insure-agent run "<task>"               One-shot task; prints the final answer
insure-agent auth login | logout | status

insure-agent session list               List persisted sessions
insure-agent session show <id>          Print message history for a session

insure-agent tools list                 List the 10 registered tools
insure-agent tools run <name> '<json>'  Execute a tool directly with JSON args

insure-agent validate commission        Run a sample commission calculation
insure-agent check compliance <file>    PII + regulation scan a file
insure-agent license check <agentId>    Check licence status
insure-agent license expiring [days]    List licences expiring within N days

Options:
  --port <number>     Override the HTTP port
  --db <path>         Override the SQLite path
  --help              Show usage
```

### Examples

```bash
# Quote-engine compliance scan
insure-agent check compliance src/services/quotation.ts

# Direct tool call: simulate commission
insure-agent tools run commission_validator '{
  "action":"calculate",
  "agentLevel":"gold",
  "productType":"life",
  "premiumAmount":120000,
  "policyYear":1,
  "isRenewal":false
}'

# One-shot task on the current directory
insure-agent run "Review src/services/underwriting.ts for AML coverage"
```

## 5. Interactive Chat

```bash
insure-agent chat
```

The chat loop streams the model's reasoning and answer with proper terminal
markdown rendering (headings, code blocks, lists, links, bold/italic). Each
tool call is numbered as a **step** with a 5-line preview; the full output is
kept in memory for inspection.

### Slash commands inside chat

| Command   | What it does                                         |
| --------- | ---------------------------------------------------- |
| `/help`   | Show command help                                    |
| `/clear`  | End the current session and start a new one         |
| `/steps`  | List every tool-call step (`#1 file_read 12ms …`)   |
| `/show N` | Expand step `N` to its full output                   |
| `/last`   | Expand the most recent step                          |
| `/model`  | Print the current provider/model                     |
| `exit`    | Quit                                                 |

`Ctrl+C` interrupts the running task without quitting; press again to quit.

## 6. HTTP API

Start with `insure-agent serve` (or `npm start`). All endpoints are under
`/api`. If `INSURE_AGENT_API_KEY` is set, every request must carry
`Authorization: Bearer <key>`.

| Method | Path                          | Description                                                |
| ------ | ----------------------------- | ---------------------------------------------------------- |
| GET    | `/api/health`                 | Liveness — `{ status, version, tools, uptime }`            |
| GET    | `/api/tools`                  | Tool catalogue                                             |
| POST   | `/api/tools/:name`            | Execute a tool directly with JSON body as params           |
| GET    | `/api/sessions`               | List sessions                                              |
| POST   | `/api/sessions`               | Create a session — body: `{ projectRoot?, modelConfig? }`  |
| GET    | `/api/sessions/:id`           | Message history for a session                              |
| POST   | `/api/sessions/:id/tasks`     | Run a task — body: `{ task, taskType? }`                   |
| POST   | `/api/sessions/:id/undo`      | Roll back the last checkpoint                              |
| GET    | `/api/hooks`                  | Hook catalogue                                             |

### Quick test

```bash
curl http://localhost:7008/api/health
curl -X POST http://localhost:7008/api/tools/commission_validator \
  -H 'Content-Type: application/json' \
  -d '{"action":"calculate","agentLevel":"silver","productType":"life",
       "premiumAmount":50000,"policyYear":1,"isRenewal":false}'
```

## 7. Tools (10)

| Tool                   | Safety       | Description                                          |
| ---------------------- | ------------ | ---------------------------------------------------- |
| `file_read`            | ✅ auto       | Read a file with optional line range                |
| `file_write`           | ⚠️ confirm   | Write a file (auto-checkpoints; auto-creates dirs)  |
| `file_edit`            | ⚠️ confirm   | Diff-based edit (replace `oldContent` with new)     |
| `code_search`          | ✅ auto       | Substring search across the project root            |
| `bash_execute`         | ⚠️ confirm   | Shell command (timeout, PII masking, danger detect) |
| `commission_validator` | ✅ auto       | Calculate / simulate / compare commission           |
| `license_checker`      | ✅ auto       | Status, product authorisation, CPD hours            |
| `schema_reader`        | ✅ auto       | List tables / columns / relations                   |
| `api_tester`           | ✅ auto       | GET/POST/PUT/DELETE/PATCH with assertions           |
| `compliance_checker`   | ✅ auto       | Run jurisdiction rules + PII scan against a file    |

> The `git` tool was removed in v0.2 — use `bash_execute` if you need raw git.

## 8. Knowledge Base

The agent's `KnowledgeBase` indexes six structured datasets and serves them via
TF-IDF retrieval (no external vector DB required):

| Dataset                  | Source file                        | Size    |
| ------------------------ | ---------------------------------- | ------- |
| AMS domain knowledge     | `src/knowledge/ams-knowledge.ts`   | 7+      |
| Compliance rules         | `src/knowledge/compliance-rules.ts` | 9+    |
| Commission disclosure    | `src/knowledge/commission-rules.ts` | 5+    |
| Agent licensing rules    | `src/knowledge/agent-licensing-rules.ts` | 4+ |
| PII detection patterns   | `src/knowledge/pii-rules.ts`       | 8       |
| **Insurance systems**    | `src/knowledge/insurance-systems.ts` | **11** |

Pluggable: replace `embeddings.ts` with pgvector / OpenAI embeddings without
touching the rest of the codebase — `KnowledgeBase.search()` keeps the same
shape.

## 9. Insurance-system catalogue

The agent ships with reference knowledge for **11 systems** in a typical
insurance carrier IT estate. Each entry describes responsibilities, owned data
entities, integrations, technical surface, compliance hot-spots, and what a
coding agent must be careful about when touching it.

| ID                   | System                                  | Category       | Tier    |
| -------------------- | --------------------------------------- | -------------- | ------- |
| `quotation_system`   | Quotation System                        | sales          | tier-1  |
| `as400_life`         | AS400 Life Admin (Policy of Record)     | core_policy    | tier-1  |
| `underwriting_system`| Underwriting System (UW Workbench)      | underwriting   | tier-1  |
| `ams`                | Agency Management System                | distribution   | tier-1  |
| `agency_portal`      | Agency Portal                           | distribution   | tier-1  |
| `pos`                | Point of Sales                          | sales          | tier-1  |
| `customer_portal`    | Customer Portal                         | customer       | tier-2  |
| `payment_gateway`    | Payment Gateway                         | finance        | tier-1  |
| `data_warehouse`     | Data Warehouse                          | data           | tier-2  |
| `bpm`                | Business Process Management             | process        | tier-2  |
| `aml_system`         | AML / KYC / Sanctions Screening         | compliance     | tier-1  |

Programmatic access:

```ts
import { getKnowledgeBase } from 'insure-agent';
const kb = getKnowledgeBase();

kb.search('AS400 batch policy admin', 5);
// → ranked KBHit[] across all six datasets
// kind: 'system' | 'knowledge' | 'compliance' | 'commission' | 'licensing' | 'pii'
```

Or directly:

```ts
import { getSystem, INSURANCE_SYSTEMS } from 'insure-agent/dist/knowledge/insurance-systems.js';
const ams = getSystem('ams');
console.log(ams.complianceHotspots);
```

## 10. Hooks

The hook engine runs reactive automations on Event-Bus events. Built-ins:

| Name                    | Trigger              | Action                                        |
| ----------------------- | -------------------- | --------------------------------------------- |
| `on_file_save`          | `file_changed`       | PII scan + LSP diagnostics                    |
| `on_commission_change`  | `file_changed`       | Auto-run `commission_validator`               |
| `on_compliance_fail`    | `compliance_checked` | Print recommended fixes for criticals         |
| `on_test_completed`     | `test_completed`     | Track pass-rate / fail summary                |
| `on_tool_executed`      | `tool_executed`      | Audit log on errors                           |
| `on_checkpoint_created` | `checkpoint_created` | (silent — for audit)                          |

Register custom hooks via `HookEngine.register({ … })`.

## 11. Project layout

```
src/
├── core/              # Agent engine
│   ├── agent-loop.ts        # Main think → act loop, streaming, multi-tool
│   ├── thinking-loop.ts     # Iteration cap, fail tracking, approvals
│   ├── context-assembler.ts # System prompt + history + tool list builder
│   ├── system-prompt.ts     # Reusable AMS-domain prompt
│   ├── llm-client.ts        # Provider-agnostic chat / chatStream
│   ├── model-router.ts      # Task-type → model routing
│   ├── tool-registry.ts     # Tool registration + param validation
│   ├── tool-executor.ts     # Safety check → execute → checkpoint → event
│   ├── safety-manager.ts    # Auto/confirm/deny gates, dangerous-cmd detect
│   ├── checkpoint.ts        # Per-step file snapshots for undo
│   ├── session.ts           # SQLite-backed session + message store
│   ├── orchestrator.ts      # High-level entry point used by CLI/API
│   ├── lsp-client.ts        # TypeScript LSP integration
│   ├── env.ts               # .env loader (project-root resolution)
│   ├── copilot-auth.ts      # GitHub Copilot OAuth device flow
│   └── database.ts          # better-sqlite3 setup
├── tools/             # 10 registered tools
├── hooks/             # Hook engine + built-in hooks
├── server/            # Express REST API
├── models/            # Provider/model catalogue
├── knowledge/         # KB datasets + TF-IDF index
├── prompts/           # ams-domain.txt
├── pipeline/          # (future) multi-step pipeline types
├── cli/
│   ├── index.ts             # Argument parser + command dispatch
│   ├── chat.ts              # Interactive chat with markdown render
│   └── markdown.ts          # Streaming terminal markdown renderer
├── main.ts            # `npm start` entry — boots HTTP server
└── index.ts           # Library exports
```

## 12. Architecture

```
User Task
    ↓
Context Assembler  (system prompt + history + tools + LSP + KB hits)
    ↓
Agent Loop         (LLM ↔ Tool ↔ Feedback, iterative)
    ↓
Tool Executor     (safety gate → execute → checkpoint → emit event)
    ↓
Response (streamed: thinking → text → tool calls → final)
```

The loop streams reasoning, content and tool calls separately, so the chat UI
can show "thinking" in italic, render the reply as markdown, and pin each tool
call as an expandable step.

For a deeper review of the loop's design vs. modern coding-agent best practice
see [`docs/agent-loop-review.md`](docs/agent-loop-review.md).

## 13. Troubleshooting

| Symptom                                                   | Likely cause / fix                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `No API key for provider: anthropic`                      | Missing `ANTHROPIC_API_KEY` in `.env` (or wrong provider in `DEFAULT_MODEL_PROVIDER`) |
| `Not logged in to GitHub Copilot. Run: insure-agent auth login` | Run that command, finish the device flow                              |
| `EADDRINUSE` on port 7008                                 | Another process holds it: `ss -tlnp \| grep :7008`                              |
| `Cannot find module '../core/env.js'`                     | Run `npm run build` — env loader is compiled output                            |
| Tests fail with "10 tools" mismatch                       | Check that `git-tool.ts` references are gone (it was removed in v0.2)          |
| Streaming hangs                                           | Provider may not support SSE — the loop falls back automatically; check stderr |
| Approval prompt not appearing                             | `INSURE_AGENT_AUTO_APPROVE` is set; remove or set to `false`                   |

Logs (PM2 deploy): `~/.pm2/logs/insure-agent-{out,error}.log`

## 14. Development

```bash
npm run dev          # tsx watch + auto-restart
npm test             # node --test (no failing tests required to pass)
npm run build        # tsc → dist/
npm run cli -- chat  # run CLI without npm link
```

Test coverage: 70+ tests across tools, sessions, hooks, compliance, knowledge,
and the HTTP API.

```bash
npm test
# tests 70+
# pass 70+   fail 0
```

Contributions welcome. Match the existing TypeScript style (strict mode, ES
modules, no `any`).

---

_v0.2 — `git` tool removed; insurance-systems knowledge added; README expanded
into a user manual._
