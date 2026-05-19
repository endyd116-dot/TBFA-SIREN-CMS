# 라운드 6 — 게이미피케이션 + 큐레이션·팝업 설계서

> **생성**: 2026-05-17 / 메인 채팅
> **베이스**: main @ `d81692b`
> **분배**: 메인(DB 마이그·시드·문서) + B(백엔드 API + 이벤트 후킹) + A(UI) + C(검증)

---

## §0. 요구사항 확정

### 게이미피케이션

| 기능 | 결정 |
|---|---|
| 포인트 적립 | 후원 완료·일일 로그인·캠페인 참여 — 규칙 어드민이 설정 |
| 포인트 차감 | 리워드 교환 시 차감 |
| 뱃지 자동 부여 | 포인트 구간·후원 횟수 마일스톤 달성 시 자동 지급 |
| 랭킹 보드 | 포인트 기준 상위 N명 공개 (닉네임 익명 처리 옵션) |
| 리워드 교환 | 회원이 포인트로 상품 교환 신청 → 운영자 수동 처리 |

### 큐레이션·팝업

| 기능 | 결정 |
|---|---|
| 팝업 | 페이지별 타겟팅, 표시 빈도 설정(항상·세션1회·하루1회), 기간 설정 |
| 큐레이션 슬롯 | 홈·마이페이지 특정 슬롯에 공지·캠페인·게시판 묶음 배치 |

---

## §1. DB 설계 (신규 8개 테이블)

### 1.1 포인트 규칙 — point_rules

```sql
CREATE TABLE point_rules (
  id          SERIAL PRIMARY KEY,
  event_type  VARCHAR(40) NOT NULL UNIQUE,  -- 'donation_complete'|'login_daily'|'campaign_join'
  point_amount INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  description VARCHAR(200),
  created_at  TIMESTAMP DEFAULT NOW()
);
-- 초기 시드 (마이그에서 INSERT)
-- donation_complete: 후원 완료 1만원당 100pt (후원액/10000 * 100)
-- login_daily: 일일 첫 로그인 1pt
-- campaign_join: 캠페인 참여 10pt
```

> **주의**: donation_complete는 고정 비율(후원액 × pointAmount / 10000) 방식 사용.
> 나머지는 flat pointAmount.

### 1.2 포인트 이력 — member_point_logs

```sql
CREATE TABLE member_point_logs (
  id            SERIAL PRIMARY KEY,
  member_id     INTEGER NOT NULL REFERENCES members(id),
  delta         INTEGER NOT NULL,          -- 양수=적립, 음수=차감
  reason        VARCHAR(200),
  event_type    VARCHAR(40),               -- point_rules.event_type 참조
  reference_id  INTEGER,                   -- 관련 donations.id 또는 rewards.id
  created_at    TIMESTAMP DEFAULT NOW()
);
```

**잔액 계산**: `SELECT SUM(delta) FROM member_point_logs WHERE member_id = N`

### 1.3 뱃지 정의 — badge_definitions

```sql
CREATE TABLE badge_definitions (
  code            VARCHAR(50) PRIMARY KEY,
  name_ko         VARCHAR(50) NOT NULL,
  icon            VARCHAR(100),            -- 이모지 또는 URL
  condition_type  VARCHAR(30) NOT NULL,    -- 'point_threshold'|'donation_count'
  condition_value INTEGER NOT NULL,
  description     VARCHAR(200),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER DEFAULT 0
);
-- 초기 시드:
-- 'first_step'   첫 걸음    🌱  donation_count  1   첫 후원
-- 'supporter'    서포터     💙  donation_count  3   3회 후원
-- 'champion'     챔피언     🏆  donation_count  10  10회 후원
-- 'point_100'    100포인트  ⭐  point_threshold 100  포인트 100 달성
-- 'point_1000'   1000포인트 🌟  point_threshold 1000 포인트 1000 달성
```

### 1.4 회원 뱃지 — member_badges

```sql
CREATE TABLE member_badges (
  id          SERIAL PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id),
  badge_code  VARCHAR(50) NOT NULL REFERENCES badge_definitions(code),
  awarded_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(member_id, badge_code)
);
```

### 1.5 리워드 상품 — rewards

```sql
CREATE TABLE rewards (
  id          SERIAL PRIMARY KEY,
  name_ko     VARCHAR(100) NOT NULL,
  description TEXT,
  point_cost  INTEGER NOT NULL,
  stock       INTEGER,                     -- NULL = 무제한
  is_active   BOOLEAN NOT NULL DEFAULT true,
  image_url   VARCHAR(500),
  created_at  TIMESTAMP DEFAULT NOW()
);
```

### 1.6 리워드 교환 이력 — reward_redemptions

```sql
CREATE TABLE reward_redemptions (
  id           SERIAL PRIMARY KEY,
  member_id    INTEGER NOT NULL REFERENCES members(id),
  reward_id    INTEGER NOT NULL REFERENCES rewards(id),
  point_cost   INTEGER NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending'|'processed'|'cancelled'
  note         VARCHAR(300),
  redeemed_at  TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);
```

### 1.7 사이트 팝업 — site_popups

```sql
CREATE TABLE site_popups (
  id                SERIAL PRIMARY KEY,
  title             VARCHAR(100) NOT NULL,
  content           TEXT,
  image_url         VARCHAR(500),
  link_url          VARCHAR(500),
  target_pages      JSONB DEFAULT '["*"]',  -- ['*'|'home'|'mypage'|...]
  display_frequency VARCHAR(20) NOT NULL DEFAULT 'once_day', -- 'always'|'once_session'|'once_day'
  start_at          TIMESTAMP,
  end_at            TIMESTAMP,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMP DEFAULT NOW()
);
```

### 1.8 큐레이션 슬롯 — site_curations

```sql
CREATE TABLE site_curations (
  id          SERIAL PRIMARY KEY,
  slot        VARCHAR(40) NOT NULL,   -- 'home_top'|'home_mid'|'mypage_banner'
  title       VARCHAR(100),
  items       JSONB DEFAULT '[]',     -- [{type:'notice'|'campaign'|'board', id:N, title:String}]
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW()
);
```

---

## §2. schema.ts 변경 (메인 작업)

```typescript
/* === 라운드6 게이미피케이션 === */
export const pointRules = pgTable("point_rules", { ... });
export const memberPointLogs = pgTable("member_point_logs", { ... });
export const badgeDefinitions = pgTable("badge_definitions", { ... });
export const memberBadges = pgTable("member_badges", { ... });
export const rewards = pgTable("rewards", { ... });
export const rewardRedemptions = pgTable("reward_redemptions", { ... });
/* === 라운드6 큐레이션·팝업 === */
export const sitePopups = pgTable("site_popups", { ... });
export const siteCurations = pgTable("site_curations", { ... });
```

**append-only 원칙** — 기존 코드 위치 변경 금지.

---

## §3. API 명세 (B 작업)

### 3.1 사용자용 — 게이미피케이션

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/my-points` | 내 포인트 잔액 + 최근 이력 20건 |
| GET | `/api/my-badges` | 내 뱃지 목록 |
| GET | `/api/ranking` | 포인트 상위 20명 (name 앞 1자+*** 익명) |
| GET | `/api/rewards-list` | 활성 리워드 목록 |
| POST | `/api/reward-redeem` | 리워드 교환 신청 (body: { rewardId }) |

**응답 예시 — GET /api/my-points**:
```json
{ "ok": true, "data": { "balance": 350, "logs": [{ "delta": 100, "reason": "후원 완료", "createdAt": "..." }] } }
```

**응답 예시 — GET /api/ranking**:
```json
{ "ok": true, "data": { "ranking": [{ "rank": 1, "name": "김***", "points": 1200 }] } }
```

### 3.2 사용자용 — 큐레이션·팝업

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/site-popups?page=home` | 현재 활성 팝업 (기간+페이지 필터) |
| GET | `/api/site-curations?slot=home_top` | 슬롯별 큐레이션 |

### 3.3 어드민용 — 게이미피케이션

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET/PATCH | `/api/admin-point-rules` | 포인트 규칙 목록 + 수정 |
| GET/POST/PATCH/DELETE | `/api/admin-badge-definitions` | 뱃지 마스터 CRUD |
| GET/POST/PATCH/DELETE | `/api/admin-rewards` | 리워드 상품 CRUD |
| GET | `/api/admin-reward-redemptions` | 교환 신청 목록 |
| PATCH | `/api/admin-reward-redemptions?id=N` | 상태 처리 (processed/cancelled) |
| GET | `/api/admin-member-points?memberId=N` | 회원 포인트 내역 |
| POST | `/api/admin-point-adjust` | 수동 포인트 조정 (body: { memberId, delta, reason }) |

### 3.4 어드민용 — 큐레이션·팝업

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/admin-popups` | 팝업 CRUD |
| GET/POST/PATCH/DELETE | `/api/admin-curations` | 큐레이션 CRUD |

### 3.5 이벤트 후킹 (기존 파일 수정)

```typescript
// netlify/functions/donate-toss-confirm.ts — 후원 완료 시 포인트 적립
// 토스 결제 최종 confirm 성공 후:
const rule = await db.select().from(pointRules)
  .where(and(eq(pointRules.eventType, 'donation_complete'), eq(pointRules.isActive, true)))
  .limit(1);
if (rule[0]) {
  const pts = Math.floor(amount / 10000) * rule[0].pointAmount;
  if (pts > 0) {
    await db.insert(memberPointLogs).values({ memberId, delta: pts, reason: '후원 완료', eventType: 'donation_complete', referenceId: donationId });
    // 뱃지 체크: checkAndAwardBadges(memberId) 헬퍼 호출
  }
}

// 같은 패턴을 donate-hyosung-intent.ts (효성 완료), donate-bank-confirm.ts (계좌이체 완료)에 적용
```

**뱃지 체크 헬퍼** (`lib/badge-checker.ts` 신설):
```typescript
export async function checkAndAwardBadges(memberId: number) {
  // donation_count: 후원 횟수 조회 → badge_definitions 조건 충족 여부 확인 → 미획득 뱃지 INSERT
  // point_threshold: 포인트 잔액 조회 → 조건 충족 여부 확인 → 미획득 뱃지 INSERT
}
```

**일일 로그인 후킹** (`netlify/functions/admin-login.ts` — 이미 B가 이번 라운드에서 수정):
- 실제로는 `auth-login.ts` (사용자 로그인) — lastLoginAt 날짜가 오늘과 다르면 1pt 적립

---

## §4. 화면 설계 (A 작업)

### 4.1 사용자 페이지

#### 포인트·뱃지·리워드 탭 — `public/mypage-points.html` (신규)
- 상단: 내 포인트 잔액 (크게), 등급 배지 옆에 포인트 표시
- 탭 3개: 포인트 이력 / 내 뱃지 / 리워드 교환
  - 포인트 이력: 날짜·사유·delta 목록 (+ 녹색 / - 빨간색)
  - 내 뱃지: 획득 뱃지 카드 그리드 (미획득 잠금 상태 표시)
  - 리워드 교환: 상품 카드 + "교환하기" 버튼 (잔액 부족 시 비활성)
- iframe 등록: mypage.html 또는 내비게이션 링크

#### 랭킹 보드 — `public/ranking.html` (신규)
- 상위 20명 테이블 (순위·이름 익명·포인트)
- 내 순위 별도 표시 (로그인 시)

### 4.2 어드민 페이지

#### 게이미피케이션 관리 — `public/admin-gamification.html` (신규)
탭 5개:
1. **포인트 규칙** — 이벤트별 포인트 금액 수정 (PATCH /api/admin-point-rules)
2. **뱃지 관리** — 뱃지 목록 + 추가·수정·삭제
3. **리워드 관리** — 상품 목록 + 추가·수정·삭제 + 재고 관리
4. **교환 신청** — 대기 중 교환 신청 목록 + 처리/취소
5. **회원 포인트** — 회원 검색 → 포인트 내역 + 수동 조정

#### 팝업 관리 — `public/admin-popups.html` (신규)
- 팝업 목록 (활성/비활성 표시)
- 추가·수정 모달: 제목·내용·이미지·링크·대상 페이지·표시 빈도·기간
- 미리보기 버튼

#### 큐레이션 관리 — `public/admin-curations.html` (신규)
- 슬롯별 탭 (홈상단·홈중간·마이페이지)
- 각 슬롯: 콘텐츠 추가(공지·캠페인 검색 선택) + 순서 드래그

#### 팝업 표시 스크립트
- `public/js/site-popup.js` (신규) — `GET /api/site-popups?page=xxx` 호출 → 팝업 렌더링
- `public/index.html` (또는 홈 페이지) + `public/mypage.html`에 script 추가

### 4.3 iframe 등록 (3개 페이지 × 4곳 = 12개 등록)

| 페이지 | admin.html | admin.js | cms-tbfa.html | cms-tbfa.js |
|---|---|---|---|---|
| admin-gamification | 시스템 그룹 | 케이스 추가 | 운영 도구 | 케이스 추가 |
| admin-popups | 시스템 그룹 | 케이스 추가 | 운영 도구 | 케이스 추가 |
| admin-curations | 시스템 그룹 | 케이스 추가 | 운영 도구 | 케이스 추가 |

---

## §5. 검증 시나리오 (C 작업)

| # | 시나리오 | 확인 |
|---|---|---|
| Q1 | 후원 완료 → 포인트 적립 (member_point_logs INSERT) | DB |
| Q2 | 일일 로그인 → 1pt 적립 (당일 중복 적립 안 됨) | DB |
| Q3 | 포인트 잔액 정확히 계산 (SUM) | API |
| Q4 | 뱃지 조건 달성 → 자동 부여 (donation_count 체크) | DB |
| Q5 | 이미 획득한 뱃지 중복 부여 안 됨 | DB |
| Q6 | 리워드 교환 신청 → 포인트 차감 + redemptions INSERT | DB |
| Q7 | 잔액 부족 → 교환 거부 (400) | API |
| Q8 | 어드민 교환 처리 → status=processed | API |
| Q9 | 어드민 수동 포인트 조정 → 로그 기록 | DB |
| Q10 | 랭킹 API → 상위 20명, 이름 익명 처리 | API |
| Q11 | 팝업 활성화 → 해당 페이지에서 GET 시 반환 | API |
| Q12 | 팝업 기간 외 → 반환 안 됨 | API |
| Q13 | 큐레이션 슬롯 조회 → items 반환 | API |
| Q14 | 어드민 팝업·큐레이션 CRUD 정상 | API |
| Q15 | 회귀: 기존 후원·로그인·캠페인 흐름 정상 | 시나리오 |

---

## §6. 4채팅 시작 프롬프트

### §6.1 B 트리거 (백엔드)

```
[영역: 백엔드(netlify/functions, lib, db)]
[브랜치: feature/round6-gamification-back — 새로 생성]

라운드 6 게이미피케이션 + 큐레이션·팝업 — 백엔드 작업.
설계서: docs/milestones/2026-05-17-round6-gamification.md §3 정독.
베이스: main @ 마이그 완료 후 커밋 (git fetch + rebase 후 시작)
lib/badge-checker.ts가 메인에 이미 추가됨 — import해서 사용.

━━━ 작업 체크박스 ━━━

□ [사용자 API] 포인트·뱃지·랭킹·리워드
   netlify/functions/my-points.ts — GET /api/my-points (잔액 + 이력 20건)
   netlify/functions/my-badges.ts — GET /api/my-badges
   netlify/functions/ranking.ts — GET /api/ranking (상위 20명, 이름 익명)
   netlify/functions/rewards-list.ts — GET /api/rewards-list
   netlify/functions/reward-redeem.ts — POST /api/reward-redeem (잔액 체크 + 차감)

□ [어드민 API] 게이미피케이션 관리
   netlify/functions/admin-point-rules.ts — GET/PATCH /api/admin-point-rules
   netlify/functions/admin-badge-definitions.ts — CRUD /api/admin-badge-definitions
   netlify/functions/admin-rewards.ts — CRUD /api/admin-rewards
   netlify/functions/admin-reward-redemptions.ts — GET/PATCH /api/admin-reward-redemptions
   netlify/functions/admin-member-points.ts — GET /api/admin-member-points + POST /api/admin-point-adjust

□ [어드민 API] 큐레이션·팝업
   netlify/functions/admin-popups.ts — CRUD /api/admin-popups
   netlify/functions/admin-curations.ts — CRUD /api/admin-curations
   netlify/functions/site-popups.ts — GET /api/site-popups?page=xxx (공개)
   netlify/functions/site-curations.ts — GET /api/site-curations?slot=xxx (공개)

□ [이벤트 후킹] 기존 파일 수정
   netlify/functions/donate-toss-confirm.ts — 후원 완료 후 포인트 적립 + checkAndAwardBadges
   netlify/functions/donate-hyosung-intent.ts — 효성 완료 후 동일
   netlify/functions/auth-login.ts — 일일 첫 로그인 1pt (lastLoginAt 날짜 비교)

□ npx tsc --noEmit 통과
□ git push origin feature/round6-gamification-back

━━━ 응답 구조 (키명 임의 변경 금지) ━━━
GET /api/my-points: { ok, data: { balance, logs: [{delta, reason, createdAt}] } }
GET /api/ranking: { ok, data: { ranking: [{rank, name, points}] } }
POST /api/reward-redeem: { ok, data: { redemptionId, newBalance } }
GET /api/site-popups: { ok, data: { popups: [{id, title, content, imageUrl, linkUrl, displayFrequency}] } }

━━━ 중요 ━━━
lib/admin-guard.ts / lib/auth.ts 수정 금지
donate-toss-confirm.ts 수정 시 기존 로직(결제 confirm → 환불 방지) 건드리지 말 것
이벤트 후킹은 fire-and-forget (포인트 적립 실패가 후원 흐름을 막으면 안 됨)
try/catch로 감싸고 실패 시 console.warn만

━━━ push 전 체크 ━━━
□ export const config = { path } 신규 함수 전부
□ requireAdmin 반환 auth.res
□ npx tsc --noEmit 통과

━━━ 자율주행 / 진행률 ━━━
push와 로직 결정만 묻기. 큰 체크박스 완료마다 📊 진행률 보고.
```

### §6.2 A 트리거 (프론트)

```
[영역: 프론트엔드(public/)]
[브랜치: feature/round6-gamification-front — 새로 생성]

라운드 6 게이미피케이션 + 큐레이션·팝업 — 프론트 작업.
설계서: docs/milestones/2026-05-17-round6-gamification.md §4 정독.
베이스: main @ 마이그 완료 후 커밋 (git fetch + rebase 후 시작)

━━━ 작업 체크박스 ━━━

□ [사용자 페이지] public/mypage-points.html 신규
   상단: 포인트 잔액 크게 표시
   탭 3개: 포인트 이력 / 내 뱃지 / 리워드 교환
   GET /api/my-points, /api/my-badges, /api/rewards-list
   리워드 교환: POST /api/reward-redeem (잔액 부족 시 버튼 비활성)

□ [사용자 페이지] public/ranking.html 신규
   GET /api/ranking → 상위 20명 테이블
   내 순위 표시 (로그인 확인 후)

□ [어드민 페이지] public/admin-gamification.html 신규
   탭 5개: 포인트 규칙 / 뱃지 관리 / 리워드 관리 / 교환 신청 / 회원 포인트
   각 탭 CRUD UI + 각 API 연결

□ [어드민 페이지] public/admin-popups.html 신규
   팝업 목록 + 추가·수정 모달 (제목·내용·이미지·링크·대상 페이지·표시 빈도·기간)

□ [어드민 페이지] public/admin-curations.html 신규
   슬롯별 탭 (home_top / home_mid / mypage_banner)
   콘텐츠 추가 + 순서 조정

□ [팝업 표시] public/js/site-popup.js 신규
   GET /api/site-popups?page=xxx → 팝업 렌더링
   localStorage로 표시 빈도(세션/하루) 제어

□ [iframe 등록 4곳 × 3페이지 = 12곳]
   admin.html: admin-gamification / admin-popups / admin-curations 메뉴 추가
   admin.js: 라우팅 케이스 3개 추가
   cms-tbfa.html: 동일 3개 메뉴 추가
   cms-tbfa.js: 라우팅 케이스 3개 추가

□ 캐시버스터 갱신
□ git push origin feature/round6-gamification-front

━━━ mock 데이터 (B 머지 전 사용) ━━━
const MOCK_MY_POINTS = {
  ok: true,
  data: {
    balance: 350,
    logs: [
      { delta: 100, reason: "후원 완료", eventType: "donation_complete", createdAt: "2026-05-17T10:00:00Z" },
      { delta: 1, reason: "일일 로그인", eventType: "login_daily", createdAt: "2026-05-17T09:00:00Z" }
    ]
  }
};
const MOCK_BADGES = {
  ok: true,
  data: { badges: [{ code: "first_step", nameKo: "첫 걸음", icon: "🌱", awardedAt: "2026-05-10" }] }
};
const MOCK_RANKING = {
  ok: true,
  data: { ranking: [
    { rank: 1, name: "김***", points: 1200 },
    { rank: 2, name: "이***", points: 980 }
  ]}
};
const MOCK_REWARDS = {
  ok: true,
  data: { rewards: [
    { id: 1, nameKo: "텀블러", description: "교사유가족협의회 텀블러", pointCost: 500, stock: 10, isActive: true }
  ]}
};

━━━ 자율주행 / 진행률 ━━━
push와 로직 결정만 묻기. 큰 체크박스 완료마다 📊 진행률 보고.
```

### §6.3 C 트리거 (검증 — B·A 머지 후)

```
[영역: 라이브 검증]
라운드 6 게이미피케이션 + 큐레이션·팝업 — 라이브 검증.
설계서: docs/milestones/2026-05-17-round6-gamification.md §5 정독.
선행 조건: 메인 마이그 완료 + B·A 머지 완료 후 진입.

━━━ 검증 체크박스 (Q1~Q15) ━━━
□ Q1  후원 완료 → 포인트 적립 확인
□ Q2  일일 로그인 → 1pt 적립, 당일 중복 없음
□ Q3  포인트 잔액 정확성
□ Q4  뱃지 자동 부여 (donation_count 조건)
□ Q5  뱃지 중복 부여 방지
□ Q6  리워드 교환 신청 → 포인트 차감
□ Q7  잔액 부족 → 400 반환
□ Q8  어드민 교환 처리 → processed
□ Q9  어드민 수동 포인트 조정 → 로그 기록
□ Q10 랭킹 API → 이름 익명 처리 확인
□ Q11 팝업 활성 → API 반환, 기간 외 → 미반환
□ Q12 큐레이션 슬롯 조회 → items 정상
□ Q13 어드민 팝업·큐레이션 CRUD
□ Q14 어드민 게이미피케이션 각 탭 정상
□ Q15 회귀: 후원·로그인·캠페인 기존 흐름 정상

━━━ 자율주행 / 진행률 ━━━
fix 발견 시 fix/round6-{키워드} 신규 브랜치.
검증 보고서: docs/verify/2026-05-17-round6-gamification.md
```

---

## §7. 라운드 마감 체크리스트 (메인)

- [ ] schema.ts 8개 테이블 + lib/badge-checker.ts 추가 → push
- [ ] migrate-round6-gamification.ts 작성 → push
- [ ] Swain 마이그 호출 (`/api/migrate-round6-gamification?run=1`)
- [ ] 마이그 파일 삭제 → push
- [ ] B 트리거 + A 트리거 발사
- [ ] B push → 응답 키 대조 → 머지
- [ ] A push → 머지
- [ ] C 검증 Q1~Q15 PASS
- [ ] PROJECT_STATE.md·HANDOFF.md 갱신 push
