# Phase 23-0 — 예산 시스템 골격 설계서 (4축 도메인 모델 + 데이터 마이그 전략)

> **작성** 2026-05-16 / 메인 / **상태** 초안 — Swain 검토 대기
> **정본 참조** [`docs/교사유가족협의회_사단법인_예산시스템_기능설계도_v3.md`](../교사유가족협의회_사단법인_예산시스템_기능설계도_v3.md)
> **선행 분석** 재활용 11 / 진화 7 / 신규 11 분류표 (대화 기록)

---

## §0. 목적·범위

v3.0 정본을 SIREN 플랫폼에 흡수하기 위한 **Phase 23 시리즈의 0번 라운드 — 골격(skeleton)**.
이 라운드가 다루는 것:

1. **마스터 테이블** — `fiscal_years` · `programs`/`program_subs` · `funding_sources` 신설 + `account_codes` 진화
2. **4축 예산 모델** — `budgets` · `budget_lines` (계정과목 × 사업 × 기능 × 재원)
3. **Phase 22 → v3.0 데이터 마이그레이션 전략** 확정
4. **Phase 23 전체 마일스톤 분할** 로드맵

이 라운드가 **다루지 않는 것** (후속 라운드): 의결 모델·집행요청·보조금·OCR·룰 엔진·시도교육청 양식·결산 — §4 로드맵 참조.

**원칙**: v3.0은 별도 시스템이 아니라 SIREN 재정 모듈(Phase 22)의 차기 버전. 밑바탕 재활용 · 예산 뼈대 재설계 · 신규 모듈 추가.

---

## §1. 현재 SIREN → v3.0 매핑 요약

| v3.0 구성요소 | 현재 SIREN | 처리 |
|---|---|---|
| 통장거래 자동분류 엔진 (AI-12) | `lib/bank-reconcile.ts` 대사 엔진 | 🟢 재활용 — 4축 출력만 추가 |
| 거래처 매핑 학습 (`payee_mapping`) | `counterparties` (학습·txn_count) | 🟢 재활용 — 컬럼 추가 |
| 계정과목 CoA (`account`) | `account_codes` (parent_code 계층·37건) | 🟡 진화 — `level`·`type`·`is_postable`·`function_default` 추가 |
| AI 호출 인프라·5층 안전장치 | `ai-gemini.ts`·AI 도구 시스템 | 🟢 재활용 |
| 증빙 파일 저장 | R2 (`r2-client/server`) | 🟢 재활용 |
| 전표 PDF | pdf-lib + NotoSansKR | 🟢 재활용 |
| 회계연도 | `fiscalYear` integer 컬럼 (산재) | 🟡 진화 — `fiscal_years` 마스터 신설 |
| 예산안 (`budget`) | `budget_plans` (1단계 승인) | 🟡 진화 — 4축·5단계 status |
| 예산 라인 (`budget_line`) | `budget_lines` (plan×category 1축) | 🟡 진화 — 4축 재설계 |
| 사업 (`program`) | 없음 (expense_categories.code 값뿐) | 🔴 신규 |
| 재원 (`funding_source`) | 없음 (revenue_categories 간접) | 🔴 신규 |
| 보조금 (`grant`) | 없음 | 🔴 신규 (23-2) |
| 의결 모델 (총회·이사회) | 없음 | 🔴 신규 (23-2) |
| 집행요청 (`expense_request`) | `vouchers`+`expenses` 2갈래 | 🟡 진화 — 하나로 통합 (23-1~2) |
| AI 학습 테이블·임베딩 | 없음 | 🔴 신규 (23-1) |
| OCR | 없음 | 🔴 신규 (23-3) |

---

## §2. 데이터 모델 (Phase 23-0 범위)

> Drizzle ORM + Neon PostgreSQL. 컬럼 상세는 23-0 구현 단계에서 확정 — 본 설계서는 **구조와 결정점**만.

### 2.1 `fiscal_years` (신규)

회계연도 마스터. 지금까지 산재한 `fiscalYear` 정수 컬럼을 대체.
- `id` · `yearCode`('FY2027') · `startDate` · `endDate` · `status`('draft'|'open'|'closed'|'locked')
- **전환 전략**: 기존 정수 `fiscalYear` 컬럼은 그대로 두고, FY2027+ 신규 모델만 이 테이블을 FK로 참조. 미래 연도를 `draft`로 미리 생성해 시작일 변경 가능.

### 2.2 `account_codes` 진화 (기존 테이블 ALTER)

현재 37건(parent_code 2단계 계층) 유지 + 컬럼 추가:
- `level` (smallint) — 관/항/목/세목 깊이
- `type` ('revenue'|'expense'|'asset'|'liability'|'net_asset') — 현재 `category`로 일부 추론 가능
- `function_default` ('exec'|'admin'|'fund'|'na') — 기능 축 자동 추천 시드값
- `is_postable` (boolean) — 말단 계정만 예산 라인 등록 허용 (룰 R-002)
- ⚠️ **마이그 후 schema 활성화** 순서 준수 (§9.1.1)

### 2.3 `programs` / `program_subs` (신규)

협의회 5대 사업 + 일반관리.
- `programs`: `id`·`code`('P01'~'P05','G00')·`name`·`managerId`(→members.id)·`isActive`
- `program_subs`: `id`·`programId`·`code`·`name`
- **시드**: P01 법률·행정지원 / P02 의료지원 / P03 인과관계조사 / P04 재발방지캠페인 / P05 연계사업 / G00 일반관리

### 2.4 `funding_sources` (신규)

재원 마스터.
- `id`·`code`·`name`·`type`('fee'|'don_ind'|'don_corp'|'grant_edu'|'own'|'int')·`restricted`(boolean)·`bankAccount`
- **시드**: 회비·개인기부·법인기부·교육청보조금·사업수익·금융수익
- 기존 `revenue_categories`(방금 만든 2단계 계층)는 이 재원 분류의 참조·시드 소스로 활용

### 2.5 `budgets` (신규 — `budget_plans` 후속)

- `id`·`fiscalYearId`·`revision`(추경 +1)·`title`·`status`('draft'|'board_review'|'assembly_review'|'approved'|'rejected'|'superseded')·`preparedBy`·`boardMeetingId`(nullable, 23-2)·`assemblyMeetingId`(nullable, 23-2)·`approvedAt`·`authorityFiledAt`
- **결정점 ①**: 기존 `budget_plans`는 FY2026까지 읽기전용 레거시로 보존, FY2027+는 `budgets` 신규 — 테이블명 충돌 없음. (§3 참조)

### 2.6 `budget_lines` (신규 — 4축)

v3.0의 심장. 현재 `budget_lines`(plan×category 1축)와 구조가 근본적으로 달라 신규 테이블.
- `id`·`budgetId`·`accountId`·`programId`·`programSubId`(nullable)·`segment`('gen'|'grant')·`function`('exec'|'admin'|'fund')·`fundingSourceId`·`grantId`(nullable, 23-2)·`amount`·`memo`
- **결정점 ②**: 테이블명 — 기존 `budget_lines`를 `budget_lines_legacy`로 rename 후 신규가 `budget_lines` 차지 vs 신규를 다른 이름. → §3·§5 참조

---

## §3. 데이터 마이그레이션 전략 (★ 핵심 결정)

**추천: 하이브리드 — 데이터를 두 층으로 나눠 처리.**

| 데이터 층 | 대상 | 처리 | 이유 |
|---|---|---|---|
| **팩트·마스터 층** | `bank_transactions`(실거래)·`counterparties`(학습)·`account_codes`(계정과목)·`revenue_categories` | **계승** — 컬럼만 추가 | 실제 일어난 사실·학습 자산. 4축과 충돌 없음 — 거래는 그대로, 태깅만 얹음 |
| **워크플로우 산출물 층** | `budget_plans`·`budget_lines`·`vouchers`·`expenses`·`other_revenues` | **FY2027 신규 출발** — 레거시는 읽기전용 보존 | 옛 1축 모델·옛 승인 흐름에 묶임. 4축 강제변환 시 사업/기능/재원을 *추측*해야 함 → 손실·오류. FY2026 결산은 현 시스템으로 마감 |

**구체 절차**:
1. FY2026까지: 현 Phase 22 재정 시스템으로 정상 운영·결산. 건드리지 않음.
2. FY2027 진입 시: `fiscal_years`에 FY2027 생성 → 신규 4축 모델로 편성 시작.
3. 레거시 테이블(`budget_plans` 등)은 "FY2026 이전 조회 전용"으로 화면에서 분리 노출.
4. 계정과목·거래처·통장거래는 끊김 없이 이어짐.

→ "전체 마이그레이션"도 "전체 신규 출발"도 아님. **팩트는 계승, 워크플로우는 FY2027 깨끗한 출발.**

---

## §4. Phase 23 마일스톤 분할 로드맵

v3.0 P1(MVP) 전체는 한 라운드 불가 — 6개 라운드로 분할.

| 라운드 | 범위 | 산출물 | 비고 |
|---|---|---|---|
| **23-0** (본 설계) | 마스터(`fiscal_years`·`programs`·`funding_sources`) + `account_codes` 진화 + 4축 `budgets`/`budget_lines` + 마이그 전략 | 골격 스키마·시드·마이그 함수 | 척추 — 정확성 최우선 |
| **23-1** | AI-12 통장 자동분류 4축 재작업 + AI 학습 테이블(`txn_classification_history`·`ai_suggestion_log`) + pgvector 임베딩 + 결재 라우팅 | 가치 입증 — `bank-reconcile.ts` 80% 재활용 | 가장 빠른 효과 |
| **23-2** | 의결 모델(총회·이사회·resolution) + 집행요청(`expense_request`) 통합 + 보조금(`grant`) 모듈 + 룰 엔진 R-001~R-024 | 사단법인 거버넌스 핵심 | 가장 큰 신규 |
| **23-3** | 영수증 OCR(AI-9~11) + 시도교육청 양식 변환(AI-8·20) + 제출 패키지 ZIP | 외부 제출 자동화 | 벤더 선정 선행 |
| **23-4** | 결산 워크플로우 + 4축 집계 보고서(수입·지출 결산서·재무상태표) + 마감 체크리스트(AI-16~18) | 결산 자동화 | FY2027 종료 전 |
| **23-5** | 편성 AI(AI-1~5) + 자연어 질의(AI-22) + 자동 브리핑(AI-23) | 편성·횡단 AI | P2 영역 일부 |

**23-0 → 23-1 → 23-2** 가 사단법인 전환 시점 필수 코어. 23-3~5는 전환 후 순차.

---

## §5. Swain 결정 대기 항목

23-0 구현 착수 전 확정 필요 (메인 추천 동봉):

| # | 결정 항목 | 옵션 | 메인 추천 |
|---|---|---|---|
| ① | **주무관청** | 어느 시도교육청 (서울/경기 등) | 정관·법인 등기 기준으로 Swain 확정 — 양식·정족수에 직접 영향 |
| ② | **정관 의결정족수** | 일반/특별의결 정족수 | 정관 초안 확정 후. 23-2 의결 모델 파라미터 — 23-0엔 영향 없음 (후속 확정 가능) |
| ③ | **회계연도 시작 시점** | FY2027 시작일 | 정관 확정 후 lock. 23-0은 `fiscal_years`를 `draft`로 미리 생성 가능 — **23-0 진행에 지장 없음** |
| ④ | **데이터 마이그 방식** | 하이브리드 vs 전체신규 vs 전체마이그 | **하이브리드** (§3) — 팩트 계승·워크플로우 FY2027 신규 |
| ⑤ | **테이블명 충돌 처리** | 기존 `budget_lines`→`_legacy` rename vs 신규 다른 이름 | 신규를 `budgets`/`budget_lines`로, 기존을 `budget_plans`/`budget_lines`는 그대로 두되 화면에서 "레거시" 분리. rename은 회귀 위험 — **rename 없이 신규 테이블 별도 이름**(예: `fy_budgets`·`fy_budget_lines`) 권장 |
| ⑥ | **LLM/OCR/임베딩 벤더** | Claude/GPT/Gemini · CLOVA/Document AI · KoSimCSE 등 | LLM: 현재 Gemini 3-flash 유지(인프라 이미 있음) / OCR: CLOVA(한글 정확도) — 23-3에 확정 / 임베딩: 23-1에 확정 |

> ①②③⑥은 후속 라운드 파라미터라 **23-0 착수를 막지 않음**. ④⑤만 23-0 시작 전 확정 필요.

---

## §6. 23-0 작업 체크리스트 (구현 라운드 진입 시)

- [ ] `fiscal_years` 테이블 + 마이그 함수 + FY2026·FY2027 시드(draft)
- [ ] `account_codes` ALTER (`level`·`type`·`function_default`·`is_postable`) + 기존 37건 값 백필 마이그
- [ ] `programs`/`program_subs` 테이블 + 마이그 + P01~P05·G00 시드
- [ ] `funding_sources` 테이블 + 마이그 + 재원 6종 시드
- [ ] `fy_budgets`/`fy_budget_lines` (또는 확정 명) 테이블 + 마이그
- [ ] schema.ts 정의 — 마이그 적용 확인 후 활성화 (§9.1.1)
- [ ] 4축 예산 편성 화면 (기존 예산 편성 화면 진화) — 4축 선택 + AI-3 자동추천 스텁
- [ ] 레거시 예산 화면 "FY2026 이전 조회 전용" 분리
- [ ] 마이그 호출 표준 — Swain `?run=1` (병렬 작업 시 worktree 분리)

---

## §7. 리스크

| 리스크 | 대응 |
|---|---|
| 4축 재설계가 운영 중 재정 데이터에 영향 | 신규 테이블 별도 — 레거시 무손상 (§3·§5⑤) |
| `account_codes` ALTER가 어드민 로그인 등 기존 SELECT 깨뜨림 | 마이그 먼저 → schema 활성화 순서 엄수 (§9.1.1) |
| P1 전체를 한 번에 설계하려는 과설계 | 라운드별 상세 설계 — 23-0은 골격만 (§0) |
| v3.0 ↔ SIREN 권한 체계 이중관리 | v3.0 역할(이사장·이사·감사 등)을 기존 `members.role`에 매핑 — 새 사용자 시스템 금지 |
| 의결 모델·OCR 등 신규 모듈 규모 과소평가 | 23-2·23-3로 분리, 라운드별 병렬(A·B·C) 분배 |

---

**다음**: Swain이 §5 ④⑤ 확정 → 23-0 구현 라운드 트리거 작성 → A·B·C 병렬 착수.
나머지 ①②③⑥은 23-1·23-2·23-3 진입 시점에 확정해도 무방.
