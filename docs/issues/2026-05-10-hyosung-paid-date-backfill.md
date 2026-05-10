# 옛 효성 데이터 결제일 백필 (별도 라운드)

> **발견**: 2026-05-10 / C 채팅 (Q12 fix 완료 보고)
> **심각도**: 🟡 Medium — 기능 동작은 정상, 그래프 정확도만 영향
> **상태**: ✅ 해결 (2026-05-11) — 옛 자료 모두 삭제 후 Swain이 계약 관리 → 수납 파일 순서로 재 import 진행 예정. 본질적 해결 (자동 백필 시도 3차 모두 키 부족, 데이터 자체 재 import가 가장 깔끔)

---

## 2026-05-11 보강 진단 응답 (Swain 재호출)

```json
{
  "state": {"hyosung_total":44, "hyosung_null_total":44,
            "regex_v1_match":0, "regex_v2_match":0, "regex_any_date_match":1},
  "join_via_billing_id":   {"join_match_via_billing_id":0, "join_match_with_paydate":0},
  "join_via_member_month": {"join_match_via_member_month":0, "join_match_with_paydate":0},
  "provider_distribution": [{"pg_provider":"hyosung_cms","cnt":44}],
  "hyosung_billings_state": {"total":41, "with_paydate":41, "linked":0},
  "samples": [10건 — billing_id·billing_month·member_no 거의 NULL]
}
```

### 핵심 분석

- **효성 결제 후원 행 44건** — 전부 결제일 NULL
- **정규식 매칭** — v1 0건 / v2 0건 / 어떤 날짜 패턴이라도 1건 (실질 0)
- **billing_id로 raw 연결** — 0건 (후원 행에 billing_id 안 채워짐)
- **회원번호+청구월로 raw 연결** — 0건 (둘 다 안 채워짐)
- **효성 청구 raw 테이블** — 41건 존재, 결제일 41건 모두 채워짐, 후원과 연결된 건 **0건**
- **샘플 10건** — `memo_excerpt` 빈 문자열 또는 "[효성 CSV 확정]" 텍스트만, 회원번호 일부만(62번 등)

### 결론

**자동 백필 경로 없음**.
- 정규식: 매칭 0
- billing_id join: 매칭 0
- member_no + month join: month가 NULL이라 불가
- raw 테이블에 결제일은 있지만 후원 행과의 연결고리(billing_id)가 끊어져 있음

원인 추정: 옛 효성 import 흐름에서 raw 테이블 INSERT 후 후원 행 INSERT 시 billing_id를 FK로 안 적었음. 또는 두 INSERT가 별도 트랜잭션이라 매칭 키가 없음.

### 처리 옵션

| 안 | 내용 | 영향 |
|---|---|---|
| **D안 (백필 포기)** | 본 이슈 닫기, 현재 fallback(시스템 입력 시각)을 paid_date로 영구 사용. 마이그 파일 삭제 | 그래프 분산 정확도 약간 손실 (44건만, 사용자 영향 0). 코드 단순 |
| **수동 매핑** | 운영자가 raw 41건과 후원 44건을 회원·금액·시기 기준으로 직접 매칭, 매칭 결과 수동 INSERT | 시간 소요 1~2시간, 매칭 가능성도 낮음 (raw 41 vs 후원 44 차이) |
| **created_at 동등 채우기** | 후원 행의 created_at을 paid_date에 복사 | fallback과 동일 — 의미 없는 백필. 이름만 paid_date라 헷갈림 유발 |

**메인 추천 — D안**. 자동 백필 경로 0이고, 운영자가 손으로 매칭해도 raw·후원 건수 차이로 100% 매칭 불가. 사용자 영향 0(fallback이 그래프 그리는 데 충분히 가까움). 옛 효성 데이터 분석 정확도 손실은 인정.

다음 라운드(R3 또는 별도)에서 효성 import 코드에 billing_id FK 추가하여 신규 import는 정상 join 가능하게 조치.

---

## 2026-05-10 진단 결과 (Swain 호출)

`/api/migrate-hyosung-paid-date-backfill` 진단 모드 응답:

```json
{"ok":true,"mode":"diagnostic","state":{"candidates":0,"hyosung_null_total":44,"hyosung_total":44}}
```

**해석**: 효성 결제 전체 44건 모두 `hyosung_paid_date` NULL. 그 중 memo 컬럼에 "결제일: YYYY-MM-DD" 패턴 매칭되는 행 0건. 본 이슈 리포트가 가정한 "옛 7건" 범위가 아니라 효성 데이터 전체에 NULL — 가정 자체가 잘못됨.

**원인 후보 3가지**:
1. memo 형식이 다름 — "결제일:" 텍스트 자체가 없거나 다른 표현
2. 최근 import도 paid_date를 안 채우고 있을 가능성 — import 코드 자체 fix 필요
3. C가 Q12 fix 시점에 본 "7건"은 다른 조건 또는 다른 시점

**다음 액션** (옵션 A — C 다음 세션):
- memo 컬럼 샘플 10건 조회 → 실제 텍스트 형식 파악
- 효성 import 코드(`netlify/functions/admin-finance-hyosung-import-*` 또는 동급) 검증 — paid_date 채우기 로직 존재 여부
- 결과에 따라:
  - memo 패턴 다름 → 정규식 보강 + 마이그 갱신 + 재호출
  - import 코드 누락 → 코드 fix + 백필 마이그 별도
  - 다른 컬럼(`created_at`, `donated_at`, 효성 CSV 별도 컬럼)에서 추출 가능 → 마이그 정규식 대신 컬럼 매핑 변경

마이그 파일 자체는 보존(멱등). 진단 마치면 정규식·소스 컬럼 결정 후 갱신.

---

## 2026-05-10 진단 보강 + import 코드 분석 (C 채팅 Q-진단)

### 보강된 진단 함수 (메인 머지 후 Swain 재호출 필요)

`/api/migrate-hyosung-paid-date-backfill` (GET, 인증 불필요) 응답을 다음으로 보강:

| 필드 | 의미 |
|---|---|
| `state.hyosung_total` | 효성 결제 전체 (`hyosung_cms` + `hyosung` 두 분류 합집합) |
| `state.hyosung_null_total` | 그 중 결제일 컬럼 비어있는 행 수 |
| `state.regex_v1_match` | 1차 정규식 `결제일: YYYY-MM-DD` 매칭 행 수 (이미 0 확인됨) |
| `state.regex_v2_match` | 2차 정규식 — 한글 콜론·공백·구분자 변형 허용 |
| `state.regex_any_date_match` | memo에 어떤 날짜 패턴이라도 있는 행 수 |
| `join_via_billing_id` | 효성 청구 raw 테이블 직접 연결로 결제일을 끌어올 수 있는 행 수 |
| `join_via_member_month` | 회원번호+청구월 조합으로 효성 청구 raw에서 결제일을 끌어올 수 있는 행 수 |
| `provider_distribution` | 옛 `hyosung` 분류와 신 `hyosung_cms` 분류의 행 수 (옛 데이터일수록 분류 다를 수 있음) |
| `hyosung_billings_state` | 효성 청구 raw 테이블 자체 상태 (전체·결제일 채워진 수·후원 행 연결된 수) |
| `samples` | 결제일 비어있는 행 10건 샘플 — id, 회원번호, 청구월, memo 200자, 효성 청구 연결 ID, 입력시각 |

이 응답을 받으면 다음 3가지가 결정 가능:
1. memo 형식이 어떻게 생겼는지 (정규식 보강 가능 여부)
2. 효성 청구 raw 테이블 직접 연결로 결제일을 가져올 수 있는지 (가장 안전한 경로)
3. 옛 데이터와 신 데이터의 분류명이 다른지 (마이그 WHERE 조건 보강)

### import 코드 분석 결과

효성 후원이 실제로 SIREN DB에 들어가는 경로 4가지를 모두 정독한 결과:

| 경로 | 동작 | 결제일 컬럼 채움 |
|---|---|---|
| 신 import (D2 파서) | CSV → 효성 청구 raw → 후원 행 직접 INSERT | 자료에 결제일 텍스트가 있을 때만 채움 |
| 신 import (D2-별경로) | CSV → 효성 청구 raw → 매칭 후 별도 확정 흐름 | 확정 시 자료의 결제일 그대로 복사 |
| 구 import (수납 일괄) | 효성 자동등록·수납 묶음 → 후원 행 직접 INSERT | 자료에 결제일 텍스트가 있을 때만 채움 + memo에도 "결제일: YYYY-MM-DD" 적음 |
| 구 import (계약·청구) | CSV → 효성 청구 raw 적재 → 별도 확정으로 후원 행 생성 | 확정 시 자료의 결제일 그대로 복사 |

→ 모든 경로가 **자료의 결제일 텍스트가 있을 때만** 결제일 컬럼을 채운다. 옛 효성 자료에 결제일이 비어있는 채로 import된 게 44건 NULL의 원인.

→ 코드 결함은 없음. 자료 자체의 결제일이 누락되었거나, 효성이 결제일을 다른 컬럼·다른 표현으로 제공했을 가능성이 큼.

→ 핵심 회복 경로는 **효성 청구 raw 테이블에 결제일이 별도 컬럼으로 살아있는지**. 보강된 진단 응답의 `hyosung_billings_state.with_paydate`와 `join_via_*.join_match_with_paydate`를 보면 결정 가능.

### 다음 액션 (C 다음 세션, Swain 응답 받은 후)

응답 시나리오별 처리:

| 응답 패턴 | 결정 |
|---|---|
| `join_via_billing_id.with_paydate` 또는 `join_via_member_month.with_paydate`가 ≥1 | **A안 (권장)**: 마이그 본문을 정규식 → 효성 청구 raw join 으로 교체. 가장 안전 |
| 위가 0이고 `regex_v2_match` 또는 `regex_any_date_match`가 ≥1 | **B안**: 보강된 정규식으로 마이그 본문 교체 |
| 모두 0이고 `samples`에서 다른 패턴이 보임 | **C안**: 샘플을 보고 실제 텍스트 형식에 맞춘 정규식 결정 |
| 모두 0이고 텍스트도 없음 | **D안**: 백필 불가 결정. 그래프 fallback(시스템 입력 시각) 그대로 두기로 합의 |

### 보강 마이그 호출 URL

`https://tbfa-siren-cms.netlify.app/api/migrate-hyosung-paid-date-backfill` (GET, 인증 불필요)

응답이 길어졌으니 Swain은 응답 본문 전체를 메인 채팅에 전달. 메인이 다음 세션에서 위 시나리오대로 결정.

---

## 배경

Q12 fix(수입 집계 기준일을 실제 결제일로 변경)는 코드와 SQL 모두 정상 동작. 다만 **운영 DB의 옛 효성 후원 7건은 결제일 컬럼(hyosung_paid_date)이 NULL**이라 fallback으로 시스템 입력 시각이 사용된다.

영향:
- 다음 효성 import부터는 결제일 컬럼이 자동 채워져 그래프 정확
- 옛 7건은 그래프 모양 즉각 변화 없음 (fallback 작동 — 사용자에 깨짐 없음)
- 단, 그래프 분산이 정확해지려면 7건 백필 필요

---

## 백필 방법

C가 제공한 1회용 SQL — 효성 메모에 "결제일: YYYY-MM-DD" 텍스트가 남아있어 정규식으로 추출 가능:

```sql
UPDATE donations
SET hyosung_paid_date = (regexp_match(memo, '결제일: (\d{4}-\d{2}-\d{2})'))[1]::timestamp
WHERE pg_provider = 'hyosung_cms'
  AND hyosung_paid_date IS NULL
  AND memo ~ '결제일: \d{4}-\d{2}-\d{2}';
```

7건 모두 같은 패턴이라 한 번에 백필 가능.

---

## 처리 방안

### 옵션 A — 1회용 마이그레이션 (권장)

`netlify/functions/migrate-hyosung-paid-date-backfill.ts` 신규 작성:
- requireAdmin + GET ?run=1
- 위 SQL 실행 + 영향 받은 행 수 응답
- 멱등 보장 (이미 채워진 행은 건드리지 않음 — `IS NULL` 조건)
- 호출 성공 후 즉시 파일 삭제

### 옵션 B — Swain이 직접 DB SQL 실행

Neon 콘솔에서 SQL 직접 실행. 7건이라 수동도 가능.

### 옵션 C — 다음 라운드 작업으로 미루기

옛 효성 자료를 일괄 다시 import — 시간·복잡도 증가, 권장 X.

**메인 추천**: 옵션 A. C 채팅 또는 별도 채팅에 위임 (1회용 마이그 작성·푸시 → Swain 호출 → 파일 삭제 push).

---

## 시점

Phase 8 마무리·Phase 9 시작 사이의 짧은 작업이라 라운드 사이 끼워넣기 적합. 또는 Phase 10 시작 전 완료 권장.

---

## 참고

- Q12 fix 보고서: docs/verify/2026-05-10-q12-payment-date-basis.md (C 작성)
- Q12 fix 머지 커밋: c03c896
