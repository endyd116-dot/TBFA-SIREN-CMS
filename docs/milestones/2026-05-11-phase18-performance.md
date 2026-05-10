# Phase 18 — API 응답 캐싱 + 느린 쿼리 튜닝

> 설계 확정일: 2026-05-11
> 담당: B(백) + A(없음 — 프론트 변경 없음)
> 선행 조건: Phase 16·17 머지 완료

---

## §0 요구사항 확정

| 항목 | 결정 |
|---|---|
| 캐싱 방식 | Netlify Blobs store (TTL 수동 관리 — expires 필드) |
| 캐시 TTL | 통계/집계 API: 10분 / KPI 대시보드: 5분 |
| 캐시 무효화 | 후원·회원 데이터 변경 API 완료 시 해당 캐시 키 삭제 (선택적) / TTL 만료 자동 갱신 기본 |
| 튜닝 대상 | ① admin-donations stats 집계 6→1 쿼리 / ② admin-donation-dashboard 7→1 CTE 쿼리 / ③ admin-members-source-kpi 캐싱 |
| 신규 테이블 | 없음 (마이그레이션 불필요) |
| 신규 lib | lib/cache.ts — getCache / setCache / deleteCache 헬퍼 |
| 프론트 변경 | 없음 |

---

## §1 DB 설계

신규 테이블 없음. 마이그레이션 불필요.

---

## §2 API 명세

### 2.1 수정 대상 함수 3개

| 함수 | 경로 | 변경 내용 |
|---|---|---|
| `admin-donations.ts` | GET `/api/admin-donations` | stats 집계 6개 → CASE WHEN 1쿼리 통합 |
| `admin-donation-dashboard.ts` | GET `/api/admin-donation-dashboard` | 7개 순차 쿼리 → WITH CTE 통합 + Blobs 캐싱(5분 TTL) |
| `admin-members-source-kpi.ts` | GET `/api/admin-members-source-kpi` | Blobs 캐싱(10분 TTL) 추가 |

### 2.2 신규 파일 1개

**lib/cache.ts** — Netlify Blobs 기반 캐시 헬퍼

```typescript
// 캐시 조회: 만료되지 않은 경우 파싱 결과 반환, 만료/미존재 시 null
export async function getCache<T>(key: string): Promise<T | null>

// 캐시 저장: ttlSeconds 후 만료
export async function setCache(key: string, data: unknown, ttlSeconds: number): Promise<void>

// 캐시 삭제 (후원 생성 등 데이터 변경 시 호출)
export async function deleteCache(key: string): Promise<void>
```

### 2.3 응답 구조 (변경 없음)

기존 응답 키 변경 없음. 캐싱은 내부 구현이며 클라이언트에 투명(X-Cache 헤더 선택 추가).

#### admin-donations stats 집계 최적화 후 응답 (기존과 동일 키):
```json
{
  "ok": true,
  "stats": {
    "todayAmount": 150000,
    "monthAmount": 4500000,
    "failedCount": 3,
    "unissuedCount": 12,
    "refundedCount": 1,
    "cancelledCount": 0
  }
}
```

#### admin-donation-dashboard 캐싱 후 응답 (기존과 동일 키):
```json
{
  "ok": true,
  "kpi": { "totalMembers": 312, "activeMembers": 298, "regularDonors": 187 },
  "alerts": [ { "type": "unlinked_hyosung", "count": 4 } ],
  "cached": true
}
```

---

## §3 화면 설계

프론트 변경 없음 — B(백) 단독 작업.

---

## §4 검증 시나리오

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | `/api/admin-members-source-kpi` 첫 호출 | 200 응답, 데이터 정상, 캐시 miss (DB 조회) |
| Q2 | Q1 직후 동일 경로 재호출 | 200 응답, 동일 데이터, 캐시 hit (응답 ≤ 50ms) |
| Q3 | `/api/admin-donation-dashboard` 첫 호출 | 200 응답, kpi·alerts 키 존재 |
| Q4 | Q3 직후 재호출 | 200 응답, cached: true 또는 응답 시간 단축 확인 |
| Q5 | `/api/admin-donations` stats 조회 | 200 응답, stats.todayAmount·monthAmount 등 6개 필드 존재 |
| Q6 | 회귀 — 기존 donations 목록 페이지네이션 | 200 응답, items 배열 + total 정상 |
| Q7 | 회귀 — admin-members 목록 조회 | 200 응답, 회원 목록 정상 |

---

## §5 mock 데이터

프론트 변경 없음 — mock 불필요.

---

## §6 채팅 시작 프롬프트

### 6.1 B 채팅 — 백 구현

```
[B — Phase 18 API 응답 캐싱 + 느린 쿼리 튜닝]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase18-back ← 반드시 새로 생성 (git checkout -b feature/phase18-back origin/main)
설계서: docs/milestones/2026-05-11-phase18-performance.md

영역: netlify/functions/, lib/
금지: public/, assets/, db/schema.ts, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━ 신규 파일 1개 ━━━
lib/cache.ts — Netlify Blobs 기반 캐시 헬퍼
  import { getStore } from "@netlify/blobs";
  - getCache<T>(key): 만료 시 null 반환
  - setCache(key, data, ttlSeconds): expires 필드 포함 저장
  - deleteCache(key): 키 삭제

━━━ 수정 파일 3개 ━━━

1) netlify/functions/admin-donations.ts
   stats 집계 현재: SELECT 6번 (오늘합계·월합계·실패·미발행·환불·취소 각각)
   목표: 하나의 CASE WHEN 쿼리로 통합
   ```sql
   SELECT
     SUM(CASE WHEN status='completed' AND created_at >= $todayStart THEN amount ELSE 0 END) AS today_amount,
     SUM(CASE WHEN status='completed' AND created_at >= $monthStart THEN amount ELSE 0 END) AS month_amount,
     COUNT(CASE WHEN status='failed' THEN 1 END) AS failed_count,
     COUNT(CASE WHEN status='completed' AND receipt_issued=false THEN 1 END) AS unissued_count,
     COUNT(CASE WHEN status='refunded' THEN 1 END) AS refunded_count,
     COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled_count
   FROM donations
   ```
   응답 키 유지: stats.todayAmount·monthAmount·failedCount·unissuedCount·refundedCount·cancelledCount

2) netlify/functions/admin-donation-dashboard.ts
   현재: 7개 순차 db.execute 호출
   목표: WITH CTE로 통합 (가능한 집계 묶기) + Blobs 캐싱 5분 TTL
   캐시 키: "donation-dashboard-v1"
   캐시 히트 시 cached:true 필드 추가

3) netlify/functions/admin-members-source-kpi.ts
   현재: 파라미터 없는 단순 COUNT(*) GROUP BY
   목표: Blobs 캐싱 10분 TTL 추가
   캐시 키: "members-source-kpi-v1"

━━━ 응답 구조 (키명 임의 변경 금지) ━━━
- admin-donations stats: { stats: { todayAmount, monthAmount, failedCount, unissuedCount, refundedCount, cancelledCount } }
- admin-donation-dashboard: 기존 키 유지 + cached 필드(boolean) 선택 추가
- admin-members-source-kpi: 기존 키 유지

━━━ push 전 체크 (이것만 틀려도 머지 불가) ━━━
  □ 브랜치명: feature/phase18-back (새로 생성했는가?)
  □ lib/cache.ts — getCache / setCache / deleteCache 3개 export
  □ admin-donations stats 키: todayAmount·monthAmount·failedCount·unissuedCount·refundedCount·cancelledCount
  □ admin-donation-dashboard 기존 응답 키 유지 (kpi·alerts 등)
  □ admin-members-source-kpi 기존 응답 키 유지
  □ export const config = { path } 수정 파일 3개 전부 확인
  □ requireAdmin 반환 auth.res (auth.response 아님)
  □ npx tsc --noEmit 통과

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.2 A 채팅 — 해당 없음

Phase 18은 백엔드 전용 (프론트 변경 없음). A는 다음 Phase 작업 대기.

### 6.3 C 채팅 — 검증·fix

```
[C — Phase 18 성능 최적화 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase18 (베이스 main @ B 머지 후 커밋)
정독: docs/milestones/2026-05-11-phase18-performance.md §4

작업 순서:
  1) §4 Q1~Q7 라이브 시나리오 순서대로 실행·기록
  2) 캐시 hit 응답시간 vs miss 응답시간 비교 기록
  3) bug 발견 시 fix 커밋 → 메인 보고
  4) 보고서 docs/verify/2026-05-11-phase18.md 작성
  5) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
금지: PROJECT_STATE.md, docs/HANDOFF.md 수정.
```

---

## §7 라운드 마감 체크리스트

- [ ] feature/phase18-back B push 완료
- [ ] 메인: 응답 키 대조 (stats 6개 키 + dashboard 기존 키 + source-kpi 기존 키)
- [ ] 메인: feature/phase18-back 머지
- [ ] 마이그레이션 없음 — schema 활성화 불필요
- [ ] C 검증 트리거 발송
- [ ] verify/phase18 머지
- [ ] PROJECT_STATE.md §5 Phase 18 → ✅ 100% 갱신
