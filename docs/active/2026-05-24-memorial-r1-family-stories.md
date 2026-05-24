# 온라인 추모관 R1 — 유가족 이야기 (설계서)

> 2026-05-24 · 메인(Opus) 설계 · 병렬 A·B·C
> 상위 기획: [`docs/specs/온라인추모관_기능명세_워크플로우.md`](../specs/온라인추모관_기능명세_워크플로우.md)
> 범위 결정: **옵션 A**(유가족이야기 + 통합추모 + 개별 선생님 페이지). 본 라운드는 그중 **R1 유가족이야기**.
> 다음 라운드: R2 온라인 추모관 본체(히어로·카운터·통합 촛불/국화 헌화·통합 방명록·개별 선생님 페이지·BGM) — §8 개요.

---

## §0. 요구사항 확정 (Swain 결정)

| 항목 | 결정 |
|---|---|
| 메뉴 | 상단 GNB에 **추모관** 추가(2뎁스: 온라인 추모관 / 유가족 이야기). "소식/참여"와 "후원 안내" 사이 |
| 유가족 이야기 | 유튜브 영상 갤러리 → 카드 클릭 → 상세페이지(영상 임베드 + 풍부한 글) → 하단 후원하기 연결 |
| 상세 본문 작성 | 초기 4개 시드는 **메인(Claude)이 직접 작성**. 이후 운영자 추가 시 **AI 초안 생성** 버튼(Gemini) 제공 |
| AI 입력 소스 | 유튜브 URL(제목·썸네일 oEmbed 자동) + 운영자 메모 → AI 초안 → 운영자 검수·발행 |
| 후원 연결 | 상세 하단 CTA = `data-action="open-modal" data-target="donateModal"`(기존 후원 모달 재사용) |
| 운영자 도구 | 어드민에서 영상 추가·AI초안·수정·발행/숨김·삭제. cms-tbfa iframe 4곳 등록 |
| BGM | **R2로 이관**(영상 소리와 충돌). 음원은 Pixabay Music 저작권 자유곡 추천 |
| 시드 4개 | 채널 @일상적인100의 협회 관련 4개 영상. URL은 Swain 제공(미제공 시 draft로 시드 후 어드민에서 URL 연결·발행) |

**시드 4개 영상(추정)**: ①[1분 인터뷰] 유가족의 목소리 ②서이초 사건 그 이후…교사유가족협의회란? ③[유가족의 목소리] 교육공동체 헌정 영상 ④[유가족의 목소리] 교사 유가족의 인터뷰

---

## §1. DB 설계 (B)

`db/schema.ts` **파일 끝에 append**(본인 섹션 헤더 명시):

```typescript
/* === 추모관 R1: 유가족 이야기 (2026-05-24) === */
export const familyStories = pgTable("family_stories", {
  id:           serial("id").primaryKey(),
  youtubeId:    varchar("youtube_id", { length: 20 }),     // draft 단계엔 null 가능
  youtubeUrl:   text("youtube_url"),
  title:        varchar("title", { length: 200 }).notNull(),
  subtitle:     varchar("subtitle", { length: 300 }),       // 카드/히어로 부제
  thumbnailUrl: text("thumbnail_url"),                      // 유튜브 자동 또는 커스텀
  summary:      varchar("summary", { length: 500 }),        // 카드용 1~2줄
  detailHtml:   text("detail_html"),                        // 상세 본문(메인/운영자/AI 작성)
  adminNotes:   text("admin_notes"),                        // AI 초안용 운영자 메모(영상 맥락)
  duration:     varchar("duration", { length: 12 }),        // 표시용 "5:38"
  category:     varchar("category", { length: 30 }).default("voice").notNull(), // voice|intro|tribute|interview
  status:       varchar("status", { length: 12 }).default("draft").notNull(),   // draft|published
  sortOrder:    integer("sort_order").default(0).notNull(),
  viewCount:    integer("view_count").default(0).notNull(),
  publishedAt:  timestamp("published_at"),
  createdBy:    integer("created_by"),                      // 운영자 member id
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  statusSortIdx: index("family_stories_status_sort_idx").on(t.status, t.sortOrder),
}));
```

> ⚠️ schema 정의는 **마이그 적용 성공 후** 활성화(§9.1.1). 마이그 함수 먼저 작성·푸시 → Swain 호출 → 성공 후 schema 정의 push.
> import 점검: `serial, varchar, text, integer, timestamp, index` (이미 있음).

**마이그**: `netlify/functions/migrate-family-stories.ts`
- GET `?run=1` + `requireAdmin`, GET 기본 = 진단. 멱등(`CREATE TABLE IF NOT EXISTS`).
- 테이블 생성 + **시드 4행 INSERT(status='draft')** — 본 설계서 §5.2의 detailHtml/title/summary 그대로. `ON CONFLICT DO NOTHING`(youtube_id 없으니 중복 방지는 title 기준 `WHERE NOT EXISTS`).
- 호출 성공 후 파일 삭제.

---

## §2. API 명세 (B)

모든 함수 `export const config = { path: "..." }` 필수. 단계별 try/catch + step·detail·stack.

| 함수 파일 | 메서드·경로 | 가드 | 설명 |
|---|---|---|---|
| `family-stories-list.ts` | GET `/api/family-stories` | 공개 | 발행분만, sortOrder→publishedAt 정렬 |
| `family-story-detail.ts` | GET `/api/family-story?id=N` | 공개 | 발행분 1건 + view_count++ |
| `admin-family-stories.ts` | GET/POST/PATCH/DELETE `/api/admin-family-stories` | requireAdmin | 목록(전체)·생성·수정·발행토글·삭제 |
| `admin-family-story-ai.ts` | POST `/api/admin-family-story-ai` | requireAdmin | AI 상세 초안 생성 |

**응답 구조 (키명 고정 — A mock 기준)**:

```jsonc
// GET /api/family-stories
{ "ok": true, "data": { "stories": [
  { "id":1, "youtubeId":"abc123", "title":"...", "subtitle":"...",
    "thumbnailUrl":"https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    "summary":"...", "duration":"5:38", "category":"voice" }
] } }

// GET /api/family-story?id=1
{ "ok": true, "data": { "story": {
  "id":1, "youtubeId":"abc123", "youtubeUrl":"https://youtu.be/abc123",
  "title":"...", "subtitle":"...", "thumbnailUrl":"...", "summary":"...",
  "detailHtml":"<p>...</p>", "duration":"5:38", "category":"voice",
  "viewCount":123, "publishedAt":"2026-05-24T00:00:00Z" } } }

// GET /api/admin-family-stories  (전체 상태 포함)
{ "ok": true, "data": { "stories": [ { ...위 + "status":"draft","sortOrder":0,"adminNotes":"..." } ] } }

// POST/PATCH /api/admin-family-stories
{ "ok": true, "data": { "story": { ...전체필드 } }, "message": "저장되었습니다" }

// DELETE /api/admin-family-stories?id=1
{ "ok": true, "message": "삭제되었습니다" }

// POST /api/admin-family-story-ai   body:{youtubeUrl?, title?, adminNotes?}
{ "ok": true, "data": { "draft": { "subtitle":"...", "summary":"...", "detailHtml":"<p>...</p>" } } }
```

**유튜브 ID 추출(서버 헬퍼)** — 정규식으로 다음 형태 모두 지원:
`youtube.com/watch?v=ID` · `youtu.be/ID` · `youtube.com/embed/ID` · `youtube.com/shorts/ID` · `youtube.com/live/ID`. ID는 11자 `[A-Za-z0-9_-]`.

**oEmbed(키 불필요)**: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json` → `{ title, thumbnail_url, author_name }`. POST 생성 시 title/thumbnail 비면 oEmbed로 자동 채움. 썸네일 폴백: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`.

**발행 검증**: `status='published'`로 바꿀 때 `youtubeId` 필수(없으면 400 "영상 URL을 먼저 입력하세요").

**AI featureKey**: `lib/ai-feature.ts` FEATURE_REGISTRY 배열 **끝에 append**(④ 충돌 재발 방지 — 기존 항목 건드리지 말 것):
```typescript
{ key: "memorial_story_detail", name: "유가족이야기 상세 초안",
  category: "admin_action",
  description: "유튜브 영상 정보·운영자 메모로 추모 상세페이지 초안 생성", sortOrder: 298 },
```
AI 호출: `callGeminiJSON<{subtitle,summary,detailHtml}>(prompt, { featureKey:"memorial_story_detail", mode:"pro", maxOutputTokens:3000 })`. 실패 시 폴백(빈 초안 + 안내). 프롬프트: "(사)교사유가족협의회 추모/연대 톤. 아래 영상 정보·운영자 메모로 ① 부제 ② 카드 요약(1~2줄) ③ 상세 본문 HTML(소개·영상이 담은 이야기·협회와의 연결·헌사, `<p>`/`<h3>`만, 200~500자) 생성. 과장·허위 사실 금지, 차분하고 존엄하게."

---

## §3. 화면 설계 (A)

스캐폴드(모든 신규 공개 페이지): `<head>`에 fonts + base/layout/components/pages.css `?v=3`, `<body data-page="memorial">`, `<div id="header-slot"></div>` … `<main>` … `<div id="modals-slot"></div><div id="footer-slot"></div>` + `<script src="/js/common.js?v=4"></script>` + 페이지 전용 JS.

**신규/수정 파일**

| 파일 | 내용 |
|---|---|
| `public/partials/header.html` (수정) | 추모관 GNB 추가(아래) |
| `public/family-stories.html` + `js/family-stories.js` (신규) | 유가족이야기 갤러리 |
| `public/family-story.html` + `js/family-story.js` (신규) | 상세페이지 + 후원 CTA |
| `public/memorial.html` (신규·R1 placeholder) | 온라인 추모관 "곧 공개" 차분한 placeholder(R2가 교체) |
| `public/admin-family-stories.html` + `js/admin-family-stories.js` (신규) | 운영자 도구 |
| `public/cms-tbfa.html` + `js/cms-tbfa.js` (수정) | iframe 4곳 등록 |

**GNB 추가**(header.html, news `<li>`(93줄)와 donate `<li>`(95줄) 사이):
```html
<li data-page="memorial">
  <a href="/memorial.html">추모관</a>
  <ul class="dropdown">
    <li><a href="/memorial.html">🕯️ 온라인 추모관</a></li>
    <li><a href="/family-stories.html">🕊️ 유가족 이야기</a></li>
  </ul>
</li>
```

**family-stories.html 레이아웃**:
```
[헤더]
[page-hero: "유가족 이야기" + 한 줄 소개 — 차분한 톤]
[container]
  [카드 그리드 1열(모바일)→2~3열(PC)]
   ┌───────────────┐
   │ [썸네일 16:9]   │  ← thumbnailUrl, 우하단 duration 배지
   │ category 칩     │
   │ 제목(세리프)     │
   │ summary 2줄     │
   └───────────────┘  카드 클릭 → /family-story.html?id=N
[모달 slot][푸터 slot]
```
- GET `/api/family-stories` → 카드 렌더. 빈 상태 "곧 이야기가 채워집니다".
- 카드 클릭: `location.href='/family-story.html?id='+id` (SPA 외부 이동 규칙 — `<a href>`면 OK).

**family-story.html 레이아웃**:
```
[헤더]
[story-hero: category 칩 · 제목(세리프) · subtitle]
[container]
  [반응형 유튜브 임베드 16:9]  ← <iframe src="https://www.youtube.com/embed/{youtubeId}">
  [detailHtml 본문 — about-cp와 유사한 타이포]
  ─────────────────────────────
  [story-donate-cta]
    "함께 기억해 주세요" + 안내문
    [후원하기 버튼] data-action="open-modal" data-target="donateModal"
  [목록으로 돌아가기]
[모달 slot][푸터 slot]
```
- GET `/api/family-story?id=N`. id 없거나 미발행 → "준비 중인 이야기입니다" + 목록 링크.
- 임베드: `youtube.com/embed/{id}?rel=0`. 반응형 wrapper(padding-top:56.25%).

**admin-family-stories.html**(어드민 단독 페이지·cms iframe):
```
[목록 테이블: 썸네일·제목·상태(draft/published)·정렬·조회수·수정/삭제]
[+ 영상 추가] 버튼 → 폼 패널:
  - 유튜브 URL [입력]  → [정보 가져오기](oEmbed 제목·썸네일 미리보기)
  - 제목 / 부제 / 카드 요약
  - 운영자 메모(영상 맥락) [textarea]  → [✨ AI 초안 생성]
  - 상세 본문 [textarea/에디터]  (AI 초안 결과가 여기로)
  - 분류 select · 정렬 number · 상태(초안/발행) toggle
  - [저장]
```
- `api()` 헬퍼(admin 페이지 패턴) 사용. AI 초안: POST `/api/admin-family-story-ai` → `data.draft`를 폼에 채움(운영자 검수·수정 후 저장).
- 발행 토글·삭제 확인.

**cms-tbfa iframe 4곳**(code_standards §4):
1. 사이드바(콘텐츠/홍보 계열 메뉴 그룹): `<li><a href="#family-stories" data-tab="family-stories"><i>🕊️</i><span>유가족 이야기</span></a></li>`
2. 섹션: `<section class="cms-page nf-iframe-page" id="page-family-stories"><iframe class="nf-iframe" data-nf-src="/admin-family-stories.html" title="유가족 이야기"></iframe></section>`
3. `cms-tbfa.js` tabLabels: `'family-stories': '🕊️ 유가족 이야기',`
4. `cms-tbfa.js` 탭 분기: `else if (tab === 'family-stories') _nfLoadIframe('page-family-stories');`

**캐시버스터**: 신규 JS `?v=1`. 수정 파일(header는 partial·no-store라 무관, cms-tbfa.js는 `?v=` 갱신).

**순수 JS 준수**(code_standards §3): public/js/*.js 에 TS 문법(`as`, `interface`, 제네릭) 금지. `node --check` 통과.

---

## §4. 검증 시나리오 (C)

| # | 시나리오 | 기대 |
|---|---|---|
| Q1 | 임의 페이지 상단 "추모관" hover | 드롭다운(온라인 추모관·유가족 이야기) 노출 |
| Q2 | 유가족 이야기 클릭 | `/family-stories.html` 갤러리, 카드 렌더(발행분) |
| Q3 | 카드 클릭 | `/family-story.html?id=N` 상세, 유튜브 임베드 재생 |
| Q4 | 상세 하단 "후원하기" | 후원 모달(donateModal) 오픈 |
| Q5 | 어드민 영상 추가: URL 입력→정보 가져오기 | 제목·썸네일 자동 표시 |
| Q6 | 어드민 ✨AI 초안 생성 | 부제·요약·본문 초안이 폼에 채워짐(실패 시 안내 토스트) |
| Q7 | 어드민 발행 토글 후 갤러리 새로고침 | 발행분만 공개에 노출 |
| Q8 | 어드민 삭제 | 목록·공개에서 제거 |
| Q9 | 4개 시드 | (URL 연결·발행 시) 상세 본문 정상 |
| R1 | 회귀: 기존 GNB·후원 모달·로그인·cms 사이드바 | 정상 |
| R2 | `npx tsc --noEmit` / `node --check` / `/api/*` 401 게이트 | 통과 |

C 검증 방식 명시 의무(라이브 불가 항목은 정독·라우팅 확인으로). 보고서 `docs/history/verify/2026-05-24-memorial-r1.md`.

---

## §5. mock 데이터 + 시드 본문

### §5.1 A용 mock (B 머지 전 — family-stories.js 상단 상수)

```javascript
const MOCK_STORIES = [
  { id:1, youtubeId:"xJLia-INHvI", title:"서이초 사건 그 이후... 교사유가족협의회란?",
    subtitle:"왜 우리가 모였는가", thumbnailUrl:"https://i.ytimg.com/vi/xJLia-INHvI/hqdefault.jpg",
    summary:"한 선생님의 죽음 이후, 유가족이 직접 만든 협의회의 시작과 약속.", duration:"5:38", category:"intro" },
  { id:2, youtubeId:"6DhgPY_c0Gw", title:"[1분 인터뷰] 유가족의 목소리... 함께 들어주세요",
    subtitle:"짧지만 깊은, 남겨진 이들의 한마디", thumbnailUrl:"https://i.ytimg.com/vi/6DhgPY_c0Gw/hqdefault.jpg",
    summary:"1분 남짓한 시간에 담긴 유가족의 진심. 가장 먼저 들어주세요.", duration:"1:22", category:"voice" },
  { id:3, youtubeId:"XY8cwu1wfZQ", title:"[유가족의 목소리] 교사 유가족의 인터뷰",
    subtitle:"긴 호흡으로 듣는 이야기", thumbnailUrl:"https://i.ytimg.com/vi/XY8cwu1wfZQ/hqdefault.jpg",
    summary:"16분, 유가족이 직접 들려주는 그날 이후의 삶과 바람.", duration:"16:51", category:"interview" },
  { id:4, youtubeId:"l97eBPM_d9E", title:"[유가족의 목소리] 교육공동체 헌정 영상",
    subtitle:"기억을 모아 만든 헌정", thumbnailUrl:"https://i.ytimg.com/vi/l97eBPM_d9E/hqdefault.jpg",
    summary:"먼저 떠난 선생님들과 교육공동체에 바치는 짧은 헌정 영상.", duration:"2:34", category:"tribute" },
];
```

### §5.2 시드 (메인 작성 — 마이그 INSERT용 · status='published')

> Swain이 4개 영상 URL 제공(2026-05-24·oEmbed로 실제 제목 확인). 아래 매핑대로 **published** 시드. 운영자가 어드민에서 수정·비공개 가능.

| sort_order | youtube_id | youtube_url | 실제 제목(title) | category | duration | 본문 |
|---|---|---|---|---|---|---|
| 1 | xJLia-INHvI | https://www.youtube.com/watch?v=xJLia-INHvI | 서이초 사건 그 이후... 교사유가족협의회란? | intro | 5:38 | ② |
| 2 | 6DhgPY_c0Gw | https://www.youtube.com/watch?v=6DhgPY_c0Gw | [1분 인터뷰] 유가족의 목소리... 함께 들어주세요 | voice | 1:22 | ① |
| 3 | XY8cwu1wfZQ | https://www.youtube.com/watch?v=XY8cwu1wfZQ | [유가족의 목소리] 교사 유가족의 인터뷰 | interview | 16:51 | ④ |
| 4 | l97eBPM_d9E | https://www.youtube.com/watch?v=l97eBPM_d9E | [유가족의 목소리] 교육공동체 헌정 영상 | tribute | 2:34 | ③ |

`thumbnail_url = https://i.ytimg.com/vi/{youtube_id}/hqdefault.jpg`. subtitle/summary는 §5.1 mock과 동일. published_at = now(). 아래 본문 detailHtml ①②③④:

**① [1분 인터뷰] 유가족의 목소리 — 함께 들어주세요** (category: voice, duration: 1:22)
```html
<p>채 1분이 되지 않는 짧은 시간입니다. 그러나 이 한마디를 꺼내기까지, 남겨진 이들은 수없이 많은 밤을 건너왔습니다.</p>
<p>화려한 말도, 거창한 호소도 없습니다. 다만 "우리를 잊지 말아 달라"는, 가장 단순하고 가장 절박한 부탁이 담겨 있을 뿐입니다.</p>
<h3>지금, 들어주세요</h3>
<p>듣는 일에는 자격이 필요하지 않습니다. 잠시 하던 일을 멈추고 이 목소리에 귀를 기울이는 것 — 그것만으로도 유가족에게는 큰 위로가 됩니다. 함께 들어주셔서 고맙습니다.</p>
```

**② 서이초 사건 그 이후… 교사유가족협의회란?** (category: intro, duration: 5:38)
```html
<p>한 선생님이 우리 곁을 떠났습니다. 그 비통한 사건은 전국의 교사와 시민의 마음을 움직였고, 거리에는 추모의 촛불이 켜졌습니다.</p>
<p>(사)교사유가족협의회는 그렇게 남겨진 유가족들이 직접 손을 맞잡고 만든 단체입니다. 같은 아픔을 겪은 이들이 서로의 곁을 지키고, 다시는 같은 일이 반복되지 않도록 진상규명과 제도 개선을 요구하기 위해 모였습니다.</p>
<h3>우리가 하는 일</h3>
<p>유가족 심리상담과 법률 지원, 순직(공무상 재해) 인정 지원, 추모와 장학 사업, 그리고 교권 보호를 위한 연대 — 협의회는 슬픔을 딛고 행동으로 기억합니다.</p>
<p>이 영상은 협의회가 어떻게 시작되었고 무엇을 향해 나아가는지를 5분 남짓한 시간에 담았습니다. 함께해 주시는 한 분 한 분이 우리의 힘입니다.</p>
```

**③ [유가족의 목소리] 교육공동체 헌정 영상** (category: tribute, duration: 2:34)
```html
<p>먼저 떠난 선생님들, 그리고 지금도 교단을 지키는 모든 선생님께 바치는 짧은 헌정입니다.</p>
<p>한 사람의 교사는 수백 명의 아이를 길러냅니다. 그 헌신과 사랑은 쉽게 보이지 않지만, 우리 사회 어디에나 남아 있습니다. 이 영상은 그 보이지 않던 마음을 한 자리에 모았습니다.</p>
<h3>기억이 곧 연대입니다</h3>
<p>잊지 않는 것, 함께 기억하는 것 — 그것이 남겨진 이들이 가장 바라는 일입니다. 2분 30초의 시간 동안, 우리 곁을 스쳐 간 소중한 이름들을 함께 떠올려 주세요.</p>
```

**④ [유가족의 목소리] 교사 유가족의 인터뷰** (category: interview, duration: 16:51)
```html
<p>16분, 결코 짧지 않은 시간 동안 유가족이 직접 들려주는 이야기입니다. 그날 이후 달라진 일상, 견뎌낸 시간, 그리고 여전히 품고 있는 바람까지 — 꾸밈없이 담았습니다.</p>
<p>인터뷰 속 한마디 한마디에는 한 가정이 감당해야 했던 무게가 실려 있습니다. 동시에, 같은 아픔을 겪을지 모를 누군가를 위해 용기 내어 카메라 앞에 선 마음도 함께 담겨 있습니다.</p>
<h3>끝까지 들어주세요</h3>
<p>긴 이야기이지만, 끝까지 함께해 주시길 부탁드립니다. 한 사람의 진심을 온전히 듣는 일은, 그 자체로 가장 따뜻한 연대입니다.</p>
```

---

## §6. 4채팅 시작 프롬프트

> 베이스: **origin/main 최신**(본 설계서 푸시 커밋). 트리거 셋업 블록의 `{BASE_HASH}`는 메인이 푸시 후 채팅 응답에 실제 해시로 채워 전달.

### §6.1 B 트리거 (feature/memorial-r1-back) — 🔧 백엔드 전용
→ 본 설계서 §1·§2 + 아래 트리거(메인 응답에 전문 출력).

### §6.2 A 트리거 (feature/memorial-r1-front) — 🎨 프론트엔드 전용
→ 본 설계서 §3·§5.1 + 아래 트리거.

### §6.3 C 트리거 (verify/memorial-r1) — 🔍 검증 전용
→ 본 설계서 §4 + 아래 트리거.

(트리거 전문은 메인 채팅 응답에 직접 출력 — workflow_standards §4)

---

## §7. 라운드 마감 체크리스트

- [ ] B 머지 → Swain `migrate-family-stories?run=1` → schema 활성화·마이그 삭제 → A 머지 → C 검증
- [ ] 응답 키 A mock ↔ B 실 API 1:1 대조
- [ ] cms-tbfa iframe 4곳 등록 확인(사이드바 클릭→로드)
- [ ] AI featureKey `memorial_story_detail` 등록·권한 매트릭스 반영(release_checklist #2)
- [ ] 메뉴얼(manual.html·manual-admin.html) "추모관/유가족이야기" 섹션 추가(release_checklist #3)
- [ ] PROJECT_STATE·HANDOFF 갱신
- [ ] Swain께 4개 영상 URL 요청 → 시드 발행

---

## §8. R2 개요 (다음 라운드 — 온라인 추모관 본체)

- **DB**: `memorial_teachers`(영정·약력·생몰·학교지역·공개·정렬·타임라인 JSONB) / `memorial_offerings`(촛불·국화 2종·teacherId nullable=통합·회원 or 닉네임·ip해시 rate limit) / `memorial_messages`(통합+개별·공감·신고·숨김) / `memorial_letters`(기억의 편지).
- **API**: 선생님 목록·상세, 헌화 등록(+카운트), 메시지 목록·작성·공감·신고, 편지 목록·작성, 어드민 선생님 CRUD·메시지 모더레이션.
- **Front**: `memorial.html`(히어로 유족영상·실시간 카운터·통합 촛불/국화 헌화·통합 방명록) / `memorial-teacher.html?id=N`(개별 프로필·약력·타임라인·개별 헌화·메시지·편지) / `admin-memorial.html`.
- **BGM**: 사이트(추모관) 멀티트랙 플레이어·음소거 토글·localStorage 기억·영상 재생 시 페이드. 음원 Pixabay Music 저작권 자유곡(Swain 배치).
- **추가 채택**: 메시지 공감(♡)·신고·운영자 숨김·헌화 2종 사용자 선택.
- **2차 이후 보류**: 자료실·공유카드(PNG·SNS)·추모일 구독 알림·다국어.
