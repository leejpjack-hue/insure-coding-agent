# InsureAgent Project Instructions

This file contains project-specific instructions that the agent follows for every task.

## Project Overview
Insurance Agency Management System (AMS) coding agent built with TypeScript/Node.js.
The agent assists IT teams in developing, maintaining, and optimizing AMS software.

## Architecture
- `src/core/` — Agent loop, LLM client, session management, safety, context assembly
- `src/tools/` — Tool definitions (file ops, bash, commission validator, license checker, etc.)
- `src/cli/` — CLI interface (interactive chat, diff display)
- `src/server/` — HTTP API server
- `src/models/` — Model provider definitions

## Code Conventions
- TypeScript with ES module output
- Tools register via ToolRegistry with OpenAI function-calling format
- All file operations sandboxed to project root
- PII masking (HKID, email, phone, policy numbers) applied to tool output
- Streaming SSE for LLM responses with reasoning_content support

## Mandatory Workflow — Design-First Process

### Rule 1: Design Before Code
Every new feature, change, or enhancement MUST start with a design document.
- If the user asks to implement something, ALWAYS produce a design doc first.
- If the user asks to skip the design and just code, explain that the design-first process is mandatory.
- Save design to: `docs/designs/<feature-name>.md`

### Rule 2: Requirements for Every Design
Every design document MUST have corresponding JIRA-ready requirement files.
- One requirement file per logical requirement.
- Gherkin acceptance criteria (Given/When/Then).
- Save to: `docs/requirements/<feature-name>/REQ-<NNN>-<title>.md`
- Include a BACKLOG.md summary for JIRA import.

### Rule 3: Test Cases for Every Requirement
Every requirement file MUST have corresponding test case files.
- One test case file per requirement.
- Linked by requirement ID.
- Save to: `docs/test-cases/<feature-name>/TC-<NNN>-<title>.md`

### Document Templates

#### Design Document Template
```markdown
# <Feature Name> — Design Document

## Overview
<1-2 paragraph summary>

## Requirements
- FR-001: <functional requirement>
- NFR-001: <non-functional requirement>

## Data Model
<table/schema definitions>

## API Endpoints
<method> <path> — <description>

## UI Screens
<screen descriptions and wireframes>

## Validation Rules
<business rules and constraints>

## Edge Cases
<edge cases and error handling>

## Non-Functional Requirements
<performance, security, compliance notes>
```

#### Requirement File Template
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

#### Test Case File Template
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
