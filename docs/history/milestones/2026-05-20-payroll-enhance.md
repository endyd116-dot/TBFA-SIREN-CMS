# 급여관리 고도화 — 설계 (수정 UI + 공제·실수령 + PAID + 계산기준·이력)

> 작성: 2026-05-20 / 메인
> 상태: **설계·스키마 확정 대기**. Swain 스키마 확인 → 마이그레이션 호출 → 스키마 활성화 → 백엔드 → 프론트.
> 기반: R37 급여 통합(`lib/payroll-calc.ts`·`admin-payroll.ts`·`admin-payroll.js`·`payroll_slips`).

## §0 요구사항 확정 (Swain 결정 2026-05-20)
| 항목 | 결정 |
|---|---|
| 명세서 항목 수정 | **직접편집 + 조정라인** (기존 금액 직접 수정 + 가감 조정 라인·사유 필수·수정 시 재집계 보존 잠금·이력 보존) |
| 추가 기능 | **지급 확정(PAID)** · **실수령액(공제)** · **계산기준 설정·수정 이력** |
| 제외 | 만근 보너스·고정 수당 (이번 범위 아님) |

## §1 현행 정리 (확인 완료)
- 자동 집계만 존재: `payroll-calc.ts`가 근태·휴가·성과(PAID)로 월기본급·야근·무급차감·성과보너스·세전총액 계산.
- 수정 경로 없음: `admin-payroll.ts` PATCH는 `reviewNote`·`status`만. 금액 컬럼 수정 API/UI 0.
- 세전(grossPay)까지만. 공제·실수령 없음. 지급은 SENT(이메일)뿐·PAID 없음. 계산 기준(1.5배·2080h·22일) 하드코딩.

## §2 DB 스키마 변경안 (마이그레이션 `migrate-payroll-enhance`)

### `payroll_slips` 컬럼 추가 (ADD COLUMN IF NOT EXISTS)
| 컬럼 | 타입 | 용도 |
|---|---|---|
| `manually_edited` | boolean default false notnull | 수동 수정됨 → 재집계가 덮지 않음(force 제외) |
| `adjustments` | jsonb default '[]' notnull | 조정 라인 `[{label, amount, kind:'ADD'\|'DEDUCT', reason}]` |
| `income_tax` | numeric(15,2) default 0 | 소득세 |
| `local_tax` | numeric(15,2) default 0 | 지방소득세 |
| `national_pension` | numeric(15,2) default 0 | 국민연금 |
| `health_insurance` | numeric(15,2) default 0 | 건강보험 |
| `long_term_care` | numeric(15,2) default 0 | 장기요양 |
| `employment_insurance` | numeric(15,2) default 0 | 고용보험 |
| `other_deduction` | numeric(15,2) default 0 | 기타 공제 |
| `total_deduction` | numeric(15,2) default 0 | 공제 합계 |
| `net_pay` | numeric(15,2) default 0 | 실수령액(세후) = grossPay − total_deduction |
| `paid_at` | timestamp | 지급 확정 시각 |
| `paid_by` | varchar(36) | 지급 확정자 |

- `status`는 기존 varchar → 값에 `'PAID'` 추가 (스키마 변경 불필요·코드 allowed 목록만 확장).

### 신규 테이블 `payroll_settings` (단일 행 id=1·계산 기준)
overtime_multiplier(1.5)·annual_hours(2080)·monthly_work_days(22)·pension_rate(0.045)·health_rate(0.03545)·longterm_rate(0.1295)·employment_rate(0.009)·income_tax_rate(0·정률 자동·명세서별 수정 가능)·updated_at·updated_by. 마이그가 id=1 시드.

### 신규 테이블 `payroll_audit` (수정 이력)
id·slip_id(FK)·changed_by·field·old_value·new_value·reason·created_at.

> 멱등: ADD COLUMN/CREATE TABLE IF NOT EXISTS + 시드 중복 방지(ON CONFLICT). 호출 후 schema.ts 정의 추가 + 파일 삭제.

## §3 API 변경안 (Stage 2)
- `admin-payroll.ts` PATCH 확장: `baseSalaryMonth·overtimePay·deductionUnpaid·performanceBonus·incomeTax·localTax·기타공제·adjustments[]` 수정 허용 → 수정 시 `manually_edited=true` + grossPay·total_deduction·net_pay 재계산 + 변경 필드 `payroll_audit` INSERT(사유 포함).
- `admin-payroll.ts` POST `action=paid`: status=PAID·paid_at·paid_by 기록 (APPROVED/SENT에서만).
- `payroll-calc.ts`: ① `manually_edited` 슬립은 재집계 skip(force 제외) ② 계산기준을 `payroll_settings`에서 로드(하드코딩 제거) ③ 공제 자동 계산(4대보험=설정 요율, 장기요양=건강보험액×longterm_rate, 소득세=설정 정률 자동·명세서별 수정 가능, 지방소득세=소득세×10%) + net_pay 산출.
- 신규 `admin-payroll-settings.ts`: GET/PUT 계산기준 (super 전용).
- `admin-payroll-export.ts`·`payroll-pdf`·`payroll-my`: 공제·실수령·조정 라인 컬럼 반영.

## §4 화면 변경안 (Stage 3 — `admin-payroll.html`/`.js`)
- 상세 모달: 급여 구성 항목을 **편집 가능 입력칸**으로 + **조정 라인 추가/삭제(사유)** + **공제 항목 입력·실수령 표시** + "저장"(PATCH) 버튼 + 수동수정 배지.
- 일람: 실수령액 컬럼 추가·PAID 카운트/배지·"지급 확정" 버튼(APPROVED/SENT).
- 신규 "계산기준" 설정 화면/섹션 (설정 PUT).
- 수정 이력 표시(상세 모달 하단).
- 캐시버스터 갱신.

## §5 단계 분할 (각 단계 push 후 검증)
1. **Stage 1**: 마이그레이션 작성 → Swain 호출 → schema.ts 정의 활성화 → 파일 삭제.
2. **Stage 2**: 백엔드(PATCH 확장·PAID·공제 계산·설정·이력) + tsc → push → 검증.
3. **Stage 3**: 프론트(수정 UI·조정라인·공제·실수령·PAID·설정 UI) + 캐시버스터 → push → Swain 라이브 검증 → 종결.

## §6 검증 시나리오 (요약)
직접 수정 후 저장·재집계해도 보존 / 조정라인 가감 반영 / 공제→실수령 정확 / PAID 상태·지급일 / 계산기준 변경이 재집계에 반영 / 수정 이력 누가·무엇·사유 기록 / 직원 마이페이지·PDF·CSV에 공제·실수령 노출.

## §7 갱신 이력
| 시각 | 변경 |
|---|---|
| 2026-05-20 | 설계 작성·Swain 4결정 반영 (스키마 확정 대기) |
| 2026-05-21 | 3단계 전부 머지 + Swain 라이브 검증 완료 → **라운드 종결** |

---

# §8 — 종결 (2026-05-21)

> 3단계 설계대로 전부 머지 + Swain 라이브 검증 완료. 세전까지였던 급여가 직접편집·조정라인·법정공제·실수령·지급확정(PAID)·계산기준 설정·수정이력까지 확장됨.

## 구현 매핑 (실제 커밋)
| 단계 | 커밋 | 내용 |
|---|---|---|
| Stage 1 (스키마) | `00f6140`(마이그) → `87bb7eb`(schema 활성화·마이그 삭제) | payroll_slips 13컬럼·payroll_settings·payroll_audit |
| Stage 2 (백엔드) | `ff48c18` | PATCH 직접편집·조정라인·공제·실수령·PAID·설정 GET/PUT·이력·payroll-calc 잠금/공제 |
| Stage 3 (프론트) | `a30c23f` | 편집 모달·조정라인·공제·실수령 미리보기·사유·저장·지급확정·계산기준 UI·수정이력 + 직원 노출(payroll-my·PDF·CSV) |

## 결과
- 어드민: 상세 모달에서 지급·공제 항목 직접 수정 + 조정 라인(가감·사유) + 실시간 실수령 미리보기 + 사유 필수 저장(이력 기록·수동수정 잠금), 일람 실수령·PAID·지급확정, 계산기준 설정.
- 직원: 마이페이지·PDF·CSV에 공제·실수령 노출, 지급완료(PAID) 후에도 조회 유지.
- 백엔드 무변경 회귀: tsc 통과(exit 0). 재집계는 수동수정·승인 이상 건 보존.
- 라이브 검증: Swain 2026-05-21 완료(100%).
