# 병행 트랙 — ④ 사건·사고 섹션 + ③ 매트릭스 AI 개선 (설계서·단일 출처)

> 2026-05-24 / v4 성과관리 전환(메인 직접)과 **병행**. 베이스 = origin/main @ 5e98e5b.
> A(프론트)·B(백) 병렬 → 메인 머지 → C 검증. 베이스 정합: PARALLEL_GUIDE §4.1.

---

## 트랙 1 — ④ 뉴스 화면에 '협회 관련 사건·사고' 섹션 (Swain Q3=섹션 추가)

기존 ④ 여론·뉴스 분석 화면(`admin-org-news`)에, 최근 **교사 사망사건·교권 침해 등 협회가 참여할 만한 사건·사고**를 네이버 수집 + Gemini가 협회 관련성·시급도 판정해 한 섹션으로 보여준다. 수집·분석은 기존 refresh/cron 파이프라인에 얹는다.

### 데이터 (B)
- `org_news_reports.incidents JSONB NOT NULL DEFAULT '[]'` 컬럼 추가(1회용 마이그 `migrate-org-news-incidents` — ALTER ADD COLUMN IF NOT EXISTS).
- incidents 원소: `{ title, link, source, pubDate, relevance(0~100), urgency('높음'|'보통'|'낮음'), reason, suggestedAction }`.
- 사건 키워드 세트(설정 keywords와 별개·상수): `["교사 사망","교사 순직","교권 침해","학교 사건사고","교사 추락","교사 극단적 선택","교원 순직"]`.

### 백엔드 (B)
- `lib/org-news-analyze.ts`에 `judgeIncidents(items, orgContext)` 추가 — Gemini(`callGeminiJSON`·featureKey `org_news_analysis`·mode pro)로 수집 기사 중 **협회 참여 여지 있는 사건만** 추려 relevance/urgency/reason/suggestedAction 산출. 관련 없으면 제외. AI 실패 시 빈 배열(status 영향 없음).
- `admin-org-news-refresh`·`cron-org-news`: 본 분석 후 사건 키워드 수집(`collectNaverSearch`) → `judgeIncidents` → `incidents`에 저장(INSERT 컬럼 추가). text[]는 `sqlTextArray`, incidents는 `::jsonb`.
- `admin-org-news-get`: 응답 report에 `incidents` 포함.

### 프론트 (A)
- `admin-org-news.html`/`admin-org-news.js`: 최신 보고서 뷰에 **`🚨 협회 관련 사건·사고`** 섹션 추가 — incidents를 urgency(높음=빨강·보통=주황·낮음=회색) 배지 + relevance% + 사건 제목(원문 링크) + reason + **제안 대응(suggestedAction)** 카드로. urgency·relevance 내림차순. 없으면 "최근 관련 사건 없음". 응답 언래핑은 기존 다중 fallback 패턴. 캐시버스터 `?v=4-incidents`.

---

## 트랙 2 — ③ 마일스톤 매트릭스 AI 파싱 개선 (Swain A+B)

`admin-milestone-matrix-parse.ts` 개선 — 큰 매트릭스(60+ 항목)도 누락 줄이게.
- `maxOutputTokens` 4000 → 8000.
- 프롬프트에 "**항목을 빠짐없이 모두 추출**(누락 금지)·표의 모든 행" 강조 + 비매출 카테고리(1~5) 인식 힌트 추가(있으면 `nonRevenueCategory`도 후보에 포함).
- 후처리: candidates 길이가 입력 행 수보다 현저히 적으면 `summary.warning`에 "일부 누락 가능 — 텍스트 분할 재시도 권장" 플래그.
- (정확 대량 셋업은 v4처럼 메인 직접이 원칙 — ③은 분기 소규모 조정 보조용.)

---

## 역할 분담·충돌 회피
- **B**: `lib/org-news-analyze.ts`·`netlify/functions/admin-org-news-*`·`cron-org-news`·신규 `migrate-org-news-incidents`·`admin-milestone-matrix-parse`. (lib·functions만)
- **A**: `public/admin-org-news.html`·`public/js/admin-org-news.js`. (public만)
- 파일 충돌 0. schema.ts·cms-tbfa 무수정(org-news는 raw SQL).

## 진행 순서
1. (지금) 메인 v4 1단계 셋업 push 완료(베이스 5e98e5b). A·B 트리거 발사.
2. A·B commit·보고 → 메인 fetch·머지·1회 push → Swain `migrate-org-news-incidents?run=1` 호출.
3. C 검증(verify/2026-05-24-news-incidents) → fix → 종결.
