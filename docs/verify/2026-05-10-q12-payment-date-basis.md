# Q12 fix — 수입 집계·표시 기준일을 실제 결제일로 전환

> 작성: C 채팅 (fix/q12-income-payment-date-basis)
> 베이스: main @ 0c08f45
> 작업 범위: 안 2 (어드민 그래프·KPI + 후원자 영수증·마이페이지 일관)
> DB 마이그: 0회 (코드만)

---

## 1. 변경 요지 (기능 위주)

**바뀐 점**: 수입 그래프와 후원 통계가 "데이터가 시스템에 들어온 시각" 대신 **자료에 적힌 실제 결제일**을 기준으로 합산. 효성 외부 자료가 며칠 늦게 일괄 업로드돼도 후원금이 진짜 결제된 달의 막대로 들어감.

**같이 바뀐 점**: 후원자 마이페이지의 후원 내역 날짜와 기부금 영수증 PDF의 후원일도 같은 기준으로 표시 — 어드민이 보는 그래프와 후원자가 받는 영수증의 날짜가 일치.

**손대지 않은 점**: 토스 결제는 원래도 시스템 등록과 결제가 동시에 일어나므로 그대로 두면 createdAt이 결제일 역할 (수 초 차이). 별도 컬럼 추가 안 함 — 다음 라운드 검토.

---

## 2. 구현 — 결제일 우선 표현식

```sql
COALESCE(donations.hyosung_paid_date, donations.created_at)
```

- 효성 CMS: `hyosung_paid_date` 채워져 있으면 그 값 사용 (자료의 실제 결제일)
- IBK 기업은행: import 시 `created_at`에 자료의 실제 입금일을 직접 저장 ([admin-donation-confirm.ts:284](../../netlify/functions/admin-donation-confirm.ts#L284)) — fallback이 곧 결제일
- 토스 일시·정기: 결제 시점에 INSERT되므로 `created_at` ≈ 결제일
- 계좌이체·수동: 동일

drizzle 사용 시 같은 sql 객체를 한 쿼리에 재사용하면 prepared statement 충돌 — 호출 시점마다 새 인스턴스 생성하는 함수 패턴(`paidAt = () => sql\`...\``) 또는 인라인 사용. 현재 구현은 변수에 한 번 넣고 한 쿼리당 같은 인스턴스 1회씩만 사용해서 문제 회피.

---

## 3. 변경 파일 (총 9개)

### 3-A. 어드민 합산·정렬 (6곳)

| 파일 | 영향 |
|---|---|
| [admin-finance-income-summary.ts](../../netlify/functions/admin-finance-income-summary.ts) | 수입 현황 그래프·KPI — 채널별·월별·후원자수 모두 결제일 기준 |
| [admin-finance-report.ts](../../netlify/functions/admin-finance-report.ts) | 재무 보고서 — 연간/분기/월간 모두 결제일 기준 |
| [admin-stats.ts](../../netlify/functions/admin-stats.ts) | 대시보드 12개월 트렌드 막대 |
| [admin-me.ts](../../netlify/functions/admin-me.ts) | 어드민 진입 시 "이번 달 후원" KPI |
| [admin-donations-export.ts](../../netlify/functions/admin-donations-export.ts) | 후원 엑셀 내보내기 — 기간 필터·정렬 결제일 기준 |
| [admin-ai.ts](../../netlify/functions/admin-ai.ts) | 이탈 위험 분석 — 최근 90일 활동 판정 |

### 3-B. 효성 import 누락 보강 (1곳)

| 파일 | 변경 |
|---|---|
| [admin-hyosung-import.ts:268](../../netlify/functions/admin-hyosung-import.ts#L268) | 구 직접 import 경로가 메모에만 적던 결제일을 `hyosungPaidDate` 컬럼에도 저장 |

### 3-C. 후원자 화면·영수증 (2곳)

| 파일 | 변경 |
|---|---|
| [donations-mine.ts](../../netlify/functions/donations-mine.ts) | 마이페이지 응답에 `paidDate` 필드 추가 + 정렬 결제일 기준 |
| [donation-receipt.ts:139](../../netlify/functions/donation-receipt.ts#L139) | PDF 후원일에 결제일 우선 적용 (R2 캐시된 옛 PDF는 영구 보존, `regenerate=1`로 재생성 시 새 날짜) |

---

## 4. 라이브 회귀 검증 결과

### 4-A. SQL 동작 검증 (운영 DB)
- `?year=2026` → 39만/16건, byChannel·monthlyTrend·donorCount 모두 정상 응답
- `?year=2025` → 60002원/5건 정상
- 채널별·월별·후원자수 합계 일관 ✓

### 4-B. 효성 결제일 채움 분포 (운영 DB 2026 현황)

| 채널 | 총 건수 | hyosungPaidDate 채워짐 | NULL |
|---|---|---|---|
| hyosung_cms | 7 | 0 | 7 |
| kcp | 6 | 0 | 6 |
| toss | 2 | 0 | 2 |
| manual | 1 | 0 | 1 |

→ **이번 fix 자체는 정상 작동(SQL 문법·집계 OK)하지만, 운영 DB의 옛 효성 데이터는 모두 `hyosungPaidDate`가 NULL이라 fallback인 createdAt이 그대로 사용되어 그래프 모양에 즉각 변화 없음**. 다음 효성 import부터 hyosungPaidDate가 채워져 그래프에 정확히 분산됨.

### 4-C. 옛 데이터 백필 (별도 라운드 권장)

`memo` 컬럼에 "(약정일: N일, **결제일: YYYY-MM-DD**)" 형식으로 결제일이 텍스트로 적혀 있음. 1회용 마이그레이션으로 추출·백필 가능:

```sql
UPDATE donations
SET hyosung_paid_date = (regexp_match(memo, '결제일: (\d{4}-\d{2}-\d{2})'))[1]::timestamp
WHERE pg_provider = 'hyosung_cms'
  AND hyosung_paid_date IS NULL
  AND memo ~ '결제일: \d{4}-\d{2}-\d{2}';
```

이번 fix 범위 외. 다음 라운드에 별도 처리 권장.

---

## 5. 의도된 한계

- **R2에 캐시된 옛 영수증 PDF**: 영구 보존 (한 번 발급된 영수증은 동일 일관성 보장 정책). 후원자가 강제 재발급 요청하면 어드민이 `regenerate=1`로 새 날짜 PDF 발급 가능.
- **토스 결제 승인 정확 시각**: 안 3 범위. 향후 토스 confirm API의 `approvedAt` 캡처 + 별도 컬럼 추가는 다음 라운드.
- **IBK 전용 컬럼 신설**: 안 3 범위. 현재는 `created_at`이 곧 입금일 역할이라 정확하지만 의미적으로 분리는 다음 라운드.

---

## 6. Phase 8 분배 영향

이 fix는 코드만 변경(마이그 0회), Phase 8 알림 인프라와 영향 영역 분리 — A·B·D 어떤 워크트리와도 충돌 없음. main에 안전히 머지 가능.
