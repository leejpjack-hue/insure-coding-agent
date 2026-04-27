# InsureAgent Development Phases

## Phase 1: Project Foundation + Core Types (0:00)
Build the foundational project structure, core TypeScript types/interfaces, and configuration system.

Create these files:
- `src/core/types.ts` — All core interfaces (Agent, Session, Message, ToolCall, ToolResult, Checkpoint, Event, Pipeline, ModelConfig)
- `src/core/config.ts` — Configuration management (port, model configs, safety limits, AMS domain settings)
- `src/core/events.ts` — Event Bus implementation (EventEmitter-based pub/sub system)
- `src/core/checkpoint.ts` — Checkpoint manager (save/restore file snapshots, undo support)
- `src/core/session.ts` — Session manager (create/restore/pause/fork sessions, persistence to SQLite)
- `src/index.ts` — Entry point placeholder

Constraints:
- Use ES modules (type: "module" in package.json)
- All types must be explicit, no `any`
- Session persistence uses better-sqlite3

## Phase 2: Tool System Framework (1:00)
Build the generic tool system that the agent loop uses.

Create:
- `src/core/tool-registry.ts` — Tool registry (register/discover tools, validate params, execute with safety checks)
- `src/core/tool-executor.ts` — Tool executor (safety check → execute → capture result → emit event → save checkpoint)
- `src/tools/file-tools.ts` — file_read, file_write, file_edit, code_search
- `src/tools/bash-tool.ts` — bash_execute (with timeout, PII masking in output, dangerous command detection)
- `src/tools/git-tool.ts` — git operations (status, diff, log, commit, branch)

Each tool must:
- Have a TypeScript interface for params and returns
- Validate inputs before execution
- Emit events to Event Bus
- Support safety levels (auto-approve / need-confirmation / deny)

## Phase 3: LSP Client + Context Assembler (2:00)
Build LSP integration and the context assembly system.

Create:
- `src/core/lsp-client.ts` — LSP client that connects to TypeScript/Java language servers via stdio, supports diagnostics, hover, definition, references
- `src/core/context-assembler.ts` — Assembles the full context for each LLM call: system prompt + project context + tool list + session history + LSP diagnostics + recent files
- `src/core/system-prompt.ts` — System prompt builder for AMS domain (commission rules, licensing, compliance)
- `src/prompts/ams-domain.txt` — AMS domain knowledge text for system prompt

LSP client should:
- Auto-start TypeScript language server
- Watch for file changes and re-check diagnostics
- Cache diagnostics per file
- Feed diagnostics into Event Bus

## Phase 4: Model Router + LLM Integration (3:00)
Build the model routing system and LLM provider integration.

Create:
- `src/core/model-router.ts` — Routes tasks to optimal models based on task type, complexity, cost
- `src/core/llm-client.ts` — Unified LLM client using AI SDK (supports Anthropic, OpenAI, Google, custom endpoints)
- `src/models/providers.ts` — Provider configurations (model IDs, costs, capabilities)
- `src/core/thinking-loop.ts` — Thinking loop controller (max iterations, consecutive fail tracking, auto-fix toggle)

Model Router logic:
- architecture_design → Claude Opus 4.7
- commission_logic → Claude Sonnet / Gemini Pro
- code_review → Claude Sonnet
- test_generation → DeepSeek V4 Flash / GPT-4o-mini
- compliance → specialized model
- daily_completion → DeepSeek V4 Flash

## Phase 5: Agent Loop Engine (4:00)
Build the core agent loop that ties everything together.

Create:
- `src/core/agent-loop.ts` — The main loop: receive task → assemble context → call LLM → parse response → execute tool OR return text OR ask follow-up → integrate feedback → repeat
- `src/core/orchestrator.ts` — Task orchestrator that routes user tasks to appropriate pipelines
- `src/pipeline/types.ts` — Pipeline interfaces
- `src/core/safety-manager.ts` — Manages safety checks before each tool execution (permission levels, rate limiting, dangerous command detection)

Agent loop must:
- Track iteration count
- Auto-fix on test failures (up to maxConsecutiveFails)
- Request user approval when needed
- Save checkpoint before each tool execution
- Emit all events to Event Bus
- Handle LLM errors gracefully (retry with backoff)

## Phase 6: AMS Tools — Commission Validator + License Checker (5:00)
Build the insurance-specific tools.

Create:
- `src/tools/commission-validator.ts` — Validates commission calculation formulas, simulates commission for different agent tiers/products, compares old vs new formulas, identifies edge cases
- `src/tools/license-checker.ts` — Checks agent license status, product authorization, lists expiring licenses, validates continuing education hours
- `src/tools/schema-reader.ts` — Reads database schema (list tables, describe table, find relations, sample data) using better-sqlite3
- `src/tools/api-tester.ts` — Tests API endpoints (GET/POST/PUT/DELETE), measures response time, validates expected responses

Each tool must:
- Register with ToolRegistry
- Have full TypeScript interfaces
- Include input validation
- Emit events
- Be unit-testable

## Phase 7: Compliance Checker Tool (6:00)
Build the compliance checking system.

Create:
- `src/tools/compliance-checker.ts` — Main compliance checker tool
- `src/knowledge/compliance-rules.ts` — Structured compliance rules database (HK IA GL20/21, Solvency II, IFRS 17, MAS, GDPR/PDPO)
- `src/knowledge/commission-rules.ts` — Commission disclosure rules per jurisdiction
- `src/knowledge/agent-licensing-rules.ts` — Agent licensing requirements per jurisdiction
- `src/knowledge/pii-rules.ts` — PII detection and masking rules

Compliance checker must:
- Scan changed files for potential violations
- Check commission calculation changes against disclosure rules
- Verify agent licensing logic is correct
- Detect PII in code (HKID, policy numbers, medical data)
- Return violations with severity, file, line, recommendation
- Generate audit trail entries

## Phase 8: Hooks System (7:00)
Build the automation hooks system.

Create:
- `src/hooks/hook-engine.ts` — Hook engine that listens to Event Bus events and triggers actions
- `src/hooks/built-in-hooks.ts` — Pre-built hooks:
  - on_file_save: run LSP + PII scan
  - on_commission_change: run commission_validator automatically
  - on_pr_open: run regression tests + compliance check
  - on_license_expiry: check for agents with licenses expiring in 30 days
  - on_compliance_fail: auto-suggest fixes
- `src/hooks/hook-types.ts` — Hook interfaces and types

Hook engine must:
- Support async hook execution
- Allow user-defined hooks (config file)
- Support conditional triggers (file path patterns, event types)
- Not block the main agent loop

## Phase 9: Express Server + REST API (8:00)
Build the HTTP server that exposes the agent.

Create:
- `src/server/index.ts` — Express server setup
- `src/server/routes/session.ts` — Session management routes (create, list, restore, pause, delete)
- `src/server/routes/agent.ts` — Agent interaction routes (send task, get status, get history)
- `src/server/routes/tools.ts` — Direct tool execution routes (for testing individual tools)
- `src/server/routes/health.ts` — Health check endpoint
- `src/server/middleware/auth.ts` — API key authentication middleware
- `src/server/middleware/rate-limit.ts` — Rate limiting middleware

API endpoints:
- POST /api/sessions — Create new session
- GET /api/sessions/:id — Get session status
- POST /api/sessions/:id/tasks — Send task to agent
- POST /api/sessions/:id/undo — Undo last action
- POST /api/tools/:name — Execute a tool directly
- GET /api/health — Health check

## Phase 10: Database + Knowledge Base (9:00)
Build the persistence and knowledge layers.

Create:
- `src/core/database.ts` — SQLite database setup with better-sqlite3 (sessions, messages, checkpoints, audit_trail tables)
- `src/knowledge/knowledge-base.ts` — Knowledge base that loads AMS domain knowledge into vector store (pgvector or in-memory)
- `src/knowledge/ams-knowledge.ts` — AMS domain knowledge: commission structures, licensing flows, product types, team hierarchies, compliance rules
- `src/knowledge/embeddings.ts` — Simple embedding system for knowledge retrieval

Database schema:
- sessions: id, project_root, status, created_at, updated_at, model_config
- messages: id, session_id, role, content, tool_call, tool_result, timestamp
- checkpoints: id, session_id, iteration, file_snapshots, created_at
- audit_trail: id, session_id, action, details, timestamp

## Phase 11: Testing Pipeline + Integration Tests (10:00)
Build comprehensive tests.

Create:
- `tests/agent-loop.test.ts` — Test the full agent loop with mock LLM
- `tests/tools.test.ts` — Test all tools (file, bash, git, commission, license, compliance)
- `tests/compliance.test.ts` — Test compliance checker with known violation scenarios
- `tests/commission.test.ts` — Test commission validator with sample formulas
- `tests/session.test.ts` — Test session create/restore/pause/fork
- `tests/api.test.ts` — Test REST API endpoints
- `tests/hooks.test.ts` — Test hook triggers and actions

Use Node.js built-in test runner (node:test). Mock LLM responses for deterministic testing.

## Phase 12: CLI + Final Integration (11:00)
Build the CLI interface and final integration.

Create:
- `src/cli/index.ts` — CLI entry point (parse args, start server or run one-shot task)
- `src/cli/commands.ts` — CLI commands:
  - `insure-agent serve` — Start server
  - `insure-agent run "task"` — Run one-shot task
  - `insure-agent session list` — List sessions
  - `insure-agent session restore <id>` — Restore session
  - `insure-agent tools list` — List available tools
  - `insure-agent validate commission` — Validate commission formulas
  - `insure-agent check compliance` — Run compliance check
- `src/cli/progress.ts` — Progress display (spinner, iteration count, tool calls)

Final integration:
- Wire everything together in src/index.ts
- Ensure all tools register properly
- Test full flow: CLI → Server → Agent Loop → Tools → LLM → Response
- Add README.md with usage instructions
- Ensure `npm run build` compiles cleanly
