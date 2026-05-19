# Phase 22-A — 매출 통합 관리 + 재정 그룹 사이드바 + AI 에이전트 통합

> **작성일**: 2026-05-14
> **설계자**: 메인 채팅 (Opus 4.7)
> **소요 추정**: 20~28h (메인 3~4h + B 9~12h + A 6~8h + C 2~4h, 평행 10~14h)
> **베이스 브랜치**: `main` @ `4abd675`
> **4채팅 평행 개발**: 메인 = 설계·로직·스키마·마이그 / A = 프론트 / B = 백엔드+AI 도구 / C = 테스트·검증·수정

---

## §-1 4채팅 분담표 (Swain 명시 구조)

| 채팅 | 모델 | worktree | 영역 | 본 Phase 작업 |
|---|---|---|---|---|
| **메인** | Opus 4.7 | `tbfa-mis` | 설계·로직·스키마·마이그·머지·조율 | 설계서 작성·schema.ts 정의·마이그 함수·B/A 키 대조·BUG fix·문서 갱신 |
| **A** | Sonnet 4.6 | `../tbfa-mis-A` | 프론트 (`public/`) | 사이드바 신설 그룹·후원 외 매출 화면·수입현황 확장·재무보고서 확장 |
| **B** | Sonnet 4.6 | `../tbfa-mis-B` | 백 (`netlify/functions/`, `lib/`, `db/`) | API 7개·**AI 에이전트 도구 6개** (§10)·도구 시드 |
| **C** | Opus 4.7 | `../tbfa-mis-C` | 검증·fix | 라이브 검증 Q1~Q15·AI 도구 호출 검증·BUG 보고서 |

**충돌 회피**: 폴더 단위 분리 → A·B 거의 0. schema.ts는 **메인이 작성** (B는 마이그 호출 후 추가 정의 없음 — 메인이 schema·마이그 모두 담당).

**병렬 작업 worktree 분리 의무**: A·B·C는 **반드시 분리된 worktree(`tbfa-mis-A`·`tbfa-mis-B`·`tbfa-mis-C`)에서 작업**. 같은 폴더 공유 시 git checkout이 다른 채팅 워킹 트리에 영향 (2026-05-09 b5167bf 사고 사례 — 가이드 §9.1.7). worktree 미생성 채팅은 `git worktree add ../tbfa-mis-{식별자} feature/{브랜치}`로 폴더 분리.

**A·B·C 문서 수정 금지 (가이드 §3, 2026-05-11 사고 사례)**: A·B·C는 `PROJECT_STATE.md`·`docs/HANDOFF.md`·`docs/milestones/`·`docs/standards/`·`docs/PARALLEL_GUIDE.md` **절대 수정 금지**. 메인만 갱신. 위반 시 머지 충돌 + 메인 중복 기록 발생.

**머지 순서 강제**: 메인 schema·마이그 push → Swain 마이그 호출 → B push → 메인 머지 → A push → 메인 머지 → C 검증 → BUG fix → 머지.

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

## §1 DB 설계 (작성 주체: **메인**)

> 본 §1 정의(schema.ts append-only + 마이그 함수)는 메인이 직접 작성·push. B는 마이그 호출 후 SELECT만 사용. A는 mock(§5) 사용.

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
| Q13 | AI 비서 "올해 매출 목록 보여줘" | `other_revenues_list` 호출, fiscalYear=2026 자동, items 반환 |
| Q14 | AI 비서 "오늘 강연료 50만원 매출 추가해줘" → "진행" | F11 short-circuit, dry-run→실행, status='draft' INSERT |
| Q15 | AI 비서 "올해 손익계산서 보여줘" | `pl_summary` 호출, 매출·지출·순이익·카테고리 분해 |
| Q16 | admin 권한 사용자 "매출 1번 승인해줘" | 403 권한 거부 ("super_admin 필요") |
| Q17 | AI 비서 "매출 카테고리 알려줘" | 6개 카테고리 한글 라벨 정확 |
| Q18 | 회귀 — 기존 AI 도구 84개 동작 (members_search·notice_create 등) | 90개 도구 중 신규 6개 추가에도 기존 84개 동작 유지 |

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

### §6.1 B 트리거 (백 구현 + AI 도구)

```
Phase 22-A 백엔드 작업 시작합니다.

설계서: docs/milestones/2026-05-14-phase22a-revenue-management.md (§1·§2·§10 정독)
브랜치: feature/phase22a-back (새로 생성, 베이스: 메인이 마이그 호출 완료한 main 시점)
worktree: ../tbfa-mis-B (이미 있음)

⚠️ 시작 전 메인 신호 확인:
  - 메인이 schema.ts·마이그 함수 push + Swain 마이그 호출 ok:true + schema 활성화 + 마이그 파일 삭제 완료한 시점부터 시작
  - 메인 신호 전 시작 시 schema 비활성화 상태에서 SELECT 실패

━━━ Part A: API 7개 작업 체크박스 (설계서 §2 1:1 매핑) ━━━
□ admin-revenue-categories-list.ts 작성 (§2.1)
□ admin-revenue-create.ts 작성 (§2.2)
□ admin-revenue-list.ts 작성 (§2.3) — 필터·페이지네이션·summary 포함
□ admin-revenue-update.ts 작성 (§2.4) — draft만
□ admin-revenue-approve.ts 작성 (§2.5) — super_admin 권한
□ admin-revenue-refund.ts 작성 (§2.6) — approved만, refundAmount 누적, 트랜잭션
□ admin-finance-pl-summary.ts 작성 (§2.7) — 손익계산서 통합 API
□ admin-nav-menus DB에 신규 메뉴 1건 시드 (pageKey='adm-other-revenues')

━━━ Part B: AI 에이전트 도구 6개 작업 체크박스 (설계서 §10 1:1 매핑) ━━━
□ lib/ai-agent-tools.ts TOOL_DECLARATIONS에 6개 도구 선언 추가 (§10.2)
  → 섹션 헤더: /* === Phase 22-A 매출 (6개) === */
□ lib/ai-agent-tools.ts executeTool switch에 6개 case 추가
□ 6개 핸들러 함수 작성 (§10.3 패턴):
  - tool_revenueCategoriesList (읽기)
  - tool_otherRevenuesList (읽기, 회계연도·카테고리·상태 필터)
  - tool_otherRevenueCreate (변경, dry-run + rollbackData, fiscalYear 자동 계산)
  - tool_otherRevenueApprove (변경, super_admin 권한, dry-run)
  - tool_otherRevenueRefund (변경, approved 상태만, 트랜잭션, dry-run)
  - tool_plSummary (읽기, 회계연도 단위 손익계산서)
□ lib/ai-agent-config.ts FALLBACK_SYSTEM_PROMPT에 매핑 표 6줄 + 재정 관리 섹션 추가 (§10.4)
□ 마이그 함수에 ai_tool_permissions 시드 INSERT 6건 추가 (§10.5) — 메인 마이그에 메인이 포함
  → B는 별도 시드 마이그 작성 X. 메인의 마이그가 이미 시드 포함하므로 코드만 작성
□ lib/ai-agent-tools.ts selectRelevantTools 키워드에 finance 분류 추가 (§10.6)
□ lib/ai-cache.ts dependentInvalidation에 (other_revenue_create → other_revenues_list·pl_summary 캐시 무효화) 추가

━━━ 응답 구조 (키명 임의 변경 금지 — A mock이 이 구조로 작성됨) ━━━
- 매출 카테고리 목록: { ok, data: { items: [{ id, code, name, sortOrder, isActive }] } }
- 매출 작성/수정: { ok, data: { revenue: { id, fiscalYear, recognizedAt, categoryId, amount, status, ... } } }
- 매출 목록: { ok, data: { items: [...], total, summary: { totalAmount, totalRefund, netAmount } } }
- 손익계산서: §2.7 전체 응답 구조 그대로 (revenue.donations/other, expenditure, netIncome, monthly[12])

━━━ 표준 v1.4 준수 (§10.7) ━━━
□ §3.1 도구 description 정확 — 카테고리 6코드를 모든 도구 description에 일관되게 (lecture|govgrant|corp_sponsor|twork_on|twork_si|etc)
□ §3.3 직접 DB + dry-run + rollbackData (변경 도구 4개)
□ §C6 role hierarchy — other_revenue_approve는 super_admin (admin 거부)
□ §15.5 schema 사전 검증 — db/schema.ts에서 revenue_categories enum 값 grep 후 일치 확인
□ §18.13 도메인 전체 동기화 — 카테고리 코드 6개를 도구 6개 description에 1:1 일관
□ ai_usage_logs INSERT 자동(ai-gemini.ts wrapper 사용)
□ featureKey='finance' 분리 — ai_feature_settings에 시드 (메인 마이그 포함)

━━━ push 전 체크 ━━━
□ 브랜치명: feature/phase22a-back (새로 생성했는가?)
□ 응답 최상위 키: ok, data (data 안에 items/revenue/summary/...)
□ export const config = { path: "/api/admin-revenue-*" } 6개 + pl-summary 1개 = 7개 전부
□ requireAdmin 반환 auth.res ('response' 아님)
□ super_admin 권한 분기 — revenue-approve·other_revenue_approve만
□ npx tsc --noEmit 통과 (신규 파일 0 에러)
□ AI 도구 6개 — TOOL_DECLARATIONS·executeTool case·핸들러·시스템 프롬프트 매핑 4지점 모두 추가
□ 카테고리 6코드 grep 일관성 (lecture/govgrant/corp_sponsor/twork_on/twork_si/etc) — 도구 6개·핸들러·매핑 표 모두 동일
❌ PROJECT_STATE.md·docs/HANDOFF.md·docs/milestones/·docs/standards/ 절대 수정 금지 (메인만 갱신)
❌ db/schema.ts 추가 정의 절대 X (메인이 0단계에 작성 완료. B는 SELECT만 사용)

push 완료 보고 시 메인이 키 대조 후 main 머지.
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
❌ PROJECT_STATE.md·docs/HANDOFF.md·docs/milestones/·docs/standards/ 절대 수정 금지 (메인만 갱신)
❌ db/schema.ts·netlify/functions/ 수정 X (A는 public/ 영역만)
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
[0단계 — 메인 단독] schema·마이그·AI 도구 시드 준비
   1. 메인: db/schema.ts에 revenueCategories·otherRevenues 추가 (append-only, 섹션 헤더)
   2. 메인: migrate-phase22a-revenue.ts 작성
      - revenue_categories·other_revenues 테이블 + 인덱스 7개
      - revenue_categories 시드 6건
      - ai_tool_permissions 시드 6건 (§10.5)
      - ai_feature_settings 'finance' 시드 1건
   3. 메인 push → Swain께 마이그 호출 요청:
      https://tbfa-siren-cms.netlify.app/api/migrate-phase22a-revenue?run=1
   4. Swain ok:true 보고 → 메인:
      - migrate-phase22a-revenue.ts 파일 삭제
      - schema 정의 그대로 (이미 활성)
      - PROJECT_STATE.md §2 마이그 완료 행 추가
      - push (메인 0단계 종료)

[1단계 — 평행] B + A 동시 작업
   B: §6.1 트리거 → feature/phase22a-back
   A: §6.2 트리거 → feature/phase22a-front

[2단계 — 메인 머지]
   5. B push 보고 → 메인: 키 대조 + AI 도구 description 카테고리 6코드 일관성 grep 후 main 머지
   6. A push 보고 → 메인: mock-실 키 1:1 비교 후 main 머지

[3단계 — C 검증]
   7. C 트리거 (§6.3) → verify/phase22a 브랜치 → Q1~Q18 라이브 검증
   8. 발견 BUG fix (메인) → 즉시 fix·push → C 재검증
   9. PASS 시 verify/phase22a → main 머지 (보고서·issues 흡수)

[4단계 — 마감]
   10. PROJECT_STATE.md §5 Phase 22-A ✅ + §2 마감 행
   11. 메모리 갱신 (project_ai_cost_safety.md BUG 표·도구 84→90 카운트)
   12. 표준 v1.4 §18.14 신규 사고 사례 있으면 추가 (없으면 그대로)
   13. Phase 22-B 진행 여부 Swain 협의
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

## §9 추정 시간 (4채팅 분담 갱신)

| 채팅 | 작업 | 시간 |
|---|---|---|
| 메인 | 설계서·**schema·마이그**(0단계 단독)·B/A 키 대조·머지·BUG fix·문서 갱신 | 3~4h |
| B | API 7개 (§2) + **AI 도구 6개**(§10) + 시스템 프롬프트 매핑 + selectRelevantTools | 9~12h |
| A | 사이드바 신설 그룹·후원 외 매출 화면·수입현황 확장·재무보고서 확장 | 6~8h |
| C | 라이브 검증 Q1~Q18 + AI 도구 호출 검증 + 보고서 | 2~4h |
| **합계** | | **20~28h (평행 10~14h)** |

평행 단축: B와 A는 0단계(메인 schema·마이그) 완료 후 동시 시작. AI 도구 작업이 추가돼 B 시간이 늘어남.

---

---

## §10 AI 에이전트 통합 (B 담당, Swain 명시 요구사항)

> 본 시스템이 개발된 후 기존 AI 에이전트 (도구 84개, 표준 v1.4)가 매출 관리 도구를 인식해서 상호작용 가능해야 함. 표준 `docs/standards/AI_AGENT_PLATFORM_STANDARD.md` v1.4 준수.

### 10.1 신규 AI 도구 6개 (Phase 22-A → 도구 총 84개 → 90개)

| 도구명 | 종류 | 권한 | 설명 |
|---|---|---|---|
| `revenue_categories_list` | 읽기 | admin | 매출 카테고리 목록 (활성 카테고리만 기본) |
| `other_revenues_list` | 읽기 | admin | 후원 외 매출 목록 (회계연도·카테고리·상태 필터 + 요약) |
| `other_revenue_create` | 변경 (dry-run) | admin | 후원 외 매출 작성 (draft 상태로 INSERT) |
| `other_revenue_approve` | 변경 (dry-run) | **super_admin** | draft→approved 또는 draft→rejected |
| `other_revenue_refund` | 변경 (dry-run) | admin | 환불액 누적 (approved 상태만) |
| `pl_summary` | 읽기 | admin | 통합 손익계산서 (회계연도 단위, 매출·지출·순이익) |

### 10.2 도구 선언 (`lib/ai-agent-tools.ts` TOOL_DECLARATIONS에 추가)

```typescript
// Phase 22-A 매출 통합 관리 (6개)
{ name: "revenue_categories_list", description: "후원 외 매출 카테고리 목록 (강연·교육|정부지원|기업협찬|함께워크_On|함께워크_SI|기타)",
  parameters: { type: "OBJECT", properties: {
    includeInactive: { type: "BOOLEAN", description: "비활성 카테고리 포함 (기본 false)" },
  }}},

{ name: "other_revenues_list", description: "후원 외 매출 목록 (회계연도·카테고리·상태 필터)",
  parameters: { type: "OBJECT", properties: {
    fiscalYear: { type: "INTEGER", description: "회계연도 (예: 2026)" },
    categoryCode: { type: "STRING", description: "lecture|govgrant|corp_sponsor|twork_on|twork_si|etc" },
    status: { type: "STRING", description: "draft|approved|rejected" },
    limit: { type: "INTEGER", description: "최대 100, 기본 20" },
  }}},

{ name: "other_revenue_create", description: "후원 외 매출 작성 (dry-run 우선, draft 상태로 시작)",
  parameters: { type: "OBJECT", properties: {
    recognizedAt: { type: "STRING", description: "매출 인식일 YYYY-MM-DD (서버에서 회계연도 자동 계산)" },
    categoryCode: { type: "STRING", description: "lecture|govgrant|corp_sponsor|twork_on|twork_si|etc" },
    amount: { type: "INTEGER", description: "원 단위 금액" },
    payerName: { type: "STRING", description: "납입자/거래처명" },
    description: { type: "STRING", description: "비고" },
    requireApproval: { type: "BOOLEAN" },
  }, required: ["recognizedAt", "categoryCode", "amount"] }},

{ name: "other_revenue_approve", description: "후원 외 매출 승인/반려 (dry-run 우선, super_admin 권한)",
  parameters: { type: "OBJECT", properties: {
    revenueId: { type: "INTEGER" },
    action: { type: "STRING", description: "approve|reject" },
    reason: { type: "STRING", description: "반려 사유 (action=reject 시 필수)" },
    requireApproval: { type: "BOOLEAN" },
  }, required: ["revenueId", "action"] }},

{ name: "other_revenue_refund", description: "후원 외 매출 환불 등록 (dry-run 우선, approved 상태만, 환불액 누적)",
  parameters: { type: "OBJECT", properties: {
    revenueId: { type: "INTEGER" },
    refundAmount: { type: "INTEGER", description: "환불액 (원 단위, 양수)" },
    reason: { type: "STRING" },
    requireApproval: { type: "BOOLEAN" },
  }, required: ["revenueId", "refundAmount"] }},

{ name: "pl_summary", description: "회계연도 통합 손익계산서 (매출 net = 후원+후원외 / 지출 / 순이익 / 카테고리 분해 / 월별 추이)",
  parameters: { type: "OBJECT", properties: {
    fiscalYear: { type: "INTEGER", description: "회계연도 (예: 2026)" },
  }, required: ["fiscalYear"] }},
```

### 10.3 핸들러 패턴 (표준 §3.3 — 직접 DB + dry-run + rollbackData)

각 변경 도구는 표준 v1.4 §3.3 패턴 정확 준수:

```typescript
async function tool_otherRevenueCreate(args: any, adminId: number | null): Promise<ToolResult> {
  const ALLOWED = new Set(["lecture","govgrant","corp_sponsor","twork_on","twork_si","etc"]);
  const code = String(args?.categoryCode || "");
  if (!ALLOWED.has(code)) return { ok: false, error: `categoryCode 'lecture/govgrant/corp_sponsor/twork_on/twork_si/etc' 중 하나` };

  const amount = Number(args?.amount || 0);
  if (amount <= 0) return { ok: false, error: "amount는 1 이상" };

  const recognizedAt = String(args?.recognizedAt || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recognizedAt)) return { ok: false, error: "recognizedAt YYYY-MM-DD 형식" };

  const fiscalYear = Number(recognizedAt.slice(0, 4));
  const preview = { recognizedAt, fiscalYear, categoryCode: code, amount, payerName: args?.payerName };

  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기" } };
  }

  try {
    const catRow: any = await db.execute(sql`SELECT id FROM revenue_categories WHERE code = ${code} LIMIT 1`);
    const categoryId = Number((catRow?.rows ?? catRow)[0]?.id);
    const r: any = await db.execute(sql`
      INSERT INTO other_revenues (fiscal_year, recognized_at, category_id, amount, payer_name, description, status, recorded_by)
      VALUES (${fiscalYear}, ${recognizedAt}, ${categoryId}, ${amount}, ${args?.payerName || null}, ${args?.description || null}, 'draft', ${adminId})
      RETURNING id
    `);
    const id = Number((r?.rows ?? r)[0]?.id);
    return { ok: true, output: { created: true, id, fiscalYear, categoryCode: code, amount, status: "draft" },
      rollbackData: { table: "other_revenues", id } };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
```

`other_revenue_approve`는 **표준 §C6 role hierarchy** 활용 (`super_admin > admin`). `other_revenue_refund`는 트랜잭션으로 refundAmount += 누적 + amount 초과 검증.

### 10.4 시스템 프롬프트 매핑 표 추가 (`lib/ai-agent-config.ts` FALLBACK_SYSTEM_PROMPT)

기존 매핑 표 끝에 추가:

```markdown
   | "매출" / "매출 목록" / "후원 외 매출" | other_revenues_list |
   | "매출 추가" / "매출 입력" / "후원 외 수입 기록" | other_revenue_create |
   | "매출 승인" / "매출 N번 승인" | other_revenue_approve |
   | "매출 환불" / "매출 N번 환불" | other_revenue_refund |
   | "손익계산서" / "순이익" / "올해 손익" | pl_summary |
   | "매출 카테고리" / "수입 카테고리" | revenue_categories_list |

### 재정 관리 (Phase 22-A 매출 통합)
- 매출 카테고리: revenue_categories_list
- 매출 목록·통계: other_revenues_list
- 매출 작성: other_revenue_create (dry-run → 승인 시 false 재호출)
- 매출 승인: other_revenue_approve (super_admin 전용)
- 매출 환불: other_revenue_refund (approved 상태만)
- 손익계산서: pl_summary — 매출 합계(후원+기타) - 지출 = 순이익
```

### 10.5 도구 권한 시드 (`ai_tool_permissions` 테이블)

B가 마이그 함수에 시드 INSERT 포함:

```sql
INSERT INTO ai_tool_permissions (tool_name, enabled, required_role, description, is_mutation, category) VALUES
  ('revenue_categories_list', true, 'admin', '매출 카테고리 목록', false, 'finance'),
  ('other_revenues_list', true, 'admin', '후원 외 매출 목록', false, 'finance'),
  ('other_revenue_create', true, 'admin', '후원 외 매출 작성', true, 'finance'),
  ('other_revenue_approve', true, 'super_admin', '매출 승인/반려', true, 'finance'),
  ('other_revenue_refund', true, 'admin', '매출 환불 등록', true, 'finance'),
  ('pl_summary', true, 'admin', '통합 손익계산서', false, 'finance')
ON CONFLICT (tool_name) DO NOTHING;
```

### 10.6 동적 도구 로딩 키워드 (`selectRelevantTools` 의도 분류)

매출/재정 키워드: `매출`·`수입`·`손익`·`순이익`·`재정`·`강연`·`정부`·`기업`·`협찬`·`함께워크` → 6개 도구 + 기존 budget·expenditure·donations 관련 도구 함께 로딩.

### 10.7 표준 v1.4 준수 체크리스트 (B 의무)

**§3 도구 설계**
- [ ] §3.1 도구 description 정확·enum 명시 — 카테고리 6코드 도구 description에 그대로 명시 (`lecture|govgrant|corp_sponsor|twork_on|twork_si|etc`)
- [ ] §3.3 직접 DB + dry-run + rollbackData (변경 도구 3개: create·approve·refund)

**§A 동적 도구 로딩·압축·요약**
- [ ] §A1 동적 도구 로딩 — selectRelevantTools에 `finance` 키워드 분류 추가 (매출·수입·손익·순이익·강연·정부·기업·협찬·함께워크 → 6개 도구 + budgets·expenditures·donations 관련 도구 함께 로딩)
- [ ] §A2 도구 결과 압축 — `other_revenues_list`·`pl_summary` 응답 800자 초과 시 다음 호출에서 "N건 매출 ... 재호출" 한 줄로 압축 (lib/ai-cache·ai-prompt-cache 활용)
- [ ] §A3 대화 요약 — 10턴 초과 시 앞 절반을 gemini-3.1-flash-lite로 200자 요약 (기존 인프라 그대로 동작 확인)
- [ ] §A7 폴백 체인 — `finance` 분류 호출 시 lite → flash → pro 폴백 체인 자동 적용

**§C 권한·역할**
- [ ] §C6 role hierarchy — `other_revenue_approve`는 super_admin 요구, admin 거부 (`isRoleAllowed` 함수 사용)

**§D 안전장치 (감사·로그·featureKey)**
- [ ] §D2 rollbackData 자동 기록 — 변경 도구 3개 모두 `ai_agent_logs.rollback_data` 보존 (revenueId·이전 status·refundAmount 등)
- [ ] §D4 ai_usage_logs INSERT 자동 — `lib/ai-gemini.ts` wrapper에 `featureKey='finance'` 부착해서 호출
- [ ] ai_feature_settings에 `finance` featureKey 시드 (메인 마이그에 포함). 월 한도·기능 토글 분리 가능

**§F 진단·UX (자연어 처리)**
- [ ] §F10 KST 동적 주입 — 매출 인식일 "오늘"/"어제"/"이번 주" 자연어 해석은 systemPrompt prefix의 KST 날짜 활용 (기존 인프라 그대로 동작 확인)
- [ ] §F11 short-circuit — 자연어 "진행"/"응"/"OK"/"네"/"취소" 응답 시 LLM 0회로 직전 functionCall을 `requireApproval=false`로 직접 실행 (기존 admin-ai-agent 핸들러가 자동 처리하므로 변경 도구가 dry-run 시 마지막 functionCall 기록되도록 확인)

**§15.5 schema 사전 검증**
- [ ] 도구 description의 enum과 `revenue_categories` 테이블 시드 6개 일치
  ```bash
  grep -n "lecture\|govgrant\|corp_sponsor\|twork_on\|twork_si" lib/ai-agent-tools.ts db/schema.ts drizzle/*.sql
  ```

**§18.13 도메인 전체 동기화 (BUG-05b 차단)**
- [ ] 카테고리 코드 6개를 도구 6개 description + 핸들러 화이트리스트 + 시스템 프롬프트 매핑 표에 일관되게 명시. 부분 적용 금지

### 10.8 AI 도구 검증 시나리오 (C 분담, §4 Q13~Q15 추가)

| # | 시나리오 | 기대 동작 |
|---|---|---|
| Q13 | AI 비서에 "올해 매출 목록 보여줘" → `other_revenues_list` 호출 | fiscalYear=2026 자동 추론, items 반환 |
| Q14 | AI 비서에 "오늘 강연료 50만원 매출로 추가해줘" → `other_revenue_create` dry-run → "진행" 응답 | F11 short-circuit, INSERT, status='draft' |
| Q15 | AI 비서에 "올해 손익계산서 보여줘" → `pl_summary` 호출 | 매출·지출·순이익 정확, 카테고리 분해 |
| Q16 | admin 권한으로 "매출 1번 승인해줘" → `other_revenue_approve` | 403 권한 거부 ("super_admin 필요") |
| Q17 | 매출 카테고리 안내 "매출 종류 알려줘" → `revenue_categories_list` | 6개 카테고리 한글 라벨 정확 |

---

## §11 표준 v1.4 갱신 후보 (Phase 22-A 마감 후)

- §18.14 (신규 가능성) — Phase 22-A 진행 중 발견한 새 사고 사례가 있으면 누적
- 도구 84 → 90개 카운트 갱신
- `lib/ai-agent-tools.ts`의 TOOL_DECLARATIONS 카테고리 섹션 헤더 추가 (`/* === Phase 22-A 매출 (6개) === */`)

---

**마지막 갱신**: 2026-05-14 (메인 초안 + 4채팅 분담 + AI 에이전트 통합 §10·§11 보강, Swain 검토 대기)
