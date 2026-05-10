# 라이브 검증 (사용자 검증 대행) — Phase 5~7 Q11~Q14

> 작성: C 채팅 (verify/live-comprehensive)
> 베이스: main @ af33e18
> 정책: docs/HANDOFF_C.md (사용자 검증 대행, 549f0b8 재정의)
> 환경: 메인 워크트리 .env·node_modules·.netlify 디렉터리 정션 + netlify dev :8888
> DB: 운영 Neon DB (Swain 컨펌, cleanup 엄격 적용)

---

## 1. 검증 큐 결과

| Q | 항목 | 결과 |
|---|---|---|
| Q11 | admin.html 재정 관리 메뉴 정적 시뮬 | ✅ 4축 일관성 통과 |
| Q12 | 수입 현황 라이브 (income-summary) | ✅ 통과 / ⚠️ 집계 기준일 메모 1건 |
| Q13 | 예산·지출 라이브 시퀀스 | 🟠 BUG-6·7 발견 → fix → 재검증 통과 |
| Q14 | 재무 보고서 라이브 (연간/분기/월간) | ✅ 통과 |

---

## 2. Q11 — 메뉴 4축 일관성

| 메뉴 | data-page (admin.html:2783-2785) | div id (admin.html:4547,4606,4609) | PAGE_TITLES (admin.js:21-23) | switchAdminPage 분기 (admin.js:5789-5797) |
|---|---|---|---|---|
| 수입 현황 | finance-income | adm-finance-income | ✅ | window.SIREN_FINANCE_INCOME.load() |
| 예산·지출 | finance-budget | adm-finance-budget | ✅ | window.SIREN_FINANCE_BUDGET.load() |
| 재무 보고서 | finance-report | adm-finance-report | ✅ | window.SIREN_FINANCE_REPORT.load() |

3개 JS 파일 모두 IIFE 끝에서 글로벌 등록(`admin-finance-income.js:188`, `admin-finance-budget.js:318`, `admin-finance-report.js:174`). 캐시버스터 `?v=20260510f1` 일관.

---

## 3. Q12 — 수입 현황 라이브

### 호출 결과
- `?year=2026`: 39만/16건. byChannel(toss 6만/2건, hyosung 14만/7건, bank 0, other 19만/7건) 합계 정확. monthlyTrend 5월 한 달치만 (현재 2026-05).
- `?year=2026&month=5`: 동일 39만/16건, monthlyTrend 빈 배열 (월 지정 시 trend 미반환 — 의도된 동작).
- `?year=2026&month=4`: 0원/0건 (4월 데이터 없음 — 정상 동작).
- `?year=2025`: 60,002원/5건 hyosung 12월 — 작년 작은 규모 정상.

### ⚠️ 메모
집계 기준이 `donations.createdAt` (DB 기록일). 효성 CMS 수납내역을 과거 결제분으로 import할 경우 import 시점이 createdAt이 되어 import한 달로 집계됨. 설계 의도 확인 권장 (만약 결제 발생일 기준 집계를 원한다면 별도 컬럼 사용 검토). Q15·Q16 효성 import 라이브 시 동작 추가 검증.

---

## 4. Q13 — 예산·지출 라이브 시퀀스

### 시퀀스 결과 (운영비 카테고리, 검증 후 cleanup)
| Step | 동작 | 결과 |
|---|---|---|
| 1 | 운영비 100만원 편성 | ✅ ok |
| 2 | 같은 카테고리 150만원 재편성 (UPDATE) | ✅ ok, plannedAmount=1500000 확인 |
| 3-5 | 지출 #1·#2·#3 등록 (5만/3만/1만) | ✅ id 1·2·3 INSERT |
| 6 | #1 승인 | ✅ ok approved |
| 7 | #2 반려 | ✅ ok rejected |
| 8 | 이미 승인된 #1을 다시 승인 시도 | 🚨 **거짓 ok 응답** → BUG-7 |
| 9 | 이미 반려된 #2를 승인 시도 | 🚨 **거짓 ok 응답** → BUG-7 |
| 10 | expenditure-list 조회 | 🚨 **500: relation "admins" does not exist** → BUG-6 |

### BUG fix 후 재검증
| 검증 | 결과 |
|---|---|
| expenditure-list (admins→members) | ✅ items 정상, created_by_name·approved_by_name = "총괄 관리자" — BUG-5 fix 라이브 동시 통과 |
| 새 #3 등록 → 1차 승인 | ✅ ok |
| #3 2차 승인 시도 | ✅ 409 + "대기 상태가 아니거나 존재하지 않는 지출입니다" |

### Cleanup
임시 endpoint `verify-cleanup-q13` 작성 → 호출 → 검증 데이터 모두 제거 → endpoint 즉시 삭제.
- DELETE expenditures id 1·2·3 (3건)
- DELETE budgets id 1 (운영비 2026)
- 검증 후 budget-list 운영비 plannedAmount=0, expenditure-list items 빈 배열 — **검증 시작 시점과 동일 상태로 복원**.
- 잔존: `audit_logs`의 어드민 호출 흔적(제거 불가, 정책상 의도 동작), `admin_login_failed` 1건(시작 시 비밀번호 1차 시도 실패).

상세 BUG 리포트: [docs/issues/2026-05-10-finance-expenditure-bugs.md](../issues/2026-05-10-finance-expenditure-bugs.md)

---

## 5. Q14 — 재무 보고서 라이브

| 호출 | 결과 |
|---|---|
| `?year=2026` (연간) | ✅ income.total 39만 (Q12 일치), expenditure.total 0 (cleanup 후), balance 39만, budgetVsActual 5개 카테고리 정상 |
| `?year=2026&quarter=1` (1~3월) | ✅ income 0 |
| `?year=2026&quarter=2` (4~6월) | ✅ income 39만 (5월 포함) |
| `?year=2026&month=5` | ✅ income 39만 |

프론트 코드(`admin-finance-report.js:107-108`)가 `period` 셀렉트 값(`q1`/`q2`/`5`/`annual`)을 `&quarter=1` 또는 `&month=5`로 정확히 변환. 엑셀 다운(`exportExcel`, line 86-99)은 SheetJS aoa_to_sheet 시트 3개(수입/지출/예산비교) 생성, 파일명 `SIREN_재무보고서_{year}_{month}월.xlsx`. 인쇄 CSS는 admin.html `<head>` `media="print"` 등록 확인 (이전 세션에서 검증).

---

## 6. 결론

Phase 5~7 라이브 검증 완료 — Q11~Q14 모두 통과. 발견된 BUG 2건(🔴 BUG-6·🟠 BUG-7) 즉시 fix 적용 후 재검증 통과. 운영 DB cleanup 완료, 검증 시작 시점 상태로 복원.

**다음 큐(다음 세션 예정)**:
- Q15 효성 회원관리 import 라이브 + DB 사이드이펙트
- Q16 효성 수납내역 import safeReevaluate 동작
- Q17 B 단계 D D3·D4·D7 화면 정적 시뮬
- Q18~Q23 Phase 4·#6·#8·#15 지연 라이브 검증
