# 검증 리포트 — ④ 사건·사고 섹션 + ③ 매트릭스 AI 개선

> 브랜치: `verify/2026-05-24-news-incidents`  
> 베이스 커밋: `f650cfc` (베이스OK 확인)  
> 검증일: 2026-05-24  
> 검증자: C 채팅 (자동 검증)  
> 결과: **BUG 없음 — PASS**

---

## 체크박스 결과

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| 1 | migrate-org-news-incidents | ✅ PASS | 하단 상세 |
| 2 | judgeIncidents | ✅ PASS | 하단 상세 |
| 3 | refresh·cron 파이프라인 | ✅ PASS | 하단 상세 |
| 4 | admin-org-news-get incidents 반환 | ✅ PASS | 하단 상세 |
| 5 | 프론트 사건·사고 섹션 | ✅ PASS | 하단 상세 |
| 6 | ③ matrix-parse 개선 | ✅ PASS | 하단 상세 |
| 7 | 회귀·tsc·node --check | ✅ PASS | 오류 없음 |

---

## 상세 검증

### 1. `migrate-org-news-incidents`

- `ALTER TABLE org_news_reports ADD COLUMN IF NOT EXISTS incidents JSONB NOT NULL DEFAULT '[]'::jsonb` → `IF NOT EXISTS` 멱등 보장 ✅
- `GET ?run=1` → `requireAdmin` + `guardFailed(auth) return auth.res` 패턴 정확 ✅
- `GET` (파라미터 없음) → 인증 없이 `incidentsColumnExists` 진단만 반환 ✅
- `export const config = { path: "/api/migrate-org-news-incidents" }` 누락 없음 ✅
- `super_admin` 역할 검증 후 실행, 응답에 "즉시 파일 삭제" 안내 포함 ✅

### 2. `judgeIncidents`

- 협회 무관 사건 제외: 프롬프트에 "단순 홍보·정책 기사·협회와 무관한 내용은 제외" + "관련 없으면 incidents:[] 로 응답" 명시 ✅
- AI 실패 시 `console.warn` 후 `return []` — status 영향 없음(fire-and-forget 안전) ✅
- 반환 필드 8개: `{title, link, source, pubDate, relevance(0~100), urgency("높음"|"보통"|"낮음"), reason, suggestedAction}` 설계 계약과 일치 ✅
- 입력값 방어: `relevance` 범위 클램프(0~100), `urgency` 유효값 체크·기본 "보통", 문자열 필드 `.slice(0, 300)` 길이 제한 ✅
- `featureKey: "org_news_analysis"`, `mode: "pro"`, `maxOutputTokens: 2000` ✅
- `INCIDENT_KEYWORDS as unknown as string[]` — readonly 타입 캐스트 정확 ✅

### 3. refresh·cron 사건 파이프라인

**공통 패턴** (refresh·cron 양쪽 동일):
```
INCIDENT_KEYWORDS → collectNaverSearch(["news"], 20) → judgeIncidents → incidents
→ INSERT(${JSON.stringify(incidents)}::jsonb)
```
- try/catch로 감싸 실패 시 `console.warn` 후 `incidents = []`로 계속 진행 ✅
- INSERT 컬럼 목록에 `incidents` 명시, `::jsonb` 캐스트 ✅
- cron: `trigger_type='cron'`, `generated_by=NULL` ✅
- refresh: `trigger_type='manual'`, `generated_by=admin.id` ✅

### 4. `admin-org-news-get` incidents 반환

- `SELECT *` 후 `row.incidents || []` — 마이그 전 undefined 방어 ✅
- 응답 필드: `incidents: row.incidents || []` — 프론트 소비 키 `incidents`와 1:1 일치 ✅

### 5. 프론트 사건·사고 섹션

**CSS (admin-org-news.html `<style>` 인라인)**:
- `.badge-urg-high`, `.badge-urg-mid`, `.badge-urg-low` 3색 배지 정의 ✅
- `.incident-card`, `.incident-card-header`, `.incident-relevance`, `.incident-title`, `.incident-meta`, `.incident-reason`, `.incident-action` 모두 정의 ✅

**JS 렌더 로직**:
- `urgency 배지`: `urgencyBadge(inc.urgency)` → `badge-urg-high/mid/low` 매핑 ✅
- `관련도 N%`: `관련도 ${inc.relevance != null ? inc.relevance : '—'}%` 표시 ✅
- `원문 링크`: `<a href="${inc.link}" target="_blank" rel="noopener">` ✅
- `suggestedAction`: `💬 제안 대응: ${esc(inc.suggestedAction)}` 표시 ✅
- `내림차순 정렬`: `urgOrder(높음→0, 보통→1, 낮음→2)` + 같은 urgency는 `relevance` 내림차순 ✅
- `빈 상태`: `incidents.length === 0` → "최근 관련 사건 없음" ✅
- `다중 fallback`: `report.incidents || (report.data && report.data.incidents) || []` ✅
- `캐시버스터`: `admin-org-news.js?v=4-incidents` ✅

### 6. ③ `admin-milestone-matrix-parse` 개선

- `maxOutputTokens: 8000` (이전 4000에서 증가) ✅
- "⚠️ 중요: 표의 모든 행을 빠짐없이 추출하라(누락 금지)..." 프롬프트 강조 추가 ✅
- NON_REVENUE 카테고리 힌트: "매출과 무관한 활동·건수·완료 기반 성과 항목" 명시 ✅
- `summary.warning`: `candidates.length < inputLineCount / 2 && candidates.length < inputLineCount - 2` 조건 시 경고 메시지 포함 ✅

### 7. 회귀 검증

- `npx tsc --noEmit`: 오류 0 ✅
- `node --check` (5개 TS 함수): 오류 0 ✅
- 기존 뉴스 화면 섹션 (요약·워드클라우드·여론 %·히스토리·설정): `renderReport` 내 기존 섹션 코드 건드리지 않고 맨 끝에 사건·사고 섹션만 추가 ✅
- 히스토리 상세 뷰: `loadHistoryDetail` → `extractReport` → `renderReport` 동일 경로 → incidents 자동 포함 ✅
- v4 정의 탭 (`admin-milestone-matrix-parse`): DB 쓰기 없는 읽기 전용 API, 기존 응답 구조 유지 ✅

---

## 관찰 사항 (BUG 아님)

1. **`extractionRatio` 미사용 변수** (`admin-milestone-matrix-parse.ts:244`): 계산은 하나 warning 조건에서 인라인 비율로 대체 사용. 기능 영향 없음.

2. **`summary.warning` 프론트 미표시**: 백엔드 응답에는 포함되나 `renderMatrixReview`에서 시각적으로 표시하지 않음. 사용자에게 누락 경고가 노출되지 않는 UX 개선 여지 있음(현 요구사항 범위 밖).

3. **`judgeIncidents` 서명**: 설계서에 `(items, orgContext)` 언급이나 구현은 `(items)` 단독. 조직명이 프롬프트에 하드코딩되어 있고 호출부도 `items`만 전달 — 실제 동작 오류 없음.

---

## Swain 브라우저 검증 체크리스트

마이그레이션 실행 후 아래 순서로 확인:

```
1. https://tbfa.co.kr/api/migrate-org-news-incidents
   → { incidentsColumnExists: false }이면 ?run=1 로 실행

2. 어드민 로그인 상태에서:
   https://tbfa.co.kr/api/migrate-org-news-incidents?run=1
   → { ok: true, mode: "run", message: "incidents JSONB 컬럼 추가 완료..." }

3. 뉴스·여론 분석 화면(admin-org-news.html) → "🔄 최신 재조사" 클릭
   → "재조사가 완료됐습니다" 토스트 확인
   → "🚨 협회 관련 사건·사고" 섹션 렌더 확인:
     a) 사건 있으면: 빨강/주황/회색 배지 + 관련도 N% + 제목(링크) + 이유 + 제안 대응
     b) 없으면: "최근 관련 사건 없음" 안내
   → 기존 섹션(요약·워드클라우드·여론 %·대응 제안) 정상 표시 확인

4. "히스토리" 탭 → 기존 보고서 클릭
   → 상세 뷰에 사건·사고 섹션 포함 확인

5. (옵션) 어드민-마일스톤 화면 → 매트릭스 분석 탭 → 10행 이상 텍스트 붙여넣기
   → 추출 결과에 NON_REVENUE 항목 정상 분류 확인
```

---

> 마이그레이션 호출 성공 확인 후 `migrate-org-news-incidents.ts` 즉시 삭제 + commit (1회용 보안 원칙).
