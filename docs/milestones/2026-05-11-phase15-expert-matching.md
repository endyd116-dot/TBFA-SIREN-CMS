# Phase 15 — 전문가 매칭 고도화 (Expert Matching Enhancement)

> **작성**: 2026-05-11 / 메인 채팅
> **상위 Phase**: Phase 15 전문가 매칭 고도화 ([카탈로그](2026-05-10-phase10-22-catalog.md) §Phase15)
> **추정**: 메인 설계 2h / B 백 5~6h / A 프론트 4~5h / C 검증 2h / 합계 13~15h
> **모드**: 평행 (A·B 동시 시작. A는 mock JSON으로 시작, B 머지 후 실 API 연결)

---

## 0. 요구사항 확정 (Swain 결정 2026-05-11)

| 항목 | 결정 |
|---|---|
| 추천 점수 계산 | **Gemini AI 적합도 판단** — 사건 내용 + 전문가 프로필 텍스트를 Gemini에 전송, 적합도 점수(0~100) + 코멘트 반환 |
| 피드백 수집 | **사용자 별점 입력 + 추천 반영** — 상담 종결 시 사용자 마이페이지에 1~5점 + 한 줄 후기 화면 노출, 다음 추천 점수에 자동 반영 |
| 전문가 프로필 확장 | 기존 members 테이블 기반 + `expertProfiles` 별도 테이블로 분야·언어·가용 요일·시간대 저장 |
| 매칭 플로우 변경 | 기존 어드민 수동 배정 유지 + AI 추천 순위 표시 추가 (강제 자동화 아님) |
| AI 호출 시점 | 어드민이 배정 화면 열 때 on-demand (매 요청 시 실시간, 결과 캐시 X) |
| 만족도 추천 반영 방식 | 해당 전문가의 과거 별점 평균을 Gemini 프롬프트에 함께 전달 (별점이 낮으면 AI가 추천 점수 낮게 반환하도록 유도) |
| 화면 위치 | 어드민: 기존 전문가 배정 화면 고도화 / 사용자: mypage.html 매칭 상세 화면에 별점 입력 추가 |

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블 2개

#### `expertProfiles` (전문가 프로필 확장)

```typescript
export const expertProfiles = pgTable("expert_profiles", {
  id:              serial("id").primaryKey(),
  memberId:        integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }).unique(),
  specialties:     text("specialties"),        // JSON 배열 문자열: ["학교폭력","노동법","이혼"]
  languages:       text("languages"),          // JSON 배열: ["한국어","영어"]
  availableDays:   varchar("available_days", { length: 50 }), // "월,화,수,목,금"
  availableHours:  varchar("available_hours", { length: 50 }), // "09:00-18:00"
  regionCoverage:  varchar("region_coverage", { length: 100 }), // "전국" or "서울,경기"
  bio:             text("bio"),                // 자기소개 (AI 프롬프트에 활용)
  avgRating:       numeric("avg_rating", { precision: 3, scale: 2 }).default("0"),  // 별점 평균 (0.00~5.00)
  ratingCount:     integer("rating_count").default(0),
  isAcceptingCase: boolean("is_accepting_case").default(true).notNull(), // 현재 신규 배정 수락 여부
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});
```

#### `matchingFeedbacks` (매칭 만족도 피드백)

```typescript
export const matchingFeedbacks = pgTable("matching_feedbacks", {
  id:          serial("id").primaryKey(),
  matchId:     integer("match_id").notNull().references(() => expertMatches.id, { onDelete: "cascade" }).unique(),
  memberId:    integer("member_id").references(() => members.id, { onDelete: "set null" }),
  rating:      integer("rating").notNull(),     // 1~5
  comment:     text("comment"),                 // 한 줄 후기
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
```

> `expertMatches` — 기존 테이블 (snake_case: `expert_matches`). schema.ts에 `expertMatches` 이름으로 이미 정의되어 있음.

### 1.2 기존 테이블 컬럼 추가 없음

`avgRating`·`ratingCount` 는 `expertProfiles`에 비정규화로 보관 (JOIN 없이 빠른 조회용). 피드백 INSERT 시 트리거 대신 API에서 직접 재계산.

### 1.3 마이그레이션

신규 테이블 2개 — `migrate-phase15-expert-matching.ts` 작성 필요.

```sql
-- expert_profiles
CREATE TABLE IF NOT EXISTS expert_profiles (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  specialties TEXT,
  languages TEXT,
  available_days VARCHAR(50),
  available_hours VARCHAR(50),
  region_coverage VARCHAR(100),
  bio TEXT,
  avg_rating NUMERIC(3,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  is_accepting_case BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- matching_feedbacks
CREATE TABLE IF NOT EXISTS matching_feedbacks (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL UNIQUE REFERENCES expert_matches(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

> **B 주의**: schema.ts 컬럼 정의는 Swain 마이그 호출 확인 후 활성화.

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `admin-expert-profile-upsert.ts` | `/api/admin-expert-profile-upsert` | POST | requireAdmin | 전문가 프로필 등록·수정 |
| `admin-expert-profile-get.ts` | `/api/admin-expert-profile-get` | GET | requireAdmin | 전문가 프로필 조회 |
| `admin-ai-expert-recommend.ts` | `/api/admin-ai-expert-recommend` | POST | requireAdmin | AI 기반 전문가 추천 순위 반환 |
| `user-match-feedback.ts` | `/api/user-match-feedback` | POST | requireActiveUser | 사용자 매칭 별점 입력 |
| `user-match-feedback-status.ts` | `/api/user-match-feedback-status` | GET | requireActiveUser | 피드백 입력 여부 확인 |

> 기존 `admin-ai-expert-match.ts` 는 단순 매칭 실행 함수. 이번에 추가되는 `admin-ai-expert-recommend.ts` 는 배정 전 추천 순위 조회 전용.

### 2.2 함수 상세

#### `admin-expert-profile-upsert` (POST)

**요청 body**:
```json
{
  "memberId": 42,
  "specialties": ["학교폭력", "노동법"],
  "languages": ["한국어"],
  "availableDays": "월,화,수,목,금",
  "availableHours": "09:00-18:00",
  "regionCoverage": "전국",
  "bio": "학교폭력 전문 변호사. 10년 경력.",
  "isAcceptingCase": true
}
```

**처리 단계**: `auth` → `validate` (memberId 필수, rating은 수정 불가) → `upsert` (member_id UNIQUE 충돌 시 UPDATE)

**응답**: `{ "ok": true }`

---

#### `admin-ai-expert-recommend` (POST)

**요청 body**:
```json
{
  "sourceType": "incident",
  "sourceId": 42,
  "matchType": "lawyer"
}
```

**처리 단계**:
1. `auth` — requireAdmin
2. `select_source` — sourceType에 따라 신고·상담 내용 조회 (title + contentHtml HTML 태그 제거 + aiSummary)
3. `select_experts` — `members.type='volunteer'` + `members.member_subtype=matchType` + `is_accepting_case=true` + `expertProfiles` JOIN
4. `ai_recommend` — Gemini 프롬프트 구성 후 호출 (아래 프롬프트 참고)
5. `map` — AI 응답 파싱 → 전문가별 점수·코멘트 매핑
6. 응답

**Gemini 프롬프트 구조**:
```
당신은 법률·심리상담 전문가 매칭 보조 시스템입니다.
아래 사건 내용과 전문가 목록을 보고, 각 전문가의 적합도 점수(0~100)와 한 줄 추천 이유를 JSON으로 반환하세요.

[사건 내용]
제목: {title}
요약: {aiSummary 또는 content 앞 300자}

[전문가 목록]
{experts.map(e => `ID:${e.id} 이름:${e.name} 전문분야:${e.specialties} 언어:${e.languages} 가용:${e.availableDays} ${e.availableHours} 평점:${e.avgRating}(${e.ratingCount}건)`).join('\n')}

응답 형식 (JSON only):
[
  { "expertId": 42, "score": 85, "reason": "학교폭력 전문 + 평점 4.8" },
  { "expertId": 17, "score": 70, "reason": "노동법 전공이나 평점 낮음" }
]
```

**응답**:
```json
{
  "ok": true,
  "recommendations": [
    {
      "expertId": 42,
      "name": "김변호사",
      "memberSubtype": "lawyer",
      "score": 85,
      "reason": "학교폭력 전문 + 평점 4.8",
      "specialties": ["학교폭력", "노동법"],
      "avgRating": 4.8,
      "ratingCount": 12,
      "availableDays": "월,화,수,목,금",
      "isAcceptingCase": true
    }
  ]
}
```

**안전장치**:
- Gemini 호출 실패 시 → 평점 기준 단순 정렬 fallback (`avgRating DESC`)
- JSON 파싱 실패 시 → 동일 fallback
- 전문가 0명이면 → `{ "ok": true, "recommendations": [] }`
- AI 비용: 건당 ~0.001달러 (on-demand, 캐시 X)

---

#### `user-match-feedback` (POST)

**요청 body**:
```json
{
  "matchId": 7,
  "rating": 4,
  "comment": "친절하게 설명해주셨습니다."
}
```

**처리 단계**:
1. `auth` — requireActiveUser
2. `validate` — matchId 필수, rating 1~5 범위 검증
3. `check_owner` — expertMatches에서 matchId 조회, user_id = 현재 사용자인지 확인
4. `check_status` — status = 'closed' 인지 확인 (종결된 매칭만 허용)
5. `check_dup` — matchingFeedbacks에 이미 동일 matchId 피드백 존재 시 400
6. `insert_feedback` — matchingFeedbacks INSERT
7. `update_avg` — expertProfiles.avgRating·ratingCount 재계산 UPDATE
8. 응답

**응답**: `{ "ok": true }`

---

#### `user-match-feedback-status` (GET)

**쿼리 파라미터**: `?matchId=7`

**응답**:
```json
{
  "ok": true,
  "submitted": false,
  "match": {
    "id": 7,
    "status": "closed",
    "expertName": "김변호사",
    "closedAt": "2026-05-10T15:00:00Z"
  }
}
```

피드백 입력 가능 조건: `status='closed'` + `submitted=false`

---

### 2.3 공통 체크

- [x] 모든 함수 `export const config = { path: "/api/xxx" }`
- [x] requireAdmin / requireActiveUser 반환 `auth.res`
- [x] `npx tsc --noEmit` 통과 후 push
- [x] schema.ts import에 `numeric` 누락 주의 (avgRating 타입)
- [x] `expertMatches` 테이블 참조 시 기존 테이블명 정확히 확인 (snake_case: `expert_matches`)

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 위치 | 진입점 | 비고 |
|---|---|---|
| `admin.html` — 전문가 배정 화면 고도화 | 기존 `adm-expert-assign` 섹션 (신규 X, 기존 수정) | AI 추천 순위 패널 추가 |
| `admin.html` — 전문가 프로필 관리 신규 | `adm-expert-profiles` 섹션 신규 | 유가족 지원 관리 그룹 또는 관리자 설정 그룹 |
| `mypage.html` — 매칭 상세 화면 | 기존 매칭 목록 항목 클릭 시 상세 영역 | 종결 상태 시 별점 입력 UI 추가 |

### 3.2 와이어프레임

#### 어드민: AI 추천 패널 (기존 배정 화면에 추가)

```
┌─ 전문가 배정 ─────────────────────────────────────────┐
│ 사건번호: IR-20260501-001 / 유형: 사건 신고             │
│                                                         │
│  ── AI 추천 순위 ────────────────────────────────────  │
│  [AI 추천받기] ← 클릭 시 Gemini 호출 (로딩 3~5초)      │
│                                                         │
│  로딩 후:                                               │
│  ┌────┬──────────┬──────┬──────┬──────────────────┐   │
│  │순위│ 전문가명  │ 점수 │ 평점 │ AI 추천 이유      │   │
│  ├────┼──────────┼──────┼──────┼──────────────────┤   │
│  │ 1위│ 김변호사  │ 85점 │ ★4.8 │ 학교폭력 전문    │   │
│  │ 2위│ 이변호사  │ 70점 │ ★3.9 │ 노동법 전공      │   │
│  └────┴──────────┴──────┴──────┴──────────────────┘   │
│                                                         │
│  ── 직접 배정 ──────────────────────────────────────   │
│  전문가 선택: [김변호사 ▼]   [배정 완료]               │
└─────────────────────────────────────────────────────────┘
```

#### 어드민: 전문가 프로필 관리

```
┌─ 전문가 프로필 관리 ───────────────────────────────────┐
│  ┌──────────┬──────────────┬──────┬──────┬──────────┐   │
│  │ 전문가명  │ 전문 분야     │ 평점 │ 수락 │ 액션     │   │
│  ├──────────┼──────────────┼──────┼──────┼──────────┤   │
│  │ 김변호사  │ 학교폭력,노동│ 4.8  │ ✅   │ [편집]   │   │
│  │ 박상담사  │ 심리,트라우마│ 4.2  │ ✅   │ [편집]   │   │
│  └──────────┴──────────────┴──────┴──────┴──────────┘   │
└─────────────────────────────────────────────────────────┘

[프로필 편집 모달]
┌─ 전문가 프로필 편집 ───────────────────────────────────┐
│ 전문 분야 (쉼표 구분): [학교폭력, 노동법              ] │
│ 가능 언어 (쉼표 구분): [한국어                        ] │
│ 가능 요일:   [월] [화] [수] [목] [금] [토] [일]        │
│ 가능 시간대: [09:00] ~ [18:00]                         │
│ 지역:        [전국                                    ] │
│ 자기소개:    [학교폭력 전문 변호사. 10년 경력.         ] │
│ 신규 배정 수락: [✅ 수락 중]                            │
│                                                         │
│ 현재 평점: ★4.8 (12건)                                  │
│                                                         │
│                           [취소] [저장]                 │
└─────────────────────────────────────────────────────────┘
```

#### 사용자: mypage.html 매칭 상세 — 별점 입력

```
┌─ 매칭 상세 ────────────────────────────────────────────┐
│ 상담 전문가: 김변호사 (학교폭력·노동법)                  │
│ 상태: 종결  /  종결일: 2026-05-10                       │
│                                                         │
│  ── 상담 후기 작성 ─────────────────────────────────   │
│  이 매칭이 도움이 되었나요?                              │
│                                                         │
│  ★★★★☆  (클릭으로 별점 선택)                          │
│                                                         │
│  한 줄 후기: [친절하게 설명해주셨습니다.            ]   │
│                                                         │
│                      [후기 제출]                        │
│                                                         │
│  ※ 후기는 전문가 배정 개선에 활용됩니다.                │
└─────────────────────────────────────────────────────────┘
```

별점 제출 후: "후기가 등록되었습니다. 감사합니다." 토스트 + 별점 입력 영역 숨김.

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 응답 처리 |
|---|---|---|
| 어드민 전문가 배정 화면 진입 | — (기존 API 그대로) | 기존 유지 |
| [AI 추천받기] 버튼 클릭 | POST `/api/admin-ai-expert-recommend` | 로딩 스피너 → 추천 순위 테이블 렌더 |
| AI 추천 실패 시 | — | "AI 추천을 불러오지 못했습니다. 직접 선택해주세요." 안내 표시 |
| 전문가 프로필 관리 진입 | GET `/api/admin-expert-profile-get?all=true` | 프로필 목록 렌더 |
| [편집] → 모달 [저장] | POST `/api/admin-expert-profile-upsert` | 목록 새로고침 |
| mypage 매칭 상세 진입 | GET `/api/user-match-feedback-status?matchId=X` | submitted=false + closed이면 별점 UI 표시 |
| 별점 선택 + [후기 제출] | POST `/api/user-match-feedback` | 성공 시 별점 UI 숨김 + 토스트 |

### 3.4 JS 파일

| 파일 | 용도 |
|---|---|
| `public/js/admin-expert-profiles.js` | 신규 — 프로필 관리 화면 |
| `public/js/admin-ai-recommend.js` | 신규 — AI 추천 패널 (기존 배정 화면에 인클루드) |
| `public/js/mypage-match-feedback.js` | 신규 — 사용자 별점 입력 (mypage.html에 인클루드) |

캐시버스터: 모두 `?v=1`

admin.html 하단 추가:
```html
<script src="/js/admin-expert-profiles.js?v=1"></script>
<script src="/js/admin-ai-recommend.js?v=1"></script>
```

mypage.html 하단 추가:
```html
<script src="/js/mypage-match-feedback.js?v=1"></script>
```

### 3.5 토스트 문구

| 상황 | 문구 |
|---|---|
| AI 추천 성공 | (없음 — 테이블 표시로 충분) |
| AI 추천 실패 | "AI 추천을 불러오지 못했습니다. 직접 선택해주세요." |
| 프로필 저장 성공 | "프로필이 저장되었습니다." |
| 별점 제출 성공 | "후기가 등록되었습니다. 감사합니다." |
| 별점 제출 실패 | "후기 등록에 실패했습니다. {서버 detail}" |
| 이미 제출됨 | "이미 후기를 작성하셨습니다." |

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오 (Q1~Q9)

| # | 시나리오 (사용자 동작) | 기대 동작 |
|---|---|---|
| Q1 | 어드민 → 전문가 프로필 관리 진입 | 전문가 목록 표시 (type=volunteer 회원) |
| Q2 | 전문가 [편집] → 전문 분야·가용 요일·자기소개 입력 후 [저장] | 저장 성공, 목록에 정보 반영 |
| Q3 | 기존 사건 신고 상세에서 전문가 배정 화면 열기 → [AI 추천받기] 클릭 | 3~5초 후 추천 순위 테이블 표시 (점수 + 이유) |
| Q4 | AI 추천 결과에서 1위 전문가를 직접 배정 | 기존 배정 흐름 그대로 동작 (회귀 없음) |
| Q5 | 배정된 상담이 종결 상태로 변경됨 | — |
| Q6 | 사용자 로그인 → mypage.html → 해당 매칭 상세 → 별점 입력 화면 표시 여부 | 종결 + 미제출이면 별점 UI 표시 |
| Q7 | 별점 4점 + 한 줄 후기 입력 후 [후기 제출] | 성공 토스트 + 별점 UI 숨김 |
| Q8 | 동일 매칭 페이지 재진입 | 별점 UI 없음 (이미 제출된 상태) |
| Q9 | 어드민 전문가 프로필에서 해당 전문가의 평점이 갱신되었는지 확인 | avgRating·ratingCount 갱신 |

### 4.2 회귀 점검

- 기존 전문가 배정(admin-ai-expert-match) 화면 — 기존 배정 흐름 정상 동작
- mypage.html 기존 매칭 목록 — 레이아웃 깨짐 없음
- admin.html 전체 로드 — JS 추가 후 구문 에러 없음

### 4.3 백필

- [x] 기존 전문가(volunteer 회원)에 대해 expertProfiles 레코드 없어도 AI 추천은 프로필 없는 상태로 동작 (bio·specialties NULL → Gemini 프롬프트에 "프로필 미입력"으로 표시)
- [x] 기존 종결된 매칭에는 피드백 입력 화면 노출 안 함 (새로 종결되는 것부터 적용)

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] 평행 (A는 mock JSON으로 시작, B 머지 후 실 API 연결)

### 5.2 머지 순서

```
1. B push (feature/phase15-back)
   → 메인: migrate-phase15 파일 확인 → Swain 마이그 호출 요청
   → Swain: https://tbfa-siren-cms.netlify.app/api/migrate-phase15-expert-matching?run=1
   → 성공 확인 → 메인: schema 활성화 + 마이그 파일 삭제 + B 머지 → push

2. A push (feature/phase15-front)
   → 메인: A 머지 → push
   → A에 "실 API 연결" 신호

3. C 검증 트리거 → C push (verify/phase15) → 메인 머지 → 라운드 마감
```

### 5.3 신규 환경변수

없음 (GEMINI_API_KEY 기존 운영 중).

### 5.4 A mock 응답

```json
{
  "ai_recommend_mock": {
    "ok": true,
    "recommendations": [
      { "expertId": 1, "name": "김변호사", "memberSubtype": "lawyer", "score": 85, "reason": "학교폭력 전문 + 평점 4.8", "specialties": ["학교폭력","노동법"], "avgRating": 4.8, "ratingCount": 12, "availableDays": "월,화,수,목,금", "isAcceptingCase": true },
      { "expertId": 2, "name": "이변호사", "memberSubtype": "lawyer", "score": 62, "reason": "분야 일치하나 평점 낮음", "specialties": ["민사"], "avgRating": 3.9, "ratingCount": 5, "availableDays": "화,목", "isAcceptingCase": true }
    ]
  },
  "feedback_status_mock": {
    "ok": true, "submitted": false,
    "match": { "id": 7, "status": "closed", "expertName": "김변호사", "closedAt": "2026-05-10T15:00:00Z" }
  }
}
```

---

## 6. 4채팅 시작 프롬프트

### 6.1 B 채팅 — 백 구현

```
[B — Phase 15 전문가 매칭 고도화 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase15-back (베이스 main 최신 커밋)
정독 (필수): docs/milestones/2026-05-11-phase15-expert-matching.md §1·§2
참고: docs/PARALLEL_GUIDE.md §3

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

핵심 정보:
- 신규 테이블 2개: expertProfiles, matchingFeedbacks (§1.1 DDL 그대로)
- 마이그레이션 파일 작성 필수: netlify/functions/migrate-phase15-expert-matching.ts
- schema.ts 컬럼 정의는 Swain 마이그 호출 확인 후 추가 (먼저 추가 금지)
- 전문가는 별도 테이블 없음 — members 테이블 type='volunteer' + member_subtype='lawyer'|'counselor'
- expertMatches 테이블이 이미 존재함 (snake_case: expert_matches)
- AI 호출: lib/ai-gemini.ts 기존 패턴 사용 (3-tier 폴백)
- schema.ts import에 numeric 추가 필요 (avgRating 타입)
- user-match-feedback: requireActiveUser 사용, avgRating 재계산은 해당 전문가 모든 피드백 AVG

작업 순서:
  1) migrate-phase15-expert-matching.ts 작성
  2) 신규 함수 5개 작성 (§2.1 목록)
  3) npx tsc --noEmit 통과
  4) push → 메인에 보고

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.2 A 채팅 — 프론트 구현

```
[A — Phase 15 전문가 매칭 고도화 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase15-front (베이스 main 최신 커밋)
정독 (필수): docs/milestones/2026-05-11-phase15-expert-matching.md §3
참고: docs/PARALLEL_GUIDE.md §3

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

모드: 평행 mock — §5.4 mock 데이터로 먼저 구현. B 머지 후 실 API 연결 신호 받으면 교체.

작업 대상:
  1) public/admin.html
     - 전문가 프로필 관리 섹션 신규 (adm-expert-profiles)
     - 사이드바 메뉴 추가 (유가족 지원 관리 그룹 또는 관리자 설정 그룹 하단)
     - 기존 전문가 배정 화면에 [AI 추천받기] 버튼 + 추천 순위 테이블 패널 추가
  2) public/js/admin-expert-profiles.js — 신규 (프로필 관리 화면)
  3) public/js/admin-ai-recommend.js — 신규 (AI 추천 패널)
  4) public/mypage.html
     - 매칭 상세 영역에 종결 상태 시 별점 입력 UI 추가
  5) public/js/mypage-match-feedback.js — 신규 (별점 입력)

AI 추천 패널:
  - [AI 추천받기] 클릭 시 POST /api/admin-ai-expert-recommend → 로딩 스피너(3~5초 안내)
  - 실패 시 "AI 추천을 불러오지 못했습니다. 직접 선택해주세요." 안내
  - 성공 시 점수 순 테이블 렌더 (§3.2 와이어프레임 참고)

별점 UI:
  - 종결 매칭 + 미제출 시에만 노출 (GET /api/user-match-feedback-status로 확인)
  - 별 클릭으로 1~5점 선택, textarea 후기 입력
  - POST /api/user-match-feedback 성공 시 UI 숨김

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.3 C 채팅 — 검증·fix

```
[C — Phase 15 전문가 매칭 고도화 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase15 (베이스 main @ B+A 머지 후 커밋)
정독: docs/milestones/2026-05-11-phase15-expert-matching.md §4

작업 순서:
  1) §4.1 Q1~Q9 라이브 시나리오 순서대로 실행·기록
  2) §4.2 회귀 점검
  3) bug 발견 시 fix 커밋 → 메인 보고
  4) 보고서 docs/verify/2026-05-11-phase15.md 작성
  5) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
금지: PROJECT_STATE.md, docs/HANDOFF.md, docs/ 수정.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] **B push 후 머지 전**: B 응답 키와 A mock 키 1:1 대조 (§2.2 응답 구조 ↔ §5.4 mock JSON 키명 일치 확인)
- [ ] Swain 마이그 호출 성공 확인
- [ ] B `feature/phase15-back` 머지 완료
- [ ] schema.ts expertProfiles·matchingFeedbacks 정의 활성화
- [ ] 마이그 파일 삭제 + push
- [ ] A `feature/phase15-front` 머지 완료 (실 API 연결 확인)
- [ ] C `verify/phase15` 머지 완료
- [ ] C 보고서 `docs/verify/2026-05-11-phase15.md` push 완료
- [ ] Q1~Q9 모두 PASS
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 Phase 15 진행률 갱신
- [ ] HANDOFF.md 갱신
