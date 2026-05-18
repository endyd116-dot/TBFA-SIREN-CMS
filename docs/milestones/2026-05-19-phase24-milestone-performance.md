# Phase 24 — 마일스톤·성과급 관리 시스템

> 작성일: 2026-05-19 | 상태: 설계 완료 (B·A 트리거 대기)

---

## §0 요구사항 확정 (Swain 결정)

| 결정 항목 | 확정 내용 |
|---|---|
| 어드민 구분 방법 | members 테이블에 `milestoneRole VARCHAR(10)` 컬럼 추가 (SM/PM/SI/null) |
| 기존 role 체계 | 유지 — super_admin, admin, operator 그대로 |
| 화면 위치 | 워크스페이스 네비게이션에 "성과 관리" 탭 추가 (workspace-milestones.html) |
| 계정별 표시 | 로그인한 계정의 milestoneRole 기준으로 본인 성과만 표시 |
| 관리 화면 | admin.html에 "성과 관리" 서브메뉴 그룹 추가 (슈퍼어드민 전용) |
| 구현 범위 | Step 1~6 (마스터+분기+매출+비매출+계산엔진+결산) |
| 시드 데이터 | 마이그레이션 함수로 53개 자동 등록 |
| 권한 정책 | rolePermissions 테이블에 milestone:* 권한 항목 추가 |

**역할 매핑**
| 시스템 역할 | milestoneRole | 권한 |
|---|---|---|
| super_admin (대표) | null | 마일스톤 정의 CRUD, 전체 결산 승인 |
| admin (사무국장) | SM | 본인 매출 검증, 비매출 성과 제출, 분기 결산 제출 |
| admin (정책국장) | PM | 동일 |
| admin (SI관리자) | SI | 동일 |
| operator (책임자) | SM/PM/SI 중 1개 | 매출·실적 데이터 입력 |

---

## §1 DB 설계

### 마이그레이션 전략
1. `migrate-milestone-setup.ts` 한 파일로 일괄 처리
2. 순서: ① members 컬럼 추가 → ② 신규 테이블 5개 생성 → ③ rolePermissions 시드 → ④ 마일스톤 53개 시드
3. 멱등 보장 (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)

### 1.1 신규 컬럼 (members 테이블)

```sql
ALTER TABLE members ADD COLUMN IF NOT EXISTS milestone_role VARCHAR(10);
-- 값: 'SM' | 'PM' | 'SI' | NULL
```

```typescript
// schema.ts — members 테이블 기존 정의 끝에 추가 (마이그 후 활성화)
milestoneRole: varchar("milestone_role", { length: 10 }),
```

### 1.2 신규 테이블 5개

```typescript
/* === Phase 24: 마일스톤·성과급 관리 === */

// 1. 분기 관리
export const quarters = pgTable("quarters", {
  id:             serial("id").primaryKey(),
  year:           integer("year").notNull(),
  quarter:        integer("quarter").notNull(),          // 1~4
  startDate:      date("start_date").notNull(),
  endDate:        date("end_date").notNull(),
  settlementDate: date("settlement_date").notNull(),
  status:         varchar("status", { length: 20 }).notNull().default("UPCOMING"),
  // UPCOMING | ACTIVE | ENDED | SETTLED
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  yearQuarterUq: uniqueIndex("quarters_year_q_uq").on(t.year, t.quarter),
}));

// 2. 마일스톤 정의 마스터
export const milestoneDefinitions = pgTable("milestone_definitions", {
  id:                   serial("id").primaryKey(),
  code:                 varchar("code", { length: 20 }).notNull().unique(),
  name:                 varchar("name", { length: 200 }).notNull(),
  category:             varchar("category", { length: 20 }).notNull(),
  // REVENUE_LINKED | NON_REVENUE
  targetMilestoneRole:  varchar("target_milestone_role", { length: 10 }).notNull(),
  // SM | PM | SI
  businessUnit:         varchar("business_unit", { length: 30 }),
  // ASSOCIATION | HAMKEWORK | PLEO | POLICY
  revenueSource:        varchar("revenue_source", { length: 100 }),
  thresholdEnabled:     boolean("threshold_enabled").notNull().default(false),
  thresholdValue:       numeric("threshold_value", { precision: 15, scale: 2 }),
  thresholdUnit:        varchar("threshold_unit", { length: 30 }),
  bonusFormula:         jsonb("bonus_formula").notNull(),
  // { type:"FLAT"|"PERCENT"|"BRACKET"|"EVENT_RANGE", unitAmount?, rate?, brackets?, minAmount?, maxAmount? }
  quarterApplicable:    varchar("quarter_applicable", { length: 5 }),
  // null=매출연동, 'Q1'|'Q2'=비매출 분기한정, 'ALL'=비매출 공통
  isSharedThreshold:    boolean("is_shared_threshold").notNull().default(false),
  sharedThresholdGroup: varchar("shared_threshold_group", { length: 20 }),
  // SI_SALES = si-001~003 공유 임계점
  isActive:             boolean("is_active").notNull().default(true),
  effectiveFrom:        date("effective_from"),
  effectiveTo:          date("effective_to"),
  sortOrder:            integer("sort_order").notNull().default(0),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
});

// 3. 매출 입력
export const revenueEntries = pgTable("revenue_entries", {
  id:                   serial("id").primaryKey(),
  milestoneDefinitionId:integer("milestone_definition_id").notNull().references(() => milestoneDefinitions.id),
  quarterId:            integer("quarter_id").notNull().references(() => quarters.id),
  enteredBy:            integer("entered_by").notNull().references(() => members.id),
  responsibleAdminId:   integer("responsible_admin_id").references(() => members.id),
  revenueDate:          date("revenue_date").notNull(),
  amount:               numeric("amount", { precision: 15, scale: 2 }).notNull(),
  amountUnit:           varchar("amount_unit", { length: 20 }).notNull().default("원"),
  // '원' | '명' | '팀' | '건'
  note:                 text("note"),
  isCampaignRouted:     boolean("is_campaign_routed").default(false),
  evidenceFiles:        jsonb("evidence_files").default([]),
  status:               varchar("status", { length: 20 }).notNull().default("PENDING"),
  // PENDING | VERIFIED | REJECTED
  reviewedBy:           integer("reviewed_by").references(() => members.id),
  reviewedAt:           timestamp("reviewed_at"),
  rejectReason:         text("reject_reason"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
});

// 4. 비매출 성과
export const nonRevenueAchievements = pgTable("non_revenue_achievements", {
  id:                   serial("id").primaryKey(),
  milestoneDefinitionId:integer("milestone_definition_id").notNull().references(() => milestoneDefinitions.id),
  quarterId:            integer("quarter_id").notNull().references(() => quarters.id),
  submittedBy:          integer("submitted_by").notNull().references(() => members.id),
  achievedDate:         date("achieved_date").notNull(),
  description:          text("description"),
  evidenceFiles:        jsonb("evidence_files").default([]),
  bonusAmount:          numeric("bonus_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  eventRangeAmount:     numeric("event_range_amount", { precision: 15, scale: 2 }),
  // EVENT_RANGE 타입 시 슈퍼어드민 수동 결정
  isSelectedForQuarter: boolean("is_selected_for_quarter").notNull().default(false),
  selectionOrder:       integer("selection_order"),   // 1 or 2
  status:               varchar("status", { length: 20 }).notNull().default("PENDING"),
  // PENDING | VERIFIED | REJECTED
  reviewedBy:           integer("reviewed_by").references(() => members.id),
  reviewedAt:           timestamp("reviewed_at"),
  rejectReason:         text("reject_reason"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
});

// 5. 분기 결산
export const quarterlySettlements = pgTable("quarterly_settlements", {
  id:                   serial("id").primaryKey(),
  quarterId:            integer("quarter_id").notNull().references(() => quarters.id),
  memberId:             integer("member_id").notNull().references(() => members.id),
  revenueLinkedTotal:   numeric("revenue_linked_total", { precision: 15, scale: 2 }).notNull().default("0"),
  nonRevenueTotal:      numeric("non_revenue_total", { precision: 15, scale: 2 }).notNull().default("0"),
  totalBonus:           numeric("total_bonus", { precision: 15, scale: 2 }).notNull().default("0"),
  calculationSnapshot:  jsonb("calculation_snapshot"),
  selfEvaluation:       text("self_evaluation"),
  status:               varchar("status", { length: 20 }).notNull().default("DRAFT"),
  // DRAFT | SUBMITTED | REVIEWED | APPROVED | REJECTED | PAID
  submittedAt:          timestamp("submitted_at"),
  reviewedBy:           integer("reviewed_by").references(() => members.id),
  reviewedAt:           timestamp("reviewed_at"),
  reviewNote:           text("review_note"),
  approvedAt:           timestamp("approved_at"),
  paidAt:               timestamp("paid_at"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  quarterMemberUq: uniqueIndex("qs_quarter_member_uq").on(t.quarterId, t.memberId),
}));
```

### 1.3 rolePermissions 시드 (마이그 함수에서 삽입)

| featureKey | featureLabel | category | adminAllowed | operatorAllowed |
|---|---|---|---|---|
| milestone:view | 성과 관리 조회 | milestone | true | true |
| milestone:revenue:input | 매출 실적 입력 | milestone | true | true |
| milestone:revenue:verify | 매출 실적 검증 | milestone | true | false |
| milestone:nonrevenue:manage | 비매출 성과 관리 | milestone | true | false |
| milestone:settlement:submit | 분기 결산 제출 | milestone | true | false |
| milestone:manage | 마일스톤 정의 관리 | milestone | false | false |
| milestone:settlement:approve | 분기 결산 승인 | milestone | false | false |
| milestone:quarter:manage | 분기 관리 | milestone | false | false |

> adminAllowed=false, operatorAllowed=false → 슈퍼어드민 전용

---

## §2 API 명세

총 **11개 함수 파일, 약 30개 엔드포인트**. 모두 `/api/` 경로.

### 파일 목록

| 파일명 | 경로 | 접근 주체 | 메서드·동작 |
|---|---|---|---|
| `milestone-definitions.ts` | `/api/milestone-definitions` | 슈퍼어드민 | GET 목록, POST 등록, PATCH /:id 수정, DELETE /:id 비활성화 |
| `milestone-quarters.ts` | `/api/milestone-quarters` | 슈퍼어드민+어드민 | GET 목록, POST 신규(슈퍼만), PATCH /:id 상태변경(슈퍼만) |
| `milestone-revenue.ts` | `/api/milestone-revenue` | 운영자+어드민 | GET 내역, POST 입력, PATCH /:id 수정(PENDING만), DELETE /:id |
| `admin-milestone-revenue.ts` | `/api/admin-milestone-revenue` | 어드민 | GET PENDING목록, POST /:id/verify, POST /:id/reject |
| `milestone-nonrevenue.ts` | `/api/milestone-nonrevenue` | 어드민 | GET 목록, POST 제출, PATCH /:id, POST /select (2개 선택) |
| `admin-milestone-nonrevenue.ts` | `/api/admin-milestone-nonrevenue` | 슈퍼어드민 | GET PENDING목록, POST /:id/verify, POST /:id/reject, PATCH /:id/event-range |
| `milestone-settlement.ts` | `/api/milestone-settlement` | 어드민 | GET 내 결산, POST /calculate 자동계산, POST /submit 제출 |
| `admin-milestone-settlement.ts` | `/api/admin-milestone-settlement` | 슈퍼어드민 | GET 전체목록, POST /:id/approve, POST /:id/reject, POST /:id/paid |
| `milestone-dashboard.ts` | `/api/milestone-dashboard` | 운영자+어드민 | GET 본인 성과 대시보드 |
| `milestone-members.ts` | `/api/milestone-members` | 슈퍼어드민 | GET 멤버 목록, PATCH /:id/role (milestoneRole 설정) |
| `migrate-milestone-setup.ts` | `/api/migrate-milestone-setup` | 슈퍼어드민 | GET?run=1 — 테이블+시드 1회 실행 |
| `cron-milestone-quarter.ts` | scheduled | 시스템 | 매일 0시 UTC — 분기 상태 자동 전환 + D-7 알림 |

### 2.1 핵심 응답 구조

**GET /api/milestone-dashboard?quarterId=1**
```json
{
  "ok": true,
  "data": {
    "quarter": { "id": 1, "year": 2025, "quarter": 1, "startDate": "2025-01-01", "endDate": "2025-03-31", "status": "ACTIVE" },
    "milestoneRole": "SM",
    "revenueProgress": [
      {
        "milestoneId": 1,
        "code": "sm-001",
        "name": "신규 정기후원자 유치",
        "category": "REVENUE_LINKED",
        "thresholdEnabled": true,
        "thresholdValue": "20",
        "thresholdUnit": "명",
        "currentVerifiedAmount": "15",
        "progressPct": 75,
        "estimatedIncentive": 0,
        "thresholdStatus": "BELOW"
      }
    ],
    "nonRevenueAchievements": [
      {
        "id": 1,
        "milestoneCode": "sm-q1-01",
        "name": "사단법인 인가 완료",
        "bonusAmount": "1000000",
        "status": "VERIFIED",
        "isSelectedForQuarter": false,
        "achievedDate": "2025-02-15"
      }
    ],
    "settlement": null,
    "estimatedIncentive": { "revenueLinked": 0, "nonRevenue": 0, "total": 0 }
  }
}
```

**GET /api/milestone-definitions**
```json
{
  "ok": true,
  "data": {
    "milestones": [
      {
        "id": 1, "code": "sm-001", "name": "신규 정기후원자 유치",
        "category": "REVENUE_LINKED", "targetMilestoneRole": "SM",
        "thresholdEnabled": true, "thresholdValue": "20", "thresholdUnit": "명",
        "bonusFormula": { "type": "FLAT", "unitAmount": 60000 },
        "quarterApplicable": null, "isActive": true
      }
    ]
  }
}
```

**GET /api/admin-milestone-settlement?quarterId=1**
```json
{
  "ok": true,
  "data": {
    "settlements": [
      {
        "id": 1, "memberId": 5, "memberName": "홍길동", "milestoneRole": "SM",
        "quarterId": 1,
        "revenueLinkedTotal": "300000", "nonRevenueTotal": "1000000", "totalBonus": "1300000",
        "status": "SUBMITTED", "submittedAt": "2025-03-25T10:00:00Z"
      }
    ]
  }
}
```

**POST /api/milestone-revenue** (body)
```json
{
  "milestoneDefinitionId": 1,
  "quarterId": 1,
  "revenueDate": "2025-02-10",
  "amount": "25",
  "amountUnit": "명",
  "isCampaignRouted": false,
  "note": "2월 정기후원 신규 모집",
  "evidenceFiles": []
}
```

**POST /api/milestone-nonrevenue/select** (body)
```json
{
  "quarterId": 1,
  "selectedIds": [3, 7]
}
```

### 2.2 인센티브 계산 로직 (milestone-settlement.ts 내 계산 함수)

```typescript
// FLAT: 초과 수량 × 단위금액
function applyFlat(excess: number, unitAmount: number): number {
  return Math.floor(excess) * unitAmount;
}

// PERCENT: 초과분 × 비율
function applyPercent(excess: number, rate: number): number {
  return Math.round(excess * rate);
}

// BRACKET: 달성치가 속한 구간의 정액
function applyBracket(value: number, brackets: Array<{min:number;max:number|null;amount:number}>): number {
  const matched = brackets
    .sort((a, b) => b.min - a.min)
    .find(b => value >= b.min && (b.max == null || value <= b.max));
  return matched ? matched.amount : 0;
}

// SI 공유 임계점 (si-001~003 합산 처리)
function calcSISharedThreshold(channelRevenues: Record<string, number>): number {
  const total = Object.values(channelRevenues).reduce((s, v) => s + v, 0);
  const excess = total - 30_000_000;
  if (excess <= 0) return 0;
  const rates: Record<string, number> = { "si-001": 0.04, "si-002": 0.05, "si-003": 0.05 };
  let bonus = 0;
  for (const [code, amount] of Object.entries(channelRevenues)) {
    const channelExcess = excess * (amount / total);
    bonus += channelExcess * (rates[code] || 0.05);
  }
  return Math.round(bonus);
}
```

---

## §3 화면 설계

### 3.1 신규·수정 파일 목록

| 파일 | 유형 | 변경 내용 |
|---|---|---|
| `public/workspace-milestones.html` | 신규 | 개인 성과 대시보드 메인 |
| `public/css/workspace-milestones.css` | 신규 | 성과 관리 전용 스타일 |
| `public/js/workspace-milestones.js` | 신규 | 성과 대시보드 로직 |
| `public/admin-milestones.html` | 신규 | 슈퍼어드민 마일스톤 관리 |
| `public/js/admin-milestones.js` | 신규 | 마일스톤 CRUD + 분기 관리 |
| `public/workspace.html` | 수정 | 사이드바 nav에 "성과 관리" 링크 추가 |
| `public/workspace-kanban.html` | 수정 | 동일 |
| `public/workspace-calendar.html` | 수정 | 동일 |
| `public/workspace-templates.html` | 수정 | 동일 |
| `public/workspace-files.html` | 수정 | 동일 |
| `public/admin.html` | 수정 | "성과 관리" 서브메뉴 그룹 추가 |

### 3.2 workspace-milestones.html 레이아웃

```
┌─────────────────────────────────────────────────────┐
│ 사이드바 (기존 ws-sidebar 패턴)                       │
├──────────────┬──────────────────────────────────────┤
│              │  🏆 성과 관리 — [홍길동 | SM | Q1 2025] │
│              ├──────────────────────────────────────┤
│              │ [내 현황] [매출 입력] [비매출 성과]       │
│              │ [분기 결산]   ← 어드민만 노출             │
│              ├──────────────────────────────────────┤
│              │ 탭 콘텐츠 영역                           │
│              │                                      │
│ 내 현황 탭   │ ┌─ 예상 인센티브 ─────────────────────┐  │
│              │ │ 매출연동: 0원  비매출: 100만원        │  │
│              │ │ 합계: 100만원                       │  │
│              │ └─────────────────────────────────┘  │
│              │                                      │
│              │ ┌─ 마일스톤별 진행률 ─────────────────┐  │
│              │ │ sm-001 신규 정기후원자 75%  ███░░  │  │
│              │ │ sm-003 월 평균 정기후원액  40%  ██░░░│  │
│              │ └─────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────┘
```

**탭별 접근 권한**:
- `내 현황`: 운영자+어드민 (본인 입력 내역 + 진행률)
- `매출 입력`: 운영자+어드민 (신규 데이터 입력 폼)
- `매출 검증`: 어드민 전용 (PENDING 항목 조회·승인·반려)
- `비매출 성과`: 어드민 전용 (제출 + 2개 선택)
- `분기 결산`: 어드민 전용 (자동 계산 → 제출)

### 3.3 admin.html 성과 관리 서브메뉴 (슈퍼어드민 전용)

```html
<!-- data-sidebar-submenu="milestone" 신규 그룹 -->
<li class="ws-nav-group">
  <a href="#" data-sidebar-group="milestone">
    🏆 성과 관리
  </a>
  <ul data-sidebar-submenu="milestone">
    <li><a data-page="milestone-defs">📋 마일스톤 정의 관리</a></li>
    <li><a data-page="milestone-quarters">🗓 분기 관리</a></li>
    <li><a data-page="milestone-settlements">✅ 결산 승인</a></li>
    <li><a data-page="milestone-roles">👥 담당 역할 설정</a></li>
  </ul>
</li>
```

---

## §4 검증 시나리오

| # | 시나리오 | 확인 사항 |
|---|---|---|
| Q1 | SM 어드민 로그인 → 성과 관리 탭 진입 | milestoneRole=SM인 마일스톤 목록만 표시 |
| Q2 | 오퍼레이터가 sm-001 매출 데이터 입력 (25명) | PENDING 상태로 저장, SM 어드민에게 알림 |
| Q3 | SM 어드민이 입력 데이터 검증 승인 | VERIFIED 전환, 진행률 갱신 |
| Q4 | 임계점(20명) 초과 → 초과분 계산 확인 | (25-20)×60,000 = 300,000원 표시 |
| Q5 | SI 어드민 — si-001+si-002+si-003 합산 3,000만 미달 | 인센티브 0원 |
| Q6 | SI 합산 4,000만원 — 채널별 초과분 배분 계산 | 1,000만 초과분 × 채널비율 × 각률 계산 확인 |
| Q7 | SM 어드민 비매출 성과 3개 제출 → VERIFIED | 2개만 선택 가능한지 확인 |
| Q8 | 3개 선택 시도 | "최대 2개" 에러 메시지 |
| Q9 | 분기 결산 자동 계산 → 제출 | 계산 스냅샷 저장, SUBMITTED 전환 |
| Q10 | 슈퍼어드민 결산 승인 → PAID | 상태 전환 + 지급 안내 알림 |
| Q11 | admin.html 마일스톤 정의 신규 등록 | bonusFormula BRACKET 저장 확인 |
| Q12 | BRACKET 마일스톤 — 실적 600만원 달성 | 구간 적용 100만원 표시 |
| Q13 | cron 분기 전환 — UPCOMING→ACTIVE | 상태 자동 전환 확인 |
| Q14 | 분기 D-7 도달 | 어드민 알림 발생 확인 |
| Q15 | EVENT_RANGE 마일스톤 슈퍼어드민 금액 입력 | nonRevenueAchievements.eventRangeAmount 저장 |

---

## §5 Mock 데이터 (B 머지 전 A가 사용)

```javascript
// workspace-milestones.js 상단에 임시 삽입
const __MOCK_MILESTONE_DASHBOARD__ = {
  ok: true,
  data: {
    quarter: { id: 1, year: 2025, quarter: 1, startDate: "2025-01-01", endDate: "2025-03-31", status: "ACTIVE" },
    milestoneRole: "SM",
    revenueProgress: [
      { milestoneId: 1, code: "sm-001", name: "신규 정기후원자 유치",
        category: "REVENUE_LINKED", thresholdEnabled: true, thresholdValue: "20", thresholdUnit: "명",
        currentVerifiedAmount: "15", progressPct: 75, estimatedIncentive: 0, thresholdStatus: "BELOW" },
      { milestoneId: 2, code: "sm-002", name: "장기후원 전환",
        category: "REVENUE_LINKED", thresholdEnabled: true, thresholdValue: "5", thresholdUnit: "명",
        currentVerifiedAmount: "7", progressPct: 100, estimatedIncentive: 100000, thresholdStatus: "ABOVE" },
      { milestoneId: 3, code: "sm-003", name: "월 평균 정기후원 누적액",
        category: "REVENUE_LINKED", thresholdEnabled: true, thresholdValue: "3000000", thresholdUnit: "원/월",
        currentVerifiedAmount: "4200000", progressPct: 140, estimatedIncentive: 500000, thresholdStatus: "ABOVE" }
    ],
    nonRevenueAchievements: [
      { id: 1, milestoneCode: "sm-q1-01", name: "사단법인 인가 완료",
        bonusAmount: "1000000", status: "VERIFIED", isSelectedForQuarter: true, selectionOrder: 1, achievedDate: "2025-02-15" },
      { id: 2, milestoneCode: "sm-q1-04", name: "기업·기관 후원 첫 협약 체결",
        bonusAmount: "2000000", status: "VERIFIED", isSelectedForQuarter: true, selectionOrder: 2, achievedDate: "2025-03-01" },
      { id: 3, milestoneCode: "sm-q1-02", name: "신규 유족 회원 30명 등록",
        bonusAmount: "1000000", status: "PENDING", isSelectedForQuarter: false, selectionOrder: null, achievedDate: "2025-03-10" }
    ],
    settlement: null,
    estimatedIncentive: { revenueLinked: 600000, nonRevenue: 3000000, total: 3600000 }
  }
};

const __MOCK_MILESTONE_DEFS__ = {
  ok: true,
  data: { milestones: [
    { id: 1, code: "sm-001", name: "신규 정기후원자 유치", category: "REVENUE_LINKED",
      targetMilestoneRole: "SM", thresholdEnabled: true, thresholdValue: "20", thresholdUnit: "명",
      bonusFormula: { type: "FLAT", unitAmount: 60000 }, quarterApplicable: null, isActive: true },
    { id: 2, code: "sm-q1-01", name: "사단법인 인가 완료", category: "NON_REVENUE",
      targetMilestoneRole: "SM", thresholdEnabled: false,
      bonusFormula: { type: "FLAT", unitAmount: 1000000 }, quarterApplicable: "Q1", isActive: true }
  ]}
};

const __MOCK_QUARTERS__ = {
  ok: true,
  data: { quarters: [
    { id: 1, year: 2025, quarter: 1, startDate: "2025-01-01", endDate: "2025-03-31",
      settlementDate: "2025-04-07", status: "ACTIVE" }
  ]}
};
```

---

## §6 트리거 메시지

### §6.1 B 트리거 (백엔드 — 11개 API 함수)

```
[Phase 24 B — 마일스톤·성과급 시스템 백엔드 구현]
작업 영역: API 백엔드 전용. HTML/JS 파일 수정 금지.

📋 구현 목록 (체크박스 완료 시마다 보고)
[ ] 1. migrate-milestone-setup.ts — 테이블 5개 생성 + milestoneRole 컬럼 + rolePermissions 시드 + 마일스톤 53개 시드
[ ] 2. milestone-definitions.ts — 마일스톤 마스터 CRUD (슈퍼어드민)
[ ] 3. milestone-quarters.ts — 분기 CRUD + 상태 변경 (슈퍼어드민)
[ ] 4. milestone-revenue.ts — 매출 입력·조회·수정·삭제 (운영자+어드민)
[ ] 5. admin-milestone-revenue.ts — 매출 검증 (어드민)
[ ] 6. milestone-nonrevenue.ts — 비매출 성과 제출·선택 (어드민)
[ ] 7. admin-milestone-nonrevenue.ts — 비매출 검증 + EVENT_RANGE 금액 설정 (슈퍼어드민)
[ ] 8. milestone-settlement.ts — 결산 자동계산·제출 (어드민)
[ ] 9. admin-milestone-settlement.ts — 결산 승인·반려·지급 (슈퍼어드민)
[10] 10. milestone-dashboard.ts — 개인 성과 대시보드 종합 API
[ ] 11. milestone-members.ts — milestoneRole 설정 API (슈퍼어드민)
[ ] 12. cron-milestone-quarter.ts — 분기 상태 자동 전환 (매일 0시)

━━━ 응답 구조 (키명 임의 변경 금지 — A mock이 이 구조로 작성됨) ━━━
GET /api/milestone-dashboard → { ok, data: { quarter, milestoneRole, revenueProgress[], nonRevenueAchievements[], settlement, estimatedIncentive } }
GET /api/milestone-definitions → { ok, data: { milestones[] } }
GET /api/milestone-quarters → { ok, data: { quarters[] } }
GET /api/milestone-revenue → { ok, data: { entries[] } }
GET /api/admin-milestone-revenue → { ok, data: { entries[] } }
GET /api/milestone-nonrevenue → { ok, data: { achievements[] } }
GET /api/admin-milestone-nonrevenue → { ok, data: { achievements[] } }
GET /api/milestone-settlement → { ok, data: { settlement } }
GET /api/admin-milestone-settlement → { ok, data: { settlements[] } }

━━━ 권한 체크 패턴 ━━━
운영자+어드민 API: requireActiveUser (lib/auth.ts)
어드민 전용: requireAdmin + member.role === 'admin' || 'super_admin'
슈퍼어드민 전용: requireAdmin + member.role === 'super_admin'
milestoneRole 체크: 본인 milestoneRole과 milestone의 targetMilestoneRole 일치 확인

━━━ 인센티브 계산 함수 (설계서 §2.2) ━━━
FLAT: Math.floor(excess) * unitAmount
PERCENT: Math.round(excess * rate)
BRACKET: 달성치 속한 구간 정액
EVENT_RANGE: eventRangeAmount 수동 입력값 사용
SI 공유 임계점: si-001~003 합산 - 30,000,000 = 초과분, 채널비율로 배분 후 각 률 적용

━━━ 마일스톤 53개 시드 목록 ━━━
SM 매출연동: sm-001~sm-006 (6개)
SM 비매출 Q1: sm-q1-01~sm-q1-04 (4개)
SM 비매출 Q2: sm-q2-01~sm-q2-04 (4개)
PM 매출연동(함께워크): pm-001~pm-004 (4개)
PM 매출연동(정책): pm-005~pm-010 (6개, pm-0100 포함)
PM 비매출 Q1: pm-q1-01~pm-q1-07 (7개)
PM 비매출 Q2: pm-q2-01~pm-q2-08 (8개)
SI 매출연동: si-001~si-007 (7개, si-001~003 isSharedThreshold=true sharedThresholdGroup='SI_SALES')
SI 비매출 Q1: si-q1-01~si-q1-06 (6개)
SI 비매출 Q2: si-q2-01~si-q2-07 (7개)
※ 설계서 원본 명세서 §5 참조하여 bonusFormula JSON 정확히 작성

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/phase24-back (새로 생성했는가?)
  □ 응답 최상위 키: ok, data → 내부 키명 위 목록 준수
  □ export const config = { path } 12개 함수 전부
  □ requireAdmin 반환 auth.res
  □ cron 함수 export const config = { schedule: "0 0 * * *" }
  □ npx tsc --noEmit 통과
  □ 마이그 함수는 GET ?run=1 패턴 (requireAdmin 인증)
```

### §6.2 A 트리거 (프론트엔드)

```
[Phase 24 A — 마일스톤·성과급 시스템 프론트엔드 구현]
작업 영역: HTML/CSS/JS 파일 전용. netlify/functions 수정 금지.

📋 구현 목록
[ ] 1. workspace-milestones.html + css/workspace-milestones.css + js/workspace-milestones.js
      - 기존 ws-sidebar 패턴 그대로 (workspace.html에서 sidebar 구조 복사)
      - 탭: 내 현황 / 매출 입력 / [매출 검증(어드민만)] / [비매출 성과(어드민만)] / [분기 결산(어드민만)]
      - API: GET /api/milestone-dashboard → revenueProgress[] + nonRevenueAchievements[] + settlement + estimatedIncentive
      - 역할(milestoneRole)에 따라 다른 탭 노출 (401/403이면 접근 불가)
[ ] 2. admin-milestones.html + js/admin-milestones.js
      - 마일스톤 정의 목록·등록·수정 테이블
      - 분기 관리 (신규 분기 생성, 상태 변경)
      - 결산 목록 + 승인·반려 버튼
[ ] 3. workspace 5개 페이지 nav 수정
      - workspace.html, workspace-kanban.html, workspace-calendar.html,
        workspace-templates.html, workspace-files.html
      - 사이드바 ul[data-sidebar-submenu="workspace"] 마지막에 아래 추가:
        <li><a href="/workspace-milestones.html" title="성과 관리"><span class="ws-nav-icon">🏆</span><span class="ws-nav-text">성과 관리</span></a></li>
[ ] 4. admin.html 수정
      - 성과 관리 서브메뉴 그룹 추가 (super_admin_only)
      - adm-milestone-defs, adm-milestone-quarters, adm-milestone-settlements, adm-milestone-roles 패널 추가

━━━ mock 데이터 (B 머지 전 사용) ━━━
// 설계서 §5 전체 코드 복붙 — const __MOCK_MILESTONE_DASHBOARD__, __MOCK_MILESTONE_DEFS__, __MOCK_QUARTERS__
// 연결 시 USE_MOCK = false 로 전환

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/phase24-front (새로 생성했는가?)
  □ mock 키명: data.quarter, data.milestoneRole, data.revenueProgress[], data.nonRevenueAchievements[], data.estimatedIncentive
  □ <script> 캐시버스터 ?v=1 포함
  □ 워크스페이스 5개 파일 nav 수정 완료
```

### §6.3 C 트리거 (검증)

```
[Phase 24 C — 마일스톤 시스템 라이브 검증]

검증 목록: 설계서 §4 Q1~Q15 시나리오 순서대로

필수 확인:
- milestoneRole별 데이터 격리 (SM 어드민이 PM 데이터 못 보는지)
- 비매출 2개 초과 선택 에러
- SI 공유 임계점 계산 정확도
- 분기 상태 전환 로직 (cron)
- 권한 정책 관리 화면에 milestone:* 항목 표시 확인
```

---

## §7 라운드 마감 체크리스트

```
[ ] migrate-milestone-setup 호출 성공 (tbfa.co.kr/api/migrate-milestone-setup?run=1)
[ ] schema.ts에 Phase 24 섹션 활성화 (milestoneRole 컬럼 포함)
[ ] B 브랜치 머지: feature/phase24-back → main
    - 머지 전 B 응답 키 ↔ A mock 키 1:1 대조
[ ] A 브랜치 머지: feature/phase24-front → main
[ ] migrate 파일 삭제 + 커밋
[ ] 워크스페이스 5개 nav 갱신 라이브 확인
[ ] admin.html 성과 관리 그룹 슈퍼어드민 로그인으로 확인
[ ] C 검증 Q1~Q15 PASS
[ ] PROJECT_STATE.md 갱신
```

---

> 총 예상 작업: B 약 15h + A 약 10h = 25h
> 시드 데이터 53개가 포함되어 마이그 함수가 가장 큰 단일 작업.
