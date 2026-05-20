# 근태 메뉴 재배치 — 조회/설정 2메뉴 분리 (설계)

> 작성: 2026-05-21 / 메인 · Swain 요청(5번)
> 영역: cms-tbfa 운영관리 근태 메뉴 + admin-workspace-management.html + admin-attendance-settings.html
> 상태: ✅ 구현 완료 — Swain 라이브 검증 대기 (커밋 후 1회 push)

## §0 배경·기준 (Swain)
현재 근태 조회 탭들이 "근태관리 설정 → (안내 링크) → 워크스페이스 관리" 2단계 안에 묻혀 있음. 기준: **자주 보는 조회는 메인(바로), 한 번 설정하면 안 바뀌는 것만 안쪽**.

## §1 현행 구조 (Explore 조사)
- cms 사이드바 운영관리: 급여관리·권한정책·성과관리 설정·**근태관리 설정**(→ `admin-attendance-settings.html` iframe, `page-attendance-settings`, cms-tbfa.js 라인 297·388)
- `admin-attendance-settings.html` 2탭: 재택보고서(remotereports)·근무형태 관리(workmodes) + 안내 링크 → `admin-workspace-management.html`
- `admin-workspace-management.html` 10탭(awmTabs): records·leaves·balances·schedule·workplaces·policy·leavetypes·holidays·monthrecords·workmodeChanges

## §2 목표 분류 (Swain 확정)
| 그룹 | 탭 | data-tab |
|---|---|---|
| 🟢 근태 현황 (ops·메인) | 근태 현황·휴가 결재·출퇴근 기록·잔여 휴가·근무형태 변경 결재·재택보고서·직원 스케줄·근무형태 관리 | records·leaves·monthrecords·balances·workmodeChanges·remotereports·schedule·workmodes |
| ⚙ 근태 설정 (config·안쪽) | 근무 정책·공휴일·휴가 종류·거점 관리 | policy·holidays·leavetypes·workplaces |

(검증 때 직원 스케줄 등 경계 조정 가능 — data-group 속성만 변경)

## §3 구현 방식
1. **흡수**: `admin-attendance-settings.html`의 remotereports·workmodes 탭(HTML+JS)을 `admin-workspace-management.html`로 이동 → 근태 전체가 한 화면(12탭). DOM id·함수명·전역변수 충돌 점검 후 통합.
2. **그룹 속성·필터**: 12탭에 `data-group="ops|config"` 부여. `admin-workspace-management.html`이 URL `?group=ops|config` 읽어 해당 그룹 탭만 노출 + 첫 탭 활성화. (파라미터 없으면 ops 기본)
3. **돌아가기 버튼**: config 그룹일 때 상단에 "← 근태 현황으로" 버튼 → 같은 화면에서 group=ops로 전환(내부 처리).
4. **cms 2메뉴**: 사이드바 "근태관리 설정" 1개 → "🟢 근태 현황"(att-ops) + "⚙ 근태 설정"(att-config) 2개. 각각 `admin-workspace-management.html?group=ops|config` iframe. section·tabLabels·라우팅 분기 추가.
5. **attendance-settings.html**: 흡수 후 제거 또는 `admin-workspace-management.html?group=ops`로 리다이렉트.
6. **캐시버스터**: admin-workspace-management.js·cms-tbfa.js ?v= 갱신.

## §4 검증 시나리오
- cms 사이드바: 운영관리에 "근태 현황"·"근태 설정" 2메뉴.
- "근태 현황" → 조회 8탭(근태현황·휴가결재·출퇴근기록·잔여휴가·근무형태변경·재택보고서·직원스케줄·근무형태관리), 첫 탭 근태 현황.
- "근태 설정" → 설정 4탭(근무정책·공휴일·휴가종류·거점) + "← 근태 현황으로" 버튼 동작.
- 흡수된 재택보고서·근무형태 관리 정상 동작(API·렌더 회귀 없음).
- 기존 결재·기록·설정 전 기능 회귀 0.

## §6 흡수 구현 가이드 (Explore 정독 — 새 세션 바로 구현용)

### 흡수 대상 (admin-attendance-settings → admin-workspace-management)
- **HTML**: `#tabRemotereports` 패널(attendance-settings.html 라인 90-161)·`#tabWorkmodes` 패널(라인 163-245) → 패널 id를 `awmPanelRemotereports`·`awmPanelWorkmodes`로 rename 후 admin-workspace-management.html에 이동. 탭 버튼 2개(`data-tab="remotereports"`·`"workmodes"`) 추가.
- **JS 함수 이관** (admin-attendance-settings.js → admin-workspace-management.js):
  - 재택보고서: `loadMemberList`·`loadRemoteReports`·`renderReportList`·`renderReportDetail`·`window.toggleStar`·`window.openReportDetail`·`starReport`·`addSupervisorNote` + 전역 `_rrCurrentId`
  - 근무형태: `buildDayGrid`·`loadWorkModes`·`formatRecurringRule`·`renderWorkModeEditor`·`saveWorkMode`·`window.deleteWorkMode` + 전역 `_wmCurrentUid`·`DAYS`·`DAY_KEYS`
- **API (변경 없음)**: `/api/admin-att-members`·`/api/admin/att/remote-reports`·`/api/admin/att/work-mode`

### 충돌·rename (필수)
- `api()`·`toast()` 중복 → **awm 버전 사용**, attendance-settings 버전 제거. ⚠️ **toast 호출부 수정**: `toast(msg,'success'/'error')` → `toast(msg)` (awm은 2번째 인자가 ms·duration).
- `esc()` → `escHtml()`로 통일.
- `$`·`$$` 헬퍼: awm엔 없음 → 이관 함수에서 `document.getElementById`로 바꾸거나 헬퍼 추가.
- 패널 id: `tabXxx` → `awmPanelXxx` (setupTabs가 `awmPanel`+Camelcase 규칙).
- **lazy init 플래그 추가**: `_awmRrInit`·`_awmWmInit` — setupTabs 분기에 `remotereports`(→회원목록 로드+이벤트 바인딩)·`workmodes`(→buildDayGrid+회원목록+이벤트) 추가. (attendance-settings는 DOMContentLoaded에서 미리 로드했지만, awm은 탭 첫 진입 시 lazy)
- 회원 목록: `loadMemberList('rrMemberSel')`·`loadMemberList('wmMemberSel')` — 각 탭 init에서 호출.

### group 필터·돌아가기·cms 2메뉴
- admin-workspace-management.js에 `const group = new URLSearchParams(location.search).get('group')` 추가(현재 안 읽음). 탭 버튼에 `data-group="ops|config"` 부여 → group에 맞는 탭만 표시(`display`), 첫 탭 활성화. (group 없으면 ops 기본)
  - ops: records·leaves·monthrecords·balances·workmodeChanges·remotereports·schedule·workmodes
  - config: policy·holidays·leavetypes·workplaces
- config 그룹 상단에 "← 근태 현황으로" 버튼 → 같은 화면에서 group=ops 탭들로 전환(내부 토글).
- cms-tbfa.html 사이드바(라인 542-554 ops-mgmt): `attendance-settings` 1개 → `att-ops`("🟢 근태 현황")·`att-config`("⚙ 근태 설정") 2개. section 2개(`page-att-ops`·`page-att-config`, iframe `data-nf-src="/admin-workspace-management.html?group=ops|config"`). cms-tbfa.js tabLabels(라인 297 부근)·라우팅 분기(라인 388 부근) 2개 추가.
- attendance-settings.html: 제거 또는 `admin-workspace-management.html?group=ops` 리다이렉트.
- 캐시버스터: `admin-workspace-management.js`·`cms-tbfa.js` ?v= 갱신.

### 검증 후 분류 조정
직원 스케줄(schedule)을 설정으로 뺄지 등 경계는 `data-group` 속성 1개만 바꾸면 됨.

## §5 갱신 이력
| 시각 | 변경 |
|---|---|
| 2026-05-21 | Swain 5번 요청·분류 확정·설계 작성 |
| 2026-05-21 | Explore 흡수 코드 정독 → §6 구현 가이드 추가 (새 세션 인수인계) |
| 2026-05-21 | ✅ 구현 완료 — 흡수 12탭 통합·group 필터·돌아가기·cms 2메뉴·옛 화면 리다이렉트 (아래 §7) |

## §7 구현 결과 (2026-05-21)

**변경 파일 6개**:
- `public/admin-workspace-management.html` — 탭 nav에 `data-group="ops|config"` 부여 + 재택보고서·근무형태 관리 2탭 추가(ops, 총 12탭)·조회/설정 순서 재배열, 헤더에 동적 타이틀(`#awmTitle`) + "← 근태 현황으로" 버튼(`#awmBackToOps`), 흡수 패널 2개(`#awmPanelRemotereports`·`#awmPanelWorkmodes`) 추가. JS 캐시버스터 `?v=15-menureorg`.
- `public/js/admin-workspace-management.js` — `apiThrow` 헬퍼(흡수 코드 응답 파싱 보존), 재택보고서·근무형태 함수 전량 이관(`esc→escHtml`·`api→apiThrow`·toast 2번째 인자 제거), `setupTabs` lazy 분기 2개(`initRemoteReportsTab`·`initWorkModesTab`), `applyGroupFilter(group)` + init에서 `?group` 읽어 필터 + 돌아가기 버튼 바인딩.
- `public/cms-tbfa.html` — 사이드바 "근태관리 설정" 1개 → "🟢 근태 현황"(`att-ops`)·"⚙️ 근태 설정"(`att-config`) 2메뉴. iframe 섹션 2개(`page-att-ops`→`?group=ops`·`page-att-config`→`?group=config`). cms-tbfa.js 캐시버스터 `?v=20260521-attreorg`.
- `public/js/cms-tbfa.js` — tabLabels 2개·라우팅 분기 2개(`_nfLoadIframe('page-att-ops'|'page-att-config')`). 섹션 표시는 `page-${tab}` 규칙으로 자동.
- `public/admin-attendance-settings.html` — `admin-workspace-management.html?group=ops` 리다이렉트 페이지로 전환(admin-hub 숨김 카드·옛 링크 안전 처리).
- `public/js/admin-attendance-settings.js` — **삭제**(흡수 완료, git history 보존).

**검증 완료(코드)**: JS 문법 통과(node --check 2/2)·DOM id 충돌 0(awm `awmXxx` vs 흡수 `rr/wm` prefix)·옛 함수명/2-인자 toast 잔존 0·흡수 API 3종 서버 가드 `super_admin` 강제 확인(비-super 어드민은 403 그레이스풀).

**남은 검증(Swain 라이브)**: ① cms 운영관리에 2메뉴 노출 ② 근태 현황 8탭(첫 탭 근태 현황)·근태 설정 4탭(+돌아가기 버튼) ③ 흡수된 재택보고서·근무형태 관리 정상 동작 ④ 기존 결재·기록·설정 회귀 0.
