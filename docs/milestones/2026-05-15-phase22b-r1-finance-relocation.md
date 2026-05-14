# Phase 22-B-R1 — 재정 시스템 통합·재배치

> 작성: 2026-05-15 메인
> 상위: Phase 22-B (재정 3부작 마지막 — 예산·결재·회계 보고서)
> R1 범위: **재정 화면 이전 (싸이렌 어드민 → 통합 CMS) + 지출 시스템 단일화 + 기간 필터 (일/주/월/반기/년/특정기간)**
> 후속: R2 차년도 예산 편성 + 2단계 결재 / R3 NPO 표준 회계 보고서

---

## §-1 4-채팅 역할 분담

| 채팅 | 모델 | 브랜치 | 담당 | 금지 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | main | 마이그·머지·문서 | — |
| A | Sonnet 4.6 | feature/phase22b-r1-front | 🎨 화면 이전 (admin.html → cms-tbfa.html) | PROJECT_STATE·docs·netlify/functions·lib·db 수정 ❌ |
| B | Opus 4.7 | feature/phase22b-r1-back | 🔧 지출 단일화 백엔드 + AI 도구 정리 | PROJECT_STATE·docs·public 수정 ❌ |
| C | Opus 4.7 | (검증 → 자체 fix) | 🔍 검증 Q1~Q14 + 자체 fix | 신규 기능 추가 ❌ |

**워크트리 분리 필수** — A: `tbfa-mis-A` / B: `tbfa-mis-B` / C: `tbfa-mis-C`

---

## §0 요구사항 (Swain 결정)

| 항목 | 결정 |
|---|---|
| 재정 화면 위치 | **전부 이전** — 22-A·22-C·옛 Phase 5~7 재정 화면 모두 싸이렌 어드민(`admin.html`)에서 통합 CMS(`cms-tbfa.html`)로 |
| 지출 시스템 정본 | **22-C `expenses` 정본** — 옛 `expenditures` 데이터를 `expenses`로 마이그 후 옛 시스템 폐기 |
| (R2) 결재 단계 | 2단계 (담당자 → 대표) — R2에서 처리 |
| (R3) 회계 보고서 | NPO 표준 양식 — R3에서 처리 |

### 배경 — 왜 이전·단일화가 필요한가

- **화면 위치 오류**: 재정 관리(22-A·22-C·옛 Phase 5~7)가 SIREN 신고 중심 어드민(`admin.html`)에 들어가 있음. 회원·후원 데이터 관리는 통합 CMS(`cms-tbfa.html`)에 있어 데이터 맥락이 분리됨. DB는 하나(Neon)라 데이터 자체는 공유되나 화면 맥락이 어긋남.
- **지출 시스템 중복**: 옛 `expenditures`(Phase 5~7)와 신규 `expenses`(Phase 22-C)가 거의 동일 역할. AI 도구도 `expenditures_list` vs `expenses_list` 양쪽 존재. 22-C 설계 시 옛 시스템 정독 누락(CLAUDE.md §9.1.9 위반).

---

## §1 화면 이전 매핑 (A 담당)

### 1.1 이전 대상 — admin.html "💰 재정 관리" 그룹 6개

| 현재 (admin.html) | data-page | JS 파일 | → 이전 후 (cms-tbfa.html) |
|---|---|---|---|
| 후원금 관리 | `donations` | admin.js loadDonations | ⚠️ cms-tbfa에 이미 정기/예비/잠재 후원자 존재 → §1.4 중복 검토 |
| 수입 현황 | `finance-income` | admin-finance-income.js | data-tab `finance-income` |
| 후원 외 매출 | `other-revenues` | admin-other-revenues.js | data-tab `other-revenues` |
| 지출 관리 | `expenses` | admin-expenses.js | data-tab `expenses` |
| 예산·지출 관리 | `finance-budget` | admin-finance-budget.js | data-tab `finance-budget` (지출 부분은 expenses로 전환 — §2) |
| 재무 보고서 | `finance-report` | admin-finance-report.js | data-tab `finance-report` |

### 1.2 cms-tbfa.html "💰 후원·재정 관리" 그룹 — 이전 후 구조

```
💰 후원·재정 관리 (data-group="donation")
├─ 정기 후원자 관리      (donor-regular)   — 기존 유지
├─ 예비 후원자 관리      (donor-prospect)  — 기존 유지
├─ 잠재 후원자 관리      (donor-potential) — 기존 유지
├─ 효성 CMS+            (hyosung)         — 기존 유지
├─ 토스 빌링            (toss-billing)    — 기존 유지
├─ ── 재정 (신규 이전) ──
├─ 수입 현황            (finance-income)   ← admin.html에서 이전
├─ 후원 외 매출         (other-revenues)   ← 이전
├─ 지출 관리            (expenses)         ← 이전
├─ 예산 관리            (finance-budget)   ← 이전 (지출 연동은 expenses 기준)
└─ 재무 보고서          (finance-report)   ← 이전
```

### 1.3 렌더 패턴 적응 (핵심 작업)

두 어드민의 렌더 패턴이 다름:

| | admin.html | cms-tbfa.html |
|---|---|---|
| 라우팅 | `switchAdminPage(page)` → `window.SIREN_*.load()` | data-tab 클릭 → `<section id="page-{tab}">` DOM 토글 |
| 영역 | `<div id="adm-{page}" class="adm-page">` | `<section id="page-{tab}">` |

A 작업:
- [ ] cms-tbfa.html 사이드바 "💰 후원·재정 관리" 그룹에 5개 메뉴 추가 (구분선 + 항목)
- [ ] cms-tbfa.html에 `<section id="page-finance-income">` 등 5개 섹션 영역 추가
- [ ] cms-tbfa.js 탭 라우팅에 5개 data-tab 케이스 추가 — 각 탭 활성 시 해당 JS의 load 호출
- [ ] 5개 JS 파일(admin-finance-income.js·admin-other-revenues.js·admin-expenses.js·admin-finance-budget.js·admin-finance-report.js)을 cms-tbfa.html에서 로드하도록 `<script>` 추가
- [ ] 각 JS가 `window.SIREN_*` 전역 객체 패턴 유지 — cms-tbfa.js에서 `data-tab` 활성 시 `window.SIREN_FINANCE_INCOME?.load()` 형태로 호출 (admin.html 패턴 그대로 재사용 가능, JS 내부 로직 수정 최소화)
- [ ] admin.html 사이드바에서 "💰 재정 관리" 그룹 6개 메뉴 **제거** + `<div id="adm-...">` 영역 제거 + `<script>` 참조 제거
- [ ] admin.js의 finance 관련 라우팅 케이스 제거
- [ ] 캐시버스터 `?v=20260515p22b` 일괄 갱신

### 1.4 후원금 관리(donations) 중복 검토 — A 보고 사항

admin.html "후원금 관리"(data-page=donations)는 `admin.js loadDonations()`로 동작. cms-tbfa.html에는 이미 정기/예비/잠재 후원자 메뉴가 있음.

**A는 admin.html의 donations 화면이 cms-tbfa의 정기 후원자 관리와 기능 중복인지, 별개 기능인지 정독 후 메인에 보고.** 중복이면 제거, 별개 기능(예: 전체 후원 내역 조회)이면 cms-tbfa로 이전. 메인 결정 대기.

---

## §2 지출 시스템 단일화 (B 담당 + 메인 0단계)

### 2.1 메인 0단계 — 데이터 마이그레이션

`netlify/functions/migrate-phase22b-expenditures-to-expenses.ts` 작성:
- 진단 모드: `expenditures` 행 수 + `expenses` 행 수 + 마이그 대상 카운트
- 실행 모드(`?run=1`): `expenditures` → `expenses` 데이터 복사
  - 컬럼 매핑:
    | expenditures | → expenses |
    |---|---|
    | category_id (→budget_categories) | category_id (→expense_categories) — §2.2 카테고리 매핑 필요 |
    | amount (numeric) | amount (bigint) — Number 변환 |
    | spent_at (date) | occurred_at (date) |
    | description | description |
    | payee | payee_name |
    | status ('draft'/'approved') | status ('draft'/'approved') |
    | receipt_url | receipt_url |
    | created_by | recorded_by |
    | approved_by / approved_at | approved_by / approved_at |
    | note | description에 합치거나 별도 |
    | (없음) | fiscal_year — spent_at 연도로 자동 |
    | (없음) | refund_amount = 0 |
  - 마이그된 행에 마커: description 끝에 ` [구지출이관]` 또는 별도 컬럼
  - 멱등성: 이미 마이그된 경우 스킵
- 호출 후 파일 삭제

### 2.2 카테고리 매핑 — Swain 또는 메인 결정

`budget_categories`(옛)와 `expense_categories`(22-C, NPO 4분류) 카테고리가 다름.
- 옛 `budget_categories` 코드를 확인 후, 22-C 4분류(personnel·program·admin_ops·fundraising) 중 하나로 매핑
- 마이그 함수 안에 매핑 테이블 하드코딩 (옛 카테고리 수가 적을 것)
- 매핑 불가한 옛 카테고리는 `expense_categories`에 사용자 카테고리로 신규 생성 (isSystem=false)
- **B는 마이그 함수 작성 전 옛 `budget_categories` 실데이터를 진단 모드로 확인 후 매핑표를 메인에 보고**

### 2.3 B 백엔드 작업

- [ ] `admin-finance-budget-list.ts` — `budgets` 집행률 계산을 `expenditures` → `expenses` 기준으로 전환
  - `executedAmount` = `expenses` WHERE status='approved' AND category_id 매칭 AND fiscal_year 매칭 SUM(amount - refund_amount)
  - 단 `budgets.category_id`는 `budget_categories` 참조 → `expense_categories`로 전환 필요 (§2.2 매핑 적용)
- [ ] `admin-finance-budget.js`가 호출하던 지출 목록 API를 `admin-expense-list`로 교체 안내 (A에게 전달)
- [ ] 옛 지출 API 3개 deprecated 처리:
  - `admin-finance-expenditure-list.ts` / `-create.ts` / `-approve.ts`
  - 즉시 삭제하지 말고 응답에 `{ deprecated: true, useInstead: "admin-expense-*" }` 추가 + 410 또는 정상 응답 + 경고 (회귀 안전)
- [ ] AI 도구 정리: `expenditures_list` 도구를 `expenses_list`로 통합 — `lib/ai-agent-tools.ts`에서 `expenditures_list` 선언·핸들러·switch case 제거, 시스템 프롬프트 매핑에서 제거
  - `lib/ai-agent-config.ts` 매핑 테이블에서 "지출"→expenditures_list 행을 expenses_list로
  - `lib/ai-cache.ts` INVALIDATION_MAP·CACHEABLE_TOOLS에서 expenditures 관련 제거
- [ ] §18.13 enum 동기화: 지출 status enum (draft|approved|rejected) 핸들러·description·매핑 3곳 점검
- [ ] `npx tsc --noEmit` 통과

### 2.4 schema.ts 처리

- `expenditures` / `budgetCategories` 테이블 정의는 **즉시 삭제하지 않음** — R2에서 budgets 재설계 시 함께 정리
- R1에서는 `expenses` / `expense_categories`만 사용하도록 코드 전환
- `budgets` 테이블은 유지 (R2 예산 편성에서 사용)

---

## §2-b 기간 필터 추가 범위 (원래 22-A 설계 의도 — 미구현)

> 22-A 설계 당시 원본 취지였으나 구현 누락. R1에 편입.

### 기간 옵션 스펙

| `period` 값 | 화면 라벨 | 서버 startDate/endDate 자동 계산 |
|---|---|---|
| `day` | 오늘 | 오늘 00:00 ~ 23:59 (KST) |
| `week` | 이번 주 | 이번 주 월요일 00:00 ~ 일요일 23:59 |
| `month` | 이번 달 | 이번 달 1일 ~ 말일 **(기본값)** |
| `half_year` | 반기 | 6개월 전 오늘 ~ 오늘 23:59 |
| `year` | 올해 | 올해 1월 1일 ~ 12월 31일 |
| `custom` | 특정 기간 | 클라이언트 전달 `startDate` ~ `endDate` |

하위호환: `fiscalYear`(숫자)만 넘어오면 `${fiscalYear}-01-01` ~ `${fiscalYear}-12-31` 변환 (기존 화면 대응)

### 적용 대상

| 파일 | 담당 |
|---|---|
| `netlify/functions/admin-revenue-list.ts` | B |
| `netlify/functions/admin-expense-list.ts` | B |
| `netlify/functions/admin-finance-pl-summary.ts` | B |
| `lib/ai-agent-tools.ts` — pl_summary / revenue_list / expenses_list 3개 | B |
| 매출 현황 UI (`admin-finance-income.js`) | A |
| 후원 외 매출 UI (`admin-other-revenues.js`) | A |
| 지출 관리 UI (`admin-expenses.js`) | A |
| 재무 보고서 UI (`admin-finance-report.js`) | A |

### pl-summary 특이 사항

- `monthly[]` 배열: `year` / `half_year` / `custom`(범위 60일 이상)일 때만 포함, 그 외 생략
- 단일 날짜(day/week)에서는 집계 합산 숫자만 반환

---

## §3 검증 Q&A (C 담당, Q1~Q20)

### 화면 이전
- Q1: 통합 CMS(cms-tbfa.html) "💰 후원·재정 관리" 그룹에 5개 재정 메뉴 노출
- Q2: 각 메뉴 클릭 → 해당 섹션 정상 렌더 (수입 현황·후원 외 매출·지출 관리·예산 관리·재무 보고서)
- Q3: 싸이렌 어드민(admin.html)에서 "💰 재정 관리" 그룹 완전히 제거됨
- Q4: admin.html에서 finance 라우팅 잔재 없음 (콘솔 에러 0)
- Q5: 통합 CMS에서 각 화면 데이터 로드 정상 (DB 공유라 데이터 동일)
- Q6: 후원금 관리(donations) 중복 검토 결과 반영 확인

### 지출 단일화
- Q7: 마이그 후 옛 expenditures 데이터가 expenses에 정상 복사 (행 수·금액 합 일치)
- Q8: 카테고리 매핑 정확성 (옛 budget_categories → expense_categories)
- Q9: 예산 관리 화면의 집행률이 expenses 기준으로 정확히 계산
- Q10: 옛 지출 API 3개 호출 시 deprecated 경고 응답
- Q11: AI 비서에 "지출 목록 보여줘" → expenses_list 호출 (expenditures_list 제거 확인)
- Q12: 지출 등록·승인·환불 흐름이 expenses 단일 시스템으로 동작

### 회귀
- Q13: 기존 22-A·22-C 기능 회귀 0 (매출·지출·손익계산서)
- Q14: 싸이렌 어드민 다른 기능(SIREN 신고 등) 회귀 0

### 기간 필터
- Q15: 매출 현황 화면에서 기간 선택기 노출 — 드롭다운 6개 옵션 (오늘/이번 주/이번 달/반기/올해/특정 기간)
- Q16: "이번 달" 기본 선택 → API 호출 시 `period=month` 전달
- Q17: "특정 기간" 선택 → 날짜 입력 2개 노출 → API `period=custom&startDate=...&endDate=...` 전달
- Q18: 기간 변경 시 매출/지출/보고서 각각 재조회 데이터 정확 (날짜 범위 안 데이터만 집계)
- Q19: `fiscalYear` 하위호환 — 기존 API 파라미터로 호출 시 정상 동작
- Q20: AI 비서 "이번 주 손익 알려줘" → pl_summary에 `period=week` 전달 + 정확 응답

---

## §4 트리거

### §4.1 B 트리거 (feature/phase22b-r1-back) — 🔧 백엔드 전용

```
[메인 → B 채팅] Phase 22-B-R1 지출 시스템 단일화 — 🔧 백엔드 + AI 도구 (프론트 작업 ❌)

이 트리거는 백엔드 + AI 도구 작업 전용입니다.
화면·HTML·JS 작업 트리거를 받았다면 잘못 받은 것이니 즉시 메인에 문의.

[자율주행 정책]
- push와 애매한 로직만 묻고 나머지는 자율 진행
- 파일 읽기·수정·git·bash·PowerShell·npm install은 묻지 말 것
- 막히면 즉시 보고 (혼자 30분 이상 헤매지 말 것)

[진행률 보고 의무]
- 큰 단계 완료마다 진행률 % 한 줄 보고
- 형식: "📊 진행률 X% (N/M 완료) — 다음: ..."

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin
  git checkout main && git pull origin main
  git checkout -b feature/phase22b-r1-back
베이스: main 최신 (반드시 git pull 후 — 옛 베이스 금지)

설계서: docs/milestones/2026-05-15-phase22b-r1-finance-relocation.md §2

■ 1단계 — 카테고리 매핑 진단 (먼저)
- [ ] 옛 budget_categories 실데이터 진단 (코드·이름 목록)
- [ ] 22-C expense_categories 4분류와 매핑표 작성 → 메인에 보고
  (매핑 불가 카테고리는 expense_categories에 isSystem=false로 신규)

■ 2단계 — 데이터 마이그레이션 함수
- [ ] netlify/functions/migrate-phase22b-expenditures-to-expenses.ts
  · 진단 모드: expenditures/expenses 행 수 + 마이그 대상
  · 실행 모드(?run=1): 컬럼 매핑(설계서 §2.1 표) + 카테고리 매핑(§2.2) 적용
  · 마이그 마커 + 멱등성
- [ ] 메인에 마이그 호출 요청 (Swain이 호출)

■ 3단계 — 백엔드 전환
- [ ] admin-finance-budget-list.ts: 집행률을 expenses 기준으로 (status='approved', fiscal_year, category_id 매칭, SUM(amount-refund_amount))
- [ ] 옛 지출 API 3개 deprecated: admin-finance-expenditure-list/create/approve
  · 즉시 삭제 X, 응답에 { deprecated:true, useInstead:"admin-expense-*" } + 경고
- [ ] AI 도구 expenditures_list → expenses_list 통합
  · lib/ai-agent-tools.ts: expenditures_list 선언·핸들러·switch case 제거
  · lib/ai-agent-config.ts: 매핑 테이블 "지출" 행 expenses_list로
  · lib/ai-cache.ts: INVALIDATION_MAP·CACHEABLE_TOOLS에서 expenditures 제거
- [ ] §18.13 enum 동기화 점검 (지출 status 3곳)

■ 4단계 — 기간 필터 (설계서 §2-b)
- [ ] admin-revenue-list.ts: `fiscalYear` → `period`+`startDate`+`endDate` 교체
  · `period` 기본값 = 'month'
  · period별 startDate/endDate 서버 자동 계산 (day/week/month/half_year/year)
  · `fiscalYear`(숫자) 하위호환 처리
- [ ] admin-expense-list.ts: 동일 적용
- [ ] admin-finance-pl-summary.ts: 동일 적용
  · `monthly[]` 조건부 포함 (year/half_year/custom 60일 이상일 때만)
- [ ] ai-agent-tools.ts — 3개 도구 파라미터 갱신
  · `pl_summary`: description에 period 옵션 추가, fiscalYear→period+startDate+endDate
  · `revenue_list`: 동일
  · `expenses_list`: 동일
- [ ] npx tsc --noEmit 통과

완료 후:
- git add, commit, git push origin feature/phase22b-r1-back
- PROJECT_STATE·docs 수정 금지
- 완료 메시지: "[B → 메인] feature/phase22b-r1-back push 완료. 머지 + 마이그 호출 요청."
```

### §4.2 A 트리거 (feature/phase22b-r1-front) — 🎨 프론트엔드 전용

```
[메인 → A 채팅] Phase 22-B-R1 재정 화면 이전 — 🎨 프론트엔드 (백엔드·AI 도구 ❌)

이 트리거는 화면·HTML·JS 작업 전용입니다.
REST API·AI 도구 트리거를 받았다면 잘못 받은 것이니 즉시 메인에 문의.

[자율주행 정책]
- push와 애매한 로직만 묻고 나머지는 자율 진행
- 파일 읽기·수정·git·bash·PowerShell·npm install은 묻지 말 것
- 막히면 즉시 보고 (혼자 30분 이상 헤매지 말 것)

[진행률 보고 의무]
- 큰 단계 완료마다 진행률 % 한 줄 보고
- 형식: "📊 진행률 X% (N/M 완료) — 다음: ..."

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin
  git checkout main && git pull origin main
  git checkout -b feature/phase22b-r1-front
베이스: main 최신 (반드시 git pull 후)

설계서: docs/milestones/2026-05-15-phase22b-r1-finance-relocation.md §1

■ 작업 — 재정 화면 5개를 admin.html → cms-tbfa.html 이전

[ ] cms-tbfa.html "💰 후원·재정 관리" 그룹에 5개 메뉴 추가
    (구분선 + 수입 현황·후원 외 매출·지출 관리·예산 관리·재무 보고서)
[ ] cms-tbfa.html에 5개 <section id="page-{tab}"> 영역 추가
[ ] cms-tbfa.js 탭 라우팅에 5개 data-tab 케이스 추가
    각 탭 활성 시 window.SIREN_*?.load() 호출 (admin.html 패턴 재사용)
[ ] cms-tbfa.html <script>에 5개 재정 JS 추가
    admin-finance-income.js·admin-other-revenues.js·admin-expenses.js·
    admin-finance-budget.js·admin-finance-report.js
[ ] admin.html에서 "💰 재정 관리" 그룹 6개 메뉴 제거 + div 영역 제거 + script 제거
[ ] admin.js finance 라우팅 케이스 제거
[ ] 캐시버스터 ?v=20260515p22b 일괄 갱신

■ 후원금 관리(donations) 중복 검토 — 보고 사항
admin.html "후원금 관리"(data-page=donations)가 cms-tbfa의 정기 후원자 관리와
중복 기능인지 별개 기능인지 정독 후 메인에 보고. 중복이면 제거, 별개면 이전.
메인 결정 대기 후 진행.

■ 추가 범위 — 기간 선택기 UI (설계서 §2-b)
이동·신설하는 재정 관리 패널 4개 전부에 기간 선택기 추가.

공통 UI 컴포넌트 (4개 패널 동일):
- 드롭다운: 오늘 | 이번 주 | 이번 달 (기본 선택) | 반기 | 올해 | 특정 기간
- "특정 기간" 선택 시: 시작일 + 종료일 date input 2개 노출 (평소 숨김)
- 날짜 입력 후 "조회" 버튼으로 재조회
- API 호출 파라미터: period=month 등 / period=custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
- 페이지 첫 진입 시 "이번 달" 자동 선택 + 자동 조회

적용 대상 4개:
[ ] 매출 현황 (admin-finance-income.js 또는 해당 패널)
[ ] 후원 외 매출 (admin-other-revenues.js 또는 해당 패널)
[ ] 지출 관리 (admin-expenses.js 또는 해당 패널)
[ ] 재무 보고서 (admin-finance-report.js 또는 해당 패널)

■ JS 내부 로직 수정 최소화
5개 JS는 window.SIREN_* 전역 객체 패턴 유지. cms-tbfa.js에서 호출만 추가.
JS 내부 fetch·렌더 로직은 그대로 (DB 공유라 데이터 동일).
단 기간 선택기 UI와 API 파라미터 전달은 각 JS 파일에 추가 필요.

완료 후:
- git add, commit, git push origin feature/phase22b-r1-front
- PROJECT_STATE·docs·netlify/functions·lib·db 수정 금지
- 완료 메시지: "[A → 메인] feature/phase22b-r1-front push 완료. donations 중복 검토 결과 포함."
```

### §4.3 C 트리거 — 🔍 검증 전용

```
[메인 → C 채팅] Phase 22-B-R1 검증 — 🔍 재정 이전 + 지출 단일화

베이스: main (B·A 머지 완료 후)
설계서 §3 Q1~Q14

[자율주행 정책] [진행률 보고 의무] (생략 — 표준대로)

검증 URL:
- 통합 CMS: https://tbfa.co.kr/cms-tbfa.html
- 싸이렌 어드민: https://tbfa.co.kr/admin.html

Q1~Q6 화면 이전 / Q7~Q12 지출 단일화 / Q13~Q14 회귀 / Q15~Q20 기간 필터

BUG 발견 시 fix/phase22b-r1-bugs 브랜치 자체 fix.
완료 메시지: "[C → 메인] R1 검증 완료. PASS X / FAIL Y. BUG N건."
```

---

## §5 라운드 마감 체크리스트

- [ ] 0단계 메인: 카테고리 매핑표 확정 (B 진단 보고 받아)
- [ ] B push → 메인 머지 → Swain 마이그 호출 → 마이그 파일 삭제
- [ ] A push → 메인 머지 (donations 중복 검토 결과 반영)
- [ ] C 검증 Q1~Q20 (Q15~Q20 기간 필터 포함)
- [ ] PROJECT_STATE §2 + §5 갱신
- [ ] HANDOFF.md 갱신

---

## §6 리스크·주의

- **화면 이전 회귀 위험**: admin.html에서 제거 시 다른 기능 라우팅 영향 점검 (admin.js 정독)
- **렌더 패턴 차이**: cms-tbfa.js는 직접 DOM 토글, admin.js는 switchAdminPage. JS 내부 수정 최소화하되 cms-tbfa.js 라우팅 어댑터 필요
- **마이그 비가역**: expenditures → expenses 마이그는 데이터 복사. 옛 expenditures는 즉시 삭제 안 함 (롤백 대비)
- **카테고리 매핑 정확성**: budget_categories → expense_categories 매핑이 틀리면 예산 집행률 왜곡 → B가 진단 후 메인 확인 필수
- **deprecated API**: 옛 expenditure API를 호출하는 다른 코드 있는지 grep 점검
- §18.13 enum 동기화: 지출 status

---

## §7 작업 시간 추정

| 채팅 | 작업 | 시간 |
|---|---|---|
| 메인 0단계 | 카테고리 매핑 확정 + 마이그 검토 | 1h |
| B | 마이그 함수 + 백엔드 전환 + AI 도구 정리 + 기간 필터 API | 6~8h |
| A | 화면 5개 이전 + admin.html 정리 + 기간 선택기 UI | 7~9h |
| C | 검증 Q1~Q14 + fix | 2~3h |
| **합계 (병렬)** | | **8~11h** |

---

## §8 R2·R3 예고 (이번 라운드 미포함)

- **R2**: 차년도 예산 편성 (budgets 테이블 활용, 전년 실적 참고) + 2단계 결재 워크플로우 (담당자→대표)
- **R3**: NPO 표준 회계 보고서 (운영성과표·재정상태표·현금흐름표 + 인쇄·엑셀)
- schema 정리(expenditures·budgetCategories 테이블 제거)는 R2에서 budgets 재설계와 함께
