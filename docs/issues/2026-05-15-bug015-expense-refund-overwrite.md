# BUG-015 (High, 22-C 신규) — 지출 환불도 누적이 아닌 덮어쓰기

> **발견**: 2026-05-15, C 검증 라운드 R2
> **심각도**: High (22-A BUG-001과 동일 패턴 반복)
> **영향**: 동일 지출에 환불 2회 등록 시 1차 환불액 사라짐 → 손익 산식 누적 오차

---

## 1. 현상

`netlify/functions/admin-expense-refund.ts:64`:

```typescript
updated = await db
  .update(expenses)
  .set({ refundAmount: Number(refundAmount), updatedAt: new Date() } as any)
  .where(eq(expenses.id, Number(id)))
  .returning();
```

`lib/ai-agent-tools.ts:3636-3641` (`tool_expenseRefund`):

```typescript
UPDATE expenses
   SET refund_amount = ${Number(refundAmount)},
       updated_at = NOW()
 WHERE id = ${Number(id)} AND status = 'approved'
```

둘 다 받은 값을 그대로 대입. 22-A BUG-001 fix 패턴(`currentRefund + incremental = newTotalRefund`)이 22-C 작업에 적용 안 됨.

## 2. 22-A 동일 패턴 fix 참조

`admin-revenue-refund.ts:60-83` (BUG-001 fix, commit `b8180a6`):

```typescript
const currentRefund = Number(rev.refundAmount) || 0;
const incremental   = Number(refundAmount);
const newTotalRefund = currentRefund + incremental;

if (newTotalRefund > Number(rev.amount)) {
  return new Response(JSON.stringify({
    ok: false,
    error: `누적 환불액이 원금을 초과합니다. 기존 ${currentRefund.toLocaleString("ko-KR")}원 + 신규 ${incremental.toLocaleString("ko-KR")}원 = ${newTotalRefund.toLocaleString("ko-KR")}원 > 원금 ...`,
    step: "validate_refund_total",
    currentRefund, incremental, amount: Number(rev.amount),
  }), { status: 400 });
}

updated = await db
  .update(otherRevenues)
  .set({ refundAmount: newTotalRefund, updatedAt: new Date() })
  ...
```

## 3. fix 제안

### `admin-expense-refund.ts`

기존 단건 검증(`Number(refundAmount) > Number(exp.amount)`)을 누적 검증으로 교체:

```diff
- if (Number(refundAmount) > Number(exp.amount)) {
-   return new Response(JSON.stringify({ ok: false, error: "환불금액이 원금을 초과할 수 없습니다", ...}), { status: 400 });
- }
+ const currentRefund = Number(exp.refundAmount) || 0;
+ const incremental   = Number(refundAmount);
+ const newTotalRefund = currentRefund + incremental;
+ if (newTotalRefund > Number(exp.amount)) {
+   return new Response(JSON.stringify({
+     ok: false,
+     error: `누적 환불액(${newTotalRefund.toLocaleString("ko-KR")}원 = 기존 ${currentRefund.toLocaleString("ko-KR")}원 + 신규 ${incremental.toLocaleString("ko-KR")}원)이 원금(${Number(exp.amount).toLocaleString("ko-KR")}원)을 초과합니다`,
+     step: "validate_refund_total",
+   }), { status: 400 });
+ }
  ...
- .set({ refundAmount: Number(refundAmount), updatedAt: new Date() })
+ .set({ refundAmount: newTotalRefund, updatedAt: new Date() })
```

### `tool_expenseRefund` (AI 도구)

22-A `tool_revenueRefund` 패턴(`lib/ai-agent-tools.ts:3286-3329`) 그대로 복사:
- SELECT로 현재 refund_amount 조회
- 누적합 계산 + 원금 초과 검증
- dry-run preview에 기존·신규·합계 모두 노출
- rollbackData에 이전값 보존
- UPDATE는 `refund_amount = newTotalRefund` (가산값)

## 4. 회귀 방지 제안

- **이전 라운드 issues 정독 의무** (CLAUDE.md §14.1 명시 — 22-C B 채팅이 따랐는지 확인)
- 신규 라운드 설계 시 직전 라운드 issues 목록 1줄씩 메인이 사전 정독 + 비슷한 패턴 작업이면 트리거에 명시
