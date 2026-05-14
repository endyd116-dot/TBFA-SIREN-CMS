# Phase 22-B-R3 — NPO 표준 회계 보고서

> 작성: 2026-05-15 메인
> 상위: Phase 22-B 재정 3부작 마지막 (R1 화면 이전·기간 필터 ✅ / R2 예산 편성 ✅ 진행 / **R3 회계 보고서**)
> 전제: **22-B-R2 + 22-D-R1 C 통합 검증 마감 후 착수** (budget_plans·budget_lines 의존)

---

## §-1 채팅 역할 분담 — A·B·C 구조

| 채팅 | 모델 | 워크트리 | 브랜치 | 담당 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | main | 머지·조율·문서 |
| A | Sonnet 4.6 | tbfa-mis-A | feature/phase22b-r3-front | 🎨 회계 보고서 화면 정식화 + 인쇄·엑셀·PDF 버튼 |
| B | Opus 4.7 | tbfa-mis-B | feature/phase22b-r3-back | 🔧 PDF 생성 함수 + 옛 테이블 코드 정리 |
| C | Opus 4.7 | tbfa-mis-C | (검증→자체fix) | 🔍 검증 Q1~Q12 |

단독 라운드 — 22-D-R2(통장 자동화)는 이후 별도.

---

## §0 요구사항 (Swain 결정 2026-05-15)

| 항목 | 결정 |
|---|---|
| 보고서 범위 | **운영성과표 + 예산 대비 실적표** — 재정상태표·현금흐름표는 22-D-R2 통장 연동 후 별도 |
| 출력 형식 | **인쇄 + 엑셀 + PDF** 3종 |
| 조회 기간 | **22-B-R1 기간 필터 전체 재사용** — day/week/month/half_year/year/custom |
| 옛 테이블 정리 | **22-B-R3에 포함** — `budgets`·`budget_categories`·`expenditures` 코드 정의 제거 |

### 배경 — SIREN 데이터 한계

SIREN은 복식부기 시스템이 아님. 수익(donations·other_revenues)·지출(expenses)·예산(budget_plans) 데이터만 존재.
자산·부채·통장 잔액 데이터가 없어 **재정상태표·현금흐름표는 22-D-R2 통장 연동 후**에야 정확.
R3는 현재 데이터로 정확히 산출 가능한 **운영성과표 + 예산 대비 실적표** 2종에 집중.

---

## §1 보고서 명세

### 1.1 운영성과표 (Statement of Operations)

NPO 표준 양식:

```
운영성과표 — (기간: 2026-01-01 ~ 2026-12-31)

Ⅰ. 사업수익
   1. 후원금수익                        XXX
   2. 사업수익 (후원 외)                 XXX
      · 강연·교육 (lecture)
      · 정부보조금 (govgrant)
      · 기업후원 (corp_sponsor)
      · 협회 운영수익 (twork_on / twork_si)
      · 기타 (etc)
   ─────────────────────────────────────
   사업수익 계                          XXX

Ⅱ. 사업비용
   1. 인건비 (personnel)                XXX
   2. 사업비 (program)                  XXX
   3. 관리운영비 (admin_ops)             XXX
   4. 모금비 (fundraising)               XXX
   ─────────────────────────────────────
   사업비용 계                          XXX

Ⅲ. 운영성과 (Ⅰ − Ⅱ)                   XXX
```

- 수익·비용 모두 환불 차감 net 기준
- 데이터 소스: `donations`(status='completed' − 'refunded') + `other_revenues`(approved, amount−refund) + `expenses`(approved, amount−refund)

### 1.2 예산 대비 실적표 (Budget vs Actual)

```
예산 대비 실적표 — 2026 회계연도 (승인 예산안: "2026년도 예산안")

계정과목        편성액      집행액      잔여액      집행률
인건비          XXX        XXX        XXX        XX%
사업비          XXX        XXX        XXX        XX%
관리운영비       XXX        XXX        XXX        XX%
모금비          XXX        XXX        XXX        XX%
─────────────────────────────────────────────────
합계           XXX        XXX        XXX        XX%
```

- 편성액: 22-B-R2 `budget_plans`(status='approved')의 `budget_lines.planned_amount`
- 집행액: `expenses`(approved, fiscal_year 매칭) 카테고리별 SUM(amount−refund)
- 승인 예산안 없으면 "예산안 미승인" 안내 (admin-finance-budget-list의 noPlan 응답 활용)

---

## §2 데이터 소스 + API

### 2.1 기존 API 재사용 (신규 최소화)

| 보고서 | 재사용 API | 비고 |
|---|---|---|
| 운영성과표 | `admin-finance-pl-summary` | 22-A·22-C·22-B-R1 산출. `revenue`/`expenditure`/`netIncome` + `period` 파라미터 이미 보유. **그대로 사용** |
| 예산 대비 실적표 | `admin-finance-budget-list` | 22-B-R2 재작성됨. `budget_plans` 기반 집행률. **그대로 사용** |

→ 운영성과표·예산실적 **데이터 API는 신규 불필요**. 프론트가 NPO 양식으로 렌더링.

### 2.2 신규 API — PDF 생성 (B 담당)

`netlify/functions/admin-finance-report-pdf.ts`:
- 쿼리: `?type=pl|budget` + `period`/`startDate`/`endDate`(운영성과표) 또는 `year`(예산실적)
- 서버에서 `pl-summary` 또는 `budget-list` 로직 호출 → pdf-lib로 A4 PDF 생성
- 한글 폰트: `assets/fonts/NotoSansKR-Regular.ttf` (netlify.toml `included_files`에 본 함수 추가 필요)
- 응답: `application/pdf` 바이너리 (또는 base64)
- requireAdmin 가드

---

## §3 출력 형식 (3종)

| 형식 | 구현 | 담당 |
|---|---|---|
| 인쇄 | `window.print()` + `@media print` A4 CSS — 기존 `admin-report-print.css` 패턴 재사용. 사이드바·버튼 숨김, A4 여백 | A |
| 엑셀 | SheetJS(이미 스택) 클라이언트 변환 — 보고서 테이블 → `.xlsx` 다운로드 | A |
| PDF | B의 `admin-finance-report-pdf` API 호출 → 바이너리 다운로드 | A(버튼)·B(생성) |

---

## §4 옛 테이블 코드 정리 (B 담당)

> ⚠️ 실제 DB 테이블·데이터는 **DROP하지 않음** (롤백 대비). `db/schema.ts` 코드 정의만 제거.

- `db/schema.ts`에서 제거: `budgetCategories`·`budgets`·`expenditures` 테이블 정의 + 관련 `$inferSelect`/`$inferInsert` 타입
- 이 3개를 import·참조하는 잔재 코드 grep 후 정리:
  - `admin-finance-budget-list.ts` — 22-B-R2에서 이미 `budget_plans` 기반으로 재작성됨, 옛 참조 없을 것 (확인만)
  - 옛 지출 API 3개 (`admin-finance-expenditure-list/create/approve.ts`) — 22-B-R1에서 deprecated 처리됨. **이번에 파일 삭제** (deprecated 기간 종료)
  - `lib/ai-agent-tools.ts`·`lib/ai-agent-config.ts`·`lib/ai-cache.ts` — `expenditures` 잔재 grep (22-B-R1에서 대부분 정리됨, 재확인)
- `npx tsc --noEmit` — 신규 에러 0건 (기존 묵은 에러 14건과 구분)

---

## §5 UI (A 담당)

### 5.1 현재 상태

`public/js/admin-finance-report.js` — 통합 CMS "재무 보고서" 화면, 탭 2개:
- "예산·실적 보고서" (기존)
- "손익계산서" (22-A 신규)

### 5.2 R3 작업 — NPO 표준 양식으로 정식화

| 기존 탭 | → R3 |
|---|---|
| "손익계산서" | **"운영성과표"** — §1.1 NPO 표준 양식 (Ⅰ 사업수익 / Ⅱ 사업비용 / Ⅲ 운영성과) |
| "예산·실적 보고서" | **"예산 대비 실적표"** — §1.2 양식 (편성·집행·잔여·집행률) |

각 탭 공통:
- [ ] 상단: 기간 선택기 (22-B-R1 §2-b 공통 컴포넌트 재사용 — day/week/month/half_year/year/custom)
- [ ] 본문: NPO 표준 양식 테이블 렌더링
- [ ] 출력 버튼 3종: [인쇄] [엑셀] [PDF]
- [ ] 보고서 머리말: 협회명·기간·생성일시 (ORG_NAME 등)

- [ ] `admin-report-print.css` 패턴의 print CSS 추가 (또는 기존 재사용)
- [ ] 캐시버스터 `?v=20260515p22br3`

---

## §6 AI 도구 (B 담당 — 최소)

운영성과표는 기존 `pl_summary` 도구가 이미 커버 (period 파라미터 보유).
예산 실적은 `budget_plan_list`(22-B-R2)가 커버.
→ **신규 AI 도구 없음.** `pl_summary` description에 "운영성과표" 표현만 보강 (LLM 매핑 강화).

---

## §7 검증 Q&A (C 담당, Q1~Q12)

### 운영성과표
- Q1: "운영성과표" 탭 — Ⅰ 사업수익(후원금+후원외 카테고리별) / Ⅱ 사업비용(NPO 4분류) / Ⅲ 운영성과 정확
- Q2: 환불 차감 net 기준 반영 (donations refunded, other/expenses refund_amount)
- Q3: 기간 선택기 — day/week/month/half_year/year/custom 전환 시 재집계 정확

### 예산 대비 실적표
- Q4: "예산 대비 실적표" 탭 — 편성·집행·잔여·집행률 정확 (22-B-R2 승인 예산안 기준)
- Q5: 승인 예산안 없을 때 "미승인" 안내 정상
- Q6: NPO 4분류별 행 + 합계 정확

### 출력
- Q7: 인쇄 — A4 양식, 사이드바·버튼 숨김, 머리말(협회명·기간) 표시
- Q8: 엑셀 — 보고서 테이블 .xlsx 다운로드, 숫자·합계 정확
- Q9: PDF — 다운로드, 한글 정상 렌더링, A4 양식

### 옛 테이블 정리·회귀
- Q10: 옛 지출 API 3개 파일 삭제 확인 + 호출 시 404
- Q11: db/schema.ts 옛 3개 정의 제거 + tsc 신규 에러 0건
- Q12: 22-A·22-C·22-B-R1·R2·22-D-R1 회귀 0 (매출·지출·예산·전표·기간 필터)

---

## §8 트리거

### §8.1 B 트리거 (feature/phase22b-r3-back) — 🔧 백엔드

```
[메인 → B 채팅] Phase 22-B-R3 회계 보고서 — 🔧 백엔드 (프론트 ❌)

전제: 22-B-R2 + 22-D-R1 C 통합 검증 마감 후 착수.

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" 류 권한 질문 금지 — 바로 실행.
- 묻는 건 단 2가지: ① git push ② 애매한 설계·로직 결정
- ★ PROJECT_STATE·docs·public 수정 금지 (지난 라운드 위반 있었음 — 엄수)

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22b-r3-back

설계서: docs/milestones/2026-05-15-phase22b-r3-accounting-reports.md

■ 1단계 — PDF 생성 함수 (설계서 §2.2)
- [ ] netlify/functions/admin-finance-report-pdf.ts
  · ?type=pl|budget + period/startDate/endDate(pl) 또는 year(budget)
  · pl-summary / budget-list 로직 재사용 → pdf-lib A4 PDF 생성
  · 한글 폰트 assets/fonts/NotoSansKR-Regular.ttf
  · requireAdmin 가드
- [ ] netlify.toml included_files에 admin-finance-report-pdf 함수 폰트 추가

■ 2단계 — 옛 테이블 코드 정리 (설계서 §4)
- [ ] db/schema.ts: budgetCategories·budgets·expenditures 정의 + 타입 제거
- [ ] 옛 지출 API 3개 파일 삭제: admin-finance-expenditure-list/create/approve.ts
- [ ] lib/ai-agent-tools.ts·ai-agent-config.ts·ai-cache.ts — expenditures 잔재 grep·정리
- [ ] admin-finance-budget-list.ts 옛 참조 없는지 확인 (22-B-R2 재작성분)

■ 3단계 — AI 도구 (설계서 §6)
- [ ] pl_summary 도구 description에 "운영성과표" 표현 보강 (신규 도구 없음)

■ 4단계 — 검증
- [ ] npx tsc --noEmit — 신규 에러 0건

완료 후:
- git add, commit, git push origin feature/phase22b-r3-back
- 완료 메시지: "[B → 메인] feature/phase22b-r3-back push 완료. 머지 요청."
```

### §8.2 A 트리거 (feature/phase22b-r3-front) — 🎨 프론트엔드

```
[메인 → A 채팅] Phase 22-B-R3 회계 보고서 — 🎨 프론트엔드 (백엔드 ❌)

전제: 22-B-R2 + 22-D-R1 C 통합 검증 마감 후 착수.

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" 류 권한 질문 금지 — 바로 실행.
- 묻는 건 단 2가지: ① git push ② 애매한 설계·로직 결정
- ★ 베이스는 반드시 git pull 후 main 최신 (옛 베이스 분기 금지 — 지난 라운드 사고 있었음)

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22b-r3-front

설계서: docs/milestones/2026-05-15-phase22b-r3-accounting-reports.md §1·§3·§5

■ 작업 — 재무 보고서 화면 NPO 표준 양식 정식화 (admin-finance-report.js)

[ ] "손익계산서" 탭 → "운영성과표" 정식화 (설계서 §1.1)
    · Ⅰ 사업수익(후원금 + 후원외 카테고리별) / Ⅱ 사업비용(NPO 4분류) / Ⅲ 운영성과
    · 데이터: 기존 /api/admin-finance-pl-summary 그대로 (period 파라미터 보유)
[ ] "예산·실적 보고서" 탭 → "예산 대비 실적표" 정식화 (설계서 §1.2)
    · 편성·집행·잔여·집행률 + 합계
    · 데이터: 기존 /api/admin-finance-budget-list 그대로 (22-B-R2 재작성분)
    · 승인 예산안 없으면 noPlan 안내
[ ] 두 탭 공통: 기간 선택기 (22-B-R1 §2-b 공통 컴포넌트 재사용)
[ ] 두 탭 공통: 보고서 머리말 (협회명·기간·생성일시)
[ ] 출력 버튼 3종:
    · [인쇄] window.print() + @media print A4 CSS (admin-report-print.css 패턴)
    · [엑셀] SheetJS 클라이언트 변환 → .xlsx
    · [PDF] /api/admin-finance-report-pdf?type=pl|budget 호출 → 다운로드
[ ] 캐시버스터 ?v=20260515p22br3

■ 주의
- 데이터 API는 신규 없음 — pl-summary·budget-list 기존 응답 키 그대로 사용
- PDF API(admin-finance-report-pdf)는 B가 작성 — A는 버튼·다운로드 처리만
- cms-tbfa.html은 캐시버스터 갱신만 (구조 변경 시 page-finance-report 섹션 내부만)

완료 후:
- git add, commit, git push origin feature/phase22b-r3-front
- PROJECT_STATE·docs·netlify/functions·lib·db 수정 금지
- 완료 메시지: "[A → 메인] feature/phase22b-r3-front push 완료."
```

### §8.3 C 트리거 — 🔍 검증

```
[메인 → C 채팅] Phase 22-B-R3 회계 보고서 검증 — 🔍

베이스: main (B·A 머지 완료 후)
설계서 §7 Q1~Q12

[자율주행 정책][진행률 보고] (표준 — 권한 질문 금지, 바로 실행)

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-C
  git fetch origin && git checkout main && git pull origin main

검증 URL: https://tbfa.co.kr/cms-tbfa.html

Q1~Q3 운영성과표 / Q4~Q6 예산 대비 실적표 / Q7~Q9 출력(인쇄·엑셀·PDF) /
Q10~Q12 옛 테이블 정리·회귀

BUG 발견 시 fix/phase22b-r3-bugs 브랜치 자체 fix.
완료 메시지: "[C → 메인] 22-B-R3 검증 완료. PASS X / FAIL Y. BUG N건."
```

---

## §9 리스크·주의

- **22-B-R2·22-D-R1 검증 마감 후 착수**: budget_plans·budget_lines 의존. C 통합 검증 BUG fix가 예산 관련이면 R3에 영향
- **PDF 폰트 6MB**: `netlify.toml included_files`에 admin-finance-report-pdf만 명시 (전역 추가 금지 — 빌드 시간)
- **옛 테이블 DROP 금지**: 코드 정의만 제거. DB 테이블·데이터는 보존 (롤백 대비)
- **옛 지출 API 파일 삭제**: 22-B-R1에서 deprecated 처리됨 → 호출하는 프론트 잔재 없는지 grep 후 삭제
- **데이터 API 신규 없음**: pl-summary·budget-list 재사용 — 응답 키 변경 시 R3 화면도 깨짐, 변경 금지
- **기존 tsc 묵은 에러 14건**: R3 작업과 무관, 신규 에러만 카운트

---

## §10 작업 시간 추정

| 채팅 | 작업 | 시간 |
|---|---|---|
| B | PDF 생성 함수 + 옛 테이블 정리 + AI description | 4~6h |
| A | 보고서 2탭 정식화 + 인쇄·엑셀·PDF 버튼 | 6~8h |
| C | 검증 Q1~Q12 | 2~3h |
| **합계 (병렬)** | | **6~9h** |

---

## §11 Phase 22-B 완결

R3 마감 시 Phase 22-B(재정 통합·예산·회계) 3부작 완결:
- R1 재정 화면 통합 CMS 이전 + 기간 필터 ✅
- R2 차년도 예산 편성 + 2단계 결재 ✅
- R3 NPO 표준 회계 보고서 (운영성과표·예산실적) ✅

후속: **22-D-R2** 통장거래내역 자동화 (재정상태표·현금흐름표는 이때 통장 데이터 확보 후 가능)
