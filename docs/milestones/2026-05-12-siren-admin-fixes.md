# 싸이렌 어드민 4건 fix — 메인 단독 작업

> **작성**: 2026-05-12 / 메인 채팅 (Phase 21 마감 직후)
> **작업 모드**: **메인 단독** (A·B·C 병렬 X, 단일 채팅에서 정독·진단·fix·검증 모두 수행)
> **추정**: 1~3h (4건 모두 작은 fix, schema 변경 0)
> **베이스**: main @ 4f49031 또는 그 이후 (새 세션 시작 시점)
> **선행 정독**: `CLAUDE.md` 자동 로드 + 본 문서 + `PROJECT_STATE.md §5`

---

## 0. 작업 범위 (Swain 2026-05-12 요청)

운영자 관리 화면에서 발견된 4건. 모두 사용자 직접 발견 → 우선순위 ↑.

| # | 증상 | 영향도 |
|---|---|---|
| 1 | SIREN 어드민 "가입 회원 관리" 진입 시 "불러오는 중..." 멈춤 | 🔴 High (운영자가 가입자 못 봄) |
| 2 | 회원 자격 승인 화면에 증빙 파일 첨부·표시 칸 없음 | 🟠 Medium (UX 누락) |
| 3 | SIREN 신고 관리 하위 "외부 기관 관리" 메뉴 클릭 무반응 | 🟠 Medium (Phase 14 미연결) |
| 4 | 메인 화면 편집 → 정적 페이지 수정 동작 안 함 | 🟡 Low (편집 후 안 저장됨) |

---

## 1. 사전 정독 결과 (2026-05-12 본 세션 Subagent 진단)

### Bug-A1: 가입 회원 관리 "불러오는 중..." 멈춤

**호출 경로**:
- HTML: `public/admin.html:2774` `<a data-page="members">`
- JS: `public/js/admin.js:585` — `params.set('source', 'siren')` (홈페이지 가입자만 표시)
- JS: `public/js/admin.js:588` — `GET /api/admin/members?source=siren` 호출
- API: `netlify/functions/admin-members.ts:218~241` — `source` enum → `signup_sources.code` 매핑

**추정 원인** (가설 — 새 세션이 실제 확인 필요):
- `admin-members.ts:102` `SOURCE_ENUM_TO_CODE` 매핑: `'siren'` enum → DB code 매핑 누락 가능성
- 또는 `signup_sources` 테이블에 해당 row 없어서 `getSignupSourceId()` 반환 null → 필터 미적용 → 전체 회원 1000+건 로드 → UI 프리징
- 7e6388b 커밋(2026-05-11)에서 "가입경로 숨김 + 홈페이지 가입자만" 변경 때 회귀 가능성

**fix 작업 (예상)**:
1. `admin-members.ts:102` 영역 확인 — `SOURCE_ENUM_TO_CODE` 매핑 확인
2. Subagent에 위임: 라이브 DB의 `signup_sources` 테이블 row 점검 (또는 메인이 진단 마이그 함수 1회 작성·호출)
3. 케이스 A: 매핑 누락 → 코드에 `'siren': 'website'` 또는 적절한 code 추가
4. 케이스 B: DB 시드 누락 → 1회용 마이그로 `INSERT INTO signup_sources (code, label) VALUES ('siren', '싸이렌 홈페이지') ON CONFLICT DO NOTHING`
5. 응답 빈 배열일 때 "조건에 맞는 회원이 없습니다" UI 표시 (현재는 무한 로딩)

### Bug-A2: 회원 자격 승인 — 증빙 파일 첨부 칸 누락

**호출 경로**:
- DB schema: `db/schema.ts` `eligibilityChangeRequests` 테이블 — `evidenceBlobId` 컬럼 **이미 존재**
- 어드민 심사 UI: `public/js/admin-eligibility.js:50~75` `renderRow()` — 증빙 필드 표시 미구현
- 사용자 신청 UI: `mypage-eligibility.js` (또는 비슷한) — 파일 업로드 UI 존재 여부 미확인

**추정 원인**:
- DB·API는 준비됐으나 어드민 심사 화면에서 evidenceBlobId 다운로드·미리보기 UI 미구현
- 사용자 신청 측에 파일 업로드 모달이 있는지도 점검 필요

**fix 작업 (예상)**:
1. `admin-eligibility.js` `renderRow()` 안에 증빙 컬럼 한 칸 추가:
   ```js
   '<td>' + (it.evidenceBlobId 
     ? '<a href="/api/blob-download?id=' + it.evidenceBlobId + '" target="_blank">📎 증빙 다운</a>'
     : '<span class="muted">파일 없음</span>') + '</td>'
   ```
2. 사용자 신청 측(`mypage-eligibility.js` 정독) — 파일 업로드 UI 없으면 추가
3. `auth-signup.ts` 또는 `mypage-eligibility-create.ts`에서 `evidenceBlobId` POST 처리 확인

### Bug-A3: 외부 기관 관리 — 클릭 무반응

**호출 경로**:
- HTML: `public/admin.html:2747` `<a data-page="agency-mgmt">` 메뉴 ✓
- 빈 섹션: `public/admin.html:3470` `<div id="adm-agency-mgmt" class="adm-page"></div>` ✓
- JS 파일: `public/js/admin-agency-mgmt.js` (라인 1~376) ✓
- 스크립트 로드: `public/admin.html:5811` `<script src="/js/admin-agency-mgmt.js?v=2">` ✓
- 라우터: `public/js/admin.js:5819~5821` `page==='agency-mgmt'` 분기 → `window.adminAgencyMgmt.reload()` ✓

**추정 원인**:
- 모든 코드가 연결돼 보이는데 동작 안 함 → 다음 셋 중 하나:
  - (a) JS 로드 순서 — `admin.js`가 `admin-agency-mgmt.js`보다 먼저 로드되면 `window.adminAgencyMgmt` 미정의 시점에 라우터 실행 (race condition)
  - (b) `/api/admin-agency-list?active=1` 응답 실패 — 콘솔 에러로만 떨어지고 UI는 빈 상태
  - (c) `external_organizations` 테이블 row 0건 → 빈 목록만 보여서 "무반응" 오해

**fix 작업 (예상)**:
1. 새 세션이 라이브에서 콘솔 열어서 실제 확인 (`/api/admin-agency-list` 응답·`window.adminAgencyMgmt` 정의 시점)
2. 케이스 (a): admin.html `<script>` 순서를 `admin-agency-mgmt.js` → `admin.js` 로
3. 케이스 (b): `admin-agency-list.ts` 진단 (DB 쿼리 실패·인증 가드 문제)
4. 케이스 (c): "등록된 외부 기관 없음" + "+ 기관 등록" 버튼 명시 (이미 있으면 시각 강화)

### Bug-A4: 메인 화면 편집 — 정적 페이지 수정 안 됨

**호출 경로**:
- 페이지: `public/admin-site-builder.html` (별도 SPA — `/admin.html` 안 아님)
- JS: `public/js/admin-site-builder.js:48~49` `page.terms`·`page.privacy` 항목 정의 ✓
- 렌더러: `:335~348` `renderPageContentEditor()` ✓
- API GET: `:386` `/api/admin/site-settings?scope=page.terms`
- API PATCH: `:537` `/api/admin/site-settings` (Draft 저장)

**추정 원인**:
- `site_settings` 테이블에 `scope='page.terms'`·`'page.privacy'` row 자체가 없어서 GET 빈 배열 → "이 영역에 등록된 설정이 없습니다" 안내만 표시 → 사용자는 "수정 안 됨"으로 인식
- 또는 Draft/Live 2단계 저장 흐름 — Draft만 저장하고 "배포" 안 눌러서 실제 반영 X

**fix 작업 (예상)**:
1. 라이브 DB에서 `SELECT * FROM site_settings WHERE scope LIKE 'page.%'` 확인
2. 시드 없으면 1회용 마이그으로:
   ```sql
   INSERT INTO site_settings (scope, key, description, value_type, value_text)
   VALUES 
     ('page.terms', 'body', '이용약관 본문', 'html', '<h2>이용약관</h2><p>...</p>'),
     ('page.privacy', 'body', '개인정보처리방침 본문', 'html', '<h2>개인정보 처리방침</h2>')
   ON CONFLICT DO NOTHING;
   ```
3. `admin-site-builder.html` — "🚀 모든 변경사항 배포" 버튼 시각 강화 (사용자가 못 찾는 경우 대비)
4. 저장 후 "이제 [배포] 클릭해야 라이브 반영됩니다" 안내 토스트

---

## 2. 작업 순서 (우선순위·의존성)

| 순서 | 작업 | 의존성 | 추정 |
|---|---|---|---|
| 1 | **Bug-A1** signup_sources 매핑·시드 점검 + `admin-members.ts` 진단·fix | 없음 | 30~45분 |
| 2 | **Bug-A3** JS 로드 순서·`admin-agency-list` 응답 진단 (콘솔 확인 필수) | 없음 | 20~30분 |
| 3 | **Bug-A4** `site_settings` page.* 시드 + 배포 흐름 안내 | DB 시드 1회 마이그 | 30~40분 |
| 4 | **Bug-A2** `admin-eligibility.js` 증빙 컬럼 + 사용자 측 업로드 UI 확인 | 없음 | 20~30분 |

**작업 원칙** (단일 메인):
- 1건씩 fix → 라이브 검증 → 다음 건. 한 번에 4건 묶음 push 금지 (회귀 추적 어려움).
- DB 시드 필요한 건 (Bug-A1·A4) 1회용 마이그 함수 작성 → Swain 호출 → schema 활성화·삭제 표준 흐름.
- 콘솔 직접 확인이 필요한 건(Bug-A3) Swain께 콘솔 응답 확인 요청.

---

## 3. 검증 시나리오

| # | 사용자 동작 | 기대 동작 |
|---|---|---|
| Q1 | SIREN 어드민 → 가입 회원 관리 클릭 | 홈페이지 가입 회원 N명 리스트 표시 (효성·직접등록 제외) |
| Q2 | 위 동작 후 — 조건 맞는 회원 0명일 때 | "조건에 맞는 회원이 없습니다" 빈 상태 안내 (무한 로딩 X) |
| Q3 | 회원 자격 변경 심사 화면 — 증빙 파일이 있는 신청 | "📎 증빙 다운" 링크 클릭 시 파일 다운로드 |
| Q4 | 자격 변경 심사 — 증빙 없는 신청 | "파일 없음" 회색 텍스트 |
| Q5 | (사용자 측) 마이페이지 → 자격 변경 신청 | 파일 첨부 UI 표시 + 업로드 가능 |
| Q6 | SIREN 신고 관리 → 외부 기관 관리 클릭 | 등록된 기관 리스트 (또는 "등록된 기관 없음") + "+ 기관 등록" 버튼 |
| Q7 | 외부 기관 등록 폼 — 신규 기관 추가 후 저장 | 리스트에 즉시 표시 |
| Q8 | 메인 화면 편집 → 정적 페이지(이용약관) 선택 | HTML 편집 칸 + 현재 내용 표시 |
| Q9 | 위 화면에서 내용 수정 → 임시저장 → 배포 | 라이브 페이지에 변경 반영 + "배포 완료" 토스트 |

회귀 점검:
- 워크스페이스 v3 (R1·R2+R3·R4 기능) 영향 0이어야 함
- 어드민 로그인·R&R 탭·운영자 관리 일반 흐름 정상

---

## 4. 새 세션 시작 프롬프트 (Swain 복붙용)

```
[메인 — 싸이렌 어드민 4건 fix (단일 채팅 작업)]

모델: Opus 4.7
워크트리: tbfa-mis (메인 직접 작업 — A·B·C 미사용)
브랜치: main (베이스 직접)

정독 (필수):
  - CLAUDE.md (자동 로드)
  - PROJECT_STATE.md (현재 상태)
  - docs/milestones/2026-05-12-siren-admin-fixes.md (본 설계서)
  ※ memory/feedback_design_routine.md §4 정독 (체크박스 톤 적용)
  ※ §9.1.9 사전 정독 정책 — 본 설계서가 이미 정독 결과를 §1에 정리

작업 범위: Swain이 2026-05-12 본 세션에서 직접 요청한 4건 (§0)
  - Bug-A1: 가입 회원 관리 멈춤
  - Bug-A2: 자격 승인 증빙 첨부 칸
  - Bug-A3: 외부 기관 관리 무반응
  - Bug-A4: 정적 페이지 수정

작업 흐름:
  1) Bug-A1부터 순서대로 (§2)
  2) 각 건마다 다음 사이클:
     a. 본 설계서 §1.X 추정 원인 확인 (라이브 콘솔·DB 점검 필요 시 Swain에 요청)
     b. fix 코드 작성 + 캐시버스터 갱신 (필요 시)
     c. DB 시드 필요하면 1회용 마이그 함수 작성 → Swain 호출 → schema 활성화·마이그 삭제
     d. commit + push
     e. Swain께 라이브 검증 안내 (Netlify 배포 1~3분 대기)
     f. PASS면 다음 건, FAIL이면 추가 fix
  3) 4건 모두 완료 후 PROJECT_STATE §5 갱신 (싸이렌 어드민 4건 ✅)
  4) docs/HANDOFF.md 갱신 (선택)

원칙:
  - 한 번에 1건만 — 4건 묶음 push 금지 (회귀 추적성)
  - DB 변경은 항상 마이그 함수 → Swain 호출 → schema 활성화 → 삭제 표준
  - 회귀 점검 영역: 워크스페이스 v3(Phase 21) 기능·어드민 로그인·R&R·운영자 관리

⚠️ §1.X 추정 원인은 가설 — 새 세션이 실제 라이브·DB 확인 후 확정.
```

---

## 5. 마감 체크리스트

- [ ] Bug-A1 fix + Swain 검증 PASS
- [ ] Bug-A2 fix + Swain 검증 PASS
- [ ] Bug-A3 fix + Swain 검증 PASS
- [ ] Bug-A4 fix + Swain 검증 PASS
- [ ] 회귀 점검 — Phase 21 기능 모두 정상
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 — "싸이렌 어드민 4건 ✅ 100%" 행 추가

---

**설계서 마지막 갱신**: 2026-05-12 (초안 작성 + Subagent 진단 결과 §1에 정리)
