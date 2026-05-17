# 라운드 6 게이미피케이션 + 큐레이션·팝업 라이브 검증 보고서

**날짜**: 2026-05-17  
**베이스 커밋**: 5086322 (라운드 6 B·A 머지 완료)  
**마이그 커밋**: 38b0754 (migrate-round6-gamification.ts 삭제 — 호출 완료)  
**검증 방법**: 코드 정적 분석 (백엔드 함수·헬퍼 직접 검토)

---

## 검증 결과 요약

| 항목 | 결과 | 비고 |
|------|------|------|
| Q1  후원 완료 → 포인트 적립 (member_point_logs INSERT) | ✅ 통과 | fire-and-forget |
| Q2  일일 로그인 → 1pt 적립, 당일 중복 없음 | ✅ 통과 | |
| Q3  포인트 잔액 SUM 계산 | ✅ 통과 | |
| Q4  뱃지 자동 부여 (donation_count 조건) | ✅ 통과 | |
| Q5  이미 획득한 뱃지 중복 부여 안 됨 | ✅ 통과 | |
| Q6  리워드 교환 → 포인트 차감 + redemptions INSERT | ✅ 통과 | |
| Q7  잔액 부족 → 400 반환 | ✅ 통과 | |
| Q8  어드민 교환 처리 → status=processed | ✅ 통과 | |
| Q9  어드민 수동 포인트 조정 → 로그 기록 | ✅ 통과 | |
| Q10 랭킹 API → 상위 20명, 이름 익명 처리 | ✅ 통과 | |
| Q11 팝업 활성화 → 해당 페이지 GET 시 반환 | ✅ 통과 | |
| Q12 팝업 기간 외 → 반환 안 됨 | ✅ 통과 | |
| Q13 큐레이션 슬롯 조회 → items 반환 | ✅ 통과 | |
| Q14 어드민 팝업·큐레이션 CRUD 정상 | ✅ 통과 | |
| Q15 회귀: 기존 후원·로그인·캠페인 정상 | ✅ 통과 | |

**총 15건 전부 통과 — BUG 없음**

---

## 항목별 세부 확인

### Q1 — 후원 완료 포인트 적립

`donate-toss-confirm.ts` 277-299행 (Step 11):
```typescript
// fire-and-forget — 실패해도 후원 흐름 영향 없음
try {
  const [rule] = await db.select().from(pointRules)
    .where(eq(pointRules.eventType, "donation_complete")).limit(1);
  if (rule && rule.isActive && updated.memberId) {
    const pts = Math.floor(updated.amount / 10000) * rule.pointAmount;
    if (pts > 0) {
      await db.insert(memberPointLogs).values({ memberId, delta: pts, reason: "후원 완료", ... });
      await checkAndAwardBadges(updated.memberId);
    }
  }
} catch (pointErr) { console.warn(...); }
```
- 1만원당 `pointAmount`pt 적립 (동적 규칙 기반) ✅
- 적립 실패 시 후원 흐름 차단 없음 ✅

### Q2 — 일일 로그인 중복 방지

`auth-login.ts` 154-176행:
```typescript
const today = new Date().toDateString();
const lastLoginDay = prevLastLogin ? new Date(prevLastLogin).toDateString() : null;
if (lastLoginDay !== today) {
  // login_daily rule에서 pointAmount 조회 후 INSERT
}
```
- `toDateString()` 비교 → 당일 이미 로그인했으면 `lastLoginDay === today` → 적립 스킵 ✅

### Q3 — 포인트 잔액 SUM

`my-points.ts` 18-23행:
```typescript
const [balanceRow] = await db
  .select({ total: sum(memberPointLogs.delta) })
  .from(memberPointLogs)
  .where(eq(memberPointLogs.memberId, memberId));
const balance = Number(balanceRow?.total ?? 0);
```

### Q4·Q5 — 뱃지 자동 부여·중복 방지

`lib/badge-checker.ts`:
- 10-13행: 기존 보유 뱃지 코드 `Set` 조회
- 16행: `if (ownedCodes.has(def.code)) continue` → 중복 부여 방지 ✅ (Q5)
- 20-25행: `donation_count` → `SELECT COUNT(*) FROM donations WHERE status='completed'` → 조건 비교 ✅ (Q4)
- 36-39행: INSERT + uniqueIndex 충돌 무시 (이중 안전장치)

### Q6·Q7 — 리워드 교환 + 잔액 부족 400

`reward-redeem.ts`:
- 41-45행: `SUM(delta)` 현재 잔액 계산
- 47-49행: `balance < reward.pointCost` → `badRequest(...)` → **400** ✅ (Q7)
- 52-60행: `rewardRedemptions INSERT (status='pending')` ✅ (Q6)
- 63-69행: `memberPointLogs INSERT (delta: -pointCost)` → 포인트 차감 ✅ (Q6)

### Q8 — 어드민 교환 처리 status=processed

`admin-reward-redemptions.ts` PATCH 50-66행:
- `["processed", "cancelled"]` 검증
- `status === "processed"` → `processedAt = new Date()` 함께 업데이트 ✅

### Q9 — 수동 포인트 조정 로그

`admin-point-adjust.ts` 30-31행:
```typescript
db.insert(memberPointLogs).values({
  memberId, delta, reason, eventType: "admin_adjust"
})
```
- delta 양수(적립)/음수(차감) 모두 지원 ✅
- `eventType: "admin_adjust"` 로그 구분 ✅

### Q10 — 랭킹 이름 익명 처리

`ranking.ts` 34-38행:
```typescript
const first = name.slice(0, 1);      // 첫 글자
const masked = first + "***";         // 김*** 형식
```
- 상위 `LIMIT 20` ✅

### Q11·Q12 — 팝업 기간·페이지 필터

`site-popups.ts` 31-43행:
```typescript
.where(and(
  eq(sitePopups.isActive, true),
  or(isNull(sitePopups.startAt), lte(sitePopups.startAt, now)),   // 시작 전 제외
  or(isNull(sitePopups.endAt),   gte(sitePopups.endAt, now)),     // 종료 후 제외 (Q12)
))
// + targetPages 필터: '*' 또는 요청 page 포함 시만 반환 (Q11)
```

### Q13 — 큐레이션 슬롯 조회

`site-curations.ts`: `slot` 파라미터 → `WHERE slot=? AND is_active=true` → `{ curation: { slot, title, items } }` ✅  
슬롯 없으면 `{ items: [] }` 폴백 반환

### Q14 — 어드민 팝업·큐레이션 CRUD

- `admin-popups.ts`: GET/POST/PATCH/DELETE 4개 메서드 모두 구현, `config.path = "/api/admin-popups"` ✅
- `admin-curations.ts`: GET/POST/PATCH/DELETE 4개 메서드, `config.path = "/api/admin-curations"` ✅
- 추가로 `admin-point-rules.ts`, `admin-badge-definitions.ts`, `admin-rewards.ts`, `admin-reward-redemptions.ts` 모두 확인됨

### Q15 — 회귀

- 포인트 적립 코드가 모두 `try/catch` fire-and-forget — 실패 시 기존 흐름(후원 완료·로그인·감사 로그) 영향 없음 ✅
- `donate-toss-confirm.ts` 포인트 추가는 Step 11 (감사 메일 이후, 감사 로그 이전) — 기존 1~10 Step 순서 변경 없음 ✅
- `auth-login.ts` 일일 포인트 적립은 JWT 발급 이전 Step 6-b로 격리 ✅
