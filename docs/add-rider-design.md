unning task: please design the requiremnt on online function for add rider in agency portal

=== Result ===
Session: sess_1777305394048_hje0tg
The user wants me to continue designing the requirements document. The previous response was cut off mid-sentence. Let me continue from where it left off and complete the full PRD document.
The previous response was cut off. Let me check what was saved and complete the document.

<file_read path="docs/requirements/PRD-Add-Rider-v1.0.md" />

The document exists but is incomplete. Let me finish writing the complete PRD.

<file_write path="docs/requirements/PRD-Add-Rider-v1.0.md" content="(# PRD: Online Add Rider Function — Agency Portal

> **Document ID:** PRD-ADD-RIDER-001  
> **Version:** 1.0  
> **Date:** 2025-07-09  
> **Status:** Draft  
> **Author:** InsureAgent  
> **Jurisdiction:** HK (primary), SG, EU  

---

## 1. Overview

### 1.1 Business Objective
Provide agents the ability to submit **rider attachment requests** to existing in-force base policies via the Agency Portal, enabling cross-sell / up-sell opportunities without manual paperwork.

### 1.2 Scope
| In Scope | Out of Scope |
|----------|-------------|
| Add rider to in-force base policy | Remove / detach rider |
| Premium recalculation with rider | Policy reinstatement |
| Underwriting referral triggers | Claims processing |
| Commission impact preview | Agent licensing (handled by existing module) |
| Compliance validation (HK IA GL20/21) | Group policy riders (Phase 2) |
| E-signature / digital consent | Offline / paper-based rider add |

### 1.3 Target Users
| Role | Access Level |
|------|-------------|
| Agent | Submit rider attachment request |
| Unit Manager | Review & approve (if delegated authority) |
| Branch Manager | Review & approve escalated cases |
| Admin / Back Office | Final processing & confirmation |

---

## 2. Glossary

| Term | Definition |
|------|-----------|
| **Rider** | An optional benefit add-on attached to a base insurance policy (e.g., Critical Illness, Accidental Death, Waiver of Premium) |
| **Base Policy** | The main insurance contract to which riders are attached |
| **Attachment Date** | The effective date of the rider (must align with policy anniversary or immediate) |
| **Rider Premium** | Additional premium charged for the rider benefit |
| **UW Referral** | Underwriting referral triggered when rider requires medical / financial underwriting |
| **Free-Look Period** | Statutory 21-day cooling-off period (HK) for new rider attachments |

---

## 3. Business Rules

### 3.1 Eligibility Checks

| Rule ID | Rule | Error Code |
|---------|------|-----------|
| BR-001 | Base policy must be **in-force** status | `ERR_RIDER_001` |
| BR-002 | Base policy must not have pending endorsement / rider request | `ERR_RIDER_002` |
| BR-003 | Rider must be **compatible** with base product type (see §3.4 Compatibility Matrix) | `ERR_RIDER_003` |
| BR-004 | Rider must not already be attached to the same base policy (duplicate check) | `ERR_RIDER_004` |
| BR-005 | Life assured age at attachment date must be within rider's **min/max entry age** | `ERR_RIDER_005` |
| BR-006 | Total rider count must not exceed **max riders per policy** (default: 6) | `ERR_RIDER_006` |
| BR-007 | Agent must hold a **valid license** for the rider's product type in the policy's jurisdiction | `ERR_RIDER_007` |
| BR-008 | Sum assured of all riders combined must not exceed **rider-to-base SA ratio** (default: 200% of base SA) | `ERR_RIDER_008` |
| BR-009 | Base policy must have sufficient **premium payment term remaining** for rider term | `ERR_RIDER_009` |
| BR-010 | Rider attachment date must be ≤ 30 days from submission date (future-dating allowed) | `ERR_RIDER_010` |

### 3.2 Underwriting Triggers

| Trigger ID | Condition | Action |
|------------|-----------|--------|
| UW-001 | Rider SA > auto-accept threshold (product-specific) | Route to UW referral |
| UW-002 | Life assured has existing medical condition flag | Route to UW referral |
| UW-003 | Financial underwriting: total SA (base + riders) > HKD 5,000,000 | Route to financial UW |
| UW-004 | Age > 55 with CI rider | Route to medical UW |
| UW-005 | Rider requires HIV test (per HK IA guidelines) | Route to medical UW |

### 3.3 Premium Calculation Rules

| Rule | Description |
|------|-------------|
| Rider Premium = Base Rate × SA × Age Factor × Gender Factor × Occupation Class × Smoker Status |
| Premium frequency must match base policy premium frequency |
| Modal premium factors: Annual=1.0, Semi-Annual=0.52, Quarterly=0.27, Monthly=0.09 |
| Loading may apply based on UW outcome |

### 3.4 Rider-Base Compatibility Matrix

| Base Product → | Life (Term) | Life (Whole) | Endowment | ILAS | Medical | Motor |
|-----------------|:-----------:|:------------:|:---------:|:----:|:-------:|:-----:|
| Critical Illness (CI) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Accidental Death (AD&D) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Waiver of Premium (WP) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Hospital Cash (HC) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Total & Permanent Disability (TPD) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Spouse Rider | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Child Rider | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Payor Benefit | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Critical Illness Extended | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Surgical Benefit | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |

---

## 4. Functional Requirements

### 4.1 Search & Select Base Policy (UC-001)

**Actor:** Agent  
**Precondition:** Agent is logged in with valid session

| Step | Action | System Response |
|------|--------|----------------|
| 1 | Agent clicks "Add Rider" from policy menu | System displays policy search screen |
| 2 | Agent enters policy number OR policyholder name OR HKID (encrypted) | System searches in-force policies assigned to agent's book |
| 3 | — | System returns matching policies with: policy number (masked), product name, life assured name, current SA, status |
| 4 | Agent selects a base policy | System validates eligibility rules BR-001 to BR-010 |
| 5 | — | If valid: proceeds to rider selection. If invalid: displays specific error code and reason |

**API Endpoint:**  
```
GET /api/v1/policies/search?q={query}&agentId={agentId}
```

**Response Fields:**
```json
{
  "policyNo": "POL-2024-XXXXXXX",
  "policyNoMasked": "POL-2024-***XXXX",
  "productType": "Life",
  "productSubType": "Term",
  "policyholder": {
    "nameEncrypted": "...",
    "nameDisplay": "CHAN *** MAN"
  },
  "lifeAssured": {
    "age": 35,
    "gender": "M",
    "smokerStatus": "N"
  },
  "sumAssured": 1000000,
  "premiumFrequency": "Monthly",
  "status": "IN_FORCE",
  "existingRiders": [
    { "riderCode": "CI01", "riderName": "Critical Illness", "sa": 500000 }
  ],
  "currentPremium": 1250.00,
  "nextAnniversary": "2025-09-01",
  "eligibleRidersAvailable": true
}
```

---

### 4.2 Select Rider(s) (UC-002)

**Actor:** Agent  
**Precondition:** Base policy selected and validated (UC-001)

| Step | Action | System Response |
|------|--------|----------------|
| 1 | System displays eligible riders based on compatibility matrix | Shows rider list with: code, name, description, min/max SA, min/max entry age, premium range |
| 2 | Agent selects one or more riders | System adds to rider cart |
| 3 | Agent specifies SA for each rider (within min/max) | System validates BR-006 (max riders), BR-008 (total SA ratio) |
| 4 | Agent selects attachment date | System validates BR-010 (≤ 30 days) |
| 5 | System calculates **premium preview** | Displays new total premium, premium breakdown per rider |

**API Endpoint:**  
```
POST /api/v1/riders/calculate-premium
```

**Request Body:**
```json
{
  "policyNo": "POL-2024-XXXXXXX",
  "agentId": "AGT-001",
  "riders": [
    {
      "riderCode": "AD01",
      "sumAssured": 500000,
      "attachmentDate": "2025-08-01"
    }
  ],
  "includeCommissionPreview": true
}
```

**Response:**
```json
{
  "policyNo": "POL-2024-XXXXXXX",
  "basePremium": 1250.00,
  "riderPremiums": [
    {
      "riderCode": "AD01",
      "riderName": "Accidental Death & Dismemberment",
      "sumAssured": 500000,
      "monthlyPremium": 125.00,
      "annualPremium": 1500.00,
      "rateApplied": {
        "baseRate": 0.003,
        "ageFactor": 1.0,
        "genderFactor": 1.0,
        "occupationClass": "Class 1",
        "smokerFactor": 1.0
      }
    }
  ],
  "totalNewPremium": 1375.00,
  "premiumIncrease": 125.00,
  "premiumIncreasePercent": 10.0,
  "attachmentDate": "2025-08-01",
  "nextBillDate": "2025-08-01",
  "uwRequired": false,
  "freeLookEndDate": "2025-08-22",
  "commissionPreview": {
    "firstYearCommission": 187.50,
    "commissionRate": "15%",
    "renewalRate": "5%"
  }
}
```

---

### 4.3 Client Declaration & Consent (UC-003)

**Actor:** Agent (on behalf of policyholder)  
**Precondition:** Rider(s) selected and premium calculated (UC-002)

**HK Regulatory Requirements (IA GL20/21):**

| Requirement | Implementation |
|-------------|---------------|
| Suitability Declaration | Agent must declare rider is suitable based on client's needs analysis |
| Product Disclosure | System generates Key Facts Statement (KFS) for the rider |
| Financial Needs Analysis (FNA) | Agent confirms FNA is updated or captures updated FNA |
| Client Acknowledgment | Digital signature from policyholder (via e-sign portal link) |
| Cooling-off Notice | System displays free-look period notice (21 days HK) |
| PDPO Consent | Client must consent to data processing for rider attachment |
| Medical Disclosure | If medical UW triggered, client must consent to medical info sharing |

**API Endpoint:**  
```
POST /api/v1/riders/consent
```

**Request Body:**
```json
{
  "policyNo": "POL-2024-XXXXXXX",
  "agentId": "AGT-001",
  "suitabilityDeclaration": {
    "fnaCompleted": true,
    "fnaDate": "2025-07-09",
    "clientNeedsMatch": ["Protection", "Critical Illness Coverage"],
    "suitabilityReason": "Client requests additional AD&D coverage due to increased travel frequency"
  },
  "consents": {
    "productDisclosure": true,
    "freeLookAcknowledged": true,
    "pdpoConsent": true,
    "medicalInfoConsent": false,
    "eSignatureRef": "ESIG-2025-XXXXXXX"
  },
  "kfsDocumentId": "KFS-AD01-20250709-XXXXX"
}
```

---

### 4.4 Submit Rider Attachment Request (UC-004)

**Actor:** Agent  
**Precondition:** Consent captured (UC-003)

| Step | Action | System Response |
|------|--------|----------------|
| 1 | Agent clicks "Submit Request" | System performs final validation |
| 2 | — | System checks: all eligibility rules, license validity, UW triggers, consent completeness |
| 3 | — | If auto-accept: Status → `APPROVED`, generates rider attachment confirmation |
| 4 | — | If UW referral: Status → `PENDING_UW`, creates UW referral task |
| 5 | — | If manager approval required: Status → `PENDING_APPROVAL`, routes to manager queue |
| 6 | — | System sends notification to agent + policyholder |
| 7 | — | System creates audit trail entry |

**API Endpoint:**  
```
POST /api/v1/riders/submit
```

**Request Body:**
```json
{
  "policyNo": "POL-2024-XXXXXXX",
  "agentId": "AGT-001",
  "riders": [
    {
      "riderCode": "AD01",
      "riderName": "Accidental Death & Dismemberment",
      "sumAssured": 500000,
      "attachmentDate": "2025-08-01",
      "premium": 125.00
    }
  ],
  "consentRef": "CONSENT-2025-XXXXXXX",
  "kfsDocumentId": "KFS-AD01-20250709-XXXXX",
  "eSignatureRef": "ESIG-2025-XXXXXXX",
  "totalNewPremium": 1375.00
}
```

**Response:**
```json
{
  "requestId": "REQ-RDR-2025-XXXXXXX",
  "status": "APPROVED",
  "policyNo": "POL-2024-XXXXXXX",
  "riders": [
    {
      "riderCode": "AD01",
      "certificateNo": "CERT-RDR-2025-XXXXXXX",
      "status": "ATTACHED",
      "effectiveDate": "2025-08-01",
      "premium": 125.00,
      "freeLookEndDate": "2025-08-22"
    }
  ],
  "totalNewPremium": 1375.00,
  "uwReferralId": null,
  "managerApprovalId": null,
  "notificationSent": true,
  "auditTrailId": "AUD-RDR-2025-XXXXXXX"
}
```

**Status Flow:**
```
DRAFT → SUBMITTED → PENDING_VALIDATION → [PENDING_UW | PENDING_APPROVAL | APPROVED]
                                                            ↓                ↓
                                                      UW_REVIEW     MANAGER_REVIEW
                                                            ↓                ↓
                                                      APPROVED ←─────── APPROVED
                                                            ↓
                                                      ATTACHED
                                                            ↓
                                                      ACTIVE (after free-look)
```

---

### 4.5 Manager Approval (UC-005)

**Actor:** Unit Manager / Branch Manager  
**Precondition:** Request status = `PENDING_APPROVAL`

| Step | Action | System Response |
|------|--------|----------------|
| 1 | Manager views pending request in approval queue | System displays full request details + compliance checks |
| 2 | Manager reviews suitability declaration, FNA, client profile | — |
| 3 | Manager approves or rejects with reason | System updates status, notifies agent |
| 4 | If approved and no UW required | Status → `APPROVED` → auto-attach |
| 5 | If approved and UW required | Status → `PENDING_UW` → route to UW |

**API Endpoints:**
```
GET  /api/v1/riders/pending-approvals?managerId={managerId}
POST /api/v1/riders/{requestId}/approve
POST /api/v1/riders/{requestId}/reject
```

**Reject Request Body:**
```json
{
  "managerId": "UM-001",
  "reason": "Insufficient justification for SA increase",
  "comments": "Please provide updated FNA with income documentation"
}
```

---

### 4.6 Underwriting Processing (UC-006)

**Actor:** UW Specialist / System (auto)  
**Precondition:** UW trigger activated

| Step | Action | System Response |
|------|--------|----------------|
| 1 | UW case created in UW system | System links to rider request |
| 2 | UW specialist reviews medical / financial evidence | — |
| 3 | UW outcome: **Accept** | Status → `APPROVED`, rider attached at standard rate |
| 4 | UW outcome: **Accept with Loading** | Status → `APPROVED_WITH_LOADING`, rider attached with premium loading; agent notified of new premium |
| 5 | UW outcome: **Decline** | Status → `DECLINED`, agent and policyholder notified with reason |
| 6 | UW outcome: **Postpone** | Status → `POSTPONED`, agent notified with re-submission eligibility date |

**API Endpoints:**
```
GET  /api/v1/riders/uw-cases?uwTeamId={teamId}
POST /api/v1/riders/{requestId}/uw-decision
```

**UW Decision Request Body:**
```json
{
  "uwSpecialistId": "UW-001",
  "decision": "ACCEPT_WITH_LOADING",
  "loadingPercent": 50,
  "reason": "Elevated cholesterol levels - standard medical loading",
  "medicalRef": "MED-2025-XXXXXXX",
  "conditions": ["Exclusion: Pre-existing cardiac conditions"],
  "newPremium": 187.50,
  "effectiveDate": "2025-08-01"
}
