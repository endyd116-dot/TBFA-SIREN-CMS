# Phase 22-B-R2 — 차년도 예산 편성 + 2단계 결재

> 작성: 2026-05-15 메인
> 상위: Phase 22-B (재정 3부작 — R1 화면 이전·기간 필터 완료 / **R2 예산 편성** / R3 회계 보고서)
> 전제: 22-B-R1 완료 (재정 화면 통합 CMS 이전, NPO 4분류 통일 결정)
> 동시 진행: **Phase 22-D-R1 (전표 시스템)** 과 병렬 — §7 병렬 가이드 참고

---

## §-1 채팅 역할 분담 — A·B·C 구조 + 두 라운드 한 브랜치 묶음

> 두 라운드(22-B-R2 + 22-D-R1) 동시 진행. 채팅은 기존 **A(프론트)·B(백엔드)·C(검증)** 유지.
> **한 채팅이 두 라운드를 한 브랜치에서 담당** — A는 두 라운드의 프론트, B는 두 라운드의 백엔드.
> 이유: A(프론트)·B(백엔드) 영역 분리라 A↔B 충돌 없음. 한 채팅 안에서 두 라운드가 같은
> 파일(`cms-tbfa.html`·`schema.ts`·`ai-agent-tools.ts`)을 건드려도 순차 처리되니 머지 충돌 0.

| 채팅 | 모델 | 워크트리 | 브랜치 | 담당 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | main | 스키마 확정·머지·문서 |
| A | Sonnet 4.6 (작업량 많으면 Opus 권장) | tbfa-mis-A | feature/phase22-r2d1-front | 🎨 22-B-R2 + 22-D-R1 프론트 |
| B | Opus 4.7 | tbfa-mis-B | feature/phase22-r2d1-back | 🔧 22-B-R2 + 22-D-R1 백엔드 + AI 도구 |
| C | Opus 4.7 | tbfa-mis-C | (검증→자체fix) | 🔍 두 라운드 통합 검증 |

**한 브랜치 묶음 이유**: 한 채팅이 브랜치 2개를 오가는 건 비효율. 두 라운드를 한 브랜치에
담으면 머지도 한 번. C 검증도 통합. 단 작업 순서는 채팅 내부에서 라운드별로 진행 (§6 트리거 참고).
**설계서 2개 참조**: A·B 모두 22-B-R2 설계서 + 22-D-R1 설계서 둘 다 읽고 작업.

---

## §0 요구사항 (Swain 결정 2026-05-15)

| 항목 | 결정 |
|---|---|
| 예산 편성 입력 | **전년 실적 자동 채움 + 수정** — 작년 지출 실적을 기본값으로, 관리자 조정 |
| 2단계 결재 | **작성→상신→승인/반려** — draft→submitted→approved/rejected, 반려 시 재상신 |
| 옛 카테고리 | **expense_categories로 단일화** — budget_categories 폐기, 예산도 NPO 4분류 |
| 예산 잠금 | **22-D-R2로 미룸** — 전표 시스템 안정화 후 |

---

## §1 DB 스키마 (R2 — 메인 스키마 확정, R2 채팅 마이그 함수 작성)

> 옛 `budgets`/`budget_categories`는 단순 구조(결재 없음)라 결재 워크플로우 부적합.
> **신규 테이블 2개**로 깨끗하게. 옛 테이블은 deprecated (즉시 삭제 X — R3에서 정리).

### 1.1 budget_plans (예산안 — 결재 단위)

```sql
CREATE TABLE budget_plans (
  id            SERIAL PRIMARY KEY,
  fiscal_year   INTEGER NOT NULL UNIQUE,        -- 연도당 1개
  title         TEXT NOT NULL,                  -- "2027년도 예산안"
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft|submitted|approved|rejected
  total_planned BIGINT NOT NULL DEFAULT 0,      -- 편성 합계 캐시
  created_by    INTEGER,                        -- members.id
  submitted_by  INTEGER,
  submitted_at  TIMESTAMPTZ,
  approved_by   INTEGER,
  approved_at   TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.2 budget_lines (예산안의 카테고리별 편성 행)

```sql
CREATE TABLE budget_lines (
  id               SERIAL PRIMARY KEY,
  plan_id          INTEGER NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
  category_id      INTEGER NOT NULL REFERENCES expense_categories(id),
  planned_amount   BIGINT NOT NULL DEFAULT 0,
  prev_year_actual BIGINT NOT NULL DEFAULT 0,   -- 전년 실적 참고값 (편성 근거)
  note             TEXT,
  UNIQUE(plan_id, category_id)
);
```

> **22-D-R1 인계**: `vouchers.budget_line_id`가 `budget_lines.id`를 참조 (전표의 "어느 예산에서 지출").
> 22-D-R1은 이 스키마를 전제로 작업 (§7.2 참고).

### 1.3 전년 실적 자동 채움 로직

`budget_plan_create` 시:
- 대상 연도 `Y`에 대해 `Y-1` 연도 `expenses` 집계:
  `SELECT category_id, SUM(amount - refund_amount) FROM expenses WHERE fiscal_year = Y-1 AND status='approved' GROUP BY category_id`
- 모든 활성 `expense_categories`에 대해 `budget_lines` 행 생성:
  - `prev_year_actual` = 위 집계값 (없으면 0)
  - `planned_amount` = `prev_year_actual` (초기값 — 관리자가 수정)

---

## §2 REST API (R2 채팅)

| 엔드포인트 | 메서드 | 기능 | 권한 |
|---|---|---|---|
| `/api/admin-budget-plan-list` | GET | 연도별 예산안 목록 | admin |
| `/api/admin-budget-plan-detail` | GET | 예산안 + budget_lines | admin |
| `/api/admin-budget-plan-create` | POST | 차년도 예산안 생성 (전년 실적 자동 채움) | admin |
| `/api/admin-budget-plan-update` | PUT | budget_lines 금액 수정 (draft만) | admin |
| `/api/admin-budget-plan-submit` | POST | 상신 (draft→submitted) | admin |
| `/api/admin-budget-plan-approve` | POST | 승인 (submitted→approved) | super_admin |
| `/api/admin-budget-plan-reject` | POST | 반려 + 사유 (submitted→rejected) | super_admin |
| `/api/admin-budget-plan-delete` | DELETE | 삭제 (draft만) | admin |
| `/api/admin-finance-budget-list` | GET | **재작성** — 승인 예산안 기준 집행률 | admin |

### 2.1 결재 상태 규칙

| 상태 | 가능 액션 | 비고 |
|---|---|---|
| draft | 수정·상신·삭제 | budget_lines 금액 자유 수정 |
| submitted | 승인·반려 (super_admin) | 수정 불가 |
| approved | 조회·집행률 | 연도당 1개 — 집행률 화면 기준 |
| rejected | 수정 후 재상신 | rejection_reason 표시 → draft 전환 후 재상신 |

### 2.2 admin-finance-budget-list 재작성

기존 `budget_categories` 기준 구조 폐기. 신규:
- 대상 연도의 `approved` 상태 `budget_plan` 조회 (없으면 빈 결과 + `noPlan: true`)
- `budget_lines` 카테고리별 `planned_amount`
- `expenses` 집계: `fiscal_year` + `status='approved'` + `category_id` → `SUM(amount - refund_amount)`
- 응답: `items[]` (category·planned·executed·remaining·rate) + `totalPlanned` + `totalExecuted` + `planStatus`

---

## §3 AI 도구 (R2 채팅 — lib/ai-agent-tools.ts)

| 도구 | 기능 | 권한 |
|---|---|---|
| `budget_plan_list` | 연도별 예산안 목록·상태 조회 | admin |
| `budget_plan_create` | 차년도 예산안 생성 (dry-run 우선) | admin |
| `budget_plan_approve` | 예산안 승인 (dry-run 우선) | super_admin |

- `ai_tool_permissions` 시드는 마이그 함수에 포함
- `lib/ai-agent-config.ts` 매핑 테이블에 "예산" → budget_plan_list 추가
- **충돌 주의**: §7.1 — D1도 `ai-agent-tools.ts` 수정. append 위치 분리

---

## §4 UI (R2 채팅 — cms-tbfa.html 예산 관리 패널)

> 22-B-R1에서 이전된 `page-finance-budget` 섹션 활용. `admin-finance-budget.js` 확장.

### 4.1 예산안 목록 화면

- 연도 선택 드롭다운 + 예산안 카드/행 (연도·제목·상태 배지·편성 합계)
- "차년도 예산안 작성" 버튼 — 다음 연도 예산안 없을 때만 활성

### 4.2 예산 편성 화면 (작성·수정)

- NPO 4분류별 행: `[카테고리명] [전년 실적: ₩X] [편성 금액 입력]`
- 전년 실적은 읽기 전용 표시 (편성 근거)
- 편성 금액 입력 시 합계 실시간 갱신
- 하단: 임시저장(draft) / 상신(submit) 버튼

### 4.3 결재 화면

- 상신된 예산안 → super_admin에게 승인/반려 버튼
- 반려 시 사유 입력 모달
- 상태 배지: 작성중(draft)·상신됨(submitted)·승인됨(approved)·반려됨(rejected)

### 4.4 집행률 화면

- 승인된 예산안 기준 카테고리별 막대 (편성 vs 집행 vs 잔여)
- `admin-finance-budget-list` 재작성 API 사용

---

## §5 검증 Q&A (C 담당, Q1~Q12)

### 예산 편성
- Q1: "차년도 예산안 작성" → 전년 실적이 각 카테고리에 자동 채워짐
- Q2: 편성 금액 수정 → 합계 실시간 갱신, 임시저장 동작
- Q3: 전년 실적이 0인 카테고리도 행 표시 (편성 0으로)

### 2단계 결재
- Q4: 담당자 상신 → submitted 상태 전환
- Q5: super_admin 승인 → approved 전환, 연도당 1개 보장
- Q6: 반려 + 사유 → rejected, 사유 표시, 재수정·재상신 가능
- Q7: draft 외 상태에서는 budget_lines 수정 불가

### 카테고리 단일화
- Q8: 예산 편성 카테고리가 NPO 4분류(expense_categories)로 표시
- Q9: 옛 budget_categories 화면 잔재 없음

### 집행률·회귀·AI
- Q10: 집행률 화면 — 승인 예산안 기준 카테고리별 편성/집행/잔여 정확
- Q11: AI 비서 "내년 예산안 만들어줘" → budget_plan_create dry-run + 승인 후 생성
- Q12: 22-A·22-C·22-B-R1 회귀 0 (매출·지출·기간 필터·화면 이전)

---

## §6 트리거

> A·B는 두 라운드(22-B-R2 + 22-D-R1)를 **한 브랜치**에서 진행. 설계서 2개 모두 참조.
> Part A(22-B-R2) → Part B(22-D-R1) 순서로 작업하되, 한 브랜치 한 커밋묶음.

### §6.1 B 트리거 (feature/phase22-r2d1-back) — 🔧 백엔드 + AI 도구 (두 라운드)

```
[메인 → B 채팅] Phase 22-B-R2 + 22-D-R1 백엔드 — 🔧 두 라운드 (프론트 ❌)

두 라운드를 한 브랜치에서 진행. 프론트는 A 채팅 담당.

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" "실행해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
- 묻는 건 단 2가지뿐: ① git push ② 애매한 설계·로직 결정
- 그 외 전부 자율 진행. 막히면 즉시 보고.

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄
- 분모는 Part A + Part B 합산 항목 수

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22-r2d1-back

설계서 2개:
- 22-B-R2: docs/milestones/2026-05-15-phase22b-r2-budget-planning.md
- 22-D-R1: docs/milestones/2026-05-15-phase22d-r1-voucher-bank-import.md

▶▶ Part A — 22-B-R2 예산 편성 백엔드
- [ ] migrate-phase22b-r2-budget-plans.ts (진단+실행, budget_plans·budget_lines 생성,
      ai_tool_permissions budget_plan_* 3개 시드, 멱등성)
- [ ] db/schema.ts: budgetPlans + budgetLines (/* === Phase 22-B-R2 === */ 파일 끝 append)
- [ ] REST API 9개: admin-budget-plan-list/-detail/-create/-update/-submit/
      -approve/-reject/-delete + admin-finance-budget-list 재작성
- [ ] create 시 전년 실적 자동 채움 (22-B-R2 설계서 §1.3)
- [ ] AI 도구 3개: budget_plan_list/create/approve
- [ ] §18.13 enum 동기화: status (draft|submitted|approved|rejected) 3곳

▶▶ Part B — 22-D-R1 전표 시스템 백엔드
- [ ] migrate-phase22d-voucher-schema.ts (진단+실행, vouchers·account_codes·
      bank_imports·bank_transactions 생성, account_codes NPO 18개 seed,
      ai_tool_permissions voucher_* 4개 시드, 멱등성)
- [ ] db/schema.ts: vouchers/accountCodes/bankImports/bankTransactions
      (/* === Phase 22-D-R1 === */ 파일 끝 append)
      · vouchers.budget_line_id는 FK 제약 없이 integer (budget_lines는 Part A가 생성)
- [ ] REST API 10개: admin-account-codes-list, admin-vouchers-list,
      admin-voucher-detail/-create/-update/-submit/-approve/-reject/-delete,
      admin-voucher-templates-list
- [ ] voucher_number 자동 생성 YYYYMM-NNN (트랜잭션 내 MAX+1)
- [ ] submit 시 승인 담당자 이메일 알림 (fire-and-forget)
- [ ] AI 도구 4개: account_codes_list/voucher_list/voucher_create/voucher_approve

▶▶ 공통
- [ ] ai-agent-config.ts 매핑 테이블 끝에 "예산"·"전표" 2줄 추가
- [ ] ai-agent-tools.ts: budget_plan_* + voucher_* 도구를 TOOL_DECLARATIONS 배열·
      executeTool switch·핸들러 함수 모두 파일 끝에 한 번에 추가 (append-only)
- [ ] npx tsc --noEmit — 신규 에러 0건 (기존 묵은 에러 14건과 구분)

완료 후:
- git add, commit, git push origin feature/phase22-r2d1-back
- PROJECT_STATE·docs·public 수정 금지
- 완료 메시지: "[B → 메인] feature/phase22-r2d1-back push 완료. 머지 + 마이그 2개 호출 요청."
```

### §6.2 A 트리거 (feature/phase22-r2d1-front) — 🎨 프론트엔드 (두 라운드)

```
[메인 → A 채팅] Phase 22-B-R2 + 22-D-R1 프론트엔드 — 🎨 두 라운드 (백엔드·AI 도구 ❌)

두 라운드를 한 브랜치에서 진행. 백엔드·API·AI 도구는 B 채팅 담당.

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" "실행해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
- 묻는 건 단 2가지뿐: ① git push ② 애매한 설계·로직 결정
- 그 외 전부 자율 진행. 막히면 즉시 보고.

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22-r2d1-front

설계서 2개:
- 22-B-R2: docs/milestones/2026-05-15-phase22b-r2-budget-planning.md §4
- 22-D-R1: docs/milestones/2026-05-15-phase22d-r1-voucher-bank-import.md §4

▶▶ Part A — 22-B-R2 예산 관리 패널 (cms-tbfa.html page-finance-budget 섹션)
- [ ] admin-finance-budget.js 확장
- [ ] 예산안 목록 화면 (연도 선택 + 예산안 목록 + "차년도 예산안 작성" 버튼)
- [ ] 예산 편성 화면 (NPO 4분류별 행: 카테고리명·전년 실적·편성 금액 입력, 합계 실시간)
- [ ] 결재 화면 (상신/승인/반려 버튼, 상태 배지, 반려 사유 모달)
- [ ] 집행률 화면 (승인 예산안 기준 카테고리별 편성/집행/잔여 막대)

▶▶ Part B — 22-D-R1 전표 탭 (cms-tbfa.html page-expenses 패널)
- [ ] 지출 관리 패널에 "전표" 탭 추가 ("지출 목록" 탭 + "전표" 탭)
- [ ] 전표 목록 (전표번호·날짜·적요·거래처·계정과목·금액·예산·상태·액션
      + 기간 선택기 §2-b 재사용 + 계정과목·상태 필터)
- [ ] 전표 작성 모달 (날짜·계정과목·세목·적요·거래처·금액·증빙종류·증빙파일·예산 항목)
      · 예산 항목: budget_lines 드롭다운 (마이그 후 채워짐, 없으면 빈 선택 허용)
      · "자주 쓰는 전표로 저장" 체크박스
- [ ] 전표 상태별 액션 (draft: 수정·제출·삭제 / submitted: 승인·반려 / rejected: 재제출)
- [ ] 반복 템플릿 불러오기 드롭다운

▶▶ 공통
- [ ] cms-tbfa.html은 page-finance-budget·page-expenses 두 섹션 내부만 수정
      (사이드바·다른 섹션·B 영역(netlify/lib/db) 금지)
- [ ] 캐시버스터 ?v=20260515p22r2d1
- [ ] JS 구문 검사 (node -c)

완료 후:
- git add, commit, git push origin feature/phase22-r2d1-front
- PROJECT_STATE·docs·netlify/functions·lib·db 수정 금지
- 완료 메시지: "[A → 메인] feature/phase22-r2d1-front push 완료."
```

### §6.3 C 통합 검증 트리거 — 🔍 두 라운드

> A·B 둘 다 머지 + 마이그 2개 호출 완료 후 메인이 발행.

```
[메인 → C 채팅] Phase 22-B-R2 + 22-D-R1 통합 검증 — 🔍

베이스: main (A·B 머지 + 마이그 2개 호출 완료 후)
설계서: 22-B-R2 §5 (Q1~Q12) + 22-D-R1 §8 (Q1~Q16)

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일·git·npm 전부 settings.json 허용됨. 권한 질문 금지.
- 묻는 건 git push와 애매한 로직뿐.

[진행률 보고 의무] "📊 진행률 X% (N/M 완료)" 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-C
  git fetch origin && git checkout main && git pull origin main

검증 URL: https://tbfa.co.kr/cms-tbfa.html

■ 22-B-R2 예산 편성 — 22-B-R2 설계서 §5 Q1~Q12
■ 22-D-R1 전표 시스템 — 22-D-R1 설계서 §8 Q1~Q16
■ 교차 확인: 전표 작성 모달 "예산 항목" 드롭다운에 22-B-R2 예산안의
  budget_lines가 정상 노출되는지

BUG 발견 시 fix/phase22-parallel-bugs 브랜치 자체 fix.
완료 메시지: "[C → 메인] 통합 검증 완료. R2 PASS X/Y, D1 PASS X/Y. BUG N건."
```

---

## §7 병렬 진행 가이드 (22-D-R1과 충돌 회피)

### 7.1 충돌 구조 — A·B 영역 분리 + 채팅 내부 라운드 조율

A(프론트)·B(백엔드)가 영역 분리라 **A↔B 충돌 없음**. 각 채팅이 두 라운드를 한 브랜치에서
순차 처리하므로 라운드 간 충돌도 채팅 내부에서 해소됨. 핵심은 **A·B가 메인 영역을 안 건드리는 것**.

| 파일 | 담당 | 두 라운드 작업 시 주의 |
|---|---|---|
| `db/schema.ts` | B | 22-B-R2 → `/* === Phase 22-B-R2 === */` / 22-D-R1 → `/* === Phase 22-D-R1 === */` 두 섹션 모두 파일 끝에 **append-only** |
| `lib/ai-agent-tools.ts` | B | budget_plan_* 3개 + voucher_* 4개 — TOOL_DECLARATIONS 배열·switch·핸들러 모두 파일 끝에 한 번에 추가 |
| `lib/ai-agent-config.ts` | B | 매핑 테이블 끝에 "예산"·"전표" 2줄 추가 |
| `cms-tbfa.html` | A | `page-finance-budget`(예산)·`page-expenses`(전표 탭) 두 섹션 내부만. 사이드바·다른 섹션·B 영역 금지 |
| `cms-tbfa.js` | A | 라우팅 추가 불필요 (22-B-R1에서 완료) |

> A·B가 동시에 push해도 영역이 갈려 메인 머지 시 충돌 없음. 머지 순서는 무관(§7.3).

### 7.2 22-D-R1 의존성 — budget_lines

- 22-D-R1 `vouchers.budget_line_id`는 `budget_lines.id` 참조 (전표의 예산 연결)
- **budget_lines 테이블은 R2가 생성** → D1은 FK 제약 없이 `budget_line_id INTEGER` 컬럼만 생성
- D1 예산 선택 UI: `budget_lines` SELECT (R2 마이그 호출 후 데이터 채워짐)
- 두 라운드 머지 후 메인이 FK 제약 추가 마이그 1줄 (선택 — 운영 안정 후)

### 7.3 머지 순서

- A·B 각자 한 브랜치(`feature/phase22-r2d1-front`·`-back`)에 두 라운드 작업 완료 후 push
- 메인은 먼저 끝난 채팅부터 머지 — A·B 영역 분리라 순서 무관, 충돌 없음
- 둘 다 머지 완료 → C 통합 검증 트리거 발행

### 7.4 마이그 호출 순서

- B가 두 라운드 마이그 함수 2개 작성 (budget_plans·budget_lines / vouchers·account_codes 등)
- B 머지 후 Swain이 둘 다 진단 호출 → 메인 검토 → `?run=1` 실행 (순서 무관)
- 단 전표의 예산 선택 UI 테스트는 budget_plans 마이그 후라야 데이터 보임

---

## §8 리스크·주의

- **옛 budgets 데이터**: R2 1단계 진단으로 옛 budgets 행 수 확인. 0건이면 신규 테이블만, 있으면 마이그 검토 (메인 보고)
- **연도당 예산안 1개**: `budget_plans.fiscal_year UNIQUE` — approved도 1개 보장. 재편성은 기존 plan 수정
- **ai-agent-tools.ts 충돌**: 두 라운드 동시 수정 — §7.1 규칙 엄수. 머지 시 메인 수동 검증
- **expense_categories 의존**: budget_lines가 expense_categories 참조 — 22-C 테이블 존재 전제 (이미 운영 중)
- **admin-finance-budget-list 재작성**: 기존 호출하는 프론트(admin-finance-budget.js)도 R2가 같이 수정 — 응답 키 변경 동기화

---

## §9 작업 시간 추정

| 채팅 | 작업 | 시간 |
|---|---|---|
| B | 22-B-R2 백엔드 + 22-D-R1 백엔드 (마이그 2 + API 19 + AI 도구 7) | 12~16h |
| A | 22-B-R2 예산 패널 + 22-D-R1 전표 탭 | 10~14h |
| C | 두 라운드 통합 검증 | 3~4h |
| **합계 (병렬)** | | **12~16h** |

---

## §10 R3 예고

- **22-B-R3**: NPO 표준 회계 보고서 (운영성과표·재정상태표·현금흐름표 + 인쇄·엑셀)
- 옛 테이블 정리: `budgets`·`budget_categories`·`expenditures` 제거 (R3에서 schema.ts 정리)
