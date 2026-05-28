# R42 SEO 라이브 검증 보고서 — C 영역

> **작성**: 2026-05-28 (C 채팅) · 브랜치 `feature/seo-verify` · 베이스 `origin/main d8614a8`
> **범위**: R42 (SEO 풀세트) 라이브 검증 — 코드 수정 X, BUG 발견 시 메인 보고
> **라이브 URL**: https://tbfa.co.kr
> **검증 기준**: `docs/active/2026-05-28-seo.md` §4 검증 시나리오 + 트리거 체크박스

---

## 종합 판단

> **라운드 종결 불가** — P0 BUG 2건으로 R42 핵심 기능 2종(`sitemap.xml`·동적 콘텐츠 메타 라우팅) 모두 미동작.
> 추가로 동적 6페이지(`/campaign.html` 등)가 `force redirect` + 함수 미배포로 **공개 페이지가 사용자에게 404로 노출**되는 회귀까지 동반.

| 영역 | PASS | FAIL | 보류(Swain 위임) |
|---|---|---|---|
| Part 1 라이브 URL | 4 | 2 | — |
| Part 2 외부 도구 | — | — | 4 |
| Part 3 어드민 회귀 | 2 | — | 3 |
| Part 4 기존 기능 회귀 | 2 | — | 3 |

---

## Part 1 — 라이브 URL 점검

| Q | 항목 | 결과 | 근거 |
|---|---|---|---|
| Q1 | `GET /sitemap.xml` 200 + XML + 동적 그룹별 ≥1개 | ❌ **FAIL** | HTTP 404 · 응답이 사이트 공통 404 HTML(3838 B) · 직접 호출 `/.netlify/functions/sitemap`도 404 |
| Q2 | `GET /robots.txt` 200 + Sitemap 라인 + Disallow 정책 | ✅ PASS | 200 · `text/plain; charset=UTF-8` 878 B · Sitemap 라인 + Disallow 22개 |
| Q3 | `curl -I /admin.html` `X-Robots-Tag: noindex, nofollow` | ✅ PASS | 헤더 확인. `cms-tbfa.html`·`workspace.html`·`mypage.html`·`my-reports.html`·`payment-*`·`billing-*` 등 8개 샘플 모두 동일 헤더 |
| Q4 | `/campaign.html?slug=...` 콘텐츠별 OG/Title/Image | ❌ **FAIL** | 페이지 자체 HTTP 404 (`force redirect` + 함수 미배포) — 동적 6페이지 모두 동일 증상 |
| Q5 | `/index.html` Organization+WebSite JSON-LD + OG + canonical | ✅ PASS | OG 7개·Twitter 4개·canonical·JSON-LD 2건(NGO + WebSite) 모두 적재. 시각 검증 통과 |
| 추가 | 정적 공개 페이지 OG/Twitter/canonical | ✅ PASS | `about·memorial·board·news·support·report·terms·privacy` 8개 샘플 모두 OG 7·Twitter 4·canonical 1 |
| 추가 | `/og-default.png` | ✅ PASS | 200 · `image/png` 170,489 B |

### Part 1 BUG (P0) 정리

| ID | 영향 | 증상 | 추정 원인 | 영향 사용자 |
|---|---|---|---|---|
| P0-1 | 검색엔진 색인 | `https://tbfa.co.kr/sitemap.xml` 404 | `netlify/functions/sitemap.ts`의 `config.path = "/sitemap.xml"` + `netlify.toml` redirect `to=/.netlify/functions/sitemap force=true`가 라이브에서 동작하지 않음. 함수는 파일 트리에는 존재(`origin/main` 확인) | 구글·네이버 색인 0 — SEO 효과 무력화 |
| P0-2 | **공개 페이지 6개 죽음 (회귀)** | `/campaign.html`·`/incident.html`·`/activity.html`·`/board-view.html`·`/family-story.html`·`/memorial-teacher.html` 모두 HTTP 404 | `netlify.toml`에 6개 모두 `force = true`로 함수 라우팅. 함수가 동작 안 하면 **정적 HTML 자체 차단** → 404로 노출 | 캠페인 상세·사건 상세·활동글·게시글·유족이야기·추모교사 **방문 사용자 전원 404** |

### P0 원인 진단 추적

1. 함수 파일은 `origin/main`에 모두 포함됨 — `git ls-tree`로 확인:
   - `netlify/functions/sitemap.ts` (blob d2c6df8...)
   - `netlify/functions/page-with-seo.ts` (blob 5626233...)
   - `netlify/functions/admin-seo-list.ts` (blob a14a2c2...) ← 정상 동작 (401)
   - `netlify/functions/migrate-seo-init.ts` (blob 962e6c4...) ← 정상 동작 (200)
2. **차이점**: 정상 동작 함수는 `config.path = "/api/admin-seo-..."` 패턴, 미동작 함수는 `/sitemap.xml` / `["/campaign.html", ...]` 등 **루트 + 확장자** path.
3. **가설**: Netlify Functions v2의 `config.path`가 정적 자산 확장자(`.xml`·`.html`)와 충돌해 라우팅 등록이 무시되거나, redirect의 `/.netlify/functions/<name>` 대상이 v2 함수에서 직접 호출 불가.
4. **부수효과**: 함수가 응답 안 하면 redirect chain이 catchall `[[redirects]] /* → /404.html status=404`로 떨어져 정적 HTML이 가려짐.
5. **확정 필요**: Netlify Deploy Logs(Swain 콘솔)에서 두 함수의 빌드·등록 여부 확인 → 원인 좁히기.

### Part 1 BUG (P1) — sitemap-builder STATIC_PAGES dead link 14건

`lib/sitemap-builder.ts` line 28~54의 `STATIC_PAGES` 25개 중 14개가 `public/` 실제 파일과 매칭되지 않음. 사이트맵이 동작하기 시작하면 검색엔진에 dead URL 14개가 노출됨.

| sitemap 등록 path | public/ 실제 파일 | 비고 |
|---|---|---|
| `/about-history.html` | ✗ | 없음 |
| `/about-team.html` | ✗ | 없음 |
| `/contact.html` | ✗ | 없음 |
| `/donate.html` | ✗ | 후원 폼은 모달이거나 다른 파일명일 가능성 |
| `/campaign-list.html` | ✗ (`campaigns.html` 있음) | 단수/복수 혼동 |
| `/media.html` | ✗ | 없음 |
| `/family-support.html` | ✗ | 없음 |
| `/family-support-counsel.html` | ✗ | 없음 |
| `/family-support-legal.html` | ✗ | 없음 |
| `/family-support-scholarship.html` | ✗ | 없음 |
| `/report-incident.html` | ✗ (`report.html` 있음) | 이름 다름 |
| `/report-legal.html` | ✗ | 없음 |
| `/login.html` | ✗ | 로그인 진입점 다른 파일 가능 |
| `/signup.html` | ✗ | 가입 진입점 다른 파일 가능 |

**조치 요청**: 메인이 `STATIC_PAGES`를 `public/*.html`과 정합(혹은 동적으로 `fs.readdirSync` 기반 생성) 권고.

---

## Part 2 — 외부 도구

라이브 도구는 인증/브라우저 UI 필요 — Swain 위임.

| 항목 | 상태 | 비고 |
|---|---|---|
| Facebook Debugger (`developers.facebook.com/tools/debug`) | ⏸️ Swain 위임 | `https://tbfa.co.kr/` 입력 → 미리보기 카드 확인. 단, P0-2로 캠페인 URL은 검증 불가 |
| Google Rich Results Test | ⏸️ Swain 위임 | `https://tbfa.co.kr/` → Organization NGO + WebSite 인식 확인 |
| Mobile-Friendly Test | ⏸️ Swain 위임 | `https://tbfa.co.kr/` 모바일 친화 확인 |
| 카카오톡 실제 공유 | ⏸️ Swain 위임 | 카톡에 `https://tbfa.co.kr/` 붙여넣어 미리보기 카드 확인 |

**보조 검증 (C가 정적으로 확인)**: `/index.html`의 OG/Twitter/JSON-LD가 표준 형식으로 모두 들어있음 — 외부 도구가 정상 작동하면 카드 표시는 거의 확실.

---

## Part 3 — 어드민 회귀

| 항목 | 상태 | 근거 |
|---|---|---|
| 사이드바 "홈페이지 관리" → 🔍 SEO 메타 진입 | ✅ 정적 PASS | `public/admin.html:2780` `<li><a data-page="seo">...</a></li>` 등록 |
| `<div id="adm-seo">` 섹션 존재 | ✅ 정적 PASS | `public/admin.html:4434` 섹션 등록 |
| `admin-seo.js` 라이브 USE_MOCK=false | ✅ PASS | 라이브 응답 `var USE_MOCK = false;` (line 8) — 실제 백엔드 연결 모드 |
| `/api/admin-seo-list` 인증 게이트 | ✅ PASS | 미인증 GET → 401 (정상 — `requireAdmin` 가드 동작) |
| `/api/migrate-seo-init` 진단 응답 | ✅ PASS | 미인증 GET → 200 (diag 모드 정상) |
| 메타 편집 → Draft 저장 → 발행 → 빌드 트리거 흐름 | ⏸️ Swain 위임 | super_admin/admin 로그인 + UI 조작 필요 |
| 단체 구조화데이터 탭 마이그 시드 노출 | ⏸️ Swain 위임 | 로그인 후 `/api/admin-seo-org` 응답에 마이그가 시드한 11개 키가 포함되는지 |
| 사이트 기본값 탭 (site_name·locale·title_suffix 등) | ⏸️ Swain 위임 | 로그인 후 확인 |
| operator 권한 → `/api/admin-seo-*` 403 | ⏸️ Swain 위임 | operator 계정 로그인 후 GET 요청 시 `canAccess('seo_edit') === false` → 403 |

---

## Part 4 — 기존 기능 회귀

| 항목 | 상태 | 근거 |
|---|---|---|
| 어드민·내부 페이지 noindex 헤더 (8/8 샘플) | ✅ PASS | `admin·cms-tbfa·workspace·mypage·my-reports·payment-success·payment-fail·billing-*` 모두 `X-Robots-Tag: noindex, nofollow` |
| `/admin.html` HTML 메타 `<meta name="robots" content="noindex,nofollow">` | ✅ PASS | curl 응답 본문에서 확인 |
| 기존 사이드바 메뉴·페이지 정상 동작 | ⏸️ Swain 위임 | 어드민 로그인 + UI 조작 |
| 캐러셀·모달·스크롤·폼 (공개 페이지) | ⏸️ Swain 위임 | 브라우저 검증 — 단, **P0-2로 6개 페이지 자체 죽었으므로** 캠페인·사건·게시글 흐름은 모두 실패 상태 |
| 결제·로그인·후원 회귀 1회 | ⏸️ Swain 위임 | 실제 흐름 |
| og-default.png 200 | ✅ PASS | 200 · `image/png` 170,489 B |

---

## P0~P3 BUG 분류표 — 메인 보고용

| ID | 등급 | 위치 | 증상 | 영향 | 조치 |
|---|---|---|---|---|---|
| **R42-V-P0-1** | **P0** | `netlify/functions/sitemap.ts` + `netlify.toml` `[[redirects]] /sitemap.xml` | `/sitemap.xml` 404 (직접 함수 호출도 404) | 검색엔진 색인 0 | Function v2 `config.path` 동작 확인 + redirect 우선순위 점검. Netlify Deploy Logs에서 함수 등록 여부 확인 |
| **R42-V-P0-2** | **P0** | `netlify.toml` `[[redirects]] /{campaign,incident,activity,board-view,family-story,memorial-teacher}.html → /.netlify/functions/page-with-seo force=true` + `netlify/functions/page-with-seo.ts` | 공개 동적 6페이지 404 (campaign·incident·activity·board-view·family-story·memorial-teacher) | **사용자가 캠페인·사건·활동·게시글·유족이야기·추모교사 페이지 진입 시 모두 404** — R42 회귀로 라이브 서비스 영향 큼 | (1) 함수 라우팅 fix 또는 (2) `force=true` 제거하고 함수 path를 다른 URL로 (예: `/api/seo-page?path=...` + 정적 HTML head에서 fetch) — **긴급** |
| **R42-V-P1-1** | P1 | `lib/sitemap-builder.ts:28~54` STATIC_PAGES | 14/25 dead link (실제 public/에 없는 파일을 sitemap에 등록) | sitemap 동작 시 검색엔진에 dead URL 노출 → 색인 품질 저하 | `public/*.html` 기준으로 STATIC_PAGES 재정의 또는 `fs.readdirSync` 기반 동적 생성 |
| **R42-V-P2-1** | P2 | `lib/sitemap-builder.ts:192~196` 주석 | memorialMessages가 schema import에는 있는데 실제 사용 안 함 (주석으로 의도적 제외 명시) | dead import — 컴파일 영향 없음 | 미사용 import 정리 (선택) |
| **R42-V-P3-1** | P3 | `docs/active/2026-05-28-seo.md` §3 페이지 분류 | 설계서의 "고정 페이지" 분류와 `STATIC_PAGES`·`netlify.toml` Disallow 패턴 간 일부 부정합 (donate/login/signup 등) | 문서·코드 동기화 결함 | 설계서 또는 코드 정합 |

---

## 검증 가능한 영역 vs 보류 영역 — 사유

| 영역 | 검증 가능성 | 사유 |
|---|---|---|
| 라이브 URL `curl`/HTTP 헤더/응답 본문 | ✅ C 직접 검증 완료 | 인증 불필요 |
| 라이브 JS 정적 텍스트 | ✅ C 직접 검증 완료 | `admin-seo.js` USE_MOCK 라이브 응답 확인 |
| HTML 메타·OG·JSON-LD 텍스트 | ✅ C 직접 검증 완료 | `curl` + grep |
| 외부 도구(페북·구글·카톡) UI | ⏸️ Swain 위임 | 인증·브라우저 렌더링·실제 공유 액션 필요 |
| 어드민 로그인 후 UI 조작 | ⏸️ Swain 위임 | super_admin/admin 세션 + JS 실행 |
| operator 권한 403 | ⏸️ Swain 위임 | operator 테스트 계정 필요 |
| Netlify Deploy Logs | ⏸️ Swain 위임 | Netlify 콘솔 권한 |
| 결제·후원 흐름 회귀 | ⏸️ Swain 위임 | 실제 결제 진행 필요 |

---

## 메인 보고 — 권고 조치 순서

### 1. 즉시 (P0 차단 해제)
1. **R42-V-P0-2 긴급 — 공개 동적 6페이지 라이브 404 회복**
   - 단기 임시 조치: `netlify.toml`에서 6개 redirect의 `force = true` 제거 → 정적 HTML이라도 다시 서빙 (동적 OG는 빠지지만 페이지 자체는 살아남)
   - 항구 조치: `page-with-seo` 함수 라우팅 fix (Netlify Deploy Logs 확인 후 path 패턴 또는 함수 형식 조정)
2. **R42-V-P0-1 — sitemap 라이브화**
   - `sitemap.ts` `config.path` 패턴 확인 + Netlify v2 함수 등록 검증
   - 대안: `config.path = "/api/sitemap.xml"`로 변경 후 redirect `from=/sitemap.xml to=/api/sitemap.xml`

### 2. 차순위 (P1)
3. `lib/sitemap-builder.ts` STATIC_PAGES를 `public/*.html` 실제 파일과 정합

### 3. 사후 검증 (P0 fix push 후)
4. C에 재검증 트리거 — 본 보고서 Part 1 Q1·Q4 재실행
5. Swain이 외부 도구(페북·구글·카톡) + 어드민 SEO 편집·발행 + operator 403 검증

---

## C 작업 추적

- 브랜치: `feature/seo-verify` (베이스 `origin/main d8614a8`)
- 수정 파일: **0건** (트리거 정책 — C는 코드 수정 X, 보고서만 commit)
- 신규 보고서: 본 파일 `docs/active/audit/r42-seo-verify.md`
- push: 안 함 (메인이 다음 fix와 묶어 1회 push — §9.3 배치)

---

**작성 완료**: 2026-05-28 (C) · 메인에 본 보고서 위치·핵심 결과 인계
