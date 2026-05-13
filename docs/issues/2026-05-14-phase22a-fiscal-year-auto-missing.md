# BUG-004 (High) — 매출 인식일과 회계연도 불일치 가능 (서버 자동 계산 누락)

> **발견**: 2026-05-14, C 검증 라운드
> **심각도**: High (회계연도 필터·집계 산식 신뢰성)

---

## 1. 현상

매출 등록 시 클라이언트가 `recognizedAt`(인식일)과 `fiscalYear`(회계연도)를 **모두** 보내고, 서버는 클라이언트 입력을 그대로 저장. 두 값 불일치 시(예: recognizedAt=2026-05-14, fiscalYear=2025) DB에 모순 데이터 INSERT.

이후 회계연도 필터(`fiscalYear=2025`)로 조회하면 2026년 5월 매출이 2025년으로 분류되어 손익 보고 오류.

## 2. 원인 위치

### API `admin-revenue-create.ts` line 23-26·50

```typescript
const { fiscalYear, recognizedAt, categoryId, amount, ... } = body;

if (!fiscalYear || !recognizedAt || !categoryId || !amount) {
  return ... "필수 항목 누락 (fiscalYear, recognizedAt, categoryId, amount)" ...
}
...
inserted = await db.insert(otherRevenues).values({
  fiscalYear: Number(fiscalYear),         // ← 클라이언트 입력값 사용
  recognizedAt: String(recognizedAt),
  ...
});
```

### AI 도구 `tool_revenueCreate` (line 3081-3104)

```typescript
const { fiscalYear, recognizedAt, categoryId, amount, ... } = args || {};
if (!fiscalYear || !recognizedAt || !categoryId || !amount) { ... }
...
INSERT INTO other_revenues (fiscal_year, recognized_at, ...)
VALUES (${Number(fiscalYear)}, ${String(recognizedAt)}::date, ...)
```

`fiscalYear` 필수 + 클라이언트 입력값 그대로.

## 3. 설계서 명세 위반

설계서 §2.2 마지막 줄:
> 서버에서 fiscalYear는 recognizedAt 연도로 자동 계산.

설계서 §10.2 (AI 도구 declaration):
```typescript
recognizedAt: { type: "STRING", description: "매출 인식일 YYYY-MM-DD (서버에서 회계연도 자동 계산)" }
```

설계서 §10.3 핸들러 패턴 예시:
```typescript
const fiscalYear = Number(recognizedAt.slice(0, 4));
```

설계서 §8.5 위험·주의사항:
> **fiscalYear 자동 계산** — recognizedAt 연도로 서버에서 결정. 클라이언트 입력값 무시

→ "클라이언트 입력값 무시" 명시 위반.

## 4. 제안 fix

### API
```typescript
const { recognizedAt, categoryId, amount, payerName, description, receiptUrl } = body;

if (!recognizedAt || !categoryId || !amount) {
  return new Response(JSON.stringify({ ok: false, error: "필수 항목 누락 (recognizedAt, categoryId, amount)" }), { status: 400 });
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(recognizedAt))) {
  return new Response(JSON.stringify({ ok: false, error: "recognizedAt YYYY-MM-DD 형식" }), { status: 400 });
}
const fiscalYear = Number(String(recognizedAt).slice(0, 4));
...
inserted = await db.insert(otherRevenues).values({
  fiscalYear,    // ← 서버 계산
  recognizedAt: String(recognizedAt),
  ...
});
```

`admin-revenue-update.ts`에서도 recognizedAt 변경 시 fiscalYear 재계산 (현재는 fiscalYear도 별도로 받음 — 불일치 가능).

### AI 도구
declaration에서 `fiscalYear` 파라미터 **제거** (서버 계산), required는 `recognizedAt, categoryCode/Id, amount` 3종만.

## 5. 회귀 영향

`migrate-phase22a-c-seed.ts` 시드 7건은 fy·at이 의도적으로 일치(예: fy=2026·at=2026-04-15) → 시드 데이터는 무영향. 단 라이브 운영 중 클라이언트 버그·악의적 입력으로 불일치 발생 시 보고 수치 오염. fix 후 unit 검증 1회 권장.
