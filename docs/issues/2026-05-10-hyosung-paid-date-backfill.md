# 옛 효성 데이터 결제일 백필 (별도 라운드)

> **발견**: 2026-05-10 / C 채팅 (Q12 fix 완료 보고)
> **심각도**: 🟡 Medium — 기능 동작은 정상, 그래프 정확도만 영향
> **상태**: ⏸ 별도 라운드 대기

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
