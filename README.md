# InsureAgent — Insurance AMS Coding Agent

A coding agent specialized for Insurance Agency Management Systems (AMS).

## Quick Start

```bash
npm install
npm run build
npm start
```

Server runs on **port 7008**.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/tools` | List all tools |
| POST | `/api/tools/:name` | Execute a tool directly |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/:id` | Get session history |
| POST | `/api/sessions/:id/tasks` | Run task |
| POST | `/api/sessions/:id/undo` | Undo last action |
| GET | `/api/hooks` | List hooks |

## Tools (11)

| Tool | Safety | Description |
|------|--------|-------------|
| `file_read` | ✅ auto | Read file content |
| `file_write` | ⚠️ confirm | Write file |
| `file_edit` | ⚠️ confirm | Edit file (diff-based) |
| `code_search` | ✅ auto | Search code |
| `bash_execute` | ⚠️ confirm | Run shell commands |
| `git` | ✅ auto | Git operations |
| `commission_validator` | ✅ auto | Validate commission formulas |
| `license_checker` | ✅ auto | Check agent licenses |
| `schema_reader` | ✅ auto | Read database schema |
| `api_tester` | ✅ auto | Test API endpoints |
| `compliance_checker` | ✅ auto | Check regulatory compliance |

## Architecture

```
User Task
    ↓
Context Assembler (system prompt + history + tools + LSP)
    ↓
Agent Loop (LLM → Tool → Feedback → repeat)
    ↓
Tool Executor (safety check → execute → checkpoint → event)
    ↓
Response
```

## AMS Domain Coverage

- **Commission Engine**: Tiered rates by agent level, product type, policy year
- **License Management**: Status tracking, CE hours, expiry alerts
- **Compliance**: HK PDPO, IA GL20/21, Insurance Ordinance Cap 41
- **Team Hierarchy**: Agent → UM → BM → Regional Director

## Tech Stack

- TypeScript + ES Modules
- Express HTTP API
- better-sqlite3 persistence
- AI SDK (multi-provider LLM)
- Node.js 22+

## Project Structure

```
src/
├── core/          # Agent engine (loop, tools, session, events)
├── tools/         # Built-in tools (file, bash, git, AMS-specific)
├── hooks/         # Automation hooks
├── server/        # Express REST API
├── models/        # Model configurations
├── knowledge/     # AMS domain knowledge
├── main.ts        # Server entry point
└── index.ts       # Library exports
```
