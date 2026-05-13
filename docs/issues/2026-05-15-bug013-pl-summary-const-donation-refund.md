# BUG-013 (Critical, 회귀) — `pl-summary.ts` `donationRefund` const 잘못 선언

> **발견**: 2026-05-15, C 검증 라운드 R2
> **심각도**: Critical (tsc 컴파일 에러 + BUG-002 fix 회귀, P&L API 운영 시 500 가능)
> **영향**: 후원 환불 차감 무효화 → 손익계산서 후원 net 과대

---

## 1. 현상

`netlify/functions/admin-finance-pl-summary.ts:21`:

```typescript
let donationGross = 0;
const donationRefund = 0;           // ← const로 잘못 선언
```

line 70:

```typescript
for (const row of refundRows) {
  ...
  donationRefund += t;              // ← const에 += 불가
}
```

**tsc 결과**:
```
netlify/functions/admin-finance-pl-summary.ts(70,7): error TS2588:
  Cannot assign to 'donationRefund' because it is a constant.
```

## 2. 원인 추정

2026-05-14 C 검증 라운드 R1에서 작성한 BUG-002 fix(`b8180a6`)는 `let donationRefund = 0`이었음. 22-C 머지(`e46f69f` B + `a616772` A) 또는 그 직후 정리 과정에서 `let → const`로 변경됨.

`git blame netlify/functions/admin-finance-pl-summary.ts -L 21,21` 확인 권장. C 라운드 fix 커밋 후 누군가가 const로 변경한 것이 확실 (BUG-002 fix가 `let`을 명시했으므로).

## 3. 영향

- **Netlify esbuild 빌드**: 일반적으로 tsc 에러를 무시하고 런타임 JS로 변환. 런타임에 `TypeError: Assignment to constant variable.` 발생 시 P&L API 응답이 500.
- **try/catch 안 → console.warn 후 통과 가능**: `pl-summary.ts:51-74` try 블록 안이므로 catch에서 잡혀 `donationRefund` 값은 0 그대로. 결과적으로 BUG-002 fix(후원 환불 차감)가 무효 — 즉 BUG-002 부분 회귀.

운영 시 두 가지 시나리오:
1. **빌드 실패** → 배포 안 됨 → 이전 버전(BUG-002 있는 상태)로 운영
2. **빌드 성공 + 런타임 catch** → BUG-002 fix 무효 → 후원 환불 차감 안 됨

어느 쪽이든 BUG-002가 부활.

## 4. fix 제안

```diff
- const donationRefund = 0;
+ let donationRefund = 0;
```

1 글자 변경. 추가 영향 없음.

## 5. 회귀 방지 제안

- 신규 머지 직전 `npx tsc --noEmit | grep -v "기존 무관 에러"` 의무 (CLAUDE.md §13 체크리스트에 명시되어 있지만 22-C 머지 시 누락)
- 또는 GitHub Actions에 tsc gate 추가 (`npx tsc --noEmit --skipLibCheck`)
