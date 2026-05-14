# Phase 22-B-R2 — 차년도 예산 편성 + 2단계 결재

> 작성: 2026-05-15 메인
> 상위: Phase 22-B (재정 3부작 — R1 화면 이전·기간 필터 완료 / **R2 예산 편성** / R3 회계 보고서)
> 전제: 22-B-R1 완료 (재정 화면 통합 CMS 이전, NPO 4분류 통일 결정)
> 동시 진행: **Phase 22-D-R1 (전표 시스템)** 과 병렬 — §7 병렬 가이드 참고

---

## §-1 채팅 역할 분담 — 라운드별 풀스택 구조

> 두 라운드(22-B-R2 + 22-D-R1) 동시 진행. 백/프 분리 대신 **라운드별 풀스택 1채팅**.
> 이유: 두 라운드가 `cms-tbfa.html`·`lib/ai-agent-tools.ts`·`db/schema.ts`를 공유 →
> 백/프로 4채팅 분리하면 4채팅이 같은 파일 충돌. 라운드로 묶으면 라운드 간 충돌만 관리.

| 채팅 | 모델 | 워크트리 | 브랜치 | 담당 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | main | 스키마 확정·머지·문서 |
| **R2** | Opus 4.7 | tbfa-mis-B | feature/phase22b-r2 | 🔧🎨 22-B-R2 예산 편성 풀스택 |
| **D1** | Opus 4.7 | tbfa-mis-A | feature/phase22d-r1 | 🔧🎨 22-D-R1 전표 시스템 풀스택 |
| C | Opus 4.7 | tbfa-mis-C | (검증→자체fix) | 🔍 두 라운드 검증 |

**워크트리 재활용**: 22-B-R1에서 쓴 tbfa-mis-A(→D1)·tbfa-mis-B(→R2). 작업 끝나 비어 있음.

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

### §6.1 R2 채팅 트리거 (feature/phase22b-r2) — 🔧🎨 풀스택

```
[메인 → R2 채팅] Phase 22-B-R2 차년도 예산 편성 + 2단계 결재 — 🔧🎨 풀스택

22-D-R1과 동시 진행. 공유 파일 충돌 주의 — 설계서 §7 필독.

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" "실행해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
- 묻는 건 단 2가지뿐: ① git push ② 애매한 설계·로직 결정
- 그 외 전부 자율 진행. 막히면 즉시 보고.

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22b-r2

설계서: docs/milestones/2026-05-15-phase22b-r2-budget-planning.md

■ 1단계 — 마이그레이션 함수
- [ ] netlify/functions/migrate-phase22b-r2-budget-plans.ts
  · 진단 모드: 옛 budgets 행 수 확인 + budget_plans/budget_lines 존재 여부
  · 실행 모드(?run=1): budget_plans + budget_lines 테이블 생성 (§1.1·§1.2)
  · ai_tool_permissions에 budget_plan_* 3개 시드
  · 멱등성 (IF NOT EXISTS)
  · 메인에 마이그 호출 요청
- [ ] db/schema.ts: budgetPlans + budgetLines 정의 추가
  · 파일 끝에 /* === Phase 22-B-R2 === */ 헤더 후 추가 (append-only)
  · 마이그 적용 확인 후 활성화

■ 2단계 — REST API 9개 (설계서 §2)
- [ ] admin-budget-plan-list / -detail / -create / -update
- [ ] admin-budget-plan-submit / -approve / -reject / -delete
- [ ] admin-finance-budget-list 재작성 (승인 예산안 기준 집행률)
- [ ] create 시 전년 실적 자동 채움 (§1.3)
- [ ] §18.13 enum 동기화: status (draft|submitted|approved|rejected) 3곳

■ 3단계 — AI 도구 3개 (설계서 §3)
- [ ] budget_plan_list / budget_plan_create / budget_plan_approve
- [ ] ai-agent-config.ts 매핑 "예산" 추가
- [ ] ★ 충돌 주의: ai-agent-tools.ts는 D1도 수정 — TOOL_DECLARATIONS 배열
      맨 끝에 추가, executeTool switch도 맨 끝에 추가 (머지 충돌 최소화)

■ 4단계 — UI (설계서 §4)
- [ ] admin-finance-budget.js 확장 — 예산안 목록·편성·결재·집행률 화면
- [ ] cms-tbfa.html page-finance-budget 섹션 내부만 수정
      (다른 섹션·D1 영역 건드리지 말 것)
- [ ] 캐시버스터 ?v=20260515p22br2

■ 5단계 — 검증
- [ ] npx tsc --noEmit 통과
- [ ] 3개 JS 구문 검사

완료 후:
- git add, commit, git push origin feature/phase22b-r2
- 완료 메시지: "[R2 → 메인] feature/phase22b-r2 push 완료. 머지 + 마이그 호출 요청."
```

### §6.2 C 트리거 — §6.3 (22-D-R1 설계서 §9.3과 통합 — 두 라운드 함께 검증)

C 검증은 두 라운드 머지 완료 후 일괄. 트리거는 머지 시점에 메인이 별도 발행.

---

## §7 병렬 진행 가이드 (22-D-R1과 충돌 회피)

### 7.1 공유 파일 — 충돌 위험 + 회피 규칙

| 파일 | R2 작업 영역 | D1 작업 영역 | 회피 규칙 |
|---|---|---|---|
| `db/schema.ts` | `/* === Phase 22-B-R2 === */` 섹션 | `/* === Phase 22-D-R1 === */` 섹션 | **append-only** — 각자 파일 끝에 헤더 후 추가. 다른 섹션 절대 수정 금지 |
| `lib/ai-agent-tools.ts` | budget_plan_* 3개 | voucher_* 등 4개 | TOOL_DECLARATIONS 배열·executeTool switch **맨 끝**에만 추가. 핸들러 함수는 파일 끝에 |
| `lib/ai-agent-config.ts` | 매핑 "예산" | 매핑 "전표" | 매핑 테이블 끝에 각자 1줄 추가 |
| `cms-tbfa.html` | `page-finance-budget` 섹션 내부 | `page-expenses` 패널 내부 | 자기 섹션 내부만. 사이드바·다른 섹션 금지 |
| `cms-tbfa.js` | 해당 없음(기존 라우팅 활용) | 해당 없음 | 둘 다 라우팅 추가 불필요 (R1에서 완료) |

### 7.2 22-D-R1 의존성 — budget_lines

- 22-D-R1 `vouchers.budget_line_id`는 `budget_lines.id` 참조 (전표의 예산 연결)
- **budget_lines 테이블은 R2가 생성** → D1은 FK 제약 없이 `budget_line_id INTEGER` 컬럼만 생성
- D1 예산 선택 UI: `budget_lines` SELECT (R2 마이그 호출 후 데이터 채워짐)
- 두 라운드 머지 후 메인이 FK 제약 추가 마이그 1줄 (선택 — 운영 안정 후)

### 7.3 머지 순서

1. 먼저 완료된 라운드 먼저 머지 (R2 또는 D1)
2. 나중 라운드는 `git fetch && git rebase origin/main` 후 push (충돌 시 자기 섹션만 살림)
3. 메인이 `ai-agent-tools.ts` 충돌 시 양쪽 도구 모두 보존 확인
4. 두 라운드 머지 완료 → C 일괄 검증 트리거 발행

### 7.4 마이그 호출 순서

- R2 마이그 (budget_plans·budget_lines) + D1 마이그 (vouchers·account_codes 등) 독립적
- 순서 무관 — 각자 머지 직후 Swain 호출
- 단 D1 예산 선택 UI 테스트는 R2 마이그 후라야 데이터 보임

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
| R2 | 마이그 + API 9개 + AI 도구 3개 + UI | 8~11h |
| D1 | (22-D-R1 설계서 §12 참고) | 8~11h |
| C | 두 라운드 검증 | 3~4h |
| **합계 (병렬)** | | **11~15h** |

---

## §10 R3 예고

- **22-B-R3**: NPO 표준 회계 보고서 (운영성과표·재정상태표·현금흐름표 + 인쇄·엑셀)
- 옛 테이블 정리: `budgets`·`budget_categories`·`expenditures` 제거 (R3에서 schema.ts 정리)
