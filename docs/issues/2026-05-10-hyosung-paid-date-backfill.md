# 옛 효성 데이터 결제일 백필 (별도 라운드)

> **발견**: 2026-05-10 / C 채팅 (Q12 fix 완료 보고)
> **심각도**: 🟡 Medium — 기능 동작은 정상, 그래프 정확도만 영향
> **상태**: 🟡 1차 마이그 가정 어긋남 — 추가 진단 필요 (C 큐 Q-진단)

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
