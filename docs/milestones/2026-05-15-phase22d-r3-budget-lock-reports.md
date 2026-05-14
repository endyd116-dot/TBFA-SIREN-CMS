# Phase 22-D-R3 — 예산 잠금 + 전표 운영 완성 + 재무제표 확장

> 작성: 2026-05-15 메인
> 상위: Phase 22-D 마지막 라운드 (R1 전표 ✅ / R2 통장 자동화 ✅ / **R3 예산잠금·결산·재무제표**)
> 전제: **22-D-R2 C 검증 마감 후 착수** (`vouchers`·`budget_lines`·`bank_transactions`·`donations`·`other_revenues` 의존)
> 범위: 6개 기능 묶음 (Swain이 후보 전부 선택) — 대형 라운드

---

## §-1 채팅 역할 분담 — A·B·C 구조

| 채팅 | 모델 | 워크트리 | 브랜치 | 담당 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | main | 스키마 확정·머지·마이그·문서 |
| A | **Opus 4.7** (작업량 큼) | tbfa-mis-A | feature/phase22d-r3-front | 🎨 예산잠금 UI·전표 인쇄·결산 체크리스트·이상패턴 배지·반복템플릿·재무제표 2탭 |
| B | **Opus 4.7** | tbfa-mis-B | feature/phase22d-r3-back | 🔧 예산잠금 로직·결산/이상패턴/재무제표 API·반복전표 cron·PDF 확장 |
| C | Opus 4.7 | tbfa-mis-C | (검증→자체fix) | 🔍 검증 Q1~Q18 |

6개 기능 한 라운드 — A·B 둘 다 Opus 권장 (22-D-R2보다 큼).

---

## §0 요구사항 (Swain 결정 2026-05-15, 8개)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 예산 잠금 | **제출 시 잠금 + 초과 경고만** — 전표 submitted 시 budget_line 가용액 차감, 초과해도 차단 안 함 |
| 2 | 전표 인쇄 | **지출결의서 양식 + 단건·일괄 둘 다** |
| 3 | 결산 보조 | **감지·체크리스트만** — 미결 전표 감지, 월 마감 잠금 ❌ |
| 4 | 이상 패턴 | **화면 배지만** — cron 이메일 알림 ❌ |
| 5 | 반복 전표 | **매월 지정일 cron 자동 draft 생성** |
| 6 | 재정상태표 | **간이판 — 통장 잔액 기반 현금성 자산만** (비현금·부채는 "해당 없음") |
| 7 | 현금흐름표 | **단순 입출금 흐름** — 영업/투자/재무 3활동 구분 ❌ |
| 8 | 재무제표 출력 | **22-B-R3 패턴 — 인쇄·엑셀·PDF** |

---

## §1 예산 잠금 (Encumbrance)

### 1.1 개념

전표가 `submitted`되는 순간 해당 `budget_line`의 가용액을 "예약"으로 잡아 미리 차감 표시.
승인 전이라도 과지출을 사전 경고. **초과해도 제출·승인은 허용** (현장 융통성 — 승인자가 판단).

### 1.2 계산식 (컬럼 추가 없음 — vouchers 집계로)

```
budget_line별:
  planned   = budget_lines.planned_amount
  reserved  = SUM(vouchers.amount WHERE budget_line_id=X AND status='submitted')
  executed  = SUM(vouchers.amount WHERE budget_line_id=X AND status='approved')
  available = planned − reserved − executed
  → available < 0 이면 "예산 초과" 경고 표시 (차단 X)
```

- `budget_lines`에 컬럼 추가 불필요 — `vouchers.budget_line_id`(22-D-R1)로 실시간 집계
- 22-B-R2 `admin-finance-budget-list` **확장**: 응답에 `reserved`·`available` 추가
- 전표 작성·제출 화면에서 선택한 budget_line의 가용액 표시 + 초과 시 빨간 경고

---

## §2 전표 인쇄

### 2.1 지출결의서 양식 (NPO 표준)

```
지출결의서
─────────────────────────────────────
전표번호: 202605-007       작성일: 2026-05-07
계정과목: 5031 임차료       세목: 사무실 임대
적요: 5월 사무실 임대료
거래처: ○○빌딩            예산: 2026 관리운영비
금액: ₩1,500,000          증빙: 세금계산서
─────────────────────────────────────
작성  [        ]   검토  [        ]   승인  [        ]
```

- `admin-report-print.css` 패턴 재사용 (22-B-R3) — `@media print` A4
- **단건 인쇄**: 전표 상세에서 [인쇄] 버튼
- **일괄 인쇄**: 전표 목록에서 기간·상태 필터 후 [선택 일괄 인쇄] — 전표당 1페이지
- 결재란(작성·검토·승인) 빈칸 — 수기 서명용

---

## §3 결산 보조 + 이상 패턴 배지

### 3.1 월말 결산 보조 (감지·체크리스트만)

- **미결 전표 감지**: 해당 월의 `draft`·`submitted` 전표 카운트
- **결산 체크리스트**: "이번 달 미결 전표 N건 / 미확인 통장 거래 M건" 표시 (재무 보고서 또는 전표 화면 상단 배너)
- **월 마감 잠금 ❌** — 상태 표시만, 수정 차단 없음

### 3.2 이상 지출 패턴 배지 (화면 배지만, cron ❌)

- 조회 시 계산: 계정과목별 `이번 달 누적 지출` vs `전월 동기 지출`
- 전월 대비 **+50% 이상 급증** → 해당 계정과목에 "⚠️ 급증" 배지
- 지출 관리·전표 화면·재무 보고서에 표시
- cron 이메일 알림 없음 — 관리자가 화면 볼 때만

---

## §4 반복 전표 자동 cron

### 4.1 vouchers 컬럼 추가 (22-D-R1 반복 템플릿 확장)

```sql
ALTER TABLE vouchers ADD COLUMN recurring_day    INTEGER;   -- 매월 자동 생성일 (1~31, 0=말일)
ALTER TABLE vouchers ADD COLUMN recurring_active BOOLEAN DEFAULT FALSE;  -- 자동 생성 ON/OFF
```

- 22-D-R1의 `is_template`·`template_name` 활용 + 위 2컬럼 추가
- 템플릿 편집 화면에서 "매월 N일 자동 생성" 설정

### 4.2 cron-voucher-recurring.ts (신규)

```
매일 KST 새벽 실행
  ↓
오늘 날짜 = recurring_day인 vouchers(is_template=true, recurring_active=true) 조회
  ↓
각 템플릿 → 이번 달 draft 전표 자동 생성 (template 필드 복사, voucher_number 신규 발번)
  ↓
중복 방지: 같은 템플릿·같은 월 이미 생성됐으면 스킵
  ↓
조용히 draft만 생성 (알림 없음 — Swain 결정 §0-4)
```

- 관리자는 다음날 전표 목록에서 자동 생성된 draft 검토·제출

---

## §5 재무제표 확장 (22-B 회계 보고서 시리즈 완성)

### 5.1 재정상태표 (간이판)

```
재정상태표 — 2026-05-08 기준

【자산】
  현금성 자산 (통장 잔액)              27,675,771
  ※ 비현금 자산은 데이터 없음 — 해당 없음
  ─────────────────────────────────
  자산 총계                           27,675,771

【부채】
  ※ 부채 데이터 없음 — 해당 없음
  부채 총계                                    0

【순자산】                            27,675,771
```

- 데이터 소스: `bank_transactions` 최신 `balance_after` (또는 `bank_imports` 메타의 현재잔액)
- 비현금 자산·부채는 "해당 없음" 명시 — SIREN 데이터 한계 투명하게

### 5.2 현금흐름표 (단순 입출금 흐름)

```
현금흐름표 — 기간: 2026-05-01 ~ 2026-05-31

기초 잔액                              28,000,000
  입금 합계 (+)                         1,500,000
    · 후원금                           1,200,000
    · 후원 외 매출                       300,000
  출금 합계 (−)                         1,824,229
    · 인건비 / 사업비 / 관리운영비 / 모금비 (카테고리별)
  ─────────────────────────────────
순현금흐름                              −324,229
기말 잔액                              27,675,771
```

- 데이터 소스: `bank_transactions` 입출금 (기간 필터 — 22-B-R1 §2-b 재사용)
- 카테고리별 내역은 대사 결과(`match_type`·`donation_id`·`voucher_id`·계정과목) 활용

### 5.3 출력 — 22-B-R3 패턴

- `admin-finance-report-pdf` 함수 확장: `?type=balance|cashflow` 추가
- 인쇄(print CSS)·엑셀(SheetJS)·PDF 3종 — 22-B-R3 운영성과표·예산실적표와 동일

---

## §6 DB 스키마

| 변경 | 내용 |
|---|---|
| `vouchers` 컬럼 2개 추가 | `recurring_day INTEGER`, `recurring_active BOOLEAN DEFAULT FALSE` |
| 그 외 | **신규 테이블 없음** — 예산 잠금·결산·이상패턴·재무제표 모두 기존 테이블 집계 |

- B는 schema.ts `vouchers` 정의에 2컬럼 append (`/* === Phase 22-D-R3 === */` 헤더, 마이그 적용 후 활성화)

---

## §7 REST API + cron

| 엔드포인트 | 기능 | 권한 |
|---|---|---|
| `admin-finance-budget-list` **확장** | 22-B-R2 것에 `reserved`·`available` 추가 (예산 잠금) | admin |
| `admin-vouchers-list` **확장** | 일괄 인쇄용 — 기간·상태 필터 결과에 인쇄 필드 포함 | admin |
| `admin-finance-settlement-check` | 미결 전표·미확인 통장 거래 카운트 (결산 보조) | admin |
| `admin-finance-anomaly` | 계정과목별 전월 대비 급증 감지 (이상 패턴 배지) | admin |
| `admin-finance-balance-sheet` | 재정상태표 (통장 잔액 기반) | admin |
| `admin-finance-cashflow` | 현금흐름표 (입출금 흐름, 기간 필터) | admin |
| `admin-finance-report-pdf` **확장** | `?type=balance|cashflow` 추가 | admin |
| `admin-voucher-template-update` | 반복 템플릿 주기 설정 (recurring_day·active) | admin |
| `cron-voucher-recurring` | 매일 KST 새벽 — 반복 전표 draft 자동 생성 | cron |

- 신규 API 6개 + 확장 3개 + cron 1개
- §6.2 단계별 try/catch + step·detail·stack 표준 준수

---

## §8 UI (A 담당)

| 화면 | 작업 |
|---|---|
| 예산 관리 (22-B-R2) | budget_line별 `reserved`·`available` 표시 + 초과 시 빨간 경고 |
| 전표 작성·제출 | 선택한 예산 항목 가용액 표시 + 초과 경고 |
| 전표 상세 | [인쇄] 버튼 — 지출결의서 양식 단건 인쇄 |
| 전표 목록 | [선택 일괄 인쇄] — 필터 결과 전표당 1페이지 |
| 전표 화면 상단 | 결산 체크리스트 배너 (미결 N건) + 이상 패턴 배지 |
| 반복 템플릿 | 템플릿 편집에 "매월 N일 자동 생성" 토글·일자 설정 |
| 재무 보고서 (22-B-R3) | "재정상태표"·"현금흐름표" 탭 2개 추가 + 인쇄·엑셀·PDF 버튼 |

- `admin-report-print.css`에 지출결의서·재정상태표·현금흐름표 print 양식 추가
- 캐시버스터 `?v=20260515p22dr3`

---

## §9 검증 Q&A (C 담당, Q1~Q18)

### 예산 잠금
- Q1: 전표 submitted 시 budget_line `reserved` 증가, 가용액 차감 표시
- Q2: 예산 초과 시 빨간 경고 표시되나 제출·승인은 허용
- Q3: 예산 관리 화면 — planned/reserved/executed/available 정확

### 전표 인쇄
- Q4: 전표 상세 [인쇄] → 지출결의서 양식 A4 단건 출력 (결재란 포함)
- Q5: 전표 목록 [선택 일괄 인쇄] → 전표당 1페이지
- Q6: 인쇄 시 사이드바·버튼 숨김, 양식만

### 결산 보조 + 이상 패턴
- Q7: 미결 전표(draft·submitted) 카운트 정확
- Q8: 결산 체크리스트 배너 — 미결 전표·미확인 통장 거래 표시
- Q9: 계정과목 전월 대비 +50% 급증 시 "⚠️ 급증" 배지
- Q10: cron 이메일 알림 없음 확인 (화면 배지만)

### 반복 전표 cron
- Q11: 템플릿에 "매월 N일 자동 생성" 설정 가능
- Q12: cron 실행 → recurring_day 도래 템플릿 → draft 전표 자동 생성
- Q13: 같은 템플릿·같은 월 중복 생성 안 됨

### 재무제표
- Q14: 재정상태표 — 통장 잔액 = 현금성 자산, 비현금·부채 "해당 없음" 명시
- Q15: 현금흐름표 — 기초/입금/출금/순현금흐름/기말, 카테고리별 내역
- Q16: 재정상태표·현금흐름표 인쇄·엑셀·PDF 출력

### 회귀
- Q17: 22-B-R2 예산 편성·22-D-R1 전표·22-D-R2 통장 대사 회귀 0
- Q18: 22-A·22-C·22-B-R1·R3 회귀 0

---

## §10 트리거

### §10.1 B 트리거 (feature/phase22d-r3-back) — 🔧 백엔드

```
[메인 → B 채팅] Phase 22-D-R3 예산잠금·전표운영·재무제표 — 🔧 백엔드 (프론트 ❌)

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" 류 권한 질문 금지 — 바로 실행.
- 묻는 건 단 2가지: ① git push ② 애매한 설계·로직 결정
- ★ PROJECT_STATE·docs·public 수정 금지
- ★ 베이스는 반드시 git pull 후 main 최신 (옛 베이스 분기 금지)

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22d-r3-back

설계서: docs/milestones/2026-05-15-phase22d-r3-budget-lock-reports.md

■ 1단계 — 마이그+schema (설계서 §6)
- [ ] migrate-phase22d-r3-recurring.ts — vouchers에 recurring_day·recurring_active 추가 (멱등)
- [ ] schema.ts vouchers 정의에 2컬럼 append (/* === Phase 22-D-R3 === */)
- [ ] 메인에 마이그 호출 요청

■ 2단계 — 예산 잠금 (설계서 §1)
- [ ] admin-finance-budget-list 확장 — reserved(submitted 합)·available 추가

■ 3단계 — 결산·이상패턴 API (설계서 §3)
- [ ] admin-finance-settlement-check — 미결 전표·미확인 통장 거래 카운트
- [ ] admin-finance-anomaly — 계정과목별 전월 대비 +50% 급증 감지

■ 4단계 — 반복 전표 cron (설계서 §4)
- [ ] admin-voucher-template-update — recurring_day·active 설정
- [ ] cron-voucher-recurring.ts — 매일 KST 새벽, recurring_day 도래 템플릿 draft 생성
      · 중복 방지(같은 템플릿·같은 월), 알림 없음
- [ ] netlify.toml에 cron 스케줄 등록

■ 5단계 — 재무제표 (설계서 §5)
- [ ] admin-finance-balance-sheet — 재정상태표(통장 잔액 기반)
- [ ] admin-finance-cashflow — 현금흐름표(입출금 흐름, 기간 필터)
- [ ] admin-finance-report-pdf 확장 — ?type=balance|cashflow

■ 6단계 — 검증
- [ ] npx tsc --noEmit — 신규 에러 0건 (기존 묵은 에러 14건과 구분)

완료 후:
- git add, commit, git push origin feature/phase22d-r3-back
- 완료 메시지: "[B → 메인] feature/phase22d-r3-back push 완료. 머지 + 마이그 호출 요청."
```

### §10.2 A 트리거 (feature/phase22d-r3-front) — 🎨 프론트엔드

```
[메인 → A 채팅] Phase 22-D-R3 예산잠금·전표운영·재무제표 — 🎨 프론트엔드 (백엔드 ❌)

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" 류 권한 질문 금지 — 바로 실행.
- 묻는 건 단 2가지: ① git push ② 애매한 설계·로직 결정
- ★ 베이스는 반드시 git pull 후 main 최신 (옛 베이스 분기 금지)

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22d-r3-front

설계서: docs/milestones/2026-05-15-phase22d-r3-budget-lock-reports.md §1·§2·§3·§5·§8

■ 1단계 — 예산 잠금 UI (설계서 §1)
- [ ] 예산 관리 화면 — budget_line별 reserved·available 표시 + 초과 빨간 경고
- [ ] 전표 작성·제출 화면 — 선택 예산 항목 가용액 표시 + 초과 경고

■ 2단계 — 전표 인쇄 (설계서 §2)
- [ ] 전표 상세 [인쇄] — 지출결의서 양식 단건 (결재란 포함)
- [ ] 전표 목록 [선택 일괄 인쇄] — 전표당 1페이지
- [ ] admin-report-print.css에 지출결의서 print 양식 추가

■ 3단계 — 결산·이상패턴 (설계서 §3)
- [ ] 전표 화면 상단 결산 체크리스트 배너 (미결 N건·미확인 거래 M건)
- [ ] 지출·전표·재무보고서에 계정과목 "⚠️ 급증" 배지

■ 4단계 — 반복 템플릿 (설계서 §4)
- [ ] 템플릿 편집에 "매월 N일 자동 생성" 토글·일자 설정

■ 5단계 — 재무제표 (설계서 §5)
- [ ] 재무 보고서 화면에 "재정상태표"·"현금흐름표" 탭 2개 추가
- [ ] 각 탭 인쇄·엑셀(SheetJS)·PDF 버튼 (22-B-R3 패턴)
- [ ] admin-report-print.css에 재정상태표·현금흐름표 print 양식 추가

■ 공통
- [ ] 캐시버스터 ?v=20260515p22dr3
- [ ] 데이터 API는 B 작성 — 응답 키 다중 fallback

완료 후:
- git add, commit, git push origin feature/phase22d-r3-front
- PROJECT_STATE·docs·netlify/functions·lib·db 수정 금지
- 완료 메시지: "[A → 메인] feature/phase22d-r3-front push 완료."
```

### §10.3 C 트리거 — 🔍 검증

```
[메인 → C 채팅] Phase 22-D-R3 검증 — 🔍 예산잠금·전표운영·재무제표

베이스: main (B·A 머지 + 마이그 호출 완료 후)
설계서 §9 Q1~Q18

[자율주행 정책][진행률 보고] (표준 — 권한 질문 금지, 바로 실행)

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-C
  git fetch origin && git checkout main && git pull origin main

검증 URL: https://tbfa.co.kr/cms-tbfa.html

Q1~Q3 예산 잠금 / Q4~Q6 전표 인쇄 / Q7~Q10 결산·이상패턴 /
Q11~Q13 반복 전표 cron / Q14~Q16 재무제표 / Q17~Q18 회귀

BUG 발견 시 fix/phase22d-r3-bugs 브랜치 자체 fix.
완료 메시지: "[C → 메인] 22-D-R3 검증 완료. PASS X / FAIL Y. BUG N건."
```

---

## §11 리스크·주의

- **대형 라운드**: 6개 기능 — B·A 둘 다 Opus, 작업 시간 큼
- **예산 잠금 계산식**: 컬럼 추가 없이 vouchers 집계 — 전표 많아지면 조회 성능 점검 (인덱스 `vouchers.budget_line_id` 확인)
- **반복 전표 중복 방지**: cron이 같은 템플릿·같은 월 재생성 안 하도록 — 생성 이력 체크 필수
- **재정상태표 데이터 한계**: 비현금 자산·부채 "해당 없음" 명시 — 정식 재정상태표로 오해 없게
- **현금흐름표 카테고리 내역**: 22-D-R2 대사 결과(match_type·계정과목) 의존 — 미대사 거래 많으면 "미분류" 비중 큼
- **admin-finance-budget-list 확장**: 22-B-R2·22-B-R3가 이 API 사용 — 응답 키 추가만(reserved·available), 기존 키 변경 금지
- **cron 신규**: netlify.toml 스케줄 등록 + 멱등성. cron 함수는 throw 안 함 (fire-and-forget)

---

## §12 작업 시간 추정

| 채팅 | 작업 | 시간 |
|---|---|---|
| B | 마이그 + 예산잠금 + 결산/이상패턴/재무제표 API 6개 + cron + PDF 확장 | 10~14h |
| A | 예산잠금 UI + 전표 인쇄 + 결산·배지 + 반복템플릿 + 재무제표 2탭 | 9~13h |
| C | 검증 Q1~Q18 | 3~4h |
| **합계 (병렬)** | | **10~14h** |

---

## §13 Phase 22-D 완결

R3 마감 시 Phase 22-D(전표·통장 자동화) 완결:
- R1 전표 시스템 ✅ / R2 통장거래내역 자동화 ✅ / R3 예산잠금·전표운영·재무제표 ✅

Phase 22 전체(22-A 매출 / 22-B 재정 3부작 / 22-C 지출 / 22-D 전표 3부작) 완결.
후속: 함께워크 ON 공유오피스 신규 구축 / tsc 묵은 에러 14건 정리 / Phase 18·19.
