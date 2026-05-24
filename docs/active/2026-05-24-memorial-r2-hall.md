# 온라인 추모관 R2 — 추모관 본체 (설계서)

> 2026-05-24 · 메인(Opus) 설계 · 병렬 A·B·C
> 상위 기획: [`docs/specs/온라인추모관_기능명세_워크플로우.md`](../specs/온라인추모관_기능명세_워크플로우.md)
> R1(유가족 이야기) 완료 후속. R2 = 통합 추모 + 개별 선생님 페이지 + BGM **한 라운드 전부**(Swain: 유가족 동의 확보).

---

## §0. 요구사항 확정 (Swain 결정)

| 항목 | 결정 |
|---|---|
| 범위 | 통합 추모(히어로·카운터·헌화·방명록) + 개별 선생님 페이지(프로필·약력·타임라인·개별 헌화·메시지·편지) + BGM **한 번에** |
| 헌화 종류 | **촛불·국화 2종, 사용자 선택**(촛불 기본). 카운터는 합산 표시 |
| 헌화 권한 | 비회원도 닉네임으로 가능 + 디바이스(ip 해시) 기준 가벼운 과도 방지. 메시지·편지 **작성은 회원**(열람 누구나) |
| 메시지 | 짧은 추모 메시지(≤1000자) + 공감(♡) + 신고 → 운영자 숨김 |
| 기억의 편지 | 긴 글, 개별 선생님 페이지 별도 섹션. 작성 회원 |
| 히어로 영상 | 교육공동체 헌정 영상(`l97eBPM_d9E`) 기본 — **어드민에서 교체 가능**(memorial_settings) |
| BGM | 무료 음원(Pixabay Music) 추천 + 멀티트랙 플레이어·음소거 토글·설정 기억·영상 재생 시 페이드. 음원 파일은 Swain이 `/assets/audio/`에 배치, 목록은 어드민 설정 |
| 어드민 | 싸이렌 어드민 **🕯️ 추모관 관리** 그룹(이미 신설)에 합류: 선생님 CRUD·메시지/편지 모더레이션·추모관 설정 |
| 선생님 시드 | 실제 정보(성함·생몰일·학교/지역·헌사·약력·타임라인)는 Swain 제공 → 메인이 상세 구성. 영정 사진은 어드민 업로드(기본 실루엣). 미제공 시 빈 그리드(차분한 empty state) |
| §6.18 | 모든 콘텐츠(히어로·BGM·선생님·문구)는 어드민 관리. 하드코딩 금지 |

**2차 이후 보류**: 공유카드(PNG·SNS), 자료실, 추모일 구독 알림, 다국어.

---

## §1. DB 설계 (B)

`db/schema.ts` 파일 끝 append(본인 섹션 헤더). import 점검: `date, jsonb, uniqueIndex` (기존 존재).

```typescript
/* === 추모관 R2: 온라인 추모관 본체 (2026-05-24) === */
export const memorialSettings = pgTable("memorial_settings", {
  id:            serial("id").primaryKey(),
  heroYoutubeId: varchar("hero_youtube_id", { length: 20 }),
  heroCopy:      varchar("hero_copy", { length: 300 }),
  bgmTracks:     jsonb("bgm_tracks"),                       // [{title,url}]
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});
export const memorialTeachers = pgTable("memorial_teachers", {
  id:           serial("id").primaryKey(),
  name:         varchar("name", { length: 60 }).notNull(),
  photoBlobId:  integer("photo_blob_id"),                  // null = 실루엣
  schoolRegion: varchar("school_region", { length: 120 }),
  birthDate:    date("birth_date"),
  deathDate:    date("death_date"),
  tributeLine:  varchar("tribute_line", { length: 200 }),
  bioHtml:      text("bio_html"),
  timeline:     jsonb("timeline"),                         // [{date,title,desc}]
  isPublic:     boolean("is_public").default(true).notNull(),
  sortOrder:    integer("sort_order").default(0).notNull(),
  createdBy:    integer("created_by"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ pubSortIdx: index("memorial_teachers_pub_sort_idx").on(t.isPublic, t.sortOrder) }));
export const memorialOfferings = pgTable("memorial_offerings", {
  id:           serial("id").primaryKey(),
  teacherId:    integer("teacher_id"),                     // null = 통합 헌화
  memberId:     integer("member_id"),
  nickname:     varchar("nickname", { length: 40 }),
  offeringType: varchar("offering_type", { length: 10 }).notNull(),  // candle|flower
  ipHash:       varchar("ip_hash", { length: 64 }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ teacherIdx: index("memorial_offerings_teacher_idx").on(t.teacherId) }));
export const memorialMessages = pgTable("memorial_messages", {
  id:          serial("id").primaryKey(),
  teacherId:   integer("teacher_id"),                      // null = 통합 방명록
  memberId:    integer("member_id"),
  authorName:  varchar("author_name", { length: 50 }).notNull(),
  content:     varchar("content", { length: 1000 }).notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  likeCount:   integer("like_count").default(0).notNull(),
  reportCount: integer("report_count").default(0).notNull(),
  isHidden:    boolean("is_hidden").default(false).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ teacherIdx: index("memorial_messages_teacher_idx").on(t.teacherId, t.isHidden) }));
export const memorialLetters = pgTable("memorial_letters", {
  id:          serial("id").primaryKey(),
  teacherId:   integer("teacher_id").notNull(),
  memberId:    integer("member_id"),
  authorName:  varchar("author_name", { length: 50 }).notNull(),
  title:       varchar("title", { length: 150 }),
  content:     text("content").notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  reportCount: integer("report_count").default(0).notNull(),
  isHidden:    boolean("is_hidden").default(false).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
export const memorialMessageLikes = pgTable("memorial_message_likes", {
  id:        serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  memberId:  integer("member_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ uniq: uniqueIndex("memorial_msg_like_uniq").on(t.messageId, t.memberId) }));
```

**마이그**: `netlify/functions/migrate-memorial.ts` — GET `?run=1` + requireAdmin, GET=진단, 멱등. 6테이블 CREATE IF NOT EXISTS + 인덱스 + **memorial_settings 시드 1행**(hero_youtube_id='l97eBPM_d9E', hero_copy='우리는 당신들을 기억합니다', bgm_tracks='[]'). 선생님 시드는 Swain 데이터 확보 후 별도(또는 어드민 입력). 호출 성공 후 파일 삭제.

---

## §2. API 명세 (B) — 공개 6 + 어드민 3

모든 함수 `export const config = { path }`. 단계별 try/catch(step·detail·stack). 보조 SELECT 실패는 빈 배열/0으로 계속.

### 공개
| 함수 | 경로 | 가드 | 설명 |
|---|---|---|---|
| `memorial-summary.ts` | GET `/api/memorial-summary` | 공개 | 카운터 + 히어로 + BGM 트랙 |
| `memorial-teachers.ts` | GET `/api/memorial-teachers` | 공개 | 공개 선생님 그리드(카드 + 카운트) |
| `memorial-teacher.ts` | GET `/api/memorial-teacher?id=N` | 공개 | 개별 상세 + 타임라인 + 카운트 |
| `memorial-offering.ts` | POST `/api/memorial-offering` | 게스트 허용 | 촛불/국화 헌화(+ip 과도 방지) |
| `memorial-messages.ts` | GET/POST `/api/memorial-messages` | GET 공개·POST requireActiveUser | 목록·작성·`?action=like\|report` |
| `memorial-letters.ts` | GET/POST `/api/memorial-letters` | GET 공개·POST requireActiveUser | 편지 목록·작성 |

### 어드민 (requireAdmin·auth.res)
| 함수 | 경로 | 설명 |
|---|---|---|
| `admin-memorial-teachers.ts` | GET/POST/PATCH/DELETE `/api/admin-memorial-teachers` | 선생님 CRUD(photoBlobId는 /api/blob-upload로 업로드 후 전달) |
| `admin-memorial-moderation.ts` | GET/PATCH/DELETE `/api/admin-memorial-moderation` | 메시지·편지 목록(신고순)·숨김 토글·삭제 |
| `admin-memorial-settings.ts` | GET/PATCH `/api/admin-memorial-settings` | 히어로 영상·헌사 카피·BGM 트랙 목록 |

**응답 구조 (키명 고정 — A mock 기준)**:
```jsonc
GET /api/memorial-summary → {ok:true,data:{
  counters:{people:1234, candles:5678, messages:910},
  hero:{youtubeId:"l97eBPM_d9E", copy:"우리는 당신들을 기억합니다"},
  bgmTracks:[{title:"…", url:"/assets/audio/memorial-1.mp3"}] }}
GET /api/memorial-teachers → {ok:true,data:{teachers:[
  {id:1, name:"…", photoUrl:"/api/blob-image?id=12"|null, schoolRegion:"…",
   tributeLine:"…", candleCount:12, messageCount:5}]}}
GET /api/memorial-teacher?id=1 → {ok:true,data:{teacher:{
  id,name,photoUrl,schoolRegion,birthDate,deathDate,tributeLine,bioHtml,
  timeline:[{date,title,desc}], candleCount,messageCount,letterCount }}}
POST /api/memorial-offering {teacherId?,type:"candle"|"flower",nickname?}
  → {ok:true,data:{candles:N, flowers:M, total:T}}   // 갱신 카운트
GET /api/memorial-messages?teacherId=&page=1 → {ok:true,data:{messages:[
  {id,authorName,content,likeCount,createdAt,liked:false}], pagination:{page,total,hasMore}}}
POST /api/memorial-messages {teacherId?,content,isAnonymous} → {ok:true,data:{message:{…}}}
POST /api/memorial-messages?action=like&id=N → {ok:true,data:{likeCount,liked}}
POST /api/memorial-messages?action=report&id=N → {ok:true,message}
GET /api/memorial-letters?teacherId=1 → {ok:true,data:{letters:[{id,authorName,title,content,createdAt}]}}
POST /api/memorial-letters {teacherId,title,content,isAnonymous} → {ok:true,data:{letter:{…}}}
admin-memorial-teachers GET → {ok:true,data:{teachers:[{…전체필드+isPublic,sortOrder}]}}
  POST/PATCH → {ok:true,data:{teacher:{…}},message} · DELETE?id=N → {ok:true,message}
admin-memorial-moderation GET?type=message|letter → {ok:true,data:{items:[…+reportCount,isHidden]}}
  PATCH?type=&id=N {isHidden} → {ok:true,message} · DELETE?type=&id=N → {ok:true,message}
admin-memorial-settings GET → {ok:true,data:{settings:{heroYoutubeId,heroCopy,bgmTracks}}}
  PATCH {heroYoutubeId,heroCopy,bgmTracks} → {ok:true,data:{settings},message}
```

**카운터**: COUNT 쿼리. candles=offerings(candle), flowers=offerings(flower), messages=messages(미숨김), people=distinct(memberId 또는 nickname 또는 ipHash). 각 try/catch.
**헌화 과도 방지**: 같은 (teacherId, ipHash) 단시간(예: 10초) 중복 무시 또는 하루 상한. 게스트 nickname 평문 저장 OK(명세 §개인정보는 임시 토큰 권장이나 R2는 닉네임만·민감정보 없음).
**photoUrl**: photoBlobId 있으면 `/api/blob-image?id=N`, 없으면 null(프론트 실루엣).

---

## §3. 화면 설계 (A)

스캐폴드: fonts + base/layout/components/pages.css?v=3, body data-page="memorial", header-slot/main/modals-slot/footer-slot + common.js?v=4 + 페이지JS?v=1 + memorial-bgm.js?v=1.

| 파일 | 내용 |
|---|---|
| `public/memorial.html` (교체) | R1 placeholder → 통합 추모 본체 |
| `public/js/memorial.js` (신규) | 카운터·헌화·방명록·그리드 로직 |
| `public/memorial-teacher.html` + `js/memorial-teacher.js` (신규) | 개별 선생님 페이지 |
| `public/admin-memorial.html` + `js/admin-memorial.js` (신규) | 운영자 도구(선생님 CRUD·모더레이션·설정) |
| `public/js/memorial-bgm.js` (신규) | BGM 멀티트랙 플레이어(공통) |
| `public/cms-tbfa.html` + `js/cms-tbfa.js` (수정) | 🕯️ 추모관 관리 그룹에 '추모관 관리'(admin-memorial) iframe 4곳 등록 |

**memorial.html (롱스크롤)**:
```
[헤더]
[① 히어로] 헌정 영상(youtube embed, 무음 루프 가능) + 헌사 카피 + 스크롤 힌트
[② 실시간 카운터] 함께 기억한 사람 / 켜진 촛불·국화 / 남겨진 메시지 (스크롤 시 count-up)
[③ 통합 촛불·국화 헌화] [🕯️ 촛불][🏵️ 국화] 선택 → 닉네임(선택) → 헌화 → 화면에 불꽃/국화 플로팅 추가·카운트++
[④ 개별 선생님 그리드] 카드(영정/실루엣·성함·학교지역·한줄헌사·🕯️N ·💬N) → /memorial-teacher.html?id=N. 빈 상태 "곧 추모 공간이 마련됩니다"
[⑤ 통합 방명록] 모든 선생님께 — 최근 글(무한 스크롤)·공감♡·신고. 작성: 회원(비회원 클릭 시 로그인 안내)
[⑥ 후원 연결] 후원하기 CTA(donateModal)
[모달·푸터]
[우상단 고정 BGM 토글] (memorial-bgm.js)
```

**memorial-teacher.html?id=N**:
```
[헤더]
[프로필] 영정/실루엣·성함·학교지역·생몰일·한줄헌사
[약력] bioHtml
[타임라인] 세로형(date·title·desc)
[개별 촛불·국화 헌화] (개별 카운트)
[추모 메시지] 방명록(짧은 글·공감·신고) — teacherId=N
[기억의 편지] 펼침/접힘 섹션·긴 글·작성 회원 — teacherId=N
[공유] 링크 복사(PNG 카드는 R3) + 후원 CTA
[목록으로]
```

**admin-memorial.html** (cms iframe·🕯️ 추모관 관리 그룹):
```
[탭/섹션 3개]
1. 선생님 관리: 목록(영정·성함·공개·정렬·수정/삭제) + 추가/수정 폼
   (성함·영정 업로드[blob-upload]·학교지역·생몰일·한줄헌사·약력·타임라인 이벤트 추가/삭제·공개·정렬)
2. 메시지·편지 모더레이션: 신고순 목록·숨김 토글·삭제(통합/개별 필터)
3. 추모관 설정: 히어로 유튜브 ID·헌사 카피·BGM 트랙(제목+URL 목록 추가/삭제)
```

**BGM (memorial-bgm.js)**: GET /api/memorial-summary의 bgmTracks 사용. 우상단 고정 토글(🔇/🔊). **음소거 상태로 시작**(브라우저 자동재생 정책)·사용자 클릭 시 재생·`localStorage('memorial_bgm_muted')` 기억. 트랙 순환. **영상(히어로·개별) 재생 시 BGM 페이드아웃 → 종료 시 페이드인**. 모바일 데이터 절약 감지 시 자동 음소거.
> **음원 추천(저작권 자유·Pixabay Music)**: pixabay.com/music 에서 `calm piano` / `sad emotional piano` / `ambient memorial` 검색 → 2~3곡 다운로드 → `/assets/audio/memorial-1.mp3`(2.mp3·3.mp3)로 배치 → 어드민 설정에 제목·URL 등록. (예: "Sad Piano", "Emotional Piano", "Peaceful Ambient" 류)

**cms iframe 4곳**(🕯️ 추모관 관리 그룹·유가족 이야기 아래):
① 사이드바: `<li><a href="#memorial-admin" data-tab="memorial-admin"><i>🕯️</i><span>추모관 관리</span></a></li>`
② 섹션: `<section class="cms-page nf-iframe-page" id="page-memorial-admin"><iframe class="nf-iframe" data-nf-src="/admin-memorial.html" title="추모관 관리"></iframe></section>`
③ cms-tbfa.js tabLabels: `'memorial-admin': '🕯️ 추모관 관리',`
④ cms-tbfa.js 분기: `else if (tab === 'memorial-admin') _nfLoadIframe('page-memorial-admin');`
(주의: 사이드바 그룹명 '추모관 관리'와 탭명 충돌 피하려 탭 라벨은 '추모관 운영' 등으로 — A 판단)

**순수 JS**(code_standards §3): TS 문법 금지·`node --check`. 캐시버스터 신규 ?v=1.

---

## §4. 검증 시나리오 (C)

| # | 시나리오 | 기대 |
|---|---|---|
| Q1 | 추모관 → 온라인 추모관 → /memorial.html | 히어로 영상·카운터·헌화·그리드·방명록 렌더 |
| Q2 | 통합 촛불/국화 헌화(비회원 닉네임) | 카운트++·화면 플로팅 추가 |
| Q3 | 통합 방명록 — 비회원 작성 시도 | 로그인 안내. 회원 작성 성공·공감·신고 |
| Q4 | 선생님 카드 클릭 → 개별 페이지 | 프로필·약력·타임라인·개별 헌화·메시지·편지 |
| Q5 | 개별 페이지 헌화/메시지/편지 | 개별 카운트·작성(회원) |
| Q6 | BGM 토글 | 음소거 시작·클릭 재생·새로고침 유지·영상 재생 시 페이드 |
| Q7 | 후원 CTA | donateModal |
| Q8 | 어드민: 선생님 추가(영정 업로드)·수정·공개토글·삭제 | 그리드 반영 |
| Q9 | 어드민: 메시지 숨김·삭제 | 공개 반영 |
| Q10 | 어드민: 히어로 영상·헌사·BGM 트랙 변경 | memorial.html 반영 |
| Q11 | cms iframe(🕯️ 추모관 관리 그룹) 로드 | 추모관 운영 화면 |
| R | 회귀: 기존 GNB·후원·로그인·유가족 이야기(R1)·cms | 정상 |
| T | tsc / node --check / /api 라우팅(9종 config)·401 게이트 | 통과 |

어드민 라이브는 Swain 분담(C 계정 없으면 정독·라우팅). 보고서 `docs/history/verify/2026-05-24-memorial-r2.md`.

---

## §5. mock + 시드

### §5.1 A mock (memorial.js·memorial-teacher.js 상단)
```javascript
const MOCK_SUMMARY = { counters:{people:1280,candles:3540,messages:870},
  hero:{youtubeId:"l97eBPM_d9E",copy:"우리는 당신들을 기억합니다"},
  bgmTracks:[{title:"잔잔한 피아노",url:"/assets/audio/memorial-1.mp3"}] };
const MOCK_TEACHERS = [
  {id:1,name:"故 ○○○ 선생님",photoUrl:null,schoolRegion:"서울",tributeLine:"아이들을 사랑한 선생님",candleCount:128,messageCount:34},
];
const MOCK_TEACHER = {id:1,name:"故 ○○○ 선생님",photoUrl:null,schoolRegion:"서울 ○○초",
  birthDate:null,deathDate:null,tributeLine:"아이들을 사랑한 선생님",
  bioHtml:"<p>약력은 유가족 협조하에 작성됩니다.</p>",
  timeline:[{date:"2023-00-00",title:"추모",desc:"기억합니다"}],candleCount:128,messageCount:34,letterCount:5};
const MOCK_MESSAGES = [{id:1,authorName:"시민",content:"잊지 않겠습니다.",likeCount:12,createdAt:"2026-05-24T00:00:00Z",liked:false}];
```

### §5.2 시드 (마이그)
- **memorial_settings 1행**: heroYoutubeId='l97eBPM_d9E', heroCopy='우리는 당신들을 기억합니다', bgmTracks='[]'.

**선생님 8분 시드 (메인 조사·작성 — 공개 보도 기반)**
> 영정 사진(photo_blob_id) null → 실루엣. 어드민에서 업로드·실명·세부 보완. 모두 `is_public=true`(Swain 결정: 바로 공개).
> ✅ Swain 확정(2026-05-24): 대전=관평초(2019~2022)·용산초(2023) / 실명='확인된 실명 모두 사용'(현재 공개 확인 실명은 호원초 이영승·김은지 두 분 — 나머지는 보도상 'A씨·○○초 교사'로만 다뤄져 미공개 → 학교 기준 표기, 유가족 통해 실명 확보 시 반영) / is_public=true.

| sort | name | school_region | death_date | offering/카운트 |
|---|---|---|---|---|
| 1 | 故 서이초 선생님 | 서울 서초구 서이초등학교 | 2023-07-18 | — |
| 2 | 故 이영승 선생님 | 경기 의정부 호원초등학교 | (2021-12) | — |
| 3 | 故 김은지 선생님 | 경기 의정부 호원초등학교 | (2021) | — |
| 4 | 故 상명대부설초 선생님 | 서울 종로구 상명대사대부속초 | (2023-01) | — |
| 5 | 故 신목초 선생님 | 서울 양천구 신목초등학교 | 2023-08-31 | — |
| 6 | 故 무녀도초 선생님 | 전북 군산 무녀도초등학교 | 2023-08-31 | — |
| 7 | 故 대전 선생님 | 대전 관평초(2019~2022)·용산초(2023) | 2023-09-07 | — |
| 8 | 故 제주 선생님 | 제주 모 중학교 | 2025-05-22 | — |

tribute_line / bio_html / timeline (각 행):

**1. 故 서이초 선생님** — tribute: "아이들 곁에서 빛났던, 우리가 끝내 지키지 못한 선생님"
bio_html: `<p>2023년 7월, 서울 서이초등학교의 젊은 선생님이 학교 안에서 세상을 떠났습니다. 교권 침해와 과중한 부담에 대한 사회적 논의에 불을 지핀 이 죽음 앞에서, 검은 옷을 입은 수만 명의 교사와 시민이 거리로 나와 "교사가 살아야 교육이 산다"고 외쳤습니다.</p><p>49재였던 9월 4일에는 전국에서 10만 명이 넘는 교사가 추모에 함께했습니다. 2024년 2월, 선생님의 죽음은 순직(공무상 재해)으로 인정되었습니다. 우리는 이 죽음이 한 사람의 비극이 아니라 우리 모두의 책임임을 기억합니다.</p>`
timeline: `[{"date":"2023-07-18","title":"별세","desc":"학교에서 세상을 떠나심"},{"date":"2023-07-22","title":"첫 추모 집회","desc":"전국 교사 거리로"},{"date":"2023-09-04","title":"49재·공교육 멈춤의 날","desc":"10만+ 추모"},{"date":"2024-02-27","title":"순직 인정","desc":"공무상 재해 인정"}]`

**2. 故 이영승 선생님** — tribute: "첫 발령지에서 아이들을 만났던 새내기 선생님"
bio_html: `<p>2021년, 의정부 호원초등학교의 새내기 선생님이 학부모들의 악성 민원에 시달리다 세상을 떠났습니다. 학교는 한때 단순 추락사로 보고했지만, 유가족의 끈질긴 진상규명 끝에 진실이 드러났습니다.</p><p>2023년 10월, 선생님의 죽음은 순직으로 인정되었습니다. 그 인정은 같은 해 같은 학교에서 떠난 동료, 그리고 전국의 교사들이 함께 싸워 얻어낸 결과였습니다.</p>`
timeline: `[{"date":"2021-12","title":"별세"},{"date":"2023-10-18","title":"순직 인정","desc":"인사혁신처 공무상 재해 인정"}]`

**3. 故 김은지 선생님** — tribute: "같은 학교, 같은 아픔 — 함께 기억해야 할 선생님"
bio_html: `<p>호원초등학교에서 6개월 간격으로 떠난 두 새내기 선생님 중 한 분입니다. 안타깝게도 선생님의 죽음은 "개인적 취약성"을 이유로 아직 순직으로 인정받지 못했습니다.</p><p>그러나 같은 학교에서 같은 고통을 겪은 동료의 순직이 인정된 만큼, 선생님의 명예 회복을 위한 노력도 멈추지 않습니다. 우리는 인정 여부와 상관없이 선생님을 똑같이 기억하고 함께합니다.</p>`
timeline: `[{"date":"2021","title":"별세"},{"date":"","title":"순직 미인정","desc":"명예 회복 노력 지속"}]`

**4. 故 상명대부설초 선생님** — tribute: "짧게 머물렀지만 깊이 사랑했던 기간제 선생님"
bio_html: `<p>2022년 봄 상명대학교사범대학부속초등학교에 부임한 기간제 선생님이 학부모의 지속적인 갑질과 과중한 업무에 시달리다 그해 여름 우울증을 진단받고 사직했고, 2023년 1월 끝내 세상을 떠났습니다.</p><p>학교는 선생님의 어려움을 알면서도 도움을 주지 않았던 것으로 조사됐습니다. 기간제라는 이유로 더 외로웠을 선생님을, 우리는 차별 없이 기억합니다.</p>`
timeline: `[{"date":"2022-03","title":"부임"},{"date":"2023-01","title":"별세"},{"date":"2023-12-15","title":"교육청 조사결과 발표"}]`

**5. 故 신목초 선생님** — tribute: "끝까지 아이들을 놓지 않았던 6학년 담임 선생님"
bio_html: `<p>2023년 8월, 서울 신목초등학교에서 6학년 담임을 맡았던 선생님이 학생 지도와 학부모 민원의 무게를 홀로 감당하다 세상을 떠났습니다. 어려운 학급을 끝까지 책임지려 애썼던 선생님이었습니다.</p><p>사건 직후 학교의 책임 회피와 함구 종용이 알려지며 교사 사회의 공분을 샀고, 동료들은 진상규명을 요구했습니다. 이후 인사혁신처는 선생님의 죽음과 업무 사이 인과관계를 인정해 순직으로 결정했습니다.</p>`
timeline: `[{"date":"2023-08-31","title":"별세"},{"date":"2023-09-01","title":"교사노조 성명","desc":"진상규명 촉구"},{"date":"","title":"순직 인정"}]`

**6. 故 무녀도초 선생님** — tribute: "작은 섬 학교에서 아이들과 함께한 선생님"
bio_html: `<p>2023년 8월, 전북 군산의 작은 섬 학교에서 6학년 담임을 맡았던 선생님이 세상을 떠났습니다. 교사가 단 세 명뿐인 초미니 학교에서 담임과 방과후·행정 업무까지 감당했고, 상급자의 사적인 일에 동원되는 등 과중한 격무와 부당한 처우에 시달린 정황이 전해졌습니다.</p><p>유가족과 동료들은 선생님의 순직 인정을 위해 재심을 청구하며 진상규명을 이어가고 있습니다.</p>`
timeline: `[{"date":"2023-08-31","title":"별세"},{"date":"2024-04-17","title":"순직 재심 청구","desc":"전북교사노조"}]`

**7. 故 대전 선생님** — tribute: "24년간 교단을 지킨, 끝내 무너지지 않으려 했던 선생님"
bio_html: `<p>24년차 베테랑 선생님이 4년에 걸친 학부모의 악성 민원과 무고성 아동학대 신고(이후 무혐의)로 깊은 상처를 안고 살아왔습니다. 2023년 서이초 사건을 계기로 자신의 교권 침해 경험을 동료들에게 알리며 변화를 호소하던 중, 그해 9월 끝내 세상을 떠났습니다.</p><p>2024년 4월, 선생님의 죽음은 순직으로 인정되었습니다. 정당한 교육 활동이 어떻게 한 교사를 벼랑으로 내몰 수 있는지를 우리에게 묻습니다.</p>`
timeline: `[{"date":"2023-09-05","title":"쓰러지심"},{"date":"2023-09-07","title":"별세"},{"date":"2024-04","title":"순직 인정"}]`

**8. 故 제주 선생님** — tribute: "제주의 교단을 지킨 선생님"
bio_html: `<p>2025년 5월, 제주의 한 중학교 선생님이 세상을 떠났습니다. 무단결석과 흡연을 한 학생을 생활지도한 뒤, 학생 가족으로부터 밤낮없이 하루 수차례의 항의 전화에 시달려 온 것으로 전해졌습니다.</p><p>서이초 이후에도 달라지지 않은 현실에 분노한 전국의 교사들이 2년 만에 다시 거리로 나와 선생님을 추모하고 교권 보호 대책을 촉구했습니다.</p>`
timeline: `[{"date":"2025-05-22","title":"별세"},{"date":"2025-06","title":"전국 교원 추모집회"}]`

> 마이그 INSERT 시: school_region·tribute_line·bio_html·timeline(jsonb)·death_date(불확실 시 null)·is_public=true·sort_order(위 번호). photo_blob_id=null(실루엣).

---

## §6. 4채팅 시작 프롬프트
(메인이 R1 마감 + R2 베이스 push 후 채팅 응답에 전문 출력. 베이스 해시는 push 후 기입.)
- §6.1 B(feature/memorial-r2-back): §1·§2 — 6테이블·마이그·공개6·어드민3·blob 재사용·카운터 COUNT
- §6.2 A(feature/memorial-r2-front): §3·§5.1 — 3페이지·BGM js·cms iframe 4곳(추모관 관리 그룹)
- §6.3 C(verify/memorial-r2): §4

---

## §7. 라운드 마감 체크리스트
- [ ] B 머지 → `migrate-memorial?run=1` → schema 활성화·마이그 삭제 → A 머지 → C 검증
- [ ] 응답 키 A mock ↔ B 1:1
- [ ] cms iframe 4곳(추모관 관리 그룹)·BGM 음원 배치 안내
- [ ] §6.18 점검(히어로·BGM·선생님·문구 전부 어드민 관리)
- [ ] 메뉴얼(manual·manual-admin) 추모관 섹션·PROJECT_STATE·HANDOFF
- [ ] Swain께 선생님 데이터 요청 → 시드/입력
- [ ] 보류 명시: 공유카드 PNG·자료실·추모일 알림(R3+)
