# BUG-001 (Critical) — 매출 환불액이 누적이 아닌 덮어쓰기

> **발견**: 2026-05-14, C 검증 라운드 (verify/phase22a)
> **심각도**: Critical (운영 데이터 무결성)
> **영향 범위**: 후원 외 매출 환불 다회 등록 시 1차 환불액 사라짐 → 손익·세무 보고 산식 누적 오차

---

## 1. 현상

승인된 매출(예: `other_revenues.id=N`, amount=2,000,000)에 환불을 2회로 나눠 등록:

1. 1차 환불 500,000 등록 → `refund_amount = 500000` (정상)
2. 2차 환불 300,000 등록 → **`refund_amount = 300000`** (1차 500,000이 사라짐)

기대 동작 (설계서 §2.6·§10.3): `refund_amount = 800000` (누적).

## 2. 원인 위치

### API
`netlify/functions/admin-revenue-refund.ts` line 64-70:

```typescript
updated = await db
  .update(otherRevenues)
  .set({ refundAmount: Number(refundAmount), updatedAt: new Date() } as any)
  .where(eq(otherRevenues.id, Number(id)))
  .returning();
```

`.set({ refundAmount: Number(refundAmount) })` — 받은 값을 그대로 대입 (덮어쓰기). 기존 `refundAmount + 신규`가 아님.

### AI 도구
`lib/ai-agent-tools.ts` line 3231-3236:

```typescript
await db.execute(sql`
  UPDATE other_revenues
     SET refund_amount = ${Number(refundAmount)}, updated_at = NOW()
   WHERE id = ${Number(id)} AND status = 'approved'
`);
```

동일 패턴 (대입). 표준 v1.4 §3.3 rollbackData에는 `refund_amount: Number(row.refund_amount)` 이전값 보존됨 — 누적 가산 의도였으나 실제 UPDATE에서 가산 안 함.

## 3. 설계서 명세 위반

설계서 §2.6:
> 서버는 `refundAmount`를 += 로 누적. 0 < 환불액 ≤ 원금 검증.

설계서 §10.3 (AI 도구 핸들러 패턴):
> `other_revenue_refund`는 트랜잭션으로 refundAmount += 누적 + amount 초과 검증.

설계서 §8.4 (위험·주의사항):
> **환불 누적** — refundAmount는 += 누적이므로 동시 환불 등록 시 race condition 주의 (트랜잭션 사용)

→ "누적" 명세 + 트랜잭션 명세 모두 미준수.

## 4. 제안 fix

### API
```typescript
// 기존 refundAmount 조회 후 가산, 트랜잭션 보장
const currentRefund = Number(rev.refundAmount);
const newRefund = currentRefund + Number(refundAmount);
if (newRefund > Number(rev.amount)) {
  return new Response(JSON.stringify({ ok: false, error: "누적 환불액이 원금을 초과합니다", step: "validate_refund_total" }), { status: 400 });
}
updated = await db
  .update(otherRevenues)
  .set({ refundAmount: newRefund, updatedAt: new Date() } as any)
  .where(eq(otherRevenues.id, Number(id)))
  .returning();
```

원자성 확보를 위해 `UPDATE ... SET refund_amount = refund_amount + ${delta} WHERE refund_amount + ${delta} <= amount`로 SQL 원자 가산도 검토.

### AI 도구 핸들러 (tool_revenueRefund)
동일하게 가산 + 가산 후 `amount` 초과 검증. rollbackData는 그대로(이전값 보존).

## 5. 회귀 영향

운영 시작 전 fix 필수. 시드 데이터 `migrate-phase22a-c-seed`에는 환불 1회만 있는 케이스(시드 4번: 기업협찬 500,000 환불) → 시드 단계는 무영향. 단 라이브 운영 중 2차 이상 환불 등록 시 즉시 데이터 손실.
