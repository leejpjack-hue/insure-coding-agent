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
4. [Model Providers](#4-model-providers)
5. [CLI — `insure-agent` command](#5-cli--insure-agent-command)
6. [Interactive Chat](#6-interactive-chat)
7. [AGENT.MD — Project Instructions](#7-agentmd--project-instructions)
8. [Design-First Workflow](#8-design-first-workflow)
9. [HTTP API](#9-http-api)
10. [Tools (10)](#10-tools-10)
11. [Knowledge Base](#11-knowledge-base)
12. [Insurance-system catalogue](#12-insurance-system-catalogue)
13. [Safety & Sandboxing](#13-safety--sandboxing)
14. [Hooks](#14-hooks)
15. [Project layout](#15-project-layout)
16. [Architecture](#16-architecture)
17. [Troubleshooting](#17-troubleshooting)
18. [Development](#18-development)

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
npm link              # global symlink -> ./dist/cli/index.js
# or -- without npm link:
ln -sf "$PWD/dist/cli/index.js" ~/.local/bin/insure-agent
```

Verify:

```bash
insure-agent --help
```

---

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
| `ZHIPU_API_KEY`          | GLM 5.1 (BigModel) -- `id.secret` format        |
| `DEFAULT_MODEL_PROVIDER` | `anthropic`, `openai`, `google`, `deepseek`, `zhipu`, `copilot` |
| `DEFAULT_MODEL`          | Model id, e.g. `claude-sonnet-4`, `gpt-4.1`     |
| `INSURE_AGENT_PORT`      | HTTP port (default `7008`)                      |
| `INSURE_AGENT_HOST`      | Bind host (default `0.0.0.0`)                   |
| `INSURE_AGENT_DB_PATH`   | SQLite path for sessions / messages             |
| `INSURE_AGENT_API_KEY`   | If set, requires `Authorization: Bearer ...` on `/api/*` |
| `AMS_JURISDICTION`       | `HK` (default), `SG`, `EU`, `US`                |
| `MAX_ITERATIONS`         | Agent-loop hard cap per task (default 20)       |
| `MAX_CONSECUTIVE_FAILS`  | Auto-stop after this many tool/LLM failures (default 5) |

> `.env` is git-ignored. Never commit it.

---

## 3. Authenticate (GitHub Copilot)

GitHub Copilot uses an OAuth device flow instead of a static API key. You only
need this if you set `DEFAULT_MODEL_PROVIDER=copilot`.

### Step-by-step

1. **Login**

   ```bash
   insure-agent auth login
   ```

   You'll see a verification URL and an 8-character user code.

2. **Authorize**

   Open the URL in any browser, enter the code, approve the request.

3. **Verify**

   ```bash
   insure-agent auth status
   ```

   Shows your GitHub username and confirms the Copilot token exchange works.

4. **Set as default** -- in your `.env`:

   ```
   DEFAULT_MODEL_PROVIDER=copilot
   ```

The cached GitHub token is exchanged on every chat request for a short-lived
Copilot bearer (~25 min lifetime). Refresh is automatic. Token is stored at
`~/.config/insure-agent/copilot.json` (mode 0600).

You must hold an active **GitHub Copilot** subscription (individual or business)
for the API to grant a token.

### Other auth commands

```bash
insure-agent auth logout     # clear cached credentials
insure-agent auth status     # show login + verify token exchange
```

---

## 4. Model Providers

InsureAgent supports 6 LLM providers. Set your default via `.env` or switch
mid-session with `/model`.

### Available providers

| Provider | API Key env var | Default model | Endpoint |
|----------|----------------|---------------|----------|
| `zhipu` | `ZHIPU_API_KEY` | `glm-5.1` | `api.z.ai` (Coding Plan) |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | `api.anthropic.com` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | `api.openai.com` |
| `google` | `GOOGLE_API_KEY` | `gemini-2.5-pro` | `generativelanguage.googleapis.com` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-v4-flash` | `api.deepseek.com` |
| `copilot` | OAuth (no key) | `gpt-4.1` | `api.githubcopilot.com` |

### Copilot models (via OAuth)

When using `copilot` provider, you get access to multiple models at no per-token
cost:

| Model ID | Description |
|----------|-------------|
| `gpt-4.1` | OpenAI GPT-4.1 (default) |
| `claude-sonnet-4` | Claude Sonnet via Copilot |
| `claude-opus-4` | Claude Opus via Copilot (thinking enabled) |
| `gemini-2.5-pro` | Gemini 2.5 Pro via Copilot |
| `o4-mini` | OpenAI o4-mini reasoning model |

### Switching models

**In `.env` (persistent):**

```
DEFAULT_MODEL_PROVIDER=zhipu
DEFAULT_MODEL=glm-5.1
```

**In chat (runtime):**

```
/model                           # show current model
/model zhipu/glm-5.1            # switch to GLM 5.1
/model copilot/claude-sonnet-4   # switch to Claude via Copilot
/model anthropic/claude-opus-4-7 # switch to Claude Opus
```

The switch takes effect immediately for the next message. It does not persist
across sessions.

### Model routing (task-based)

The agent can route different task types to different models automatically.
Configured in `src/core/model-router.ts`:

| Task type | Default model |
|-----------|---------------|
| `architecture_design` | Claude Opus |
| `commission_logic` | Claude Sonnet |
| `code_generation` | Claude Sonnet |
| `code_review` | Claude Sonnet |
| `test_generation` | DeepSeek Flash |
| `compliance_check` | GPT-4o-mini |
| `documentation` | Gemini 2.5 Pro |
| `daily_completion` | DeepSeek Flash |
| `general` | GLM 5.1 |

---

## 5. CLI -- `insure-agent` command

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
# Start interactive chat
insure-agent chat

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

# One-shot task
insure-agent run "Review src/services/underwriting.ts for AML coverage"
```

---

## 6. Interactive Chat

```bash
insure-agent chat
```

The chat loop streams the model's reasoning and answer with proper terminal
markdown rendering (headings, code blocks, lists, links, bold/italic). Each
tool call is numbered as a **step** with a 5-line preview; the full output is
kept in memory for inspection.

When files are created or modified, a **colored diff** is displayed showing
exactly what changed:

- **Green** `+` lines: added content
- **Red** `-` lines: removed content
- **Gray** lines: unchanged context

### Slash commands

| Command | What it does |
|---------|-------------|
| `/help` | Show command help |
| `/model [provider/model]` | Show current model, or switch (e.g. `/model zhipu/glm-5.1`) |
| `/clear` | End the current session and start a new one |
| `/sessions` | List all saved sessions |
| `/resume [id]` | Resume the last session (or a specific one by id) |
| `/steps` | List every tool-call step (`#1 file_read 12ms ...`) |
| `/show N` | Expand step N to its full output |
| `/last` | Expand the most recent step |
| `/cancel` | Cancel the running task |
| `exit` | Quit |

`Ctrl+C` interrupts the running task without quitting; press again to quit.

### Session management

All conversations are persisted in SQLite (`data/insure-agent.db`). Sessions
survive across restarts. Use `/sessions` to see history and `/resume` to continue
where you left off.

```
/sessions                          # list all sessions with timestamps
/resume                            # resume the most recent session
/resume sess_1746012345_abc123     # resume a specific session
```

When you resume, the full conversation history is loaded so the model has context
from the previous conversation.

---

## 7. AGENT.MD -- Project Instructions

`AGENT.MD` is a project-level instruction file (like `CLAUDE.md` for Claude Code).
Place it in your project root and the agent will load it automatically.

### How it works

1. When the agent starts, it looks for `AGENT.MD`, `agent.md`, or `Agent.md` in
   the project root
2. The contents are injected into the LLM context as a dedicated section
3. The model treats these as mandatory instructions for all tasks

### Example AGENT.MD

```markdown
# Project Instructions

## Architecture
This is a Next.js app using App Router with PostgreSQL via Prisma.

## Code Style
- Use TypeScript strict mode
- Prefer `const` over `let`
- Use Zod for all API input validation

## Rules
- All API endpoints must validate input
- Never commit .env files
- Use file_edit for modifications, not file_write
```

### Without AGENT.MD

The agent still works without it. The system prompt provides default insurance
domain knowledge and the mandatory design-first workflow (see below).

---

## 8. Design-First Workflow

Every feature request, change, or implementation **must** follow this strict
4-step sequence. The agent will not skip steps.

### Step 1 -- Design Document

Before writing any code, the agent produces a design document:

- Saved to `docs/designs/<feature-name>.md`
- Includes: Overview, Requirements, Data Model, API Endpoints, UI Screens,
  Validation Rules, Edge Cases, Non-Functional Requirements
- Presented to you for review before proceeding

### Step 2 -- JIRA Requirement Files

For every design document, the agent generates requirement files:

- Saved to `docs/requirements/<feature-name>/REQ-<NNN>-<title>.md`
- Each file contains: ID, Title, Description, Acceptance Criteria (Gherkin
  Given/When/Then), Priority, Story Points
- A summary file `BACKLOG.md` lists all requirements for JIRA import

### Step 3 -- Test Case Files

For each requirement, the agent generates test cases:

- Saved to `docs/test-cases/<feature-name>/TC-<NNN>-<title>.md`
- Each file contains: Test Case ID, Linked Requirement ID, Pre-conditions,
  Test Steps, Expected Results, Test Data

### Step 4 -- Implementation

Only after Steps 1--3 are complete and you approve the design:

- Code changes are implemented
- Automated tests are written
- Compliance is verified

### Example output structure

```
docs/
  designs/
    partial-surrender.md
  requirements/
    partial-surrender/
      REQ-001-initiate-surrender.md
      REQ-002-calculate-surrender-value.md
      REQ-003-approval-workflow.md
      BACKLOG.md
  test-cases/
    partial-surrender/
      TC-001-initiate-surrender.md
      TC-002-calculate-surrender-value.md
      TC-003-approval-workflow.md
```

### Document templates

#### Design Document

```markdown
# <Feature Name> -- Design Document

## Overview
<1-2 paragraph summary>

## Requirements
- FR-001: <functional requirement>
- NFR-001: <non-functional requirement>

## Data Model
<table/schema definitions>

## API Endpoints
<method> <path> -- <description>

## UI Screens
<screen descriptions>

## Validation Rules
<business rules and constraints>

## Edge Cases
<edge cases and error handling>

## Non-Functional Requirements
<performance, security, compliance notes>
```

#### Requirement File

```markdown
# REQ-<NNN>: <Title>

## Description
<What this requirement covers>

## Acceptance Criteria
Given <context>
When <action>
Then <expected result>

## Priority
<High/Medium/Low>

## Story Points
<estimate>

## Linked Design
docs/designs/<feature-name>.md
```

#### Test Case File

```markdown
# TC-<NNN>: <Title>

## Requirement
REQ-<NNN>

## Pre-conditions
<setup needed>

## Test Steps
1. <step>
2. <step>

## Expected Results
<what should happen>

## Test Data
<sample data>
```

---

## 9. HTTP API

Start with `insure-agent serve` (or `npm start`). All endpoints are under
`/api`. If `INSURE_AGENT_API_KEY` is set, every request must carry
`Authorization: Bearer <key>`.

| Method | Path                          | Description                                                |
| ------ | ----------------------------- | ---------------------------------------------------------- |
| GET    | `/api/health`                 | Liveness -- `{ status, version, tools, uptime }`           |
| GET    | `/api/tools`                  | Tool catalogue                                             |
| POST   | `/api/tools/:name`            | Execute a tool directly with JSON body as params           |
| GET    | `/api/sessions`               | List sessions                                              |
| POST   | `/api/sessions`               | Create a session -- body: `{ projectRoot?, modelConfig? }`  |
| GET    | `/api/sessions/:id`           | Message history for a session                              |
| POST   | `/api/sessions/:id/tasks`     | Run a task -- body: `{ task, taskType? }`                   |
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

---

## 10. Tools (10)

| Tool                   | Safety       | Description                                          |
| ---------------------- | ------------ | ---------------------------------------------------- |
| `file_read`            | auto         | Read a file with optional line range                |
| `file_write`           | confirm      | Create new files only (auto-creates parent dirs)    |
| `file_edit`            | confirm      | Edit existing files (replace `oldContent` with new) |
| `code_search`          | auto         | Substring search across the project root            |
| `bash_execute`         | confirm      | Shell command (timeout, PII masking, danger detect) |
| `commission_validator` | auto         | Calculate / simulate / compare commission           |
| `license_checker`      | auto         | Status, product authorisation, CPD hours            |
| `schema_reader`        | auto         | List tables / columns / relations                   |
| `api_tester`           | auto         | GET/POST/PUT/DELETE/PATCH with assertions           |
| `compliance_checker`   | auto         | Run jurisdiction rules + PII scan against a file    |

### Tool selection rules

The agent follows these rules automatically:

- **`file_write`** -- only for creating brand-new files
- **`file_edit`** -- preferred for all modifications to existing files (reads
  the file first, then applies a precise replacement)
- **`bash_execute`** -- blocked for destructive commands (`rm -rf /`, `drop
  table`, `mkfs`, etc.) unless explicitly approved

---

## 11. Knowledge Base

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

---

## 12. Insurance-system catalogue

The agent ships with reference knowledge for **11 systems** in a typical
insurance carrier IT estate.

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

---

## 13. Safety & Sandboxing

### File sandbox

All file operations are restricted to the project root directory. The agent
cannot read, write, or edit files outside the project it was started in.

- Path traversal attacks (`../../etc/passwd`) are blocked
- Absolute paths outside the project are rejected
- Relative paths are resolved against the project root

### PII masking

All tool output is automatically masked:

| Pattern | Example | Masked as |
|---------|---------|-----------|
| HKID | `A123456B` | `[HKID_REDACTED]` |
| Email | `user@example.com` | `[EMAIL_REDACTED]` |
| Phone (HK) | `98765432` | `[PHONE_REDACTED]` |
| Policy number | `POL123456` | `[POLICY_REDACTED]` |

### Safety levels

| Level | Behaviour |
|-------|-----------|
| `auto_approve` | Runs without prompting |
| `need_confirmation` | Requires approval (auto-approved for first 10 iterations) |
| `deny` | Blocked entirely |

### Dangerous command detection

`bash_execute` is checked against a blocklist including:
- `rm -rf /`, `rm -rf *`
- `drop table/database`, `truncate table`
- `mkfs`, `dd if=`, `> /dev/sda`
- `curl | sh`, `wget | sh`
- Fork bombs

---

## 14. Hooks

The hook engine runs reactive automations on Event-Bus events. Built-ins:

| Name                    | Trigger              | Action                                        |
| ----------------------- | -------------------- | --------------------------------------------- |
| `on_file_save`          | `file_changed`       | PII scan + LSP diagnostics                    |
| `on_commission_change`  | `file_changed`       | Auto-run `commission_validator`               |
| `on_compliance_fail`    | `compliance_checked` | Print recommended fixes for criticals         |
| `on_test_completed`     | `test_completed`     | Track pass-rate / fail summary                |
| `on_tool_executed`      | `tool_executed`      | Audit log on errors                           |
| `on_checkpoint_created` | `checkpoint_created` | (silent -- for audit)                          |

Register custom hooks via `HookEngine.register({ ... })`.

---

## 15. Project layout

```
src/
  core/              # Agent engine
    agent-loop.ts        # Main think -> act loop, streaming, multi-tool
    thinking-loop.ts     # Iteration cap, fail tracking, approvals
    context-assembler.ts # System prompt + AGENT.MD + history + tool list
    llm-client.ts        # Provider-agnostic chat / chatStream
    model-router.ts      # Task-type -> model routing
    tool-registry.ts     # Tool registration + param validation
    tool-executor.ts     # Safety check -> execute -> checkpoint -> event
    safety-manager.ts    # Auto/confirm/deny gates, dangerous-cmd detect
    checkpoint.ts        # Per-step file snapshots for undo
    session.ts           # SQLite-backed session + message store
    orchestrator.ts      # High-level entry point used by CLI/API
    copilot-auth.ts      # GitHub Copilot OAuth device flow
    database.ts          # better-sqlite3 setup
  tools/             # 10 registered tools
  hooks/             # Hook engine + built-in hooks
  server/            # Express REST API
  models/            # Provider/model catalogue
  knowledge/         # KB datasets + TF-IDF index
  cli/
    index.ts             # Argument parser + command dispatch
    chat.ts              # Interactive chat with markdown + diff rendering
    diff.ts              # Colored diff display (LCS-based)
    markdown.ts          # Streaming terminal markdown renderer
  main.ts            # `npm start` entry -- boots HTTP server
  index.ts           # Library exports
```

---

## 16. Architecture

```
User Task
    |
Context Assembler  (system prompt + AGENT.MD + history + tools + KB hits)
    |
Agent Loop         (LLM <-> Tool <-> Feedback, iterative)
    |
Tool Executor     (sandbox check -> safety gate -> execute -> checkpoint -> event)
    |
Response (streamed: thinking -> text -> tool calls -> colored diff -> final)
```

The loop streams reasoning, content and tool calls separately, so the chat UI
can show "thinking" in italic, render the reply as markdown, and pin each tool
call as an expandable step with a colored diff for file changes.

---

## 17. Troubleshooting

| Symptom | Likely cause / fix |
|---------|-------------------|
| `No API key for provider: anthropic` | Missing `ANTHROPIC_API_KEY` in `.env` (or wrong provider in `DEFAULT_MODEL_PROVIDER`) |
| `Not logged in to GitHub Copilot` | Run `insure-agent auth login`, complete the device flow |
| `EADDRINUSE` on port 7008 | Another process holds it: `ss -tlnp \| grep :7008` |
| `Cannot find module '../core/env.js'` | Run `npm run build` |
| Streaming hangs | Provider may not support SSE -- the loop falls back automatically |
| Agent uses `file_write` instead of `file_edit` | The system prompt now guides the model; if it still happens, tell the agent "use file_edit" |
| `Insufficient balance` (Zhipu) | You're using the wrong endpoint -- Coding Plan uses `api.z.ai`, not `open.bigmodel.cn` |

Logs (PM2 deploy): `~/.pm2/logs/insure-agent-{out,error}.log`

---

## 18. Development

```bash
npm run dev          # tsx watch + auto-restart
npm test             # node --test
npm run build        # tsc -> dist/
npm run cli -- chat  # run CLI without npm link
```

Contributions welcome. Match the existing TypeScript style (strict mode, ES
modules, no `any`).

---

_v0.3 -- AGENT.MD support, design-first workflow, colored diff display, session
resume, model switching, Copilot OAuth._
