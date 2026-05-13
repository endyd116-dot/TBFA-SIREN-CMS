# Phase 22-C 지출 관리 설계서

> 작성: 2026-05-14 메인  
> 전제: Phase 22-A(매출 관리) 완료 후 착수  
> 연계 설계서: `docs/milestones/2026-05-14-phase22a-revenue-management.md`

---

## §-1 4-채팅 역할 분담

| 채팅 | 모델 | 브랜치 | 담당 | 금지 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | main | 스키마·마이그레이션·머지·문서 | — |
| A | Sonnet 4.6 | feature/phase22c-front | 프론트엔드 (화면·JS) | PROJECT_STATE, docs/milestones, docs/standards 수정 ❌ |
| B | Sonnet 4.6 | feature/phase22c-back | REST API + AI 도구 | 동일 ❌ |
| C | Opus 4.7 | (읽기 전용) | 검증 Q1~Q20 | 코드 직접 수정 ❌ |

**워크트리 분리 필수**
- A: `C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A` → `feature/phase22c-front`
- B: `C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B` → `feature/phase22c-back`
- C: `C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-C` → main 최신, 읽기 전용

---

## §0 요구사항 (Swain 결정)

| 항목 | 결정 |
|---|---|
| 카테고리 체계 | NPO 표준 4분류 기본 시드 + 관리자 자유 추가·편집 가능 |
| 승인 워크플로우 | draft → approved/rejected, super_admin 전용 (매출과 동일) |
| 증빙 첨부 | R2 파일 업로드 (pre-signed URL 패턴) |
| 예산 연동 | 22-C 독립 (예산 대비 실적은 22-B에서 처리) |

---

## §1 DB 설계 (메인 0단계 완료)

### expense_categories 테이블

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | serial | PK | |
| code | varchar(32) | UNIQUE NOT NULL | 분류 코드 |
| name | varchar(100) | NOT NULL | 한글명 |
| description | text | | 설명 |
| is_system | boolean | DEFAULT false | true = NPO 기본값, code·name 수정 불가 |
| sort_order | integer | DEFAULT 0 | 정렬 |
| is_active | boolean | DEFAULT true | 비활성화 (삭제 불가, FK 참조) |
| created_at / updated_at | timestamptz | | |

**시드 4개 (NPO 표준)**

| code | name | is_system |
|---|---|---|
| personnel | 인건비 | true |
| program | 사업비 | true |
| admin_ops | 관리운영비 | true |
| fundraising | 모금비 | true |

---

### expenses 테이블

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | serial | PK | |
| fiscal_year | integer | NOT NULL | 회계연도 |
| occurred_at | date | NOT NULL | 지출 발생일 |
| category_id | integer | FK → expense_categories.id | |
| amount | bigint | NOT NULL | 원 단위 |
| payee_name | varchar(200) | | 지급처 |
| description | text | | 설명 |
| receipt_url | varchar(500) | | R2 증빙파일 URL |
| status | varchar(20) | DEFAULT 'draft' | 'draft'\|'approved'\|'rejected' |
| refund_amount | bigint | DEFAULT 0 | 환불·취소 누적 |
| recorded_by | integer | | members.id (작성자) |
| recorded_at | timestamptz | DEFAULT now() | |
| approved_by | integer | | members.id (승인자) |
| approved_at | timestamptz | | |
| rejection_reason | text | | |
| created_at / updated_at | timestamptz | | |

**인덱스**: fiscal_year / category_id / status / occurred_at

---

## §2 REST API 목록 (B 담당, 9개 신규 + 기존 1개 업데이트)

### 카테고리 관리 (3개)

**1. GET /api/admin-expense-categories-list**
- 인증: requireAdmin
- 응답: `{ ok, data: [{ id, code, name, description, isSystem, sortOrder, isActive }] }`
- 전체 반환 (비활성 포함, 관리 화면용)

**2. POST /api/admin-expense-category-create**
- 인증: super_admin 전용
- body: `{ code, name, description?, sortOrder? }`
- isSystem 강제 false (사용자 생성 카테고리는 항상 false)
- code 중복 → 400 `"이미 사용 중인 코드입니다"`

**3. PUT /api/admin-expense-category-update**
- 인증: super_admin 전용
- body: `{ id, name?, description?, sortOrder?, isActive? }`
- isSystem=true → name·code 수정 불가, sortOrder·isActive만 허용

---

### 지출 항목 관리 (6개)

**4. POST /api/admin-expense-create**
- body: `{ fiscalYear, occurredAt, categoryId, amount, payeeName?, description?, receiptUrl? }`
- status 기본 "draft", recordedBy=auth.adminId, recordedAt=now()
- amount > 0 검증, categoryId 존재 확인 (§15.5)

**5. GET /api/admin-expense-list**
- query: `?fiscalYear=&status=&categoryId=&page=1&limit=30`
- separate query + JS Map 패턴 (drizzle 다중 leftJoin 금지)
- 응답 items 필드: id / fiscalYear / occurredAt / categoryId / categoryCode / categoryName / amount / payeeName / description / receiptUrl / status / refundAmount / netAmount(=amount−refundAmount) / recordedBy / approvedBy / approvedAt / createdAt

**6. PUT /api/admin-expense-update**
- body: `{ id, fiscalYear?, occurredAt?, categoryId?, amount?, payeeName?, description?, receiptUrl? }`
- status="approved" → 수정 불가, 400 `"승인된 항목은 수정할 수 없습니다"`
- 인증: super_admin 또는 recordedBy===auth.adminId

**7. POST /api/admin-expense-approve**
- body: `{ id, action: "approve"|"reject", rejectionReason? }`
- approve: status→"approved", approvedBy=auth.adminId, approvedAt=now()
- reject: status→"rejected", rejectionReason 필수
- 인증: super_admin 전용

**8. POST /api/admin-expense-refund**
- body: `{ id, refundAmount }`
- status="approved"인 경우만 가능
- refundAmount ≤ amount 검증
- 인증: super_admin 전용

**9. POST /api/admin-expense-receipt-presign**
- body: `{ fileName, contentType }`
- lib/r2-server.ts의 기존 pre-signed URL 패턴 사용
- 응답: `{ ok, uploadUrl, fileUrl }`
- 프론트에서 uploadUrl로 PUT → fileUrl을 expense.receiptUrl에 저장

---

### 기존 API 업데이트 (1개)

**GET /api/admin-finance-pl-summary** (22-A 구현 → 22-C에서 실데이터 교체)

22-A에서 `totalExpense=0` 하드코딩 → 22-C 완료 후 아래로 교체:

```
totalExpense = SUM(amount - refund_amount)
  FROM expenses WHERE status='approved' AND fiscal_year=?

expenseByCategory = GROUP BY category_id → JOIN expense_categories
```

응답에 `expenseByCategory: [{ code, name, amount }]` 추가

---

## §3 화면 설계 (A 담당)

### 사이드바 추가

기존 "💰 재정 관리" 그룹에 추가:
- **지출 관리** → `/admin-expenses.html`

---

### admin-expenses.html (신규)

헤더: "지출 관리"

**탭 구조:**
- [지출 내역] (기본)
- [카테고리 설정] (super_admin만 노출)

**지출 내역 탭:**
- 필터바: 회계연도 / 상태(전체·임시저장·승인·반려) / 카테고리
- 테이블: 지출일 | 카테고리 | 지급처 | 금액 | 환불액 | 순금액 | 상태뱃지 | 액션
  - 상태뱃지: draft=회색"임시저장" / approved=초록"승인" / rejected=빨간"반려"
  - 액션: 수정(draft만) / 승인(super_admin, draft만) / 환불(super_admin, approved만)
- 상단 우측: [+ 지출 등록] → 등록 모달

**등록 모달 필드:**
- 회계연도 (number, 기본 현재 연도)
- 지출 발생일 (date)
- 카테고리 (select, MOCK_EXPENSE_CATEGORIES)
- 금액 (number)
- 지급처 (text)
- 설명 (textarea)
- 증빙서류 (file → presign API → R2 업로드 → fileUrl 저장)

**카테고리 설정 탭:**
- 카테고리 카드 목록
  - is_system=true: "기본값" 뱃지, 이름·코드 편집 불가, sortOrder·isActive만 편집
  - is_system=false: 전체 편집 가능
- [+ 카테고리 추가] 버튼 → 추가 모달

---

### admin-finance-income.html 업데이트

- 회계연도 selector 추가
- "지출 현황" 섹션 추가: 카테고리별 지출 바 차트 (Chart.js)
- "순이익" 카드: 총수입 - 총지출 = 순이익

---

### admin-finance-report.html 업데이트

- 손익계산서(P&L) 탭의 지출 섹션: 카테고리별 실데이터
- 지출 합계 → 순이익 계산

---

## §4 검증 Q&A (C 담당, Q1~Q20)

**카테고리 관리**
- Q1: 지출 카테고리 목록 조회 → 시스템 4개 노출 확인
- Q2: 커스텀 카테고리 추가 → 목록 추가 확인
- Q3: isSystem=true 카테고리 이름 수정 시도 → 거절 확인
- Q4: 커스텀 카테고리 비활성화 → isActive=false 확인

**지출 CRUD**
- Q5: 지출 항목 등록 → status=draft 확인
- Q6: 지출 목록 필터 (연도·상태·카테고리별)
- Q7: draft 항목 수정 → 성공 확인
- Q8: draft 항목 승인 → status=approved 확인
- Q9: approved 항목 수정 시도 → 거절 확인
- Q10: 승인 반려 (rejectionReason 필수) → status=rejected 확인
- Q11: approved 항목 환불 기록 → netAmount 감소 확인
- Q12: refundAmount > amount 입력 → 거절 확인

**증빙 첨부**
- Q13: 영수증 파일 업로드 → presign API → R2 PUT → receiptUrl 저장 확인

**P&L 통합**
- Q14: P&L 요약 API (총지출 = approved 지출 합산) 확인
- Q15: 카테고리별 지출 집계 정확성 확인
- Q16: 순이익 = 총수입 - 총지출 계산 정확성 확인

**AI 도구**
- Q17: "2026년 지출 목록 보여줘" → expenses_list 호출 확인
- Q18: "인건비 200만원 지출 등록해줘" → expense_create dry-run → 승인 → 실행
- Q19: "지출 #2 승인해줘" → expense_approve dry-run → 승인 → 실행 (super_admin)
- Q20: admin 권한으로 expense_approve 시도 → 권한 거절 확인

---

## §5 Mock 데이터 (A 전용, B 완료 전까지 사용)

```javascript
const MOCK_EXPENSE_CATEGORIES = [
  { id:1, code:"personnel",   name:"인건비",     isSystem:true,  sortOrder:1, isActive:true },
  { id:2, code:"program",     name:"사업비",     isSystem:true,  sortOrder:2, isActive:true },
  { id:3, code:"admin_ops",   name:"관리운영비", isSystem:true,  sortOrder:3, isActive:true },
  { id:4, code:"fundraising", name:"모금비",     isSystem:true,  sortOrder:4, isActive:true },
];

const MOCK_EXPENSE_LIST = {
  items: [
    { id:1, fiscalYear:2026, occurredAt:"2026-04-25", categoryId:1, categoryCode:"personnel",
      categoryName:"인건비", amount:3500000, payeeName:"직원 급여", description:"4월 인건비",
      status:"approved", refundAmount:0, netAmount:3500000 },
    { id:2, fiscalYear:2026, occurredAt:"2026-04-10", categoryId:3, categoryCode:"admin_ops",
      categoryName:"관리운영비", amount:450000, payeeName:"KT", description:"인터넷·전화 요금",
      status:"approved", refundAmount:0, netAmount:450000 },
    { id:3, fiscalYear:2026, occurredAt:"2026-05-02", categoryId:2, categoryCode:"program",
      categoryName:"사업비", amount:800000, payeeName:"인쇄소", description:"홍보물 제작",
      status:"draft", refundAmount:0, netAmount:800000 },
  ],
  total: 3, page: 1, limit: 30,
};

// 22-A MOCK_PL_SUMMARY에 지출 추가한 버전
const MOCK_PL_SUMMARY_WITH_EXPENSE = {
  fiscalYear: 2026,
  donationRevenue: { regular:12500000, oneTime:3200000, total:15700000 },
  otherRevenue: {
    byCategory: [
      { code:"lecture",  name:"강연·교육 수익",     amount:1500000 },
      { code:"govgrant", name:"정부·지자체 지원금", amount:5000000 },
    ],
    total: 6500000,
  },
  totalRevenue: 22200000,
  expenseByCategory: [
    { code:"personnel", name:"인건비",     amount:3500000 },
    { code:"admin_ops", name:"관리운영비", amount:450000 },
  ],
  totalExpense: 3950000,
  netIncome: 18250000,
  refundTotal: 0,
  netRevenue: 22200000,
};
```

---

## §6.1 B 트리거 (feature/phase22c-back) — 🔧 백엔드 전용

> ⚠️ **혼동 방지**: 이 트리거는 **B 채팅(백엔드)** 전용입니다.
> 프론트엔드 트리거(§6.2)와 절대 섞이지 않도록 발송 시 채팅 대상을 확인하세요.
> 22-A 라운드에서 A·B에게 둘 다 프론트 트리거가 발송된 사고 재발 방지.

```
[메인 → B 채팅] Phase 22-C 지출 관리 — 🔧 백엔드 + AI 도구 (프론트 작업 ❌)

이 트리거는 백엔드 + AI 도구 작업 전용입니다.
화면·HTML·JS 작업이 포함된 트리거를 받았다면 잘못 받은 것이니 즉시 메인에 문의.

[자율주행 정책]
- push와 애매한 로직만 묻고 나머지는 자율 진행
- 파일 읽기·수정·git 명령·bash·PowerShell·npm install은 묻지 말 것
- 막히면 즉시 보고 (혼자 30분 이상 헤매지 말 것)

[진행률 보고 의무]
- 큰 단계(체크박스 1개) 완료마다 진행률 % 한 줄 보고
- 형식: "📊 진행률 35% (3/N 완료) — 다음: ..."
- 매 응답마다 ❌ (큰 단계마다만)

전제: Phase 22-A feature/phase22a-back 작업 완료 후 신규 브랜치 시작

워크트리 준비:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin
  git checkout -b feature/phase22c-back origin/main
베이스: main (22-A 머지 완료 후 시점)

설계서: docs/milestones/2026-05-14-phase22c-expense-management.md
표준: docs/standards/AI_AGENT_PLATFORM_STANDARD.md v1.4

■ Part A — REST API 9개 신규 + 기존 1개 업데이트 (§2 전체)

체크박스 순서:

카테고리 관리:
- [ ] GET  /api/admin-expense-categories-list
- [ ] POST /api/admin-expense-category-create (super_admin, isSystem 강제 false)
- [ ] PUT  /api/admin-expense-category-update (isSystem=true → sortOrder·isActive만)

지출 항목:
- [ ] POST /api/admin-expense-create
- [ ] GET  /api/admin-expense-list (separate query + JS Map 패턴)
- [ ] PUT  /api/admin-expense-update (approved 수정 불가)
- [ ] POST /api/admin-expense-approve (super_admin 전용)
- [ ] POST /api/admin-expense-refund  (super_admin 전용, refundAmount ≤ amount)
- [ ] POST /api/admin-expense-receipt-presign (lib/r2-server.ts 패턴)

기존 업데이트:
- [ ] GET  /api/admin-finance-pl-summary → totalExpense 실데이터 교체 + expenseByCategory 추가

공통 규칙:
- export const config = { path: "/api/함수명" }
- 단계별 try/catch + step + detail + stack
- guardFailed(auth) 패턴 (TS2339 방지)
- bigint 컬럼: Number() 변환 후 응답

■ Part B — AI 도구 5개 신규 + pl_summary 핸들러 업데이트 (§10 전체)

파일: lib/ai-agent-tools.ts
featureKey='finance' (22-A에서 이미 시드됨)

신규 도구 5개:

[ ] expense_categories_list (읽기, dry-run 불필요)
  description: "지출 카테고리 목록. NPO 표준 4분류(인건비/사업비/관리운영비/모금비) + 사용자 정의."
  parameters: {} (없음)

[ ] expenses_list (읽기, dry-run 불필요)
  description: "지출 항목 목록. 연도·상태·카테고리 필터. status: draft|approved|rejected"
  parameters:
    fiscalYear (number, optional)
    status (string, enum ["draft","approved","rejected"], optional)
    categoryId (number, optional)

[ ] expense_create (변경, requireApproval=true)
  description: "지출 항목 등록. 승인 전 draft 상태로 저장."
  parameters (required: fiscalYear, occurredAt, categoryId, amount):
    fiscalYear (number), occurredAt (string, YYYY-MM-DD), categoryId (number),
    amount (number), payeeName (string), description (string)

[ ] expense_approve (변경, requireApproval=true, super_admin 전용)
  description: "지출 항목 승인 또는 반려. super_admin 전용. action: approve|reject"
  parameters (required: id, action):
    id (number), action (string, enum ["approve","reject"]), rejectionReason (string)

[ ] expense_refund (변경, requireApproval=true, super_admin 전용)
  description: "승인된 지출 항목 환불 기록. 환불액은 순지출에서 차감."
  parameters (required: id, refundAmount):
    id (number), refundAmount (number)

pl_summary 핸들러 업데이트:
  - 기존 totalExpense=0 → expenses 테이블 실데이터 조회
  - expenseByCategory 배열 추가

표준 v1.4 체크리스트 (§10.7):
- [ ] §3.1 description 간결 (50자 이내 첫 문장)
- [ ] §3.3 직접 DB 또는 내부 REST 호출
- [ ] §3.3 변경 도구 dry-run + rollbackData
- [ ] §C6 role hierarchy (expense_approve·refund = super_admin)
- [ ] §D featureKey='finance', ai_usage_logs 로깅
- [ ] §F11 short-circuit (dry-run 자연어 승인)
- [ ] §15.5 schema 사전 검증 (expense_categories categoryId 존재 확인)
- [ ] §18.13 enum 동기화 (status: draft|approved|rejected — 핸들러·description·ALLOWED 3곳 일치)
- [ ] §A 동적 로딩: 'finance' 인텐트에 키워드 추가 (지출, 비용, 경비, 인건비, 사업비)

시스템 프롬프트 매핑 추가:
  "지출 조회·목록 → expenses_list / expense_categories_list"
  "지출 등록 → expense_create"
  "지출 승인·반려 → expense_approve"
  "지출 환불 → expense_refund"

완료 후:
- git add, commit ("feat(phase22c): 지출 관리 API 9개 + AI 도구 5개 구현")
- git push origin feature/phase22c-back
- PROJECT_STATE.md / docs/ 수정 금지
- 완료 메시지: "[B → 메인] feature/phase22c-back push 완료. 머지 요청."
```

---

## §6.2 A 트리거 (feature/phase22c-front) — 🎨 프론트엔드 전용

> ⚠️ **혼동 방지**: 이 트리거는 **A 채팅(프론트엔드)** 전용입니다.
> 백엔드 트리거(§6.1)와 절대 섞이지 않도록 발송 시 채팅 대상을 확인하세요.

```
[메인 → A 채팅] Phase 22-C 지출 관리 — 🎨 프론트엔드 (백엔드·AI 도구 ❌)

이 트리거는 화면·HTML·JS 작업 전용입니다.
REST API 함수·AI 도구가 포함된 트리거를 받았다면 잘못 받은 것이니 즉시 메인에 문의.

[자율주행 정책]
- push와 애매한 로직만 묻고 나머지는 자율 진행
- 파일 읽기·수정·git 명령·bash·PowerShell·npm install은 묻지 말 것
- 막히면 즉시 보고 (혼자 30분 이상 헤매지 말 것)

[진행률 보고 의무]
- 큰 단계(체크박스 1개) 완료마다 진행률 % 한 줄 보고
- 형식: "📊 진행률 35% (3/N 완료) — 다음: ..."
- 매 응답마다 ❌ (큰 단계마다만)

전제: Phase 22-A feature/phase22a-front 작업 완료 후 신규 브랜치 시작

워크트리 준비:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin
  git checkout -b feature/phase22c-front origin/main
베이스: main (22-A 머지 완료 후 시점)

설계서: docs/milestones/2026-05-14-phase22c-expense-management.md §3

■ 작업 목록

- [ ] 사이드바: "💰 재정 관리" 그룹에 "지출 관리" → /admin-expenses.html 추가

- [ ] public/admin-expenses.html + public/js/admin-expenses.js (신규)
  탭: [지출 내역] / [카테고리 설정]
  지출 내역 탭: 필터 + 테이블 + 등록 모달 (R2 파일 업로드 포함)
  카테고리 탭: isSystem 뱃지 + 추가/편집 (super_admin 조건부 노출)

- [ ] public/admin-finance-income.html + js 업데이트
  지출 섹션 + 카테고리별 바 차트 + 순이익 카드

- [ ] public/admin-finance-report.html + js 업데이트
  P&L 탭 지출 섹션 실데이터 (mock → 22-B 완료 후 실데이터)

- [ ] 캐시버스터 ?v=N 일괄 갱신

R2 파일 업로드 패턴:
  1. POST /api/admin-expense-receipt-presign → { uploadUrl, fileUrl }
  2. fetch(uploadUrl, { method:"PUT", body: file })
  3. expense.receiptUrl = fileUrl

Mock 데이터 (§5 전체 사용):
  MOCK_EXPENSE_CATEGORIES, MOCK_EXPENSE_LIST, MOCK_PL_SUMMARY_WITH_EXPENSE

공통 규칙:
  api() 헬퍼 이중 stringify 금지
  응답 키 다중 fallback: res.data.data.X || res.data.X || res.X
  금액: toLocaleString('ko-KR') + "원"
  super_admin 전용 버튼: role 체크 후 조건부 렌더

완료 후:
- git add, commit ("feat(phase22c): 지출 관리 프론트엔드 구현")
- git push origin feature/phase22c-front
- PROJECT_STATE.md / docs/ 수정 금지
- 완료 메시지: "[A → 메인] feature/phase22c-front push 완료. 머지 요청."
```

---

## §6.3 C 트리거

```
[메인 → C 채팅] Phase 22-C 지출 관리 — 검증

베이스: main (22-C B+A 머지 완료 후)
설계서 §4 Q1~Q20 전체 검증

검증 URL: https://tbfa.co.kr/admin-expenses.html
API 베이스: https://tbfa.co.kr/api/

Q1~Q4: 카테고리 관리 (목록 조회, 추가, isSystem 수정 거절, 비활성화)
Q5~Q12: 지출 CRUD (등록·수정·승인·반려·환불·제약 확인)
Q13: 영수증 파일 업로드 → R2 URL 저장 확인
Q14~Q16: P&L 통합 (지출 반영 순이익 정확성)
Q17~Q20: AI 도구 (expenses_list, expense_create, expense_approve, 권한 거절)

완료 메시지: "[C → 메인] Phase 22-C 검증 완료. 결과 보고."
```

---

## §7 라운드 마감 체크리스트

- [ ] 0단계 메인: schema.ts 추가 완료 ✅ / 마이그레이션 실행 + 파일 삭제
- [ ] 1단계 B: feature/phase22c-back push, API 9개 + 업데이트 1개, AI 도구 5개 + 업데이트 1개
- [ ] 메인: B 머지 전 key 대조 + status enum 3곳 동기화 확인 (§18.13)
- [ ] 1단계 A: feature/phase22c-front push, mock→실데이터 교체 완료
- [ ] 메인: A 머지
- [ ] 2단계 C: Q1~Q20 검증
- [ ] 메인: PROJECT_STATE.md + HANDOFF.md + memory 갱신
  - memory/project_ai_cost_safety.md: 도구 수 90개로 갱신

---

## §8 리스크·주의

- 22-A 완료 전 착수 금지 (pl_summary API가 22-A에 의존)
- expenses 테이블 없을 때 pl_summary는 totalExpense=0 fallback 유지 (22-A 배포 기간 중 안전)
- isSystem 카테고리: DELETE 불가 (FK 참조) → isActive=false로만 비활성화
- **status enum 3곳 동기화 필수 (§18.13)**: expenses 핸들러 ALLOWED 상수 + expenses_list description + expense_create description — 3곳 모두 "draft|approved|rejected"
- R2 presigned URL 만료 시간: 기존 r2-server.ts 패턴 그대로 따를 것

---

## §9 작업 시간 추정

| 채팅 | 작업 | 시간 |
|---|---|---|
| 메인 0단계 | schema 2개 완료 + migration | 1h (schema 완료, migration 대기) |
| B 1단계 | API 9개 + 업데이트 1개 + AI 도구 5개 + 업데이트 1개 | 10~14h |
| A 1단계 | 신규 1페이지 + 업데이트 2개 + 사이드바 | 7~9h |
| 병렬 합계 | | **10~14h** |

---

## §10 AI 에이전트 도구 (5개 신규, 1개 업데이트)

### §10.1 도구 목록

| 도구명 | 유형 | dry-run | 최소 권한 | featureKey |
|---|---|---|---|---|
| expense_categories_list | 읽기 | ❌ | admin | finance |
| expenses_list | 읽기 | ❌ | admin | finance |
| expense_create | 변경 | ✅ | admin | finance |
| expense_approve | 변경 | ✅ | super_admin | finance |
| expense_refund | 변경 | ✅ | super_admin | finance |
| pl_summary (업데이트) | 읽기 | ❌ | admin | finance |

### §10.2 ai_tool_permissions 시드

마이그레이션에 포함 (5개 INSERT ON CONFLICT DO NOTHING)

### §10.3 핸들러 패턴 (§3.3 표준)

읽기 도구: DB 직접 쿼리 또는 내부 fetch
변경 도구:
```
if (args.requireApproval !== false) {
  // dry-run: before 상태 조회 → 미리보기 텍스트 반환
  return { requireApproval: true, preview: "...", rollbackData: beforeState };
}
// 실행: REST API 내부 호출
```

### §10.4 동적 로딩 키워드 추가

기존 'finance' 인텐트에 추가:
`지출`, `비용`, `경비`, `인건비`, `사업비`, `관리운영비`, `모금비`

### §10.5 시스템 프롬프트 매핑

```
지출 목록/조회 → expenses_list / expense_categories_list
지출 등록 → expense_create
지출 승인/반려 → expense_approve
지출 환불 → expense_refund
손익/재정 현황 → pl_summary (지출 포함)
```

---

## §11 표준 v1.4 업데이트 후보

- isSystem 컬럼 패턴: 시스템 기본값 보호 (code·name 잠금) → 표준 재사용 패턴으로 등재 후보
- §15.5 확장: category FK 참조 시 존재 확인 의무를 모든 FK 컬럼으로 일반화 후보
