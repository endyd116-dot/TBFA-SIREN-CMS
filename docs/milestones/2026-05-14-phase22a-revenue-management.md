# Phase 22-A — 매출 통합 관리 + 재정 그룹 사이드바

> **작성일**: 2026-05-14
> **설계자**: 메인 채팅 (Opus 4.7)
> **소요 추정**: 14~19h (B 6~8h + A 6~8h + C 2~3h, 평행 8~12h)
> **베이스 브랜치**: `main` @ `9f147a5`

---

## §0 요구사항 확정 (Swain 결정 사항)

| 결정 항목 | 결정 내용 |
|---|---|
| Phase 범위 | Phase 22-A 단독 (매출 통합 관리 + 재정 그룹 사이드바). 차년도 예산 자동 편성·다단계 결재·풀세트 회계 보고서는 Phase 22-B로 분리 |
| 회계연도 기준 | **1월 1일 ~ 12월 31일** (한국 일반 가이드라인) |
| 환불 처리 | **net 방식** — 환불액을 매출에서 차감. `donations` 테이블의 `status='refunded'`는 자동 제외 |
| 후원금 외 매출 카테고리 (6종) | ① 강연·교육 수익 ② 정부·지자체 지원금 ③ 기업 협찬·제휴 수익 ④ 함께워크_On(사업지원·자리대여) ⑤ 함께워크_SI(AI·AX·SI) ⑥ 기타 |
| 사이드바 진입점 | "💰 재정 관리" 그룹 신설 (시스템 그룹 위) — 5개 메뉴 |
| 권한 | 매출 작성·조회: admin 이상 / 매출 승인: super_admin (Phase 5~7과 동일 패턴) |

---

## §1 DB 설계

### 1.1 신규 테이블 2개

#### `revenue_categories` — 후원 외 매출 카테고리 정의 (6개 시드)

```typescript
export const revenueCategories = pgTable("revenue_categories", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 32 }).unique().notNull(),   // 'lecture', 'govgrant' 등
  name: varchar("name", { length: 100 }).notNull(),           // 한글명
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  codeIdx: index("revenue_categories_code_idx").on(t.code),
  activeIdx: index("revenue_categories_active_idx").on(t.isActive),
}));
```

**시드 데이터 (마이그에서 INSERT)**:

| code | name | sortOrder |
|---|---|---|
| `lecture` | 강연·교육 수익 | 10 |
| `govgrant` | 정부·지자체 지원금 | 20 |
| `corp_sponsor` | 기업 협찬·제휴 수익 | 30 |
| `twork_on` | 함께워크_On (사업지원·자리대여) | 40 |
| `twork_si` | 함께워크_SI (AI·AX·SI) | 50 |
| `etc` | 기타 | 999 |

#### `other_revenues` — 후원 외 매출 기록

```typescript
export const otherRevenues = pgTable("other_revenues", {
  id: serial("id").primaryKey(),
  fiscalYear: integer("fiscal_year").notNull(),          // 2026 등 — 회계연도(1~12월)
  recognizedAt: date("recognized_at").notNull(),         // 매출 인식일 (입금일 기준)
  categoryId: integer("category_id").notNull().references(() => revenueCategories.id),
  amount: bigint("amount", { mode: "number" }).notNull(),   // 원 단위
  payerName: varchar("payer_name", { length: 200 }),     // 납입자/거래처명
  description: text("description"),                       // 비고
  receiptUrl: varchar("receipt_url", { length: 500 }),   // R2 증빙파일
  status: varchar("status", { length: 20 }).default("draft").notNull(),  // draft|approved|rejected
  refundAmount: bigint("refund_amount", { mode: "number" }).default(0).notNull(),  // 환불액 (net 계산용)
  recordedBy: integer("recorded_by"),                    // 작성자 admin id
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  approvedBy: integer("approved_by"),                    // 승인자 admin id
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  fiscalYearIdx: index("other_revenues_fy_idx").on(t.fiscalYear),
  categoryIdx: index("other_revenues_category_idx").on(t.categoryId),
  statusIdx: index("other_revenues_status_idx").on(t.status),
  recognizedAtIdx: index("other_revenues_recognized_idx").on(t.recognizedAt),
}));
```

### 1.2 기존 테이블 활용 (수정 없음)

- `donations` — `status='completed'`만 매출 인식, `refunded`는 자동 제외 → net 매출 산출
- `expenditures` — `status='approved'`만 지출 인식
- `budgets`·`budget_categories` — 예산 비교용

### 1.3 마이그레이션 함수

**파일**: `netlify/functions/migrate-phase22a-revenue.ts` (1회용)

```
GET ?run=1  → requireAdmin 후 실행:
  1. CREATE TABLE IF NOT EXISTS revenue_categories
  2. CREATE TABLE IF NOT EXISTS other_revenues
  3. 인덱스 7개 생성
  4. revenue_categories 6개 시드 INSERT ON CONFLICT DO NOTHING
GET 기본    → 진단 (테이블·시드 존재 여부 확인, 인증 불필요)
```

호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙).

---

## §2 API 명세 (신규 7개)

모든 API: `requireAdmin` + `export const config = { path }` + 단계별 try/catch + step·detail·stack 응답.

### 2.1 `GET /api/admin-revenue-categories-list`

매출 카테고리 목록. isActive=true만 기본, ?all=1로 비활성 포함.

**응답**:
```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": 1, "code": "lecture", "name": "강연·교육 수익", "sortOrder": 10, "isActive": true },
      ...
    ]
  }
}
```

### 2.2 `POST /api/admin-revenue-create`

후원 외 매출 신규 기록 (status='draft' 시작).

**요청**:
```json
{
  "recognizedAt": "2026-05-14",
  "categoryId": 1,
  "amount": 500000,
  "payerName": "○○고등학교",
  "description": "5월 교사 연수 강연료",
  "receiptUrl": "https://r2.../receipt-2026-05-14-001.pdf"
}
```

**응답**:
```json
{
  "ok": true,
  "data": {
    "revenue": { "id": 42, "fiscalYear": 2026, "amount": 500000, "status": "draft", ... }
  }
}
```

서버에서 fiscalYear는 recognizedAt 연도로 자동 계산.

### 2.3 `GET /api/admin-revenue-list`

후원 외 매출 목록. 필터: fiscalYear·categoryId·status·payerName(LIKE)·기간(from·to). 페이지네이션 limit/offset.

**응답**:
```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": 42, "fiscalYear": 2026, "recognizedAt": "2026-05-14", "categoryName": "강연·교육 수익",
        "amount": 500000, "refundAmount": 0, "payerName": "○○고등학교", "status": "draft", ... }
    ],
    "total": 17,
    "summary": { "totalAmount": 12500000, "totalRefund": 200000, "netAmount": 12300000 }
  }
}
```

### 2.4 `PATCH /api/admin-revenue-update`

매출 수정. draft 상태만 수정 가능. 승인 후 수정은 rejected 필요.

### 2.5 `POST /api/admin-revenue-approve`

draft→approved 또는 draft→rejected. **super_admin 권한 필요**.

**요청**:
```json
{ "revenueId": 42, "action": "approve" }
{ "revenueId": 42, "action": "reject", "reason": "증빙 부족" }
```

### 2.6 `POST /api/admin-revenue-refund`

매출 환불 등록. refundAmount 증분. approved 상태만 가능.

**요청**:
```json
{ "revenueId": 42, "refundAmount": 100000, "reason": "..." }
```

서버는 `refundAmount`를 +=로 누적. 0 < 환불액 ≤ 원금 검증.

### 2.7 `GET /api/admin-finance-pl-summary`

**통합 손익계산서 (Phase 22-A 핵심 API)**. 회계연도 단위.

**요청**: `?year=2026`

**응답**:
```json
{
  "ok": true,
  "data": {
    "fiscalYear": 2026,
    "revenue": {
      "donations": { "gross": 50000000, "refund": 500000, "net": 49500000 },
      "other": {
        "gross": 12500000, "refund": 200000, "net": 12300000,
        "byCategory": [
          { "code": "lecture", "name": "강연·교육 수익", "net": 3000000 },
          ...
        ]
      },
      "totalNet": 61800000
    },
    "expenditure": {
      "total": 55000000,
      "byCategory": [
        { "code": "ops", "name": "운영비", "total": 20000000 },
        ...
      ]
    },
    "netIncome": 6800000,
    "monthly": [
      { "month": 1, "revenue": 5000000, "expenditure": 4500000, "net": 500000 },
      ...
    ]
  }
}
```

산식:
- 후원 net = `donations` status='completed' 합계 - status='refunded' 합계
- 후원 외 net = `other_revenues` status='approved' (amount - refundAmount) 합계
- 지출 total = `expenditures` status='approved' 합계
- 순이익 = (후원 net + 후원 외 net) - 지출 total

---

## §3 화면 설계 (신규/수정 파일)

### 3.1 사이드바 신설 그룹

**`public/admin.html` 수정**: 사이드바에 "💰 재정 관리" 그룹 추가 (시스템 그룹 위).

```
💰 재정 관리
├─ 💝 후원금 관리       → adm-donations (기존)
├─ 💵 수입 현황 (통합)  → adm-finance-income (확장)
├─ 📥 후원 외 매출      → adm-other-revenues (신규)
├─ 📊 예산·지출 관리    → adm-finance-budget (기존)
└─ 📈 재무 보고서       → adm-finance-report (손익계산서 탭 추가)
```

**`public/js/admin-shell.js` 수정**: 그룹 정의 + 메뉴 5개 등록 (아이콘·라벨·pageKey·hash).

**`admin-nav-menus` API 시드**: 신규 메뉴 1건(`adm-other-revenues`) DB 등록 → 즐겨찾기·Cmd+K 자동 색인.

### 3.2 신규 페이지: 후원 외 매출 입력·관리 (`adm-other-revenues`)

**파일**: `public/js/admin-other-revenues.js` (신규)

```
┌──────────────────────────────────────────────────────────┐
│ 후원 외 매출 관리                          [+ 매출 추가] │
├──────────────────────────────────────────────────────────┤
│ 회계연도: [2026 ▼]  카테고리: [전체 ▼]  상태: [전체 ▼]  │
├──────────────────────────────────────────────────────────┤
│ 요약: 총 매출 12,500,000 / 환불 200,000 / 순매출 12,300,000│
├──────────────────────────────────────────────────────────┤
│ 일자      카테고리          금액      납입자    상태       │
│ 2026-05-14 강연·교육 500,000  ○○고  draft  [상세]      │
│ 2026-05-10 함께워크_SI 1,500,000  □□회사 approved [상세] │
│ ...                                                        │
└──────────────────────────────────────────────────────────┘
```

**[+ 매출 추가] 모달**:
- 매출 인식일 (datepicker, 기본 오늘)
- 카테고리 (select, revenue-categories-list API)
- 금액 (number, 원 단위)
- 납입자/거래처
- 비고
- 증빙파일 업로드 (R2)
- [임시저장 (draft)] / [저장 후 승인 요청]

**[상세] 모달**:
- 필드 표시 + 편집 (draft만)
- 승인/반려 버튼 (super_admin만)
- 승인된 건은 [환불 등록] 버튼

### 3.3 수입 현황 통합 확장 (`adm-finance-income`)

**파일**: `public/js/admin-finance-income.js` (확장)

상단 KPI를 6개로 확장:
- 총 매출 (후원+기타, net)
- 후원금 net
- 후원 외 net
- 총 환불
- 지출
- **순이익 (이번 회계연도)**

월별 추이 차트: 매출(stacked: 후원+기타) vs 지출 vs 순이익 라인.

카테고리 분해 파이/막대: 후원 채널별 + 후원 외 카테고리별 통합 뷰.

### 3.4 재무 보고서 손익계산서 탭 (`adm-finance-report`)

**파일**: `public/js/admin-finance-report.js` (확장)

기존 탭(수입·지출·예산vs실적) 옆에 **손익계산서 탭** 추가:

```
┌──────────────────────────────────────────────────────────┐
│ 회계연도 2026 손익계산서                                  │
├──────────────────────────────────────────────────────────┤
│ I. 매출                                       총 61,800,000│
│   1. 후원금 수입                              49,500,000  │
│      - 정기 후원                              30,000,000  │
│      - 일시 후원                              19,500,000  │
│   2. 후원 외 매출                             12,300,000  │
│      - 강연·교육 수익                          3,000,000  │
│      - 정부·지자체 지원금                      5,000,000  │
│      - 기업 협찬·제휴 수익                     2,000,000  │
│      - 함께워크_On                             1,500,000  │
│      - 함께워크_SI                               800,000  │
│      - 기타                                            0  │
├──────────────────────────────────────────────────────────┤
│ II. 지출                                      총 55,000,000│
│   카테고리별 분해                                          │
├──────────────────────────────────────────────────────────┤
│ III. 당기순이익                                   6,800,000│
└──────────────────────────────────────────────────────────┘
[엑셀 익스포트] [PDF 출력]
```

---

## §4 검증 시나리오 (C 라이브)

| # | 시나리오 | 기대 동작 |
|---|---|---|
| Q1 | 매출 카테고리 6개 시드 확인 | 카테고리 목록 API 응답 6건 (정확한 한글 라벨) |
| Q2 | 후원 외 매출 6개 카테고리 각 1건씩 작성 | draft 상태로 INSERT, fiscalYear 자동 계산(2026) |
| Q3 | draft 매출 수정 | amount/description 수정 반영 |
| Q4 | super_admin 승인 → approved 상태 | approvedBy·approvedAt 기록 |
| Q5 | admin 권한으로 승인 시도 | 403 권한 거부 |
| Q6 | 승인된 매출 환불 50,000원 등록 | refundAmount=50,000, net 차감 확인 |
| Q7 | 통합 손익계산서 API 호출 | 후원+기타 매출 합산, 지출 차감, 순이익 정확 |
| Q8 | 월별 추이 | 12개월 배열 반환, 각 월의 매출·지출·순이익 정확 |
| Q9 | 사이드바 신설 "💰 재정 관리" 그룹 5개 메뉴 클릭 진입 | 각 페이지 정상 로드 |
| Q10 | Cmd+K 검색에서 "매출" 검색 → 후원 외 매출 페이지 노출 | 즐겨찾기 별 아이콘 표시·클릭 시 즐겨찾기 추가 |
| Q11 | 후원 환불 발생 시 손익계산서 net 자동 차감 | donations refunded 상태 1건 추가 후 net 감소 확인 |
| Q12 | 회귀 — 기존 Phase 5~7 화면(예산·지출·재무 보고서) | 동일 동작 유지 |

---

## §5 mock 데이터 (A가 B 머지 전 사용)

```javascript
// public/js/admin-other-revenues.js 상단
const MOCK_REVENUE_CATEGORIES = [
  { id: 1, code: 'lecture', name: '강연·교육 수익', sortOrder: 10, isActive: true },
  { id: 2, code: 'govgrant', name: '정부·지자체 지원금', sortOrder: 20, isActive: true },
  { id: 3, code: 'corp_sponsor', name: '기업 협찬·제휴 수익', sortOrder: 30, isActive: true },
  { id: 4, code: 'twork_on', name: '함께워크_On (사업지원·자리대여)', sortOrder: 40, isActive: true },
  { id: 5, code: 'twork_si', name: '함께워크_SI (AI·AX·SI)', sortOrder: 50, isActive: true },
  { id: 6, code: 'etc', name: '기타', sortOrder: 999, isActive: true },
];

const MOCK_REVENUE_LIST = {
  items: [
    { id: 1, fiscalYear: 2026, recognizedAt: '2026-05-14', categoryId: 1, categoryName: '강연·교육 수익',
      amount: 500000, refundAmount: 0, payerName: '○○고등학교', description: '5월 교사 연수 강연료',
      status: 'draft', recordedAt: '2026-05-14T10:00:00Z', approvedAt: null },
    { id: 2, fiscalYear: 2026, recognizedAt: '2026-05-10', categoryId: 5, categoryName: '함께워크_SI (AI·AX·SI)',
      amount: 1500000, refundAmount: 0, payerName: '□□회사', description: 'AI 컨설팅',
      status: 'approved', recordedAt: '2026-05-10T14:00:00Z', approvedAt: '2026-05-11T09:00:00Z' },
    { id: 3, fiscalYear: 2026, recognizedAt: '2026-04-22', categoryId: 2, categoryName: '정부·지자체 지원금',
      amount: 5000000, refundAmount: 0, payerName: '서울특별시 교육청', description: '2026년 1차 사업비',
      status: 'approved', recordedAt: '2026-04-22T11:00:00Z', approvedAt: '2026-04-23T10:00:00Z' },
  ],
  total: 3,
  summary: { totalAmount: 7000000, totalRefund: 0, netAmount: 7000000 },
};

const MOCK_PL_SUMMARY = {
  fiscalYear: 2026,
  revenue: {
    donations: { gross: 50000000, refund: 500000, net: 49500000 },
    other: {
      gross: 12500000, refund: 200000, net: 12300000,
      byCategory: [
        { code: 'lecture', name: '강연·교육 수익', net: 3000000 },
        { code: 'govgrant', name: '정부·지자체 지원금', net: 5000000 },
        { code: 'corp_sponsor', name: '기업 협찬·제휴 수익', net: 2000000 },
        { code: 'twork_on', name: '함께워크_On (사업지원·자리대여)', net: 1500000 },
        { code: 'twork_si', name: '함께워크_SI (AI·AX·SI)', net: 800000 },
        { code: 'etc', name: '기타', net: 0 },
      ],
    },
    totalNet: 61800000,
  },
  expenditure: {
    total: 55000000,
    byCategory: [
      { code: 'ops', name: '운영비', total: 20000000 },
      { code: 'program', name: '사업비', total: 25000000 },
      { code: 'admin', name: '관리비', total: 10000000 },
    ],
  },
  netIncome: 6800000,
  monthly: [
    { month: 1, revenue: 5000000, expenditure: 4500000, net: 500000 },
    { month: 2, revenue: 5200000, expenditure: 4600000, net: 600000 },
    { month: 3, revenue: 5100000, expenditure: 4700000, net: 400000 },
    { month: 4, revenue: 5500000, expenditure: 4800000, net: 700000 },
    { month: 5, revenue: 6000000, expenditure: 4900000, net: 1100000 },
    { month: 6, revenue: 0, expenditure: 0, net: 0 },
    { month: 7, revenue: 0, expenditure: 0, net: 0 },
    { month: 8, revenue: 0, expenditure: 0, net: 0 },
    { month: 9, revenue: 0, expenditure: 0, net: 0 },
    { month: 10, revenue: 0, expenditure: 0, net: 0 },
    { month: 11, revenue: 0, expenditure: 0, net: 0 },
    { month: 12, revenue: 0, expenditure: 0, net: 0 },
  ],
};
```

---

## §6 4채팅 시작 프롬프트

### §6.1 B 트리거 (백 구현)

```
Phase 22-A 백엔드 작업 시작합니다.

설계서: docs/milestones/2026-05-14-phase22a-revenue-management.md (정독)
브랜치: feature/phase22a-back (새로 생성, 베이스 main @ 9f147a5)
worktree: ../tbfa-mis-B (이미 있음)

━━━ 작업 체크박스 (설계서 §1·§2 1:1 매핑) ━━━
□ db/schema.ts append-only로 revenueCategories·otherRevenues 정의 추가 (§1.1)
  → 본인 섹션 헤더 명시: /* === Phase 22-A 매출 관리 === */
□ netlify/functions/migrate-phase22a-revenue.ts 작성 (§1.3)
  → GET ?run=1: 테이블 2개 + 인덱스 7개 + 시드 6건 / GET 기본: 진단
□ admin-revenue-categories-list.ts 작성 (§2.1)
□ admin-revenue-create.ts 작성 (§2.2)
□ admin-revenue-list.ts 작성 (§2.3) — 필터·페이지네이션·summary 포함
□ admin-revenue-update.ts 작성 (§2.4) — draft만
□ admin-revenue-approve.ts 작성 (§2.5) — super_admin 권한
□ admin-revenue-refund.ts 작성 (§2.6) — approved만
□ admin-finance-pl-summary.ts 작성 (§2.7) — 손익계산서 통합 API
□ admin-nav-menus DB에 신규 메뉴 1건 시드 (pageKey='adm-other-revenues')

━━━ 응답 구조 (키명 임의 변경 금지 — A mock이 이 구조로 작성됨) ━━━
- 매출 카테고리 목록: { ok, data: { items: [...] } }
- 매출 작성/수정: { ok, data: { revenue: {...} } }
- 매출 목록: { ok, data: { items: [...], total, summary: { totalAmount, totalRefund, netAmount } } }
- 손익계산서: §2.7 전체 응답 구조 그대로

━━━ push 전 체크 ━━━
□ 브랜치명: feature/phase22a-back (새로 생성했는가?)
□ 응답 최상위 키: ok, data (data 안에 items/revenue/...)
□ export const config = { path: "/api/admin-revenue-*" } 7개 + pl-summary 1개 = 8개 전부
□ requireAdmin 반환 auth.res ('response' 아님)
□ super_admin 권한 분기 — revenue-approve만 super_admin (다른 건 admin 이상)
□ npx tsc --noEmit 통과 (신규 파일 0 에러)
□ schema.ts append-only — 다른 작업 영역 덮어쓰지 않음

마이그 호출: Swain이 어드민 로그인 후 주소창에
  https://tbfa-siren-cms.netlify.app/api/migrate-phase22a-revenue?run=1
호출 후 ok:true 확인되면 메인에 알림 → 메인이 schema 활성화 + 마이그 파일 삭제 + push
```

### §6.2 A 트리거 (프론트 구현)

```
Phase 22-A 프론트 작업 시작합니다.

설계서: docs/milestones/2026-05-14-phase22a-revenue-management.md (정독)
브랜치: feature/phase22a-front (새로 생성, 베이스 main @ 9f147a5)
worktree: ../tbfa-mis-A (이미 있음)

━━━ 작업 체크박스 (설계서 §3 1:1 매핑) ━━━
□ public/admin.html — 사이드바에 "💰 재정 관리" 그룹 추가 (시스템 그룹 위) (§3.1)
□ public/admin.html — id="adm-other-revenues" div 신규 자리 예약 (§3.2)
□ public/js/admin-shell.js — 그룹 정의·5개 메뉴 등록 (§3.1)
□ public/js/admin-other-revenues.js — 후원 외 매출 화면 신규 (§3.2)
  → 목록 테이블·필터(회계연도·카테고리·상태)·요약·[+ 매출 추가] 모달·[상세] 모달
  → 작성/수정/승인/반려/환불 흐름
□ public/js/admin-finance-income.js — KPI 6개 + 통합 차트 확장 (§3.3)
□ public/js/admin-finance-report.js — 손익계산서 탭 추가 (§3.4)
□ admin.html 캐시버스터 ?v=N 갱신 (수정된 JS 모두)

━━━ mock 데이터 (B 머지 전 사용) ━━━
[설계서 §5 mock 데이터 그대로 복붙 — 설계서 다시 읽지 말고 트리거에 임베드된 것 사용]

const MOCK_REVENUE_CATEGORIES = [
  { id: 1, code: 'lecture', name: '강연·교육 수익', sortOrder: 10, isActive: true },
  { id: 2, code: 'govgrant', name: '정부·지자체 지원금', sortOrder: 20, isActive: true },
  { id: 3, code: 'corp_sponsor', name: '기업 협찬·제휴 수익', sortOrder: 30, isActive: true },
  { id: 4, code: 'twork_on', name: '함께워크_On (사업지원·자리대여)', sortOrder: 40, isActive: true },
  { id: 5, code: 'twork_si', name: '함께워크_SI (AI·AX·SI)', sortOrder: 50, isActive: true },
  { id: 6, code: 'etc', name: '기타', sortOrder: 999, isActive: true },
];
// 매출 목록·손익계산서 mock는 §5 참조

━━━ push 전 체크 ━━━
□ 브랜치명: feature/phase22a-front (새로 생성했는가?)
□ mock 키명: items / revenue / summary / fiscalYear / revenue.donations.net / netIncome — B 응답과 동일
□ <script> 캐시버스터 ?v=N 포함
□ 사이드바 5개 메뉴 모두 hash 라우팅 동작
□ [+ 매출 추가] 모달에서 카테고리 selector가 카테고리 목록 API 사용 (mock 폴백)
□ 환불 등록 UI 포함 (approved 상태에서만 노출)
□ 회귀 — 기존 Phase 5~7 화면 동작 유지
```

### §6.3 C 트리거 (라이브 검증)

```
Phase 22-A 라이브 검증 시작합니다.

베이스: main (메인이 B+A 머지 + 마이그 호출 + schema 활성화 완료한 시점)
브랜치: verify/phase22a (새로 생성)
worktree: ../tbfa-mis-C (현재 detached HEAD @ 9f147a5)

━━━ 검증 시나리오 (설계서 §4 Q1~Q12) ━━━
순서대로 실제 라이브 환경에서 검증, 보고서 작성:
- docs/verify/2026-05-14-phase22a.md (RESULTS)
- 발견 BUG는 docs/issues/2026-05-14-phase22a-{키워드}.md

검증 표현 규칙: 함수명·변수명 안 쓰고 기능·사용자 동작 위주.

작업 금지:
- PROJECT_STATE.md, docs/HANDOFF.md, docs/milestones/, docs/standards/ 수정 (검증 보고서만 작성)
- 코드 수정 (BUG 발견 시 보고만, fix는 메인이)

검증 완료 시 메인에 보고:
- 통과/실패 집계
- 발견 BUG 목록 + 심각도
- 데이터 영향 (인서트된 매출 ID 등)
```

---

## §7 라운드 마감 체크리스트 (메인 머지 순서)

```
1. B push 완료 보고 → 메인: feature/phase22a-back 정독·키 대조 후 main 머지
2. Swain께 마이그 호출 요청:
   https://tbfa-siren-cms.netlify.app/api/migrate-phase22a-revenue?run=1
3. Swain ok:true 보고 → 메인:
   - schema.ts 정의 활성화 (마이그 함수 보다 schema가 늦게 추가된 경우)
   - migrate-phase22a-revenue.ts 파일 삭제
   - PROJECT_STATE.md §2 마이그 호출 완료 행 추가
   - push
4. A push 완료 보고 → 메인: feature/phase22a-front 정독·mock-실 키 대조 후 main 머지
5. C 검증 트리거 → V1 결과 보고
6. 발견 BUG fix (메인) → BUG 표에 기록·즉시 fix·push
7. C 재검증 → PASS 시 verify/phase22a → main 머지 (보고서·issues 흡수)
8. PROJECT_STATE.md §5 Phase 22-A ✅ 표시 + §2 마감 행 추가
9. 메모리 갱신 (Phase 22-A 완료 기록)
10. Phase 22-B 진행 여부 Swain 협의
```

---

## §8 위험·주의사항

1. **schema.ts append-only** — B는 본인 섹션 헤더 명시 후 파일 끝에 추가. 다른 작업 영역 덮어쓰면 회귀 (§9.1.6 사고 사례)
2. **마이그 호출 표준** — Swain 직접 어드민 로그인 후 주소창 호출. 메인이 자동 호출 X
3. **권한 분기 정확** — revenue-approve만 super_admin. 다른 6개는 admin 이상. 실수 시 운영 권한 사고
4. **환불 누적** — refundAmount는 += 누적이므로 동시 환불 등록 시 race condition 주의 (트랜잭션 사용)
5. **fiscalYear 자동 계산** — recognizedAt 연도로 서버에서 결정. 클라이언트 입력값 무시
6. **net 정의 일관성** — 후원 net = completed - refunded / 후원 외 net = approved의 (amount - refundAmount). 두 계산식이 다른 점 주의
7. **회귀 영역** — admin.html 사이드바·admin-shell.js·admin-finance-income.js·admin-finance-report.js 모두 기존 동작 유지 확인 (C Q12)

---

## §9 추정 시간

| 채팅 | 작업 | 시간 |
|---|---|---|
| 메인 | 설계서·머지·키 대조·BUG fix | 2~3h |
| B | schema·마이그·API 7개 | 6~8h |
| A | 사이드바·신규 화면·확장 2개 | 6~8h |
| C | 라이브 검증 + 보고서 | 2~3h |
| **합계** | | **16~22h (평행 8~12h)** |

---

**마지막 갱신**: 2026-05-14 (메인 초안 작성, Swain 검토 대기)
