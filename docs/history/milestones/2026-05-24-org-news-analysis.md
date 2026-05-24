# ④ 교사유가족협의회 뉴스·여론 분석 — 설계서 (병렬 라운드 단일 출처)

> 2026-05-24 / 메인 설계 → A(프론트)·B(백) 병렬 → 메인 머지 → C 검증.
> 요구 원문: `docs/active/2026-05-24-milestone-and-news.md` §④. 본 문서가 ④ 구현 단일 출처.
> 수집=네이버 검색 API · 분석=Gemini (Swain 2026-05-24 확정).

---

## 1. 한 줄 정의

매일 아침(KST 09:00) 자동 + 어드민 "최신 재조사" 버튼으로, 네이버 검색에서 협회·대표·이슈 키워드 최근 1주 콘텐츠를 수집 → Gemini가 **활동·이슈 요약 / 연관 키워드(워드클라우드) / 여론 경향 / 추천 액션 / 직전 대비 변경점**을 생성 → 통합 CMS 새 메뉴 "여론·뉴스 분석"에 표시하고, 보고서를 행으로 누적해 과거 히스토리 조회.

## 2. Swain 결정 (2026-05-24)

| 항목 | 결정 |
|---|---|
| 수집·분석 | 네이버 검색 API 수집 + Gemini 분석 |
| 화면 위치 | **통합 CMS 새 메뉴 "📰 여론·뉴스 분석"** (iframe 페이지) |
| 검색 키워드 | **협회명+대표명 중심 + 이슈·사건 확장 + 최근 사망사건/사건·사망사고 포함** |
| 워드클라우드 | **wordcloud2.js (CDN, 3-tier 폴백)** |
| 자동 시각·가드 | **매일 KST 09:00 자동 + 수동 재조사 무제한** (featureKey 월 한도로만 통제) |

**기본 키워드 시드** (설정에서 편집 가능): `교사유가족협의회`, `박두용`, `교유협`, `교사 순직`, `교사 사망`, `공무상 재해`, `교권 보호`
**수집 범위**: 네이버 `news` + `blog` + `webkr`(웹문서) 3종 (카페는 노이즈로 v1 제외).

## 3. Swain 액션 (코드 무관·게이트)

- **네이버 개발자센터 검색 API 키 발급** → Netlify env 등록: `NAVER_SEARCH_CLIENT_ID`, `NAVER_SEARCH_CLIENT_SECRET`
- **마이그 호출**(머지 push 배포 후): `https://tbfa.co.kr/api/migrate-org-news?run=1` (어드민 로그인 상태)

## 4. 데이터 모델 (메인이 마이그 작성·Swain 호출)

> ⚠️ **2026-05-24 정정(C 검증 BUG-1)**: 아래 §4 표는 **설계 초안**이며, B 백엔드 구현이 더 풍부·일관된 컬럼을 사용해 **실제 스키마와 어긋났음**. **권위 스키마 = `netlify/functions/migrate-org-news.ts`(C fix 버전)**. 실제 사용 컬럼:
> - `org_news_reports`: `id·keywords text[]·scopes text[]·per_combo·collected_count·items jsonb·summary·keyword_cloud jsonb·sentiment jsonb·recommendations jsonb·diff_summary·ai_status·trigger_type·generated_by·created_at` (+`created_at DESC` 인덱스). *period_from/to·source_count·sources·ai_model·status(varchar)는 미사용 — collected_count·items·ai_status로 대체.*
> - `org_news_settings`: `id·keywords text[]·scopes text[]·per_combo·auto_enabled·cron_hour_kst·updated_at·updated_by` (싱글톤 CHECK·시드 keywords raw 배열).
> - keywords/scopes는 서버가 **raw 배열 바인딩 → `text[]`**(jsonb 아님). 옛 마이그로 jsonb 생성된 DB는 `?reset=1`로 DROP·재생성.

### `org_news_reports` (보고서 = 행 누적 = 히스토리) — ⚠️아래는 초안(권위=마이그)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | serial PK | |
| generated_at | timestamptz | 생성 시각 (DESC 인덱스) |
| trigger_type | varchar(10) | 'cron' \| 'manual' |
| generated_by | integer | members.id (cron이면 NULL) |
| period_from / period_to | date | 수집 기간 (최근 1주) |
| keywords | jsonb | 사용 키워드 세트 |
| source_count | integer | 수집 건수 |
| sources | jsonb | `[{title,link,description,pubDate,sourceType,keyword}]` |
| summary | text | 활동·이슈 요약 |
| keyword_cloud | jsonb | `[{text,weight}]` 워드클라우드용 |
| sentiment | jsonb | `{label,positive,neutral,negative,reason}` |
| recommendations | jsonb | AI 추천 액션 `[{title,detail}]` |
| diff_summary | text | 직전 보고서 대비 변경점(신규/사라진 이슈·키워드 변화) |
| ai_model | varchar(60) | |
| status | varchar(10) | 'ok' \| 'partial' \| 'failed' |
| created_at | timestamptz | |

### `org_news_settings` (단일 행 id=1·UPSERT 시드)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | integer PK (=1) | 싱글톤 CHECK |
| keywords | jsonb | 키워드 세트(위 시드) |
| scopes | jsonb | `["news","blog","webkr"]` |
| auto_enabled | boolean | 매일 cron 자동 on/off |
| updated_at | timestamptz | |

마이그 함수: `netlify/functions/migrate-org-news.ts` (메인 작성·§6.8 GET ?run=1 + requireAdmin·멱등 IF NOT EXISTS·시드 ON CONFLICT DO NOTHING). 호출 성공 후 삭제.

## 5. featureKey (B 등록)

`lib/ai-feature.ts` FEATURE_REGISTRY에:
```
{ key:"org_news_analysis", name:"교유협 뉴스·여론 분석", category:"admin_action",
  description:"네이버 수집 콘텐츠에서 활동·이슈 요약·연관 키워드·여론·추천·변경점 생성", sortOrder:297 }
```
cron·수동 공용. fail-open(시드 불필요).

## 6. API 계약 (A·B 합의 — 변경 금지)

모든 엔드포인트 `requireAdmin` + `export const config={path}`. 응답 `{ok, data}` + step/detail 에러.

| 메서드·경로 | 권한 | 입력 | 응답 data |
|---|---|---|---|
| `GET /api/admin-org-news-list` | admin | `?limit=60` | `{ reports:[{id,generatedAt,triggerType,periodFrom,periodTo,sourceCount,sentimentLabel,summaryShort,status}] }` (최신순) |
| `GET /api/admin-org-news-get` | admin | `?id=N` (없으면 최신) | `{ report:{ ...전체 컬럼... } }` |
| `POST /api/admin-org-news-refresh` | super_admin | (없음) | `{ report:{...전체...} }` — 수집+분석+INSERT 1건. featureKey 월한도로만 통제 |
| `GET /api/admin-org-news-settings` | admin | — | `{ settings:{keywords,scopes,autoEnabled} }` |
| `PUT /api/admin-org-news-settings` | super_admin | `{keywords?,scopes?,autoEnabled?}` | `{ settings }` (UPSERT 시드) |

**sentiment.label** = `긍정`\|`부정`\|`중립`\|`혼조`. **keyword_cloud** = 빈도·중요도 가중 `[{text,weight}]` (weight 1~100).

## 7. 역할 분담 (병렬)

### 메인 (나) — 설계·인프라·머지·문서
- [x] 설계서(본 문서) + API 계약 확정
- [x] 마이그 함수 `migrate-org-news.ts` 작성
- [ ] A·B 브랜치 머지(로컬 main) → 1회 push → Swain(키+마이그) → C 검증 조율
- [ ] 종결 시 schema.ts 정의 append-only 추가(선택)·매뉴얼·명세·history 이동

### B (백엔드) — `tbfa-mis-B` / `feature/org-news-back` (베이스 로컬 main)
- [ ] `lib/naver-search.ts` — 네이버 검색 API 클라이언트(news/blog/webkr). 키워드별 호출·최근 1주 필터·link 기준 dedup·HTML 태그 제거·AbortSignal.timeout. 키 미설정 시 명시적 에러(fail-closed).
- [ ] `lib/org-news-analyze.ts` — 수집 항목 → Gemini(`callGeminiJSON`·mode pro·featureKey `org_news_analysis`) → `{summary,keywordCloud,sentiment,recommendations}`. 직전 보고서 받아 `diffSummary` 생성. 폴백(AI 실패 시 휴리스틱 요약·빈도 기반 키워드클라우드).
- [ ] `admin-org-news-list` / `admin-org-news-get` / `admin-org-news-refresh`(super_admin) / `admin-org-news-settings`(GET admin·PUT super_admin·UPSERT 시드) — raw SQL(db.execute(sql\`\`)).
- [ ] `cron-org-news.ts` — KST 09:00(UTC 00:00) `auto_enabled` 확인 후 수집+분석+INSERT(trigger_type='cron') + `netlify.toml` 등록.
- [ ] `lib/ai-feature.ts` FEATURE_REGISTRY `org_news_analysis` 추가.
- 검증: tsc 0. **schema.ts는 메인 영역(건드리지 않음)·raw SQL만.**

### A (프론트) — `tbfa-mis-A` / `feature/org-news-front` (베이스 로컬 main)
- [ ] `public/admin-org-news.html` + `public/js/admin-org-news.js`(?v=1) — 위 API 계약 소비.
- [ ] CMS 4곳 등록(기존 milestone-review 패턴): ① `cms-tbfa.html:~551` 메뉴 `<li><a href="#org-news" data-tab="org-news"><i>📰</i><span>여론·뉴스 분석</span></a></li>` ② `cms-tbfa.html:~2236` `<section id="page-org-news"><iframe data-nf-src="/admin-org-news.html">` ③ `cms-tbfa.js:~296` 타이틀맵 `'org-news':'📰 여론·뉴스 분석'` ④ `cms-tbfa.js:~388` 로더 `else if(tab==='org-news') _nfLoadIframe('page-org-news');`
- [ ] 화면: 최신 보고서(요약·**워드클라우드(wordcloud2.js CDN 3-tier 폴백)**·여론 배지·추천 카드·변경점·소스 링크 목록) + **히스토리 드롭다운/목록**(과거 보고서 선택 조회) + **"🔄 최신 재조사" 버튼**(refresh·로딩·완료 토스트) + **설정 패널**(키워드 편집·자동 토글·super_admin).
- [ ] CMS 캐시버스터 갱신(cms-tbfa.html이 참조하는 cms-tbfa.js ?v 갱신).
- 검증: JS 문법(node --check). **lib/·functions·schema.ts·netlify.toml 건드리지 않음(B 영역).**

### C (검증) — A·B 머지 후 `verify/2026-05-24-org-news`
- [ ] 수집 dedup·1주 필터·키 미설정 fail-closed / AI 폴백 / 5개 엔드포인트 권한(super_admin 분기)·계약 일치 / cron toml·auto_enabled / 워드클라우드 렌더·히스토리·재조사·설정 저장 / featureKey / 회귀·tsc 0 + Swain 브라우저 체크리스트.

## 8. 진행 순서

1. **메인**: 설계+마이그 로컬 main 커밋(push 없음) → A·B 트리거 발사.
2. **A·B 병렬**(베이스 로컬 main): commit까지, push 금지(§6.17).
3. **메인**: A·B 머지(로컬 main) → **1회 push** → Swain ① 네이버 키 env ② `migrate-org-news?run=1` 호출.
4. **C**: 머지본 검증·버그 fix(commit) → 메인 머지.
5. 통과 시 매뉴얼·명세·featureKey 화면·history 이동.

## 9. 주의 (회귀·정합)
- A는 `cms-tbfa.html/js`+신규 2파일만, B는 `lib/`+`functions/`+`netlify.toml`+`ai-feature.ts`만 → **파일 충돌 0**. schema.ts는 메인 단독.
- 네이버 API 일 25,000건 무료 쿼터 — 키워드×범위(7×3=21콜/회)면 충분. 수동 무제한이나 featureKey 월 한도가 AI 비용 상한.
- sources JSONB가 커질 수 있음 → 보고서당 항목 상한(예 키워드·범위별 상위 N개)으로 제한.

---

## 구현 결과 (2026-05-24·A·B 병렬 머지·tsc 0·JS 문법 0)

- **B 백엔드**(`500700f`→cherry-pick `c686cc1`): `lib/naver-search.ts`(news/blog/webkr·1주 필터·dedup·8초 timeout·키 미설정 fail-closed)·`lib/org-news-analyze.ts`(Gemini pro·summary/keywordCloud/sentiment/recommendations/diff·AI 실패 휴리스틱 폴백 status partial)·5 엔드포인트(list/get/refresh/settings)·`cron-org-news.ts`(UTC 00:00=KST 09:00·auto_enabled 분기)+netlify.toml 등록·featureKey `org_news_analysis`.
- **A 프론트**(`2d4e538`→cherry-pick `3222cef`): `admin-org-news.html`+`admin-org-news.js`(계약 5종 소비·다중 fallback 언래핑)·CMS 4곳 등록(메뉴 `#org-news`·iframe `page-org-news`·타이틀맵·로더)·워드클라우드 wordcloud2.js 3-tier CDN 폴백+CSS 폴백·히스토리·재조사·설정 패널(403 시 숨김).
- **머지**: A·B 작업 커밋만 cherry-pick(옛 검수 커밋 ce5dcd8·cf0aaba 제외). 충돌 1건 = `lib/ai-feature.ts` FEATURE_REGISTRY(③ milestone_matrix_mapping + ④ org_news_analysis 둘 다 보존)로 해소. 파일 충돌 그 외 0.
- **계약 정합**: A 언래핑(`res.data.data.X||res.data.X`) ↔ B 래핑(`{ok,data:{...}}`) 일치 확인.

### Swain 액션 (push 배포 후)
- env `NAVER_SEARCH_CLIENT_ID`·`NAVER_SEARCH_CLIENT_SECRET` 등록 ✅(완료)
- **마이그 호출**: `https://tbfa.co.kr/api/migrate-org-news?run=1` (어드민 로그인) → 2테이블 생성. **호출 전엔 보고서 목록/단건 500**(정상).

### C 검증 (2026-05-24·`04275b9`→머지 `9c031cd`) — BUG 2건 발견·fix·나머지 PASS·tsc 0
- **BUG-1(P0)**: 마이그 컬럼명·타입이 서버 코드와 전면 불일치(설계 초안대로 `source_count·jsonb keywords` vs 서버 `collected_count·items·ai_status·text[]`) → 호출 시 전부 500. **베이스 어긋남으로 B가 설계서를 못 본 채 독자 컬럼 사용**한 결과(§6.1·§9.1.1 위반). → 마이그를 서버 실사용 스키마로 재작성.
- **BUG-2(P1)**: 화면이 읽는 응답 키가 서버와 달라 보고서 있어도 빈 화면 → 화면에 서버 실응답 폴백 추가(양쪽 키 수용·회귀 0).
- 정상: 수집·분석·5엔드포인트 권한·cron·워드클라우드 3단 폴백·CMS 4곳·featureKey 전부 PASS.

### 메인 후속(2026-05-24)
- **마이그 `?reset=1` 추가**: Swain이 옛(틀린 타입) 마이그를 이미 호출 → keywords/scopes가 jsonb로 생성됨. ADD COLUMN으론 타입 못 고치고 Neon 콘솔 DROP 불가 → `?reset=1`이 두 빈 표 DROP 후 재생성(데이터 0·안전).
- §4 문서를 구현 스키마로 정정(권위=마이그).

### 메인 후속 fix (2026-05-24·C 검증 이후)
- **text[] 배열 바인딩 버그**: drizzle `sql` 템플릿이 `${jsArray}`를 콤마로 펼쳐 레코드로 만들어 text[] INSERT가 전부 500(`?reset=1` 시드에서 표면화). 시드·refresh·cron·settings 4곳 모두 `lib/org-news-analyze.sqlTextArray()`(=`ARRAY[$1,$2,…]::text[]` 개별 바인딩)로 교체. C 코드검증이 라이브 미실행이라 미발견한 런타임 버그.
- **여론 % 표시**: 백엔드 0~100 값에 프론트가 ×100 중복(8000%) → 제거. sentiment label 영문(negative)↔한글 배지 맵 불일치 → 양쪽 수용. `?v=3-sentiment`.

### ✅ Swain 라이브 확인 (2026-05-24)
`?reset=1` 7단계 성공 + 재조사 정상 동작(요약·워드클라우드·여론·추천·소스 링크 표시 확인). 1회용 마이그 삭제 완료.

### 종결 시 잔여
- [ ] 여론 % fix(`?v=3-sentiment`) 렌더 최종 확인
- [ ] 매뉴얼(`manual-admin.html`)·명세 동기화 + 설계서 history 이동
