# 버그 픽스 라운드 2차 — 1차 픽스 미흡분 + 새 에러 (13건)

> 작성: 2026-05-15 메인
> 계기: 1차 버그 픽스 라이브 검증 결과 재정 화면 다수가 여전히 깨짐 + 새 에러(#4 unwrap·#10 addEventListener·#13 SQL array) 발견
> 진단: Explore 2회 — "1차 수정이 왜 불완전했는지"까지 파헤침

---

## §-1 채팅 역할 분담

| 채팅 | 모델 | 워크트리 | 브랜치 | 담당 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | main | 머지·문서 |
| A | Opus 4.7 | tbfa-mis-A | feature/bugfix2-front | 🎨 unwrap 정리·재정 화면·대시보드 KPI·사이드바·CSS |
| B | Opus 4.7 | tbfa-mis-B | feature/bugfix2-back | 🔧 donorType·검증 대시보드 쿼리·금월결제/총매출 집계·통장 import·발송 |
| C | Opus 4.7 | tbfa-mis-C | (검증→자체fix) | 🔍 정적 정독 (라이브는 Swain — `feedback_verification_rounds`) |

> push 자동화 발효됨 — A·B·C는 자기 `feature/`·`fix/` 브랜치 push 자율. 묻는 건 애매한 로직뿐.

---

## §0 1차 픽스가 불완전했던 이유 + 2차 진단 종합

| # | 증상 (1차 후 여전히/신규) | 진단 |
|---|---|---|
| 1 | "효성 CMS+에 KPI 넣었으나 대상이 틀림" | 진짜 대상은 **통합 CMS 1뎁스 "대시보드" 메뉴**. `renderDashboard()`가 kpiFamily·kpiDonor 등을 "—"로만 둠 — 집계 로직 없음 |
| 2 | 효성 회원 여전히 "비후원" | `unwrap()`이 응답 구조 오해석 → `donorType` undefined → `DONOR_TYPE_LABEL[undefined]` = "비후원" fallback |
| 3 | 검증 대시보드 여전히 무한로딩 | `admin-donation-dashboard.ts` 캐시 응답이 이중 래핑(`data:{...cached}`) → unwrap 못 풂 + BOOL_OR 쿼리 NULL 처리 오류 가능성 |
| 4 | "unwrap is not defined" | `unwrap()`이 cms-tbfa.js IIFE 스코프에만 — 1차에서 `window._cmsApi`만 노출, `unwrap` 누락 |
| 6 | 후원자관리·알림발송 2뎁스 열린 채 | cms-tbfa.html에 `style="display:block"` 인라인 하드코딩 (재정만 1차에서 none 처리됨) |
| 6-1 | 워크스페이스 2뎁스 아이콘 우측 쏠림 | 워크스페이스 2뎁스 메뉴가 1뎁스와 같은 padding — 들여쓰기 CSS 없음 |
| 7 | 후원결제내역 UI 깨짐 + 금월 결제금액 안 맞음 | renderShell CSS 클래스 누락 + 금월 결제 = 효성정기+CMS정기+일시(직접계좌)+일시(토스) **4채널 합산 로직 부재** |
| 8 | 수입현황 효성 금액 누락 + 토스 6만원(미오픈인데) + 느림 | `pgProvider` 매칭 부정확 + 토스 미오픈인데 데이터 잡힘 → DB 실제 값 확인 필요 |
| 9 | 후원 외 매출 여전히 빈 화면 | other-revenues 라우팅/renderShell 미반영 |
| 10 | 지출 관리 "addEventListener null" | `admin-expenses.js bindShellEvents()`가 querySelector null 체크 없이 addEventListener — `#expYearSelect`는 renderShell HTML에 없음 |
| 11 | 예산 관리 UI LOW 퀄리티 | renderShell CSS 클래스(kpi-grid·data-table·input-sm 등)가 로드된 CSS에 없음 |
| 13 | 통장 업로드 "op ANY/ALL requires array" + 탭 UI 깨짐 | `admin-bank-import.ts`가 `= ANY(${hashes})`에 빈 배열/null 전달 + 탭 CSS 클래스 누락 |
| 14 | 발송 상세 전부 0 + 발송중인데 완료 | `totalRecipients` 명시 조회 안 됨 + job.status 판정 로직 + 수신자 목록 status 필터가 일부만 |

---

## §1 공통 핵심 — unwrap() 함수 정리 (#2·#3·#4 동시 해결, A)

`cms-tbfa.js`의 `unwrap()`이 3개 버그의 공통 원인:
- [ ] **#4**: IIFE 바깥에 `window._cmsUnwrap = unwrap;` 노출 (1차에서 누락). 모듈 스코프 코드(잠재후원자 등)가 참조 가능하게
- [ ] **#2·#3**: `unwrap()` 응답 구조 파싱 로직 강화 — `{ ok, data: [...] }` / `{ ok, data: { data: [...], total } }` / `{ ok, data: { ...cached, cached: true } }`(이중 래핑) 모두 정확히 풀도록. 현재 마커 키 검사가 느슨해 오작동
- [ ] unwrap이 정확해지면 #2 donorType·#3 검증 대시보드 데이터가 제대로 전달됨

---

## §2 재정 화면 (#7·#8·#9·#10·#11·#13)

### A 담당 (프론트)
- [ ] **#10**: `admin-expenses.js bindShellEvents()` — 모든 querySelector 결과에 null 가드 (`el?.addEventListener()` 또는 `if(!el) return`). renderShell HTML에 없는 요소(`#expYearSelect` 등) 참조 제거 또는 가드
- [ ] **#9**: other-revenues 라우팅 — 첫 진입 시 renderShell 보장. `page-other-revenues` 빈 섹션 → init() 호출 후 DOM 생성 확인
- [ ] **#11·#13 탭·#7·#8 UI**: renderShell이 쓰는 CSS 클래스(kpi-grid·data-table·input-sm·tab-btn·tabs-bar 등)가 cms-tbfa.html이 로드하는 CSS에 **실제로 정의돼 있는지 확인** — 없으면 cms-tbfa.html 인라인 `<style>` 또는 별도 CSS에 보강. 1차에서 pages.css 로드만 추가했는데 클래스가 거기 없을 수 있음
- [ ] **#7**: 후원결제내역 "금월 결제금액" — 효성 정기 + CMS 정기 + 일시(직접계좌) + 일시(토스) **4채널 합산** 표시 (B가 API에 합계 필드 추가하면 그걸 사용)

### B 담당 (백엔드)
- [ ] **#7·#8**: `admin-finance-income-summary.ts`·`admin-finance-pl-summary.ts` — 금월 결제·총매출이 4채널(효성정기·CMS정기·일시직접·일시토스) 정확히 합산하는지. `donations` 테이블의 `pgProvider`·`status` 컬럼 실제 값 확인
- [ ] **#8 토스 미스터리**: 토스 미오픈인데 토스 6만원 잡힘 → `donations` 테이블 실제 `pgProvider='toss'` 행 조회. 테스트 데이터면 그대로 두되 집계가 "기타"로 안 빠지게, 집계 로직 오류면 수정
- [ ] **#8 효성 금액 누락**: 효성 CMS 매출이 총매출에 안 잡히는 원인 — pgProvider 매칭 또는 status 필터
- [ ] **#13**: `admin-bank-import.ts` — `= ANY(${hashes})` 앞에 빈 배열 가드: `if (hashes.length === 0) { ... 정상 응답 }`
- [ ] **#8 속도**: 1차에서 캐시 추가했는데 여전히 느리면 쿼리·인덱스 재점검

---

## §3 통합 CMS 대시보드 (#1 — A 주도 + B 보조)

- [ ] **#1**: 통합 CMS 1뎁스 "대시보드" 메뉴(`data-tab="dashboard"`)의 `renderDashboard()` — 현재 kpiFamily·kpiDonor·kpiRegular·kpiOnetime을 "—"로만 둠
  - A: 회원 목록 응답 기반으로 유족회원(`type='family'`)·후원회원(`donorType` regular+prospect)·정기·일시 카운트 계산해 KPI 표시
  - B: 첫 페이지 데이터만으로는 부정확 → 전체 집계가 필요하면 `admin-members` 응답에 `donorTypeCounts`·`typeCounts` 같은 전체 집계 필드 추가 (또는 별도 경량 집계 API)
  - A는 B 집계 필드 사용, 응답 키 다중 fallback

---

## §4 사이드바 (#6·#6-1 — A)

- [ ] **#6**: `cms-tbfa.html` 사이드바 — 후원자 관리·알림 발송·AI 에이전트 그룹의 `<ul class="cms-submenu" style="display:block">` 인라인을 **`display:none`으로**. `cms-menu-group`의 `open` 클래스도 제거. 모든 2뎁스 기본 닫힘
  - 단 현재 활성 탭이 속한 그룹은 진입 시 자동 펼침 (setupTabs 초기화에서)
- [ ] **#6-1**: 워크스페이스(`workspace*.html`) 사이드바 2뎁스 — `padding-left` 명시(1뎁스 + 아이콘 + 갭만큼, 예: 54px)로 들여쓰기. 2뎁스 아이콘이 1뎁스처럼 보이지 않게

---

## §5 발송 작업 (#14 — B 주도)

- [ ] **#14**: `admin-send-job-progress.ts` — `totalRecipients`를 `COUNT(*)`로 명시 조회 + NULL→0 coalesce. `job.status` 정확히 반환
- [ ] 수신자 목록 쿼리 — status 필터를 `IN ('pending','sending','completed','failed')` 전체로 (현재 일부만 → "발송 중"만 보임)
- [ ] "발송중인데 완료처리" — job 완료 판정 로직 점검 (totalRecipients=0이면 완료로 오인하는지)
- [ ] 발송 상세 화면(iframe `send-jobs.html`)이 progress 응답을 정확히 파싱하는지

---

## §6 A·B 분배 요약

**A (feature/bugfix2-front)**: §1 unwrap 정리(#2·#3·#4) / §2 프론트(#7·#9·#10·#11·#13 UI) / §3 대시보드 KPI(#1) / §4 사이드바(#6·#6-1)
**B (feature/bugfix2-back)**: §2 백엔드(#7·#8·#13 import) / §3 대시보드 집계 필드(#1 보조) / §5 발송(#14)

---

## §7 트리거

### §7.1 A 트리거 (feature/bugfix2-front)

```
[메인 → A 채팅] 버그 픽스 2차 — unwrap·재정 화면·대시보드 KPI·사이드바 — 🎨 프론트엔드

[자율주행 정책]
- PowerShell·git bash·파일·git·npm 전부 settings.json 허용됨. 권한 질문 금지.
- ★ feature 브랜치 push는 자율 — 묻지 말고 바로 push + 완료 보고.
  묻는 건 애매한 설계·로직 결정뿐.
- 베이스는 git pull 후 main 최신

[진행률 보고 의무] 큰 단계 완료마다 "📊 진행률 X% (N/M 완료)" 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/bugfix2-front

설계서: docs/milestones/2026-05-15-bugfix-round2.md

■ 1단계 — unwrap 정리 (§1, 핵심 — #2·#3·#4 동시 해결)
- [ ] cms-tbfa.js IIFE 바깥에 window._cmsUnwrap = unwrap 노출
- [ ] unwrap() 응답 구조 파싱 강화 — { ok, data:[] } / { ok, data:{data:[],total} } /
      { ok, data:{...cached} } 이중 래핑 모두 정확히 풀도록
- [ ] 잠재후원자 등 모듈 스코프 코드가 unwrap 정상 참조 확인

■ 2단계 — 재정 화면 프론트 (§2 A 담당)
- [ ] #10 admin-expenses.js bindShellEvents() — querySelector null 가드 (?.addEventListener)
- [ ] #9 other-revenues 라우팅 — 첫 진입 renderShell 보장
- [ ] #11·#13탭·#7·#8 — renderShell CSS 클래스가 로드 CSS에 실제 있는지 확인,
      없으면 보강 (1차 pages.css 로드만으론 부족했음)
- [ ] #7 후원결제내역 금월 결제금액 — B API의 4채널 합계 필드 사용해 표시

■ 3단계 — 통합 CMS 대시보드 KPI (§3, #1)
- [ ] 1뎁스 "대시보드" 메뉴 renderDashboard() — kpiFamily·kpiDonor·kpiRegular·
      kpiOnetime을 "—" 대신 실제 집계값으로 (B 집계 필드 사용, 응답 키 다중 fallback)

■ 4단계 — 사이드바 (§4)
- [ ] #6 후원자관리·알림발송·AI 그룹 cms-submenu 인라인 display:block → none,
      open 클래스 제거. 활성 탭 그룹만 진입 시 자동 펼침
- [ ] #6-1 워크스페이스 2뎁스 padding-left 명시 들여쓰기

■ 5단계 — 검증
- [ ] 캐시버스터 ?v=20260515bugfix2
- [ ] JS 구문 검사

완료 후: git push origin feature/bugfix2-front
완료 메시지: "[A → 메인] feature/bugfix2-front push 완료."
```

### §7.2 B 트리거 (feature/bugfix2-back)

```
[메인 → B 채팅] 버그 픽스 2차 — donorType·검증 대시보드·금월결제/총매출·통장·발송 — 🔧 백엔드

[자율주행 정책]
- PowerShell·git bash·파일·git·npm 전부 settings.json 허용됨. 권한 질문 금지.
- ★ feature 브랜치 push는 자율 — 묻지 말고 바로 push + 완료 보고.
  묻는 건 애매한 설계·로직 결정뿐.
- ★ PROJECT_STATE·docs·public 수정 금지 / 베이스는 git pull 후 main 최신

[진행률 보고 의무] 큰 단계 완료마다 "📊 진행률 X% (N/M 완료)" 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/bugfix2-back

설계서: docs/milestones/2026-05-15-bugfix-round2.md

■ 1단계 — donorType·검증 대시보드 (§0 #2·#3)
- [ ] #2 admin-members.ts — donorType 응답 구조 정규화 (A의 unwrap이 정확히
      풀 수 있는 형태로). 효성 회원 후원상태가 donations JOIN으로 제대로 판정되는지
- [ ] #3 admin-donation-dashboard.ts — 캐시 응답 이중 래핑 제거
      (data:{...cached} → {...cached}). BOOL_OR 쿼리 NULL 처리 점검 (500 원인)

■ 2단계 — 금월 결제·총매출 집계 (§2 B, #7·#8)
- [ ] #7·#8 admin-finance-income-summary.ts·pl-summary.ts — 금월 결제·총매출이
      4채널(효성정기·CMS정기·일시직접계좌·일시토스) 정확히 합산하는지
- [ ] #8 donations 테이블 실제 pgProvider·status 값 조회 — 토스 미오픈인데
      토스 6만원 잡히는 원인 (테스트 데이터 vs 집계 오류) / 효성 금액 누락 원인
- [ ] #8 1차 캐시 후에도 느리면 쿼리·인덱스 재점검

■ 3단계 — 통장 import + 대시보드 집계 (§2·§3, #13·#1)
- [ ] #13 admin-bank-import.ts — = ANY(${hashes}) 앞 빈 배열 가드
- [ ] #1 admin-members 응답에 전체 집계 필드(typeCounts·donorTypeCounts) 추가
      또는 경량 집계 API — A의 대시보드 KPI가 정확한 전체 수치 쓰도록

■ 4단계 — 발송 작업 (§5, #14)
- [ ] admin-send-job-progress.ts — totalRecipients COUNT(*) 명시 + NULL→0,
      job.status 정확 반환
- [ ] 수신자 목록 status 필터 IN ('pending','sending','completed','failed') 전체
- [ ] "발송중인데 완료처리" job 완료 판정 로직 점검

■ 5단계 — 검증
- [ ] npx tsc --noEmit — 신규 에러 0건 (기존 묵은 에러 14건과 구분)

완료 후: git push origin feature/bugfix2-back
완료 메시지: "[B → 메인] feature/bugfix2-back push 완료. (마이그 있으면) 호출 요청."
```

### §7.3 C 트리거

```
[메인 → C 채팅] 버그 픽스 2차 검증 — 🔍 정적 정독 (라이브는 Swain)

베이스: main (B·A 머지 후)
설계서 §0 버그 13건

[자율주행 정책] feature/fix push 자율, 권한 질문 금지

C는 코드·응답 키·스키마 정합 정독 + tsc + API 라우팅 확인에 집중.
(C 환경에 브라우저 자동화·어드민 계정 없어 SPA 라이브 검증은 물리적으로 불가 —
 라이브 렌더링은 Swain이 직접. feedback_verification_rounds 메모리 참고)

각 항목 검증 방식("정독 PASS" / "라이브 필요")을 보고에 명시.
- §1 unwrap — IIFE 노출 + 파싱 로직 정합 (#2·#3·#4)
- §2 재정 화면 — null 가드·라우팅·CSS 클래스·집계 4채널 합산
- §3 대시보드 KPI — 집계 필드 ↔ 프론트 키 정합
- §4 사이드바 — 인라인 display·들여쓰기
- §5 발송 — totalRecipients·status 필터·job 판정

BUG 발견 시 fix/bugfix2-bugs 브랜치 자체 fix.
완료 메시지: "[C → 메인] 버그 픽스 2차 검증 완료. PASS X / FAIL Y. BUG N건."
```

---

## §8 리스크·주의

- **unwrap이 핵심**: #2·#3·#4가 한 함수에 수렴 — A가 unwrap 먼저 정확히 고치고 나머지 진행
- **CSS 클래스 실재 확인**: 1차에서 "pages.css 로드 추가"만 하고 클래스가 거기 있는지 검증 안 함 → 2차는 renderShell이 쓰는 클래스가 **실제로 정의돼 있는지** 확인 필수
- **#8 토스 미스터리**: B가 DB 실제 데이터 조회로 원인 규명 — 추측 금지
- **C 라이브 불가**: C는 정적 정독, 최종 렌더링은 Swain. 설계서 §7.3·메모리대로
- **기존 tsc 묵은 에러 14건**: 무관, 신규만 카운트
