# PROJECT_STATE.md — SIREN 작업 상태 (휘발성)

> **목적**: "지금 어디까지 왔는지·다음 뭐 할지" 한 화면.
> **자동 로드 X** — 메인 채팅 시작 시 명시적으로 정독.
> **갱신 의무**: 라운드 종결·진행 상태 변경 시 즉시 갱신 후 push.
> **이전 본문(2026-05-19까지 누적 로그)**: [`docs/history/state-2026-05-19-archive.md`](docs/history/state-2026-05-19-archive.md) (385줄·archive 보존)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 이름 | **SIREN (싸이렌)** — 교사유가족협의회 통합 NPO 플랫폼 |
| 라이브 URL | <https://tbfa.co.kr> (공식) / <https://tbfa-siren-cms.netlify.app> (Netlify 기본) |
| 베이스 브랜치 | `main` |
| 단일 최신 인수인계 | [`docs/rules/HANDOFF.md`](docs/rules/HANDOFF.md) |
| 문서 구조 진입점 | [`docs/README.md`](docs/README.md) — 4영역 분리(rules·specs·active·history) |

상세 스택·환경변수·폴더 구조는 [`CLAUDE.md`](CLAUDE.md) §1~5 참조.

---

## 2. 현재 상태 (2026-05-26)

### 🟢 2026-05-26 RAG 검색 인프라 — 설계 완료·병렬 분배 대기
- **결정(Swain)**: pgvector + Q&A 311 + 메뉴얼 본문 + 기존 고정 지식(knowledge.md) 유지·보강 + Gemini `text-embedding-004`. featureKey `ai_rag_search` 토글(OFF 시 기존 동작·안전망).
- **설계서**: `docs/active/2026-05-26-rag-search.md` (8섹션). **베이스 origin/main @ `b593cd8` push 완료.**
- **다음**: B(백·pgvector 마이그/`lib/ai-embedding`/reindex·status/`admin-ai-agent` 주입/featureKey) · A(프론트·`admin-ai-config` RAG 섹션) · C(검증) 트리거 발사 — PARALLEL_TEMPLATE §6 양식.


> **2026-05-25 최신 — 메뉴얼·명세 동기화 라운드 (진행 중)**
> - ✅ 연차 산정 정책 + 카드 만료 입력: C 라이브 검증 PASS·동작 BUG 0·권고 1건(카드만료 입력 무인증 = Swain "그대로" 결정·일회성 토큰 보강은 백로그). 보고서 `docs/history/verify/2026-05-25-leave-policy-live.md`.
> - ✅ 메인 명세 v4 정합: 근태(연차 모드 A/B·퇴근 위치 검증·다중 세션·휴가 부여/회수)·성과(비매출 5:5 캡·5카테고리·매트릭스). 종결 설계서 4종(근태메뉴·연차정책·추모관 R1/R2) history 이동.
> - ✅ C 메뉴얼/AI 동기화 완료·머지(`755694d`): 메뉴얼 2종 + jsonl(311→329) + knowledge.md 신규기능 반영·업체명 토스→KICC·알리고→솔라피 정정.
> - ✅ 근태 출근 버그 fix (중복 스케줄 1뿌리): ① 재택인데 사무실 위치검증 거부 ② 직원 스케줄 무한로딩 — 둘 다 옛 OFFICE 줄 잔존이 원인. 근무형태 관리 **충돌 자동대체**(확인 1회·기존 줄 종료 보존, `4de7a26`·캐시버스터 v20) + 스케줄 조회 최신우선 정렬(`d9122b8`)로 재발 차단.
> - ✅ 추모관 AI 도구 TOOL_GROUPS 누락 보강(`00426de`).
> - 📦 위 전체 1회 push. (.md 내부 노트 토스 잔존 3개는 라이브 비노출 — 별도 정정 예정)
> - ⚠️ Swain 라이브 검증: 근무형태 관리 충돌 자동대체 / 메뉴얼·AI / AI 프롬프트 재붙여넣기(knowledge.md=DB).
> - ※ 아래 누적 항목 옛 표기 정정: 마일스톤 매트릭스 매핑 = **종결**(C검증 8/8·history 이동) / 추모관 AI도구 마이그(`migrate-memorial-aitools`) = **호출 완료·삭제됨**(잔여 ①은 옛 표기) / 성과 v4 마이그(`migrate-milestone-v4`) = 파일 삭제 완료.

### ✅ 온라인 추모관 (R1 유가족이야기 + R2 추모관 본체) — 라이브·릴리스 동기화 완료 (2026-05-24)
- **R1 유가족이야기**: 추모관 GNB(DB 메뉴)·갤러리(/family-stories)·상세(영상+후원 연결)·운영자 도구(영상 추가·AI 초안·발행)·영상 4건 시드. C검증 PASS·장애 시 mock 폴백 제거.
- **R2 추모관 본체**: /memorial(히어로 헌정영상·실시간 카운터·통합 촛불/국화 헌화·통합 방명록)·개별 선생님 페이지(프로필·약력·타임라인·개별 헌화·메시지·기억의 편지)·BGM 플레이어·운영자(선생님 CRUD·모더레이션·설정). C검증 PASS.
- **교사 8분 추모 시드**(공개 보도 기반): 서이초·호원초(이영승·김은지)·상명대부설초·신목초·무녀도초·대전(관평·용산)·제주. is_public=true.
- **상단 메뉴는 DB 렌더**(nav_menu_items + /api/public/nav-menus, 정적 header는 폴백) — 추모관·자유게시판 DB 메뉴 마이그로 추가. 홈 퀵메뉴 자유게시판 제거·소식/참여 이동. 게시판 소개문 '회원들'로.
- **릴리스 동기화**: 메뉴얼(manual·manual-admin)·AI 시스템 프롬프트·AI 도구 3종(읽기: memorial_summary·memorial_teachers_list·family_stories_list)·권한 시드 마이그·AI 학습자료(jsonl·knowledge.md).
- **배포 단축**: `SECRETS_SCAN_ENABLED=false`(시크릿 스캔 off).
- **운영 잔여(Swain 액션)**: ① `/api/migrate-memorial-aitools?run=1` 호출(AI 도구 권한 시드) ② AI 설정에 갱신된 knowledge.md 재붙여넣기(라이브 프롬프트=DB) ③ 영정 사진 업로드 ④ BGM 음원 배치+설정 등록.
- **2차 보류**: 자료실·공유카드(PNG·SNS)·추모일 구독 알림·다국어.
- 설계: `docs/active/2026-05-24-memorial-r1-family-stories.md`·`-r2-hall.md`. 명세: `docs/specs/온라인추모관_기능명세_워크플로우.md`.

### 🟢 성과관리 v4 전환 — 1·2단계 완료 (2026-05-24)
직원 연봉·성과급 v4(5:5 밸런스+R&R·정책국장/사무국장/SI) 반영. **메인 직접**(AI 추측 0).
- **1단계 완료**(`migrate-milestone-v4` 호출됨·`upserted:71`): non_revenue_category 칸 추가 + 역할 3개(기존 PM/SM/SI 재사용 — **직원 재배정 불필요**) + 기존 정의 전면 비활성 + **v4 71개**(매출23·비매출5카테고리48) 정확 등록. 마이그 삭제 완료.
- **2단계 완료**(`165f823`): 매출/비매출 **5:5 영역 캡**(PM 850/850·SM 800/800·SI 1110/740만·초과분 이전 X·상수·calculation_snapshot에 raw·cap 기록) + 비매출 **카테고리당2/분기7** 선택 룰(서버 milestone-nonrevenue + 직원 화면 workspace-milestones `?v=15-v4nr`). 마이그 0.
- **폴리시 완료**(`be0b5ea`): ① 비매출 5카테고리 묶음 보기(정의 탭·직원 선택 화면) ② **역할별 캡 화면 편집**(상수→`milestone_roles.revenue_cap/non_revenue_cap` DB 전환·`migrate-milestone-role-caps` 호출됨·삭제 완료·settlement try/catch 방어) ③ ③매트릭스 누락 경고 표시. `?v=10-polish`/`v16-polish`.
- **기록 정리 완료**: 매뉴얼(manual-admin)·성과 명세 v4 배너 반영, 설계서 5종 history 이동. **성과 v4 전환 전체 종결.**

### ✅ 병행 트랙 — ④ 사건·사고 섹션 + ③ 매트릭스 AI 개선 (2026-05-24·C검증 PASS)
A·B 병렬(베이스 정합 OK)·머지(`f650cfc`)·C검증 **BUG 0 전항목 PASS**(`docs/history/verify/2026-05-24-news-incidents.md`). `migrate-org-news-incidents` 호출됨(incidents 컬럼)·삭제 완료.
- 뉴스 화면 '🚨 협회 관련 사건·사고' 섹션(네이버 수집+Gemini 협회 관련성·시급도 판정) + ③ matrix-parse maxTokens 8000·누락금지·warning.
- C 관찰(비차단): summary.warning이 ③ 리뷰 화면에 미표시(폴리시).


### 🟡 ④ 교유협 뉴스·여론 분석 — A·B 병렬 머지 완료·마이그+C검증 대기 (2026-05-24)
네이버 검색 수집 + Gemini 분석(요약·워드클라우드·여론·추천·변경점) → 통합 CMS 새 메뉴 "📰 여론·뉴스 분석" + 매일 09:00 cron + 수동 재조사 + 히스토리. **메인·A(프론트)·B(백)·C(검증) 병렬.** A·B 작업 커밋 cherry-pick 머지(`3222cef`·`c686cc1`)·tsc 0·JS 문법 0·계약 정합 확인. featureKey `org_news_analysis`. 단일 출처 `docs/active/2026-05-24-org-news-analysis.md`.
- **신규 2테이블**(raw SQL·schema.ts 미정의): `org_news_reports`(히스토리 누적)·`org_news_settings`(단일행 시드). 마이그 `migrate-org-news`.
- **C 검증 + 메인 후속 fix 누적**: ① C BUG-2건(마이그 컬럼·화면 응답키) ② 메인: 마이그 `?reset=1`(타입 잘못된 표 DROP+재생성) ③ 메인: **text[] 배열 바인딩 버그**(drizzle가 `${배열}`을 레코드로 펼침 → 시드·refresh·cron·settings INSERT 전부 500) `sqlTextArray()` 헬퍼로 4곳 수정 ④ 메인: 여론 % ×100 중복(8000%)·영문 라벨 배지 표시 fix.
- **✅ Swain 라이브 확인(2026-05-24)**: `?reset=1` 7단계 성공 + CMS 여론·뉴스 분석 재조사 **정상 동작**(요약·워드클라우드·여론·추천·소스). 1회용 마이그 삭제 완료.
- **남은 종결**: 매뉴얼·명세 동기화 + 설계서 history 이동(% fix 렌더 최종 확인 후).

### 🟡 ③ 마일스톤 매트릭스 AI 매핑 — C 코드검증 PASS 8/8·BUG 0 / Swain 브라우저 클릭만 대기 (2026-05-24)
분기 성과 기준표(매트릭스)를 텍스트로 붙여넣으면 AI가 마일스톤 정의 후보를 추출·기존 충돌 판정 → 고신뢰·충돌 없는 신규는 자동 선택, 충돌·삭제 후보는 수정/삭제/유지 선택. **스키마 0·마이그 0·외부연동 0** (기존 `milestone_definitions`·소프트삭제·변경이력 재활용). tsc 0·JS 문법 0. **C 검증 PASS 8/8·BUG 0**(리포트 `docs/history/verify/2026-05-24-milestone-matrix.md`·`f7e8ad6`) — 코드론 완료, AI 실호출·브라우저 UX만 Swain 클릭 검증.
- **Swain 결정**: 입력=텍스트 붙여넣기 / 반영=신뢰도 높으면 자동 / 매핑=상시 정의 집합 갱신 / 감사 테이블=신설 안 함.
- **신규**: AI 파싱 엔드포인트 `admin-milestone-matrix-parse`(읽기 전용·DB 쓰기 0·super_admin) + featureKey `milestone_matrix_mapping`. 적용은 기존 `milestone-definitions` POST/PATCH 재사용(검증 중복 0).
- **프론트**: 성과관리 '마일스톤 정의' 탭에 '🤖 매트릭스 분석' 버튼·분석 모달(검토·인라인 편집·자동선택). `?v=9-matrix`.
- **단일 출처**: `docs/active/2026-05-24-milestone-matrix-mapping.md`.
- **Swain 라이브 검증**: 매트릭스 텍스트 붙여넣기 → 분석 → 자동선택/충돌/삭제후보 검토 → 적용 → 정의 목록 반영. 통과 시 매뉴얼·명세 동기화 후 설계서 history 이동.
- **다음**: ④ 교유협 뉴스 분석(네이버 검색 키 발급·cron·워드클라우드·히스토리 — 최대 규모·별도 라운드).

### ✅ 2026-05-24 배포 8건 배치 검증 마감 (C검증·메인 머지)
C가 `verify/2026-05-24-batch`에서 코드 검증 PASS 7/7 + **BUG-1(P1) 발견·fix**: 하루 다중 세션 도입 후 어드민 시각 수정 2경로가 세션 배열 미동기화 → 같은 날 직원 퇴근·재출근 시 어드민 정정이 되돌아가던 조용한 데이터 손실. `rebuildSingleSession` 헬퍼로 정합화. 메인 cherry-pick(`5ec8d04`)·tsc 0·1회 push. 리포트: `docs/history/verify/2026-05-24-batch.md`.

### 🏁 운영 전 전수 검수 + 수정 라운드 종결 (2026-05-23)
오픈 전 4영역(메인·A·B·C) 5축 전수 검수 → 마스터 우선순위표 → **P0 2 + P1 18 수정·배포 완료**(`17a7eb3..e28b1b6` + 후속 cron 가드). tsc 0.
- **검수**: 권위 리포트 4종 + master(P0 2/P1 19/P2 ~38). C 자체 재검증으로 에이전트 오탐(P0 6→1) 정정. 산출물 → `docs/history/2026-05-23-prelaunch-audit/`.
- **수정 완료**: 운영자 권한상승 차단·KICC빌링화면404·신고수정 데이터손실·운영자목록 이중래핑·멘션·보관복원·휴가합산·분기경계·급여기준 UPSERT·급여 force정합·구독버튼·cron 12종 toml등록·게이미피케이션 라우팅·migrate 9개 삭제·웹훅 금액가드·AI백그라운드 fail-closed 등.
- **WONTFIX**: 카드 만료 사전알림 = KICC가 만료월 미제공(PG 제약·API 조회 불가) → 실제 만료 시 결제실패 알림이 커버.
- **🔴 Swain env 게이트(코드 무관·오픈 전 필수)**: ① `INTERNAL_TRIGGER_SECRET` 설정(미설정 시 AI 자동요약 멈춤·fail-closed) ② 이메일 `RESEND_TEST_RECIPIENT` 제거+도메인검증+`EMAIL_FROM` ③ KICC env 4 ④ 솔라피 알림톡 env(승인 후) ⑤ DB 시드(payroll_settings·근태 정책/거점/휴가종류).
- **➡️ 다음 라운드(새 세션 설계)**: **연차 산정 정책 기능** — 모드 A(5인 이하·월 만근 +1) / 모드 B(5인 이상·근속 기반 1주년 기본12일·2년마다+1, 슈퍼어드민 CRUD) 선택. 스키마+마이그+어드민UI+cron 재작성. 현재 협회=5인 이하라 cron은 모드 A(만근만)로 임시 가드(`SERVICE_BASED_ANNUAL_ENABLED=false`).

### 🟡 연차 산정 정책 기능 + 카드 만료 유효기간 입력 — 구현 완료·라이브 검증 대기 (2026-05-24)
연차 정책 라운드 전 단계(Stage1~3) + 카드 만료 부록(방식②) 구현 완료. **마이그 적용 완료(appliedCount 7)** → schema 활성화·마이그 삭제. tsc 0. **메인 자율 진행(Swain 수면)·1회 push.**
- **데이터모델(Swain 확정)**: `att_policies` 확장(연차 6컬럼) + `members.hire_date`(NULL이면 가입일 폴백). 신규 테이블 대신 기존 근무 정책 행 재활용.
- **백엔드**: `admin-att-leave-policy`(super_admin·UPSERT 시드) + `cron-att-leave-auto` 모드 분기 재작성(`SERVICE_BASED_ANNUAL_ENABLED` 가드 제거→정책값). 모드 A=만근 보너스/모드 B=근속(1주년12·3주년13·5주년14·상한).
- **프론트**: 근태 설정 '근무 정책' 탭에 연차 산정 정책 섹션(모드 라디오+파라미터 토글·`?v=17-leavepol`).
- **카드 만료(방식②)**: `billing-card-expiry-set` + billing-success 유효기간 입력. ⚠️ `billing_keys.card_expiry_month`는 schema 정의엔 없으나 **DB엔 존재**(cron 운영 중) → **raw SQL UPDATE로만 접근**(billing_keys SELECT 격리·회귀 0).
- **TODO(모드 B 실사용 전)**: 회원 상세에 입사일 입력 칸 추가(현재 가입일 폴백). 설계·결과 = `docs/active/2026-05-24-leave-policy-design.md` 구현 결과.
- **Swain 라이브 검증**: ① 근무 정책 탭 연차 섹션 노출·모드 토글·저장/재로드 ② billing-success 유효기간 입력·저장. 통과 시 설계서 history 이동.
- **후속 보강(2026-05-24 Swain 요청)**: ① 잔여 휴가 탭에 **'휴가 부여/회수' 폼** 추가(직원·휴가종류 선택 → 잔여 기록 없는 직원도 첫 부여 가능·회수는 음수 입력·기존 행 +1/-1/상세 조정은 유지) ② **실시간 출퇴근 현황 직원 이름 클릭 → '출퇴근 기록' 탭 자동 이동·해당 직원 조회**. 캐시버스터 v18-leavegrant. (휴가 잔여 조정 API·이력은 기존 `admin-att-leave-balances` 재활용 — 신규 API 0)
- **잔여 휴가 버그 fix + 전 직원 노출(2026-05-24)**: 잔여 조회가 `db.execute` 결과를 `rows.rows`로만 파싱(postgres-js는 배열 반환) → **항상 빈 목록**이던 버그를 `db.select` 빌더로 재작성해 해소(부여분이 안 보이던 원인). 동시에 **잔여 0·미부여 직원도 전원 표시 + '+ 부여' 버튼**(직원 프리필). 캐시버스터 v19-allstaff.
- **직원 정보 CRUD·삭제(2026-05-24 Swain 결정)**: 삭제=**운영자 해제**(기존 강등·회원/기록 유지), 위치=**기존 운영자 관리 화면(`admin-role-policy.html`) 강화**. 권한 CRUD(승급·역할·활성·강등)는 기존 유지 + **개인정보 편집 모달(이름·연락처·입사일) 추가**(`admin-operators` PATCH에 name·phone·hireDate). 입사일은 여기서 입력 → 연차 모드B 근속 계산에 사용(별도 회원상세 입력 UI 불필요해짐).
- **출퇴근 장소 제한(2026-05-24 Swain 확정·구현)**: 출근(check-in)은 OFFICE·FIELD에서 거점 반경 내만 허용. **퇴근(check-out)도 OFFICE(일반근무)만 거점 반경 강제 추가**(att-checkout — 출근 기록 거점 우선·없으면 가장 가까운 OFFICE 거점). 재택(REMOTE)·외근(FIELD)·출장(BUSINESS_TRIP)은 퇴근 위치 미검증(Swain 지시). 거점 GPS 좌표는 입력 완료. 클라이언트는 이미 퇴근 시 위치 전송 중이라 수정 0.

### 🔧 Push 배치 정책 신설 (2026-05-21·배포 비용 절감)
Netlify 배포 크레딧 폭증(한 달 1,426 production 배포 → 크레딧 79%·$10 auto-recharge 반복). `push`=배포=과금이라 **A·B·C push 금지 + 메인이 검증 단위로 묶어 1회 push**로 전환. 상세: CLAUDE.md §9.3·§6.17 / HANDOFF §7.7.

### 🏁 급여 고도화 정식 종결 (2026-05-21)
- 세전까지였던 급여 → **직접편집·조정라인·법정공제·실수령·지급확정(PAID)·계산기준 설정·수정이력**까지 확장.
- Stage1 `00f6140`+`87bb7eb`(스키마) → Stage2 `ff48c18`(백엔드) → Stage3 `a30c23f`(프론트). 3단계 머지 + Swain 라이브 검증 완료.
- 직원 마이페이지·PDF·CSV에 공제·실수령 노출, PAID 후에도 조회 유지.
- 종결 문서 → `docs/history/milestones/2026-05-20-payroll-enhance.md`.

### 🏁 성과관리 화면 통합 정식 종결 (2026-05-21)
- 통합 CMS 운영 관리 **성과관리 설정 + 비매출 검토 2메뉴 → 단일 "성과관리" 6탭** 통합.
- 마일스톤 정의 단일 API(`milestone-definitions`)·소프트삭제로 결산 참조 보존. 중복 API(`admin-milestone-definitions.ts`)·옛 설정 화면(`admin-milestone-settings.html`/`.js`) 완전 제거. DB/마이그 변경 0.
- Stage1 `76aff40` → Stage2 `18df0be`+`2dcbcfb` → Stage3 `4816e03` → 후속 `11105ad`(메뉴명)·`e715fb0`(감사 갭 fix).
- "직원 역할 배정" 무한로딩 버그: 옛 화면 제거로 소멸.
- 종결 문서 → `docs/history/milestones/2026-05-20-milestone-screen-unify.md` (PART 3 종결 요약).

### 🏁 R39 (역할 동적 CRUD + Admin UX 통합) 정식 종결
- **Stage 1~8 전부 머지 + 라이브 검증(메인 직접) 15/15 PASS**
- 라이브 검증 중 BUG 2건 발견·즉시 fix: ① tsc narrowing 사전 5건(런타임 0) ② att deviceType 미저장
- 메뉴얼 2종(manual.html·manual-admin.html) + AI 학습 자료 300문항 통합 완료 (C 작업)
- 설계서 → `docs/history/milestones/2026-05-20-r39-roles-and-ux.md` archive
- 라운드 종결 체크리스트 15가지 메모리 정식 등록 (`release_checklist.md`)

### 🏁 명세 정합 시리즈(R29~R37) 공식 종결
- **7라운드 누적**: 65+건 명세 정합 fix + R36 부가 5건 + R37 급여 통합
- **검증 합산**: E2E 12/12 + R37 Q10/10 + R36 회귀 8/8 + R35 P1·P2 23/23 ALL PASS·BUG 0건
- **정합도 v2**: 근태 **93.4%** / 성과 **96.7%** / 평균 **95.1%**

### 🟢 운영 시작 공식 선언
근태관리 + 성과관리 + 급여 통합 + 역할 동적 CRUD + Admin UX 시스템 — 즉시 운영 시작 가능.

### 📁 문서 4영역 분리 정착
- `docs/rules/` — 운영·작업 규칙
- `docs/specs/` — 명세 마스터 7개
- `docs/active/` — 진행 중 라운드 (현재 비어있음)
- `docs/history/` — 완료 히스토리 (R39 설계서 포함)
- `docs/manual/` — 사용자/AI 학습 자료 (메뉴얼 단편 + 300문항 jsonl·R39 통합)

---

### 🟡 대형 기능 4종 요청 (2026-05-24 Swain) — 순차 진행 중
Swain 결정 순서: **급여 fix → 출퇴근 재출근 → 마일스톤 매핑 → 뉴스 분석**. 뉴스 수집=**네이버+Gemini 분석**.
- **① 급여 빈집계 fix + AI — ✅ 완료·배포**: 급여 명세 대상 = **기본급 + 그달 근무실적 둘 다**(근무 활동 없으면 명세서 생성 제외·`payroll-calc.ts` hasActivity). **AI 분석** 버튼(`admin-payroll?action=analyze`) — 이상치 탐지(음수·공제과다·전월±30%)·입력 누락 점검(기본급 미설정·DRAFT·HOLD)·Gemini 집계 요약. featureKey `payroll_ai_summary` 등록. 캐시버스터 admin-payroll.js v20260524-ai.
- **② 출퇴근 재출근 + 셀프수정 — ✅ 완료·배포**: att_records.sessions(JSONB) 추가(마이그 적용·요약 컬럼 유지로 회귀 0). 퇴근 후 출근 시 모달(재출근/퇴근취소/시각수정)·업무시간 내(정책 표준 출퇴근 시각)만 퇴근취소·셀프수정·업무시간 외는 재출근만(기존 퇴근 보존). 서버 att-checkin(재출근 분기)·att-checkout(세션 마감·다중세션 근무시간 합산)·att-session-edit(신규 셀프수정) / lib/att-session.ts(세션 헬퍼) / workspace-attendance.js 모달+재출근 버튼(v15-reentry). tsc 0. ⚠️ 잠재 엣지: 어드민이 당일 기록의 checkIn/Out을 직접 수정해도 sessions는 동기화 안 됨(당일 재출근 동시 발생 시만 불일치·극히 드뭄).
- **③ 마일스톤 매트릭스 AI 매핑 — ⏳ 대기**: 새 분기 매트릭스 입력 → AI 파싱·매핑·기존 중복 수정/삭제 확인.
- **④ 교유협 뉴스 분석 — ⏳ 대기**: 네이버 수집+Gemini 분석·워드클라우드·매일 cron+수동·이전 대비 변경점·히스토리. (가장 큰 규모·외부 연동)
- ✅ **①② 완료·배포**. **③④는 새 메인 세션에서 설계부터** — 단일 출처 `docs/active/2026-05-24-milestone-and-news.md`(요구·결정·접근·미결정·정독). ③ 먼저(외부연동 0) → ④(네이버 키·cron·워드클라우드·최대 규모).
- 🔄 **2026-05-24 배포 8건은 C가 `verify/2026-05-24-batch`에서 라이브 검증·fix 중** → C 보고 시 새 메인이 fetch·머지·1회 push로 마감.

## 3. 진행 중 작업

### 현재 진행 트랙 (2026-05-21)
| 트랙 | 상태 | 다음 |
|---|---|---|
| **급여 고도화** (편집·조정·공제·실수령·PAID·계산기준·이력) | 🟢 **종결** — 3단계 머지 + Swain 라이브 검증 완료 | 종결 문서 `docs/history/milestones/2026-05-20-payroll-enhance.md` |
| **근태 연동 갭 수정** (G1 결재단절·G2 통계·G3 캘린더·G4 라벨) | 🟡 머지 `a189fe9`(c2a4fa2)·메인 코드검증 PASS | Swain 라이브 검증 → 종결. 설계 `docs/active/2026-05-20-att-gap-fix.md` |
| **성과관리 화면 통합** | 🟢 종결(§2) | — |

---

### main HEAD: R39 정식 종결 + 메뉴얼 통합 직후

| 작업 | 채팅 | 상태 |
|---|---|---|
| **R39 통합 라운드 8단계** | B+메인 | 🟢 **정식 종결** — Stage 1~8 머지 + 라이브 검증 15/15 PASS + BUG 2건 fix |
| **사용자 메뉴얼 + AI 학습 자료 300문항** | C+메인 | 🟢 **통합 완료** — manual.html·manual-admin.html + jsonl 300문항 main 안착 |
| **Netlify 사고** | 외부 | 🟢 복구 완료 |

### 🟡 근태 메뉴 재배치 — 구현 완료·라이브 검증 대기 (2026-05-21)
cms 운영관리 "근태관리 설정" 1메뉴 → **"🟢 근태 현황"(조회 8탭)·"⚙️ 근태 설정"(설정 4탭)** 2메뉴 분리. 재택보고서·근무형태 관리 탭을 워크스페이스 관리 화면으로 흡수(12탭 통합) + `?group=ops|config` 필터 + "← 근태 현황으로" 버튼. 옛 `admin-attendance-settings.html`은 리다이렉트로 전환, `.js` 삭제. 변경 6파일·코드 검증 통과. 설계·결과 `docs/active/2026-05-21-att-menu-reorg.md` §7.

### 🟡 R40 PG 전환 (토스 → KICC) — 백엔드+프론트 머지·배포 완료·검증 대기 (2026-05-21)
오픈 전 전면 즉시 전환(효성 유지·카드 PG만 교체). A·B·C 전부 Opus·main직결·KICC_MODE=test.
- 마이그 적용(컬럼 toss_*→pg_*·테스트데이터 purge: toss 22건·빌키 3건·효성 보존) → B STEP2/3(`da94154`)+A(`1836943`) 머지·1회 push·tsc 0.
- 토스 함수 10개 삭제·KICC 8개 신규(lib/kicc·donate-kicc-*·billing-register/approve·cron-kicc-billing·kicc-webhook)·cron 단일 통합.
- ✅ C 검증 완료(`81d9381`) — 코드·계약·회귀·보안 PASS. 회귀 1건 fix(어드민 KICC 자동환불 UI 복구)·빌링탭 라벨 정정. 보고서 `docs/history/verify/2026-05-21-r40-kicc.md`.
- ✅ 실거래 1차 막힘 → URL 스킴 핫픽스(`afac58f`) + **KICC 명세 정합 fix(`0328320`)**: 메인·B 독립 정독 동일 결론, 메인이 kicc.md 교차검증 후 B 버전 채택. webpay clientTypeCode "00"·요청 서명 제거·승인 shopTransactionId/approvalReqDate·batch 중첩·revise 서명(pgCno\|shopTransactionId)·빌키삭제/조회 필수필드 전부 명세 정합. 실측 스펙 설계서 §9.
- **남은 것(Swain 핸즈온)**: ① Netlify KICC env 4개 설정 확인(KICC_MALL_ID·SECRET_KEY·API_DOMAIN·MODE=test) ② 브라우저+테스트카드 실거래 Q1~Q7(거래등록부터 통과 예상) ③ 응답 msgAuthValue 검증은 비차단(경고)·실거래 해시 포맷 확인 후 차단 전환 가능. 통과 시 설계서 history 이동·메뉴얼 '토스'→KICC. 설계 `docs/active/2026-05-21-r40-kicc.md`.
- **✅ 미결정 2건 Swain 결정(2026-05-22)**: ① 일시 결제수단 = **전체(+가상계좌)** → B 정정 필요(payMethodTypeCode "00"·입금 웹훅(이벤트30)·미입금 만료) ② 정기 = **효성 CMS+ 유지** → 정기 UI 효성 노출 점검. ⏸️ 둘 다 **KICC MID 권한 활성화 대기** 후 착수(설계 §10-C·D).

### ✅ 발송 인프라 — 솔라피(SOLAPI) API 교체로 근본 해결 (프록시 안정화 작업 폐기)
알리고+무료VM프록시의 메모리 hang 문제는 **프록시 강화(스왑/ARM 이전)가 아니라 발송 업체를 솔라피로 교체**해 근본 해결(IP 화이트리스트 불필요 → 프록시 자체가 불필요). SMS·휴대폰 인증은 솔라피로 **라이브 완료**. **남은 것은 알림톡 6종 카카오 승인 후 env 연결 + 옛 프록시·OCI 코드 폐기뿐**(스왑/ARM 이전·SSH 작업은 모두 불필요해짐). 상세: 메모리 `reference_sms_kakao_proxy.md`·`docs/active/2026-05-23-solapi-migration.md`.

### 🚀 다음 라운드 후보 (Swain 결정 대기)
- 메뉴얼 R39 기능 본문 갱신 (현재 '예정' 표기 → 실제 안내)
- Netlify 배포 시간 단축·RAG 인프라 구축

### R39 진행 상세 (Stage 1~8 모두 main 머지 완료)
- ✅ Stage 1: milestone_roles 테이블·시드 SM/PM/SI
- ✅ Stage 2: 역할 카탈로그 API + 백엔드 검증 동적화
- ✅ Stage 3: 프론트 라벨 동적화 + 역할 관리 UI (5번째 탭)
- ✅ Stage 4: R38 선완료로 스킵 (사람별 마일스톤·안내 박스 — R38 머지로 흡수)
- ✅ Stage 5: 실시간 출퇴근 + 카카오 지도 + PC 위치 + R38 월별 표 회귀 fix
- ✅ Stage 6: 워크툴 상단 출퇴근 버튼 + 상태별 라벨 + visibilitychange 동기화
- ✅ Stage 7: 휴가 수동 CRUD + 어드민 출퇴근 양방향 수정 + 이력 2테이블 + device_type 컬럼 (마이그 호출 + schema 활성화 + 파일 삭제 완료)
- ✅ Stage 8: 비매출 검토 화면(5번째 탭 + 4가지 액션) + 워크스페이스 로딩 fix(병렬화·성과 ~200ms·근태 ~600ms 단축) + B 자체 회귀 8/8 PASS

### Swain 라이브 검증 권장 시나리오
브라우저(어드민 로그인) 라이브 확인 권장:
1. 비매출 검토 — 운영 관리 → 비매출 검토 탭 진입·일람·상세 모달·1차 검토·승인·반려·EVENT_RANGE 금액 결정
2. 워크스페이스 진입 속도 — 성과·근태 메뉴 진입 시 체감 빨라졌는지
3. Stage 5·6·7 회귀 — 실시간 출퇴근·카카오 지도·워크툴 상단 버튼·휴가 수동 조정·어드민 출퇴근 수정·확인 요청 알림
4. R37 급여 자동 집계 회귀
5. SM/PM/SI 매출·비매출·결산·진행률 회귀

### 옛 R38 (Admin UX 3건) — 머지 완료·R39 Stage 4·5 일부로 흡수
사람별 마일스톤·출퇴근 월/리스트·회원 안내 박스 모두 main에 안착. R39 Stage 3 동적화로 라벨 자동 적응.

### C 메뉴얼 진행 상세 (`docs/manual/`)
- ✅ manual.html (회원·신고자·후원자) — 영역 A/B/C 1차 본문 완성·검색·인쇄·모바일 4차 마무리 완성
- ✅ manual-admin.html (운영자·간사·슈퍼어드민) — 권한·신고 운영·영역 D 워크스페이스·영역 E 후원·결제 1차 본문 완성
- ✅ ai-assistant-knowledge.md — 11,447 → 7,888자 압축 완성 (목표 5,000~8,000 정합)
- ✅ ai-training-siren-user.jsonl — 60문항 (후원 20·회원 18·SIREN 16·콘텐츠 6)
- ⏳ ai-training-siren-admin.jsonl — 어드민 60문항 (다음 응답)
- ⏳ ai-training-cms.jsonl — 통합 CMS 150문항 (75+75 분할)
- ⏳ ai-training-ai-assistant.jsonl — AI 비서 30문항
- ⏳ 옛 ai-training.jsonl 100문항 → docs/history/로 archive 이동

### R39 시리즈 완전 종결(C 라이브 검증 PASS) 후 예약
- 설계서 `docs/active/2026-05-20-r39-roles-and-ux.md` → `docs/history/milestones/`로 archive 이동
- 라운드 종결 체크리스트 15가지 메모리 정식 등록 (`docs/active/2026-05-20-r39-roles-and-ux.md §6.5`)
- R40 후속: **PG 전환 (토스 → KICC)** — `docs/kicc.md` 기반 옵션 A(듀얼 PG 점진 전환) 추천·추가 KICC 문서 필요(빌키·자동결제·해지·조회)·기존 토스 회원 처리 정책 결정 필요
- R40 추가: Netlify 배포 시간 단축 (netlify-plugin-cache·dead code 정리)·RAG 인프라 구축 (Q&A 300문항 임베딩)

설계서: `docs/active/2026-05-20-r39-roles-and-ux.md`

---

## 4. 잔여 작업

상세는 [`docs/rules/REMAINING_WORK.md`](docs/rules/REMAINING_WORK.md). 요약:

- **근태 6.6%** §6.2 부가 8건 (외근지 즐겨찾기·재택 사진·셀카·체크리스트·위젯·비교 뷰·다국어·IP 패턴) — 운영 후 1~2분기 관찰 후 선별
- **성과 3.3%** 옵션·후속 3건 (rolePermissions 실 미연결·AI 증빙 검토·팀 보너스)
- **Phase 23 재정 v3.0** — 2026-08-20 이후 별도 합의
- **Swain 운영 시작 액션**: ① 회원 base_salary 입력 ② 분기 결산 PAID 처리 ③ R36/R37 사용 패턴 관찰

---

## 5. Swain 운영 정책 (2026-05-20 시점 유지)

- **자율 권한**: 코드 수정·git push·Netlify 배포·npm 명령·옵션 추천 진행
- **확인 필요**: 설계·로직 결정·마이그레이션 호출·진정 위험·비가역 작업
- **A·B·C 자율주행**: push까지 자율·임시 브랜치 정리 자율·메인에게 묻지 말 것 ([CLAUDE.md §6.17](CLAUDE.md))
- **§6.15 알림**: 회귀 위험 실재 시만 박음 (도메인 분리·충돌 0인 머지는 알림 X) ([`feedback_single_session.md`](C:/Users/Administrator/.claude/projects/c--Users-Administrator-Desktop----dev-tbfa-mis/memory/feedback_single_session.md))

---

## 6. worktree 현황

| 폴더 | 용도 | 브랜치 |
|---|---|---|
| `c:\...\tbfa-mis` | 메인 | main 또는 작업 브랜치 |
| `c:\...\tbfa-mis-A` | A 채팅 | feature/r*-att-* 등 |
| `c:\...\tbfa-mis-B` | B 채팅 | feature/r*-ms-* / r37-* 등 |
| `c:\...\tbfa-mis-C\docs` | C 채팅 | verify/r*-* 등 |
| `c:\...\tbfa-mis-A\public` | A 보조 | — |

---

## 7. 참고 문서

| 문서 | 위치 | 역할 |
|---|---|---|
| CLAUDE.md | 루트 | 자동 로드 — 코딩 컨벤션·권한·자율성 원칙 |
| HANDOFF.md | docs/rules/ | 단일 최신 인수인계 |
| REMAINING_WORK.md | docs/rules/ | 잔여 작업 인벤토리 |
| PARALLEL_GUIDE.md | docs/rules/ | 병렬 작업·머지·충돌 회피 |
| 명세 마스터 7개 | docs/specs/ | 근태·성과·재정 + phase24·26·27·28 |
| 메모리 인덱스 | `~/.claude/projects/c--*/memory/MEMORY.md` | 자동 로드 — 본문은 작업 관련만 정독 |

---

**마지막 갱신**: 2026-05-20 24:00 KST (R39 정식 종결·라이브 검증 15/15 PASS·메뉴얼 300문항 통합·R40 KICC 대기)
