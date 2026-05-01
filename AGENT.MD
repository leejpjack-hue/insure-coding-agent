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

### Rule 4: Use auto-retrieved Domain Knowledge
Each turn the context includes a `## Relevant Domain Knowledge (auto-retrieved)`
section with the top KB hits for the task — system catalogue entries (AS400 Life,
AMS, Underwriting, Agency Portal, POS, Customer Portal, Payment Gateway, BPM,
Data Warehouse, AML), compliance rules, commission disclosure rules, licensing
rules, and PII rules.

**Use them.** When a hit names a regulation, cite it in your design. When a hit
warns of an integration caveat (e.g. AS400 batch windows, idempotency on Payment
Gateway, AML auto-clear restrictions), surface that caveat in your edge cases.
Skipping these hits when they're directly relevant is a quality failure.

### Design-Quality Rubric

A complete design document — at minimum — covers all of the following. If a
section is genuinely N/A, say so explicitly rather than omitting it.

| Section | What "complete" looks like |
| --- | --- |
| Overview | One paragraph: who needs this, why, and the business outcome |
| Actors | Every human and system actor (≥3 typically), with their role |
| Pre-conditions | Concrete checks that must hold before the flow can start |
| Process Steps | Numbered happy path; each step names the responsible system |
| Data Model | TypeScript-style interfaces or SQL DDL with key constraints |
| State Machine | All states + every transition (success, failure, cancellation) |
| Compliance | Cite the specific regulation by ID (e.g. HK IA GL21, GDPR Art. 6) |
| Edge Cases | At least 5; see rubric below |
| Approval / SLA | Threshold table when amounts or risk drive routing |
| Open Questions | Things you would ask product / compliance before coding |

### Edge-Case Rubric

When enumerating edge cases, deliberately walk these categories. Skipping a
category is acceptable only if the design genuinely doesn't touch it.

1. **Pre-condition failure** — what if a required check fails (e.g. expired licence, policy not in-force)?
2. **Mid-flow failure** — what if the network drops between two of the steps?
3. **Partial state** — what if the customer signs but the back-office never receives the case?
4. **Concurrent actor** — what if two agents act on the same record simultaneously?
5. **Stale data** — what if the quoted value or rate-table snapshot has aged out?
6. **Regulatory exception** — cooling-off, vulnerable customer, AML high-risk, sanctions hit
7. **Lien / encumbrance** — what if the policy has premium financing or an existing claim?
8. **Customer cancels mid-flow** — at every step, can they?
9. **Actor leaves mid-flow** — agent terminated, customer dies, signatory unavailable
10. **Out-of-band channel race** — same change requested via the customer portal at the same time
11. **Currency / FX** — for cross-border products
12. **Timezone / batch window** — for AS400-backed systems with overnight cycles

A good design surfaces at least 5 of these; a great design surfaces 8+ with
named mitigations.

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
