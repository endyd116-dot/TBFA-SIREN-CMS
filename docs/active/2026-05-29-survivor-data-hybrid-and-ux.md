# R43 — 딥릴리프 데이터 축적 하이브리드 + 사건 진행 정보 UX 개선

> **단일 출처**. 본 라운드의 결정·DB·API·화면·검증·mock·트리거·체크리스트 전부 이 문서.
> **베이스**: main (HEAD `00e11ea` 기준 — `feat(martyrdom): auto-reindex approved report when application doc added to closed case`)
> **시작일**: 2026-05-29 / **목표 종결**: 메인 1회 push (B 머지→A 머지→C 검증)
> **범위**: 파트1 데이터 축적(내부+AI 외부 검색 하이브리드) + 파트2 사건 진행 정보 UX(DB 변경 0)

---

## §0. 요구사항·결정 (Swain 확정)

### §0.A 트리거 핵심 결정 (라운드 진입 전)

| # | 결정 | 의미 |
|---|---|---|
| 1 | 초안 RAG=승급 자료만 | AI 수집물은 검토 전엔 신청서 초안 RAG에서 **격리**. RAG 색인 키 신설 `martyr_external`·승급 시 `martyr_case`로 전환 |
| 2 | 출처 표시 | 정식 사례와 AI 자료 시각 구분("AI 분석 자료"·"검증 대기" 배지) |
| 3 | 통계·발간 β | 내부 검증 + 운영자 승급된 자료 합산해 "사례 N건(정식 X·AI 분석 Y)" 단일 숫자 |
| 4 | 수집 주기 | 운영자 요청 즉시 + **2주 cron** |
| 5 | 비용 토글 | 새 featureKey `martyrdom_ai_external` (martyrdom_ai와 분리 — 토글 OFF면 외부 검색 fail-closed·내부 분석은 정상) |

### §0.B AskUserQuestion 결정 (라운드 진입 직후)

| # | 결정 | 의미 |
|---|---|---|
| 6 | **외부 검색=Gemini Search Grounding + 네이버 검색 둘 다** | Gemini=판례·법령·해외(googleSearchRetrieval tool·출처 URL 자동 동봉)·네이버=국내 뉴스(R39 ④ 인프라 재활용) |
| 7 | 저장 모델=신규 테이블 `martyrdom_external_research` | 검토→승급 시 `martyrdom_cases`로 복사. martyrdom_cases는 정식 사례만(혼탁 0) |
| 8 | outcome→status 자동연동 = **확인 다이얼로그 1번** | outcome 저장 시 "작업상태도 종결로 바꿀까요?" 묻기·운영자 실수 방지 |
| 9 | 도메인 화이트리스트 = 정부·공공기관 + 법원·법제처 + 주요 언론 | site:operator로 Gemini Search에 도메인 힌트·DB로 운영자 추가 가능 |

### §0.C 화이트리스트 도메인 (시드)

**정부·공공기관**: `gov.kr`, `moe.go.kr`(교육부), `moel.go.kr`(고용노동부), `mpm.go.kr`(인사혁신처), `geps.or.kr`(공무원연금공단)
**법원·법제처**: `scourt.go.kr`, `glaw.scourt.go.kr`, `casenote.kr`, `law.go.kr`
**언론**: `kbs.co.kr`, `imnews.imbc.com`, `news.sbs.co.kr`, `yna.co.kr`(연합), `hani.co.kr`, `joongang.co.kr`, `chosun.com`, `jtbc.co.kr`, `mk.co.kr`, `hankyung.com`

운영자가 어드민에서 `martyrdom_external_settings` 행에 추가·제거 가능(JSONB 배열·시드 후 자유 편집).

---

## §1. DB 설계

### §1.1 신규 테이블 `martyrdom_external_research`

```typescript
// db/schema.ts 끝에 본인 섹션 헤더 후 추가
/* === R43 딥릴리프 데이터 축적 하이브리드 === */
export const martyrdomExternalResearch = pgTable("martyrdom_external_research", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  sourceUrl: text("source_url"),                  // 출처 URL (Gemini grounding·네이버 link)
  sourceDomain: varchar("source_domain", { length: 200 }),
  searchEngine: varchar("search_engine", { length: 20 }).notNull(),  // 'gemini'|'naver'
  searchQuery: text("search_query"),              // 호출한 검색어
  publishedAt: timestamp("published_at", { withTimezone: true }),
  snippet: text("snippet"),                       // 요약·미리보기
  contentFull: text("content_full"),              // 본문 전체(있을 때)
  status: varchar("status", { length: 20 }).notNull().default("pending"),
    // 'pending'(검토 대기) | 'reviewing'(검토 중) | 'approved'(승급됨) | 'rejected'(기각)
  reviewedByUid: integer("reviewed_by_uid").references(() => members.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  promotedCaseId: integer("promoted_case_id").references(() => martyrdomCases.id, { onDelete: "set null" }),
  meta: jsonb("meta").$type<{ geminiCitations?: string[]; naverThumbnail?: string; lang?: string }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const martyrdomExternalSettings = pgTable("martyrdom_external_settings", {
  id: serial("id").primaryKey(),
  whitelistDomains: jsonb("whitelist_domains").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  defaultQueries: jsonb("default_queries").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // cron 2주 자동 검색용 기본 검색어 (예: "교사 순직 인정", "공무상 사망 인정 판례")
  lastCronAt: timestamp("last_cron_at", { withTimezone: true }),
});
```

### §1.2 마이그 `migrate-martyrdom-external.ts`

멱등(`CREATE TABLE IF NOT EXISTS`·`ON CONFLICT DO NOTHING`). Swain 어드민 GET `?run=1`.

- 2테이블 생성
- `martyrdom_external_settings` 1행 시드(화이트리스트 도메인 19개·기본 검색어 5종)
- `ai_feature_toggles` `martyrdom_ai_external` 시드(`enabled=true`·`monthly_cost_cap=30`)
- `role_permissions` 시드: `martyrdom_external_review`(super_admin·admin: ON·operator: OFF·viewer: OFF)
- 검증 GET (인증 X)로 행수 확인 후 `?run=1` 호출

### §1.3 schema.ts 활성화 순서

CLAUDE.md §6.7 — **마이그 호출 확인 후** schema 활성화·push. B는 마이그 작성+호출까지·schema 활성화는 머지 직후 메인이.

### §1.4 RAG 색인 키 (격리 보장)

- 신규: `martyr_external` (외부 자료·**검토 전 신청서 RAG에서 제외**)
- 기존 유지: `martyr_active`(진행 사건)·`martyr_case`(과거 인정)·`martyr_law`(법령)
- 승급 시: `martyr_external` 청크 삭제 + 새 `martyr_case` 청크 색인(`indexApprovedReport` 패턴 차용)

---

## §2. API 명세 (8개 + cron 1)

| # | 엔드포인트 | 메서드 | 권한 | 본문 | 응답 |
|---|---|---|---|---|---|
| 1 | `/api/admin-martyrdom-external-search` | POST | requireAdmin + `martyrdom_external_review` | `{query, engines:['gemini','naver']}` | `{ok, queued:N, jobId}` (background 트리거) |
| 2 | `/api/admin-martyrdom-external-list` | GET | requireAdmin | `?status=pending&limit=50` | `{ok, items:[{id,title,sourceUrl,sourceDomain,searchEngine,publishedAt,snippet,status}]}` |
| 3 | `/api/admin-martyrdom-external-detail` | GET | requireAdmin | `?id=N` | `{ok, item:{...전체 컬럼}}` |
| 4 | `/api/admin-martyrdom-external-review` | POST | requireAdmin + `martyrdom_external_review` | `{id, action:'approve'\|'reject', rejectionReason?}` | approve: `{ok, promotedCaseId}` / reject: `{ok}` |
| 5 | `/api/admin-martyrdom-external-delete` | DELETE | requireAdmin | `?id=N` (rejected만) | `{ok}` |
| 6 | `/api/admin-martyrdom-external-settings` | GET·PATCH | requireAdmin | PATCH: `{whitelistDomains?, defaultQueries?}` | `{ok, settings}` |
| 7 | `/api/admin-martyrdom-external-stats` | GET | requireAdmin | — | `{ok, pending, approved, rejected, lastCronAt}` |
| 8 | `/api/admin-martyrdom-external-search-background` | POST(internal) | INTERNAL_TRIGGER_SECRET | `{queries[], engines[]}` | 백그라운드 실행 → 결과 INSERT |
| cron | `cron-martyrdom-external.ts` | scheduled | — | netlify.toml `schedule` 매 2주 수요일 KST 03:00 (= UTC 화요일 18:00) | `martyrdom_ai_external` 토글 ON·`defaultQueries`로 #8 호출 |

### §2.1 백엔드 lib 신설

- **`lib/martyrdom-external.ts`** — `runExternalResearch(queries[], engines[])` / `dedupe(rows, byUrl)` / `parseGeminiCitations(response)` / `promoteToCase(externalId, reviewerUid)` (RAG 색인 포함)
- **`lib/ai-gemini.ts`** — `callGeminiWithSearch(prompt, opts)` 신규 (tools: `[{googleSearchRetrieval: {}}]` — 기존 callGemini 미수정·외부 검색 전용 신설)
- **`lib/naver-search.ts`** — 신설 또는 R39 ④ 코드 재활용 (`NAVER_CLIENT_ID`/`SECRET` env)

### §2.2 비용 안전장치

- `callGeminiWithSearch` 호출 전 `checkFeatureBeforeCall('martyrdom_ai_external')`
- 토글 OFF 시 fail-closed (배경 cron·수동 요청 둘 다 차단·UI에 "외부 검색 비활성화" 안내)
- 5분 surge 카운터에 `internalBulk:false`로 합산(딥릴리프 P1 분류 surge 사고 교훈 — 외부 검색은 일반 호출로 취급)
- 월 cap `monthly_cost_cap=30` ($30) — Swain 운영 중 조정

### §2.3 응답 표준 (CLAUDE.md §6.2)

전 API: `try/catch + step·detail·stack`. step 라벨 예: `auth`·`select_pending`·`search_gemini`·`search_naver`·`promote_index`.

---

## §3. 화면 설계

### §3.1 【파트 2】 사건 진행 정보 UX 개선 (DB 변경 0)

**위치**: `public/admin-martyrdom.html` 사건 상세 페이지 헤더 직하 (기한 섹션·자료 섹션 위).

**그룹 박스 마크업**:

```html
<section class="case-progress-box" id="caseProgressBox">
  <header>
    <h3>📊 사건 진행 정보</h3>
    <p class="hint">우리 시스템 내부 작업 상태(왼쪽)와 외부 공단 심의 결과(오른쪽)는 별도로 관리됩니다. 외부 행정 절차 단계는 아래 진행 막대로 표시됩니다.</p>
  </header>
  <div class="progress-grid">
    <div class="field">
      <label>내부 작업 상태 (우리) <span class="tip" title="우리 협회가 이 사건을 어느 단계까지 지원했는지 — 운영자가 직접 갱신합니다.">❓</span></label>
      <select id="caseStatus">...intake/collecting/analyzing/drafting/submitted/closed</select>
    </div>
    <div class="field">
      <label>심의 최종 결과 (공단) <span class="tip" title="공무원연금공단·인사혁신처 심의위원회의 인정·불인정 결정 결과입니다.">❓</span></label>
      <select id="caseOutcome">- / 인정 / 불인정</select>
    </div>
  </div>
  <div class="stepper-block">
    <label>외부 행정 단계 <span class="tip" title="공단·심의위원회의 행정 절차상 현재 단계입니다.">❓</span></label>
    <ol class="stepper" id="caseStepper">
      <li data-stage="apply">신청</li>
      <li data-stage="review">심의</li>
      <li data-stage="decided">결정</li>
      <li data-stage="reappeal">재심</li>
    </ol>
  </div>
</section>
```

**자동 연동** (Swain 결정 #8): `caseOutcome` change 이벤트에서 `approved`·`rejected` 선택 시 `confirm('심의 최종 결과가 결정되었습니다. 내부 작업 상태도 "종결"로 바꿀까요?')` → 확인 시 `caseStatus=closed` 자동 PATCH·취소 시 outcome만 저장.

**Stepper 클릭**: 각 단계 클릭 시 PATCH로 `procedureStage` 갱신·현재 단계 강조(`.active`).

**기존 위치 정리**: 기한 모달의 `dl_stage` 드롭다운은 유지(기한 편집 흐름) — 신규 Stepper는 별도 진입점·DB 컬럼 동일(`martyrdomDeadlines.stage` 또는 `martyrdomCases.procedureStage` — 사전 정독에서 후자 확인됨).

### §3.2 【파트 1】 외부 자료 검토 화면

**위치**: `public/admin-martyrdom.html` 신규 탭 "🔍 외부 자료" (cms-tbfa iframe은 admin-martyrdom 1개·**iframe 4곳 등록 불필요**·tab만 추가).

**레이아웃 (좌-우 분할)**:

```
┌─────────── 🔍 외부 자료 ─────────────────────────────────────────┐
│  [🤖 새 검색] [검색어 _________________] [엔진: ☑Gemini ☑네이버] │
│  ┌─────────────────────┬────────────────────────────────────┐ │
│  │ ⏳ 검토 대기 (N건)    │ 상세                                │ │
│  │ ─────────────────── │ ─────────────────────────────────  │ │
│  │ ▸ [Gemini] 제목 A   │ 📑 제목                            │ │
│  │   geps.or.kr·2026.. │ 출처: geps.or.kr ↗ ·2026-05-15      │ │
│  │ ▸ [네이버] 제목 B   │ [AI 분석 자료·검증 대기] 배지        │ │
│  │   yna.co.kr·2026.. │                                    │ │
│  │ ▸ [Gemini] 제목 C   │ [본문/스니펫 전문]                   │ │
│  │   ...               │                                    │ │
│  │ ─────────────────── │ ─────────────────────────────────  │ │
│  │ ✅ 승급됨 (X건)      │ [✅ 승급] [❌ 기각] [🗑 삭제(기각만)] │ │
│  │ ❌ 기각 (Y건)        │                                    │ │
│  └─────────────────────┴────────────────────────────────────┘ │
│  ⓘ 통계·발간 화면에는 검증된 자료만 합산되어 "사례 N건(정식 X·AI 분석 Y)"로 표시 │
└──────────────────────────────────────────────────────────────────┘
```

### §3.3 배지·시각 구분 (Swain 결정 #2)

- 외부 자료 카드: `class="badge badge-ai"` "AI 분석 자료" + `class="badge badge-pending"` "검증 대기"
- 승급된 사건(외부에서 온): 사건 카드 우상단 `class="badge badge-ai-promoted"` "🤖 AI 수집 출처"
- 통계 화면: 합산 숫자 옆 작은 주석 `"(정식 X·AI 분석 Y)"`

### §3.4 통합 CMS 권한 정책 (§6.18·release_checklist #1·#9)

- `role_permissions` 신규 키 `martyrdom_external_review` UI 노출(`admin-role-policy` 카테고리: 딥릴리프) — **마이그 시드만으로 자동 노출**(코드 변경 0·R41 패턴)
- 외부 자료 탭은 권한 없으면 숨김(`canAccess('martyrdom_external_review')` 체크)
- iframe 등록 4곳: **추가 없음** (기존 admin-martyrdom 탭 추가)

---

## §4. 검증 시나리오 (C)

| # | 시나리오 | 통과 기준 |
|---|---|---|
| Q1 | 마이그 호출(`migrate-martyrdom-external?run=1`) | 2테이블·시드 1행·featureKey 1·role_permissions 1 — appliedCount ≥ 4 |
| Q2 | 외부 검색 수동 요청 (`?query=교사 순직 인정 판례&engines=both`) | Background 큐잉·DB row N건 created·Gemini citations·네이버 link 둘 다 |
| Q3 | featureKey OFF + 외부 검색 시도 | fail-closed·`error:"외부 검색 비활성화"`·DB write 0 |
| Q4 | RAG 격리 — pending 자료가 신청서 초안 검색에 노출 X | searchRag(sourceTypes:['martyr_case']) 결과에 `martyr_external` 청크 0 |
| Q5 | 승급 → martyrdom_cases 새 행 + `martyr_case` 색인 | promotedCaseId not null·RAG 청크 신규·검색 시 hit |
| Q6 | 기각 → status='rejected'·삭제 가능·RAG 청크 0 | rejectionReason 보존 |
| Q7 | 2주 cron 수동 실행 (`?run=1`) | `defaultQueries`로 검색·`lastCronAt` 갱신 |
| Q8 | UX 그룹 박스 — outcome=approved 저장 시 다이얼로그 | 확인 → status=closed PATCH·취소 → outcome만 |
| Q9 | Stepper 클릭 → procedureStage PATCH·강조 갱신 | active 클래스 이동·DB 반영 |
| Q10 | 권한 — operator가 외부 자료 탭 접근 | UI 숨김·API 403 |
| Q11 | 출처 배지 — 외부 자료/승급 사건/통계 합산 표기 | 시각 구분 명확·합산 숫자 정확 |
| Q12 | 비용 안전장치 — 분당 호출 5회 초과 | surge cooldown 발동·기존 martyrdom_ai와 독립 |

---

## §5. mock 데이터 (A가 B 머지 전 사용 — §6.2 임베드 그대로)

```javascript
// public/js/admin-martyrdom-external-mock.js
const MOCK_EXTERNAL_LIST = {
  ok: true,
  items: [
    { id: 1, title: "교사 순직 인정 판례 — 대전지법 2024 결정", sourceUrl: "https://glaw.scourt.go.kr/...", sourceDomain: "glaw.scourt.go.kr", searchEngine: "gemini", publishedAt: "2026-04-12T00:00:00Z", snippet: "법원이 학교 교사의 공무상 사망을 인정한 판례. 직무 스트레스와 인과관계를 폭넓게 인정...", status: "pending" },
    { id: 2, title: "공무원연금공단, 교사 순직 인정 기준 안내", sourceUrl: "https://geps.or.kr/...", sourceDomain: "geps.or.kr", searchEngine: "gemini", publishedAt: "2026-03-20T00:00:00Z", snippet: "직무수행 중 사망·공무상 질병 인정 기준 5가지 요건...", status: "pending" },
    { id: 3, title: "서이초 교사 순직 인정 확정 — 연합", sourceUrl: "https://yna.co.kr/...", sourceDomain: "yna.co.kr", searchEngine: "naver", publishedAt: "2026-02-08T00:00:00Z", snippet: "유족이 신청한 순직 인정 청구가 최종 인용되었다...", status: "approved" }
  ]
};
const MOCK_EXTERNAL_DETAIL = {
  ok: true,
  item: { id: 1, title: "교사 순직 인정 판례 — 대전지법 2024 결정", sourceUrl: "https://glaw.scourt.go.kr/...", sourceDomain: "glaw.scourt.go.kr", searchEngine: "gemini", publishedAt: "2026-04-12T00:00:00Z", snippet: "법원이...", contentFull: "원고는 ○○초등학교 교사로서 ... 공무상 사망으로 인정한다.", status: "pending", meta: { geminiCitations: ["https://glaw.scourt.go.kr/...", "https://law.go.kr/..."] } }
};
const MOCK_EXTERNAL_STATS = { ok: true, pending: 12, approved: 5, rejected: 3, lastCronAt: "2026-05-15T18:00:00Z" };
const MOCK_EXTERNAL_REVIEW_APPROVE = { ok: true, promotedCaseId: 42 };
const MOCK_EXTERNAL_REVIEW_REJECT = { ok: true };
const MOCK_EXTERNAL_SEARCH = { ok: true, queued: 8, jobId: "ext-job-12345" };
const MOCK_EXTERNAL_SETTINGS = { ok: true, settings: { whitelistDomains: ["gov.kr","moe.go.kr","glaw.scourt.go.kr","yna.co.kr"], defaultQueries: ["교사 순직 인정","공무상 사망 판례"] } };

// 파트 2 UX 상수 (재참조용)
const STATUS_LABELS = { intake:"접수", collecting:"자료 수집", analyzing:"분석", drafting:"서면 작성", submitted:"청구·제출", closed:"종결" };
const OUTCOME_LABELS = { approved:"인정", rejected:"불인정" };
const STAGE_LABELS = { apply:"신청", review:"심의", decided:"결정", reappeal:"재심" };
const STAGE_ORDER = ["apply","review","decided","reappeal"];
```

---

## §6. 4채팅 시작 프롬프트 (영역 라벨 명확화·workflow_standards §3)

### §6.1 B 트리거 (🔧 백엔드 구현)

```
[자율주행 정책 — A·B·C 채팅 공통, CLAUDE.md §6.17·§9.3·feedback_audit_round]
- 자율: Read·Edit·Write 모든 파일, git status/log/diff/fetch/add/commit/rebase, npm install, bash, PowerShell
- 금지: git push (메인 단독), force push, hard reset, rm -rf, lib/auth.ts·admin-guard.ts 수정
- 묻기: 설계·로직 결정, package.json/lock, npm uninstall, netlify/curl
- 영역: 백엔드(B) — DB 마이그·API 8개·lib 신설·cron. 같은 폴더 tbfa-mis-B 워크트리.
- 완료 보고: 브랜치명·커밋 해시·변경 요약을 메인 채팅에 전달. push는 메인이 일괄.

[베이스] main HEAD = 00e11ea (martyrdom auto-reindex). 워크트리: c:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B. 브랜치: feature/r43-external-back

[작업 영역] R43 딥릴리프 데이터 축적 하이브리드 — 백엔드 단독.
docs/active/2026-05-29-survivor-data-hybrid-and-ux.md §1·§2 100% 구현.

[체크박스 패턴 — Sonnet 4.6 충실도↑]
□ db/schema.ts 끝에 `/* === R43 딥릴리프 데이터 축적 하이브리드 === */` 헤더 후 martyrdomExternalResearch·martyrdomExternalSettings 정의 추가(append-only)
□ netlify/functions/migrate-martyrdom-external.ts — 멱등 마이그(2테이블·시드 1행·featureKey martyrdom_ai_external·role_permissions martyrdom_external_review). 인증·실행 분리(GET 진단 / ?run=1 실행)
□ netlify/functions/admin-martyrdom-external-search.ts — POST·requireAdmin+권한·INTERNAL_TRIGGER_SECRET로 background 호출·{ok,queued,jobId}
□ netlify/functions/admin-martyrdom-external-list.ts — GET·status 필터·limit·{ok,items[]}
□ netlify/functions/admin-martyrdom-external-detail.ts — GET·?id=N·{ok,item}
□ netlify/functions/admin-martyrdom-external-review.ts — POST·action 'approve'|'reject'·approve 시 promotedCaseId 반환(martyrdom_cases 신규 행 INSERT + RAG 색인)
□ netlify/functions/admin-martyrdom-external-delete.ts — DELETE·rejected만·{ok}
□ netlify/functions/admin-martyrdom-external-settings.ts — GET·PATCH·{ok,settings}
□ netlify/functions/admin-martyrdom-external-stats.ts — GET·집계 4종
□ netlify/functions/admin-martyrdom-external-search-background.ts — INTERNAL_TRIGGER_SECRET 인증·실제 검색 실행·INSERT
□ netlify/functions/cron-martyrdom-external.ts — schedule 매 2주 KST 03:00 수요일·`martyrdom_ai_external` 토글 확인 후 background #호출
□ netlify.toml — cron-martyrdom-external schedule 등록
□ lib/martyrdom-external.ts — runExternalResearch / dedupe / parseGeminiCitations / promoteToCase(RAG 색인 포함)
□ lib/ai-gemini.ts — callGeminiWithSearch 신규(tools: [{googleSearchRetrieval: {}}])·기존 callGemini 미수정
□ lib/naver-search.ts — 신설 또는 R39 ④ 코드 재활용
□ lib/ai-cost-safety — martyrdom_ai_external featureKey 분기 추가(martyrdom_ai와 독립 카운터·surge)
□ npx tsc --noEmit 통과
□ 마이그 ?run=1 호출은 Swain 라이브 검증 단계(메인 안내)

━━━ 응답 구조 (키명 임의 변경 금지·A mock이 이 구조 §5에 임베드) ━━━
[설계서 §5 mock 그대로 — list/detail/stats/review-approve/review-reject/search/settings 7개 응답 구조]

━━━ push 전 체크 ━━━
□ 브랜치명: feature/r43-external-back
□ 응답 최상위 키: ok·items / ok·item / ok·queued·jobId / ok·promotedCaseId / ok·pending·approved·rejected·lastCronAt / ok·settings
□ export const config = { path: "/api/admin-martyrdom-external-*" } 8개 (cron·background 제외)
□ requireAdmin 반환 `auth.res` (response 아님)
□ schema 정의는 마이그 호출 확인 후 메인이 활성화 (B는 schema 정의만 push 전 보류·머지 시 활성화)
□ npx tsc --noEmit 통과·node --check 통과
□ 커밋 단위: 마이그/lib/API/cron 단계별 commit(머지 가독성↑)·**push 안 함** (메인 일괄)
```

### §6.2 A 트리거 (🎨 프론트엔드 구현)

```
[자율주행 정책 — §6.1과 동일]
- 영역: 프론트엔드(A) — admin-martyrdom.html UX 그룹 박스 + 외부 자료 탭 + 자동 연동 다이얼로그. 워크트리 tbfa-mis-A. 브랜치 feature/r43-external-front

[베이스] main HEAD = 00e11ea. tbfa-mis-A 워크트리. 

[작업 영역] R43 딥릴리프 — 프론트 단독.
docs/active/2026-05-29-survivor-data-hybrid-and-ux.md §3 100% 구현.

[체크박스 패턴]
□ public/admin-martyrdom.html 상세 페이지 헤더 직하에 `<section class="case-progress-box">` 신설(설계서 §3.1 마크업 그대로). 기존 status·outcome 드롭다운은 이 박스로 이동·기한 모달의 dl_stage 유지
□ public/admin-martyrdom.html 신규 탭 "🔍 외부 자료" 추가 — 탭 헤더·콘텐츠 영역(설계서 §3.2 레이아웃)
□ public/css/admin-martyrdom.css 또는 inline — case-progress-box·stepper·badge-ai·badge-pending·badge-ai-promoted 스타일
□ public/js/admin-martyrdom.js — caseOutcome change 시 자동 연동 다이얼로그(설계서 §3.1 confirm 문구)·Stepper 클릭·외부 자료 탭 fetch·검토·삭제 액션
□ mock 활성화 옵션 `const USE_MOCK = true` — B 머지 전 페이지 단독 동작·머지 후 false 전환
□ 통합 CMS 권한 체크 — `canAccess('martyrdom_external_review')` 외부 자료 탭 노출 제어(설계서 §3.4)
□ 캐시버스터 admin-martyrdom.js ?v=R43-1 (인용처 전부 갱신)
□ statusLabels·outcomeLabels·stageLabels·stageOrder 상수 §5 그대로
□ 통계 화면 — admin-martyrdom 사건 목록·딥릴리프 발간 화면에 합산 N건 표기 변경(`(정식 X·AI 분석 Y)`)

━━━ mock 데이터 (B 머지 전·설계서 §5 그대로 임베드·"§5 참조" 금지) ━━━
[설계서 §5 MOCK_* 상수 7개 + STATUS_LABELS·OUTCOME_LABELS·STAGE_LABELS·STAGE_ORDER 그대로 임베드]

━━━ push 전 체크 ━━━
□ 브랜치명: feature/r43-external-front
□ mock 키명: B 응답과 동일(items[].id·sourceDomain·searchEngine 등 §5)
□ <script src="admin-martyrdom.js?v=R43-1"> 인용처 전부 갱신
□ B 머지 후 USE_MOCK=false 자동 전환은 메인 머지 시 처리
□ tsc 영향 없음(.js)·node --check 통과(JS 문법)
□ **push 안 함** (메인 일괄)
```

### §6.3 C 트리거 (🔍 검증)

```
[자율주행 정책 — §6.1과 동일·검증 영역]
- 영역: 검증(C) — 코드 검토 + 라이브 E2E. 워크트리 tbfa-mis-C. 브랜치 verify/r43-external

[베이스] main HEAD = (B·A 머지 후 메인이 알려준 머지 해시·메인이 안내).

[작업 영역] R43 종결 검증. docs/active/2026-05-29-survivor-data-hybrid-and-ux.md §4 시나리오 Q1~Q12 전부.

[체크박스]
□ Q1 마이그 호출 결과 진단
□ Q2 수동 검색 background 큐잉·DB row 확인
□ Q3 featureKey OFF fail-closed
□ Q4 RAG 격리(`martyr_external`이 신청서 초안 검색에 0)
□ Q5 승급 → cases 새 행 + RAG 색인
□ Q6 기각 → rejected·삭제 가능
□ Q7 cron 수동 실행
□ Q8 UX 자동 연동 다이얼로그
□ Q9 Stepper 클릭 → procedureStage 갱신
□ Q10 operator 권한 차단
□ Q11 출처 배지·합산 숫자
□ Q12 비용 안전장치·surge
□ 코드 검토 (drizzle leftJoin 체인 금지·schema append-only·requireAdmin auth.res·config.path 누락 0)
□ 보고서 docs/history/verify/2026-05-29-r43-external.md
□ BUG-* 발견 시 P0~P3 분류 + fix 제안

━━━ push 전 체크 ━━━
□ 브랜치명: verify/r43-external
□ 라이브 검증 결과 PASS/FAIL 명시
□ **push 안 함** (메인 일괄)
```

---

## §7. 라운드 마감 체크리스트 (release_checklist 15항목 + R43 특화)

### 7.1 코드·DB
- [ ] schema.ts append-only 헤더(`R43 딥릴리프 데이터 축적 하이브리드`) — 다른 작업 영역 침범 0 (§9.1.6)
- [ ] 마이그 호출 완료(Swain)·schema 활성화·1회용 파일 삭제
- [ ] tsc 0·머지 후 메인 재검증 (feedback_audit_round 머지 게이트)
- [ ] requireAdmin·requireActiveUser·config.path 표준 준수

### 7.2 권한·운영자립 (§6.18)
- [ ] `martyrdom_external_review` featureKey 시드·admin-role-policy 노출
- [ ] 외부 자료 탭 권한 게이트(canAccess)
- [ ] 화이트리스트 도메인·기본 검색어 어드민 편집 화면(`admin-martyrdom-external-settings`)
- [ ] 코드 하드코딩 콘텐츠 0 (시드는 마이그만·이후 운영자 편집)

### 7.3 동기화 (release_checklist 15항목)
- [ ] 권한 정책 관리 (#1) — admin-role-policy에서 `martyrdom_external_review` 토글 보이는지
- [ ] AI 비서 도구 (#2) — 외부 자료 통계 read-only 도구 추가 검토 (선택: `martyrdom_external_stats` — 검증 후 결정)
- [ ] 사용자 메뉴얼 (#3) — manual-admin.html 딥릴리프 섹션에 외부 자료 검토 흐름 추가
- [ ] AI 학습 자료 (#4) — knowledge.md + jsonl 4~6문항
- [ ] 명세 마스터 (#5) — 해당 없음 (딥릴리프는 milestone archive에 있음·새 명세 X)
- [ ] PROJECT_STATE / HANDOFF (#6)
- [ ] 알림 시스템 (#7) — 해당 없음 (검토는 운영자 진입형)
- [ ] CSV·PDF export (#8) — 해당 없음
- [ ] iframe 라우팅 4곳 (#9) — **추가 없음** (기존 admin-martyrdom 탭 추가)
- [ ] cron 자동화 (#11) — `cron-martyrdom-external` 매 2주 등록
- [ ] schema·마이그·시드 (#14) — append-only·멱등·시드 1행
- [ ] 환경변수 (#15) — Gemini Search Grounding은 GEMINI_API_KEY 재활용·네이버 NAVER_CLIENT_ID/SECRET 기존 활용·신규 0

### 7.4 메모리·히스토리
- [ ] memory `project_survivor_hybrid.md` 생성 (project_seo_r42 패턴 — 아키텍처·핵심 함정·검증 절차)
- [ ] 설계서 → `docs/history/milestones/2026-05-29-r43-survivor-hybrid.md` archive 이동
- [ ] PROJECT_STATE.md §2 R43 종결 섹션 추가
- [ ] §6.15 알림 메시지 (메인 push 시 A·B·C 채팅에 영향 없음 — 단독 메인 종결)

### 7.5 비용·라이브
- [ ] `martyrdom_ai_external` 토글 ON·월 cap $30·surge 카운터 독립 확인
- [ ] Swain 라이브 E2E (Q1~Q12 중 ≥ 8개 PASS)
- [ ] 메인 1회 push (배포 비용 절감·§9.3)

---

**커밋 시퀀스 예상**:
1. (메인) 설계서 추가 — 로컬 commit only (push 안 함·§9.3 베이스 push 생략)
2. (B) feature/r43-external-back — schema·마이그·lib·API·cron 단계별 commit
3. (A) feature/r43-external-front — UX 박스·탭·mock·USE_MOCK=true commit
4. (메인) B → main 머지·tsc 재검증·schema 활성화 commit·마이그 호출 안내
5. (Swain) 마이그 ?run=1 호출 → 메인이 진단 확인
6. (메인) A → main 머지·USE_MOCK=false·캐시버스터 commit
7. (메인) 1회 push → Netlify 배포 → Swain 라이브 검증
8. (C) verify/r43-external — 검증 보고서 commit (메인 머지 후)
9. (메인) C 보고서 머지·BUG fix·메뉴얼·memory·archive 이동·종결 push
