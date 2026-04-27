# InsureAgent — 保險代理人管理系統 Coding Agent 設計書 v3.0

> 聚焦 Agent Management System（代理人管理系統）+ 詳細 Coding Agent 機制
> 移除所有 AS400/Mainframe/Legacy 相關內容

---

## 1. 產品定位

InsureAgent 係一個 **Coding Agent**，專門幫 IT 團隊開發、維護同優化保險代理人管理系統（AMS）。

### AMS 核心功能模組

| 模組 | 功能 |
|------|------|
| **Agent Profile** | 代理人註冊、基本資料、層級、團隊架構 |
| **License Management** | 發牌、續牌、暫停、投訴、處分 |
| **Product Authorization** | 邊個 agent 可以賣邊種產品、培訓要求 |
| **Commission Engine** | 佣金計算、階梯、分配、團隊佣金 |
| **Performance Tracking** | 業績、KPI、排名、獎勵 |
| **Customer Assignment** | 客戶分配、關係管理、轉移 |
| **Compliance Monitor** | 牌照續期提醒、持續培訓、合規報表 |

---

## 2. Coding Agent 核心機制

### 2.1 Agent Loop 引擎

```
User Task → Context Assembly → LLM Decision → Tool Execution → Feedback → Loop
```

#### Step 1: Context Assembly（上下文組裝）

每次 LLM 調用前，自動組裝：

```
System Prompt（保險 AMS 領域知識）
+ Project Context（項目結構、conventions）
+ Available Tools（可用工具列表 + 描述）
+ Session History（之前嘅對話 + tool 結果）
+ LSP Diagnostics（即時語法錯誤）
+ Recent Files（最近打開嘅文件）
+ Compliance Rules（適用嘅監管要求）
```

System Prompt 結構：

```
[Role] 你係 InsureAgent，專注保險 AMS 開發

[Domain Knowledge]
- 佣金計算規則（flat rate / tiered / override）
- 代理人發牌流程（HK IA / MAS / NAIC）
- 保險產品類型（Life/Health/Property/Motor/Travel）
- 監管合規要求
- 團隊層級架構（Agent → Unit Manager → Branch Manager → Regional Director）

[Tools]
- file_read, file_write, file_edit, code_search
- bash_execute, lsp_client, git
- schema_reader, api_tester
- commission_validator, license_checker, compliance_checker

[Constraints]
- 所有佣金計算必須有單元測試
- API 必須有 input validation
- PII 數據必須加密
- 改動必須通過 compliance check
- 佣金公式變更必須有 audit trail

[Working Style]
- 簡潔直接，唔講廢話
- 先理解再動手
- 每步都跑測試驗證
- 遇到合規問題立即標記
```

#### Step 2: LLM Decision（模型決策）

LLM 返回三種之一：
- **tool_use** — 調用工具（例：`file_read("src/services/commission.service.ts")`）
- **text_output** — 直接回覆用戶
- **follow-up** — 向用戶提問（需要澄清）

#### Step 3: Tool Execution（工具執行）

```
Tool Executor 收到 tool_use
    │
    ├── Safety Check
    │   ├── 呢個操作有冇權限？
    │   ├── 會唔會改到生產數據？
    │   ├── 需要唔需要用戶確認？
    │   └── 有冊超過 rate limit？
    │
    ├── 如果安全 → 執行 Tool
    └── 如果危險 → 暫停，向用戶請求確認
    
    執行結果 + Side Effects：
    ├── LSP: 即時語法檢查
    ├── Event Bus: 通知其他組件
    └── Checkpoint: 保存呢步狀態（可 undo）
```

#### Step 4: Feedback Integration（反饋整合）

Tool result + LSP diagnostics + Test results 全部加入 LLM context → 返回 Step 2

#### Step 5: Completion（完成）

```
Agent 認為任務完成：
1. 跑所有相關測試
2. 跑 compliance check  
3. 跑 commission_validator（如果改咗佣金邏輯）
4. 生成變更摘要
5. 請求用戶 review
6. 用戶 approve → git commit + 可選 PR
```

---

### 2.2 Tool System 詳細 TypeScript 接口

#### 通用 Tools

```typescript
// 文件讀取
interface FileReadTool {
  name: "file_read";
  params: { path: string; startLine?: number; endLine?: number };
  returns: { content: string; totalLines: number; language: string };
}

// 文件編輯（diff-based）
interface FileEditTool {
  name: "file_edit";
  params: {
    path: string;
    oldContent: string;    // 要替換嘅原始內容
    newContent: string;    // 新內容
  };
  // Safety: 自動備份到 .checkpoint/
}

// 文件寫入
interface FileWriteTool {
  name: "file_write";
  params: { path: string; content: string; createDirs?: boolean };
  // Safety: 覆蓋現有文件需要確認
}

// Shell 執行
interface BashExecuteTool {
  name: "bash_execute";
  params: {
    command: string;
    cwd?: string;
    timeout?: number;
  };
  returns: { stdout: string; stderr: string; exitCode: number };
  // Safety: 危險命令需確認，自動 PII 遮蔽
}

// LSP 客戶端
interface LSPClientTool {
  name: "lsp_client";
  params: {
    action: "diagnostics" | "hover" | "definition" | "references";
    filePath: string;
    line: number;
    column: number;
  };
  returns: {
    diagnostics: Array<{
      severity: "error" | "warning" | "info";
      message: string;
      line: number;
    }>;
  };
  // 背景：每次文件修改後自動觸發
}

// 代碼搜索
interface CodeSearchTool {
  name: "code_search";
  params: {
    query: string;
    path?: string;
    fileType?: string;
    maxResults?: number;
  };
}

// Git
interface GitTool {
  name: "git";
  params: {
    action: "status" | "diff" | "log" | "commit" | "branch" | "add";
    args?: string[];
  };
}
```

#### AMS 專用 Tools

```typescript
// ===== 佣金驗證器 =====
interface CommissionValidatorTool {
  name: "commission_validator";
  params: {
    action: "validate_formula" | "simulate" | "compare";
    formula?: string;
    testCases?: Array<{
      input: {
        agentLevel: "bronze" | "silver" | "gold" | "platinum";
        productType: "life" | "health" | "property" | "motor" | "travel";
        premiumAmount: number;
        policyYear: number;
        isRenewal: boolean;
        teamSize?: number;
      };
      expectedCommission: number;
    }>;
  };
  returns: {
    isValid: boolean;
    calculatedCommission: number;
    discrepancies?: string[];
    edgeCases?: string[];
  };
}

// ===== 牌照檢查器 =====
interface LicenseCheckerTool {
  name: "license_checker";
  params: {
    action: "check_status" | "check_authorization" | "list_expiring";
    agentId?: string;
    productType?: string;
    daysUntilExpiry?: number;
  };
  returns: {
    status: "active" | "expired" | "suspended" | "pending_renewal";
    authorizedProducts: string[];
    expiryDate: string;
    ceHours: number;
    requiredHours: number;
  };
}

// ===== Schema Reader =====
interface SchemaReaderTool {
  name: "schema_reader";
  params: {
    action: "list_tables" | "describe_table" | "list_relations" | "sample_data";
    tableName?: string;
  };
  returns: {
    tables?: string[];
    columns?: Array<{ name: string; type: string; nullable: boolean }>;
    relations?: Array<{ from: string; to: string; type: string }>;
  };
}

// ===== API 測試器 =====
interface APITesterTool {
  name: "api_tester";
  params: {
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    url: string;
    headers?: Record<string, string>;
    body?: any;
    expectStatus?: number;
  };
  returns: {
    status: number;
    body: any;
    duration: number;
    matches: boolean;
  };
}

// ===== 合規檢查器 =====
interface ComplianceCheckerTool {
  name: "compliance_checker";
  params: {
    changedFiles: string[];
    jurisdiction: "HK" | "SG" | "EU" | "US";
    checkTypes: Array<
      "data_privacy" |
      "commission_disclosure" |
      "agent_licensing" |
      "consumer_protection" |
      "reporting"
    >;
  };
  returns: {
    violations: Array<{
      type: string;
      severity: "critical" | "warning" | "info";
      file: string;
      line: number;
      description: string;
      recommendation: string;
    }>;
    overallRiskScore: number;
    pass: boolean;
  };
}
```

---

### 2.3 Thinking Loop 實例

```
用戶任務："加一個新嘅佣金階梯計算功能"

Iteration 1: LLM 讀取現有佣金代碼
  → Tool: file_read("src/services/commission.service.ts")
  → LSP: ✅ 冇錯誤

Iteration 2: LLM 讀取 DB schema
  → Tool: schema_reader("list_tables")
  → 發現需要新 commission_tiers table

Iteration 3: LLM 建立 migration
  → Tool: file_write("migrations/xxx_commission_tiers.sql")
  → LSP: ✅ 冇錯誤

Iteration 4: LLM 修改 commission service
  → Tool: file_edit(commission.service.ts)
  → LSP: ⚠️ Type error (line 45)

Iteration 5: 自動修正 type error
  → Tool: file_edit(fix type)
  → LSP: ✅ 冇錯誤

Iteration 6: 生成單元測試
  → Tool: file_write("tests/commission.tier.test.ts")
  → Tool: bash_execute("npm test")
  → 結果: ❌ 2/8 tests failed

Iteration 7: 自動修正邊界值問題
  → Tool: file_edit(fix boundary)
  → Tool: bash_execute("npm test")
  → 結果: ✅ 8/8 tests passed

Final Check:
  Commission Validator: ✅
  Compliance Checker: ✅
  LSP Diagnostics: ✅
  → 生成變更摘要 → 請求用戶 Review

設定：
  maxIterations: 20
  maxConsecutiveFails: 5
  autoFix: true
  requireApprovalAfter: 10
```

---

### 2.4 Checkpoint & Undo

```typescript
interface Checkpoint {
  id: string;
  timestamp: number;
  iteration: number;
  description: string;
  fileSnapshots: Map<string, string>;  // path → content
}

// 每次 Tool 執行前自動保存
// 用戶可隨時 undo 到任何 Checkpoint
// 最多保存最近 50 個
```

### 2.5 Session 管理

```typescript
interface Session {
  id: string;
  status: "active" | "paused" | "completed" | "failed";
  projectRoot: string;
  modelConfig: ModelConfig;
  messages: Message[];         // 完整對話歷史
  currentIteration: number;
  totalTokensUsed: number;
  totalCost: number;
  filesModified: string[];
  testsRun: number;
  testsPassed: number;
  
  save(): void;               // 持久化到 disk
  restore(id: string): void;  // 從 disk 恢復
  fork(): Session;            // 分支（試驗性改動）
}
```

### 2.6 Event Bus

```typescript
type Event =
  | { type: "file_changed"; path: string }
  | { type: "lsp_diagnostic"; file: string; diagnostics: Diagnostic[] }
  | { type: "tool_executed"; tool: string; result: any }
  | { type: "test_completed"; passed: number; failed: number }
  | { type: "compliance_checked"; violations: Violation[] }
  | { type: "checkpoint_created"; id: string }
  | { type: "user_input_required"; message: string };

// 訂閱者：
// - Context Assembler（加入 LLM context）
// - Hook Engine（觸發自動化）
// - Checkpoint Manager
// - Audit Logger
// - Dashboard（實時狀態）
```

---

## 3. Model Router

| 任務 | 模型 | 原因 | 成本 |
|------|------|------|------|
| 架構設計 | Claude Opus 4.7 | 深度推理 | $$$$ |
| 佣金邏輯生成 | Claude Sonnet / Gemini Pro | 質量+速度 | $$ |
| Code Review | Claude Sonnet | 準確性 | $$$ |
| 單元測試 | DeepSeek V4 Flash / GPT-4o-mini | 快+平 | $ |
| 合規檢查 | Fine-tuned 模型 | 領域專精 | $$$ |
| 日常補全 | DeepSeek V4 Flash | 極低 | ¢ |

---

## 4. Hooks & Automation

| Hook | 觸發 | 動作 |
|------|------|------|
| `on_file_save` | 文件保存 | LSP 檢查 + PII scan |
| `on_commission_change` | 佣金相關文件變更 | 自動跑 commission_validator |
| `on_pr_open` | PR 建立 | 回歸測試 + compliance check |
| `on_license_expiry` | 定時檢查 | 到期 30 日前提醒 |
| `on_deploy_stage` | 部署到 staging | Smoke test + Canary |
| `on_compliance_fail` | 合規檢查失敗 | 自動建議修正 |

---

## 5. 安全設計

| 層 | 設計 |
|-----|------|
| **Data Protection** | PII 自動遮蔽、加密存儲、TLS 1.3 |
| **Access Control** | RBAC（精算師/開發者/合規官）、租戶隔離 |
| **Audit** | 不可篡改操作日誌、變更審批流程 |
| **Operational** | Checkpoint per step、Rate limiting、Kill switch |

---

## 6. 技術棧

| 層 | 技術 |
|-----|------|
| Agent Server | TypeScript + Bun + Hono |
| CLI/TUI | Go |
| VS Code Extension | Extension API + Webview |
| LLM | AI SDK（provider-agnostic）|
| Knowledge Base | pgvector + Neo4j |
| Frontend | React / Flutter Web |
| CI/CD | GitHub Actions |

---

## 7. MVP Roadmap

| Phase | 時間 | 交付物 |
|-------|------|--------|
| **P1** | 月 1-3 | CLI + Server + Tool Loop + 基本 Tools |
| **P2** | 月 4-6 | AMS 專用 Tools + Model Router + Compliance |
| **P3** | 月 7-9 | VS Code Extension + LSP + Testing Pipeline |
| **P4** | 月 10-12 | Hooks + Dashboard + Multi-user + GA |

---

_Report v3.0 — 2026-04-27_
