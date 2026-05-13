# BUG-002 (Critical) — 손익계산서가 후원 환불을 차감하지 않음

> **발견**: 2026-05-14, C 검증 라운드
> **심각도**: Critical (핵심 산식 오류 → 모든 손익 보고 과대)
> **영향 범위**: 모든 회계연도의 후원 net 산정 / 순이익 과대 / Q14 검증 실패

---

## 1. 현상

`/api/admin-finance-pl-summary?fiscalYear=2026` 응답:

```json
{
  "revenue": {
    "donations": { "gross": 50000000, "refund": 0, "net": 50000000 },
    ...
  }
}
```

`donations.refund` 항상 0. `donations` 테이블에 `status='refunded'`인 행이 존재해도 차감되지 않음.

기대(설계서 §2.7 산식):
> 후원 net = `donations` status='completed' 합계 - status='refunded' 합계

## 2. 원인 위치

### API `admin-finance-pl-summary.ts` line 25-48

```typescript
const donRows = await db
  .select({ ... })
  .from(donations)
  .where(
    and(
      eq(donations.status, "completed"),   // ← completed만 SELECT, refunded 미집계
      ...
    )
  )
  .groupBy(...);

for (const row of donRows) {
  ...
  donationByMonth[m].gross = g;
  donationGross += g;
}
// donationRefund 0으로 유지
```

쿼리에 `donations.status='refunded'` 두 번째 집계 누락. line 122의 `donationNet = donationGross - donationRefund`도 `donationRefund=0` 이므로 `donationGross`와 동일.

월별 분해(`monthly[]`)에서도 동일 누락 — `revenue = donationByMonth[m].gross + otherByMonth[m].gross - otherByMonth[m].refund` (line 116). 후원 환불은 차감 안 됨.

### AI 도구 `tool_plSummary` line 3243-3290

```typescript
const donR: any = await db.execute(sql`
  SELECT COALESCE(SUM(amount), 0) AS gross
    FROM donations
   WHERE status = 'completed'
     AND EXTRACT(YEAR FROM COALESCE(hyosung_paid_date, created_at)) = ${Number(fiscalYear)}
`);
const donGross = Number(...);
...
revenue: {
  donations: { gross: donGross, refund: 0, net: donGross },   // ← refund 0 하드코딩
  ...
}
```

동일하게 `refund: 0` 하드코딩.

## 3. 설계서 명세 위반

설계서 §2.7 산식 (응답 예시):
```json
"donations": { "gross": 50000000, "refund": 500000, "net": 49500000 }
```

설계서 §0 결정사항:
> 환불 처리 — **net 방식** — 환불액을 매출에서 차감. `donations` 테이블의 `status='refunded'`는 자동 제외

→ "자동 제외"는 status=completed 필터로 일부 달성되나, refunded 행이 별도 집계되어 응답의 `donations.refund`에 표시되어야 한다는 §2.7 사양과 어긋남. 결과적으로 `net` 자체는 `completed` 합계와 같지만 **사용자에게 환불액이 가시화되지 않음** → 회계 보고 누락.

## 4. 제안 fix

### API `admin-finance-pl-summary.ts`

donations 집계 쿼리 1회 추가:

```typescript
// 후원 환불 집계 (status='refunded')
let donationRefund = 0;
const donationRefundByMonth: Record<number, number> = {};
for (let m = 1; m <= 12; m++) donationRefundByMonth[m] = 0;

try {
  const refundRows = await db
    .select({
      month: sql<string>`EXTRACT(MONTH FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}))`,
      total: sql<string>`COALESCE(SUM(${donations.amount}), 0)`,
    })
    .from(donations)
    .where(
      and(
        eq(donations.status, "refunded"),
        sql`EXTRACT(YEAR FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt})) = ${fiscalYear}`
      )
    )
    .groupBy(sql`EXTRACT(MONTH FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}))`);
  for (const row of refundRows) {
    const m = Number(row.month);
    const t = Number(row.total);
    donationRefundByMonth[m] = t;
    donationRefund += t;
  }
} catch (err: any) { console.warn("[pl-summary] 후원 환불 집계 실패", err); }
```

monthly[] 계산에도 `donationRefundByMonth[m]` 차감 반영:
```typescript
const revenue = donationByMonth[m].gross - donationRefundByMonth[m] + otherByMonth[m].gross - otherByMonth[m].refund;
```

### AI 도구 핸들러

`tool_plSummary`에 동일 SUM 쿼리 추가, `donations: { gross, refund: donRefund, net: donGross - donRefund }` 갱신.

## 5. 회귀 영향

운영 데이터에 `donations.status='refunded'`가 있으면 즉시 fix 시 net이 감소 (정상화). 기존 보고서·KPI 화면이 이 값을 그대로 표시했다면 운영 수치 변동 발생 — Swain께 사전 안내 권장.
