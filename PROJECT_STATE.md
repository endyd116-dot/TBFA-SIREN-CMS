# PROJECT_STATE.md — SIREN 작업 상태 (휘발성)

> **목적**: "지금 누가 뭘 하고 있나" 한 곳에 모음.
> **자동 로드 X** — 메인 채팅 시작 시 명시적으로 정독.
> **갱신 의무**: 진행률·다음 할 일이 바뀌면 본인 채팅이 직접 갱신 후 push.
> **정적 가이드**(분담·충돌·시작 프롬프트·머지 체크리스트)는 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md).

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 이름 | **SIREN (싸이렌)** — 교사유가족협의회 통합 NPO 플랫폼 |
| 라이브 URL | https://tbfa-siren-cms.netlify.app |
| 베이스 브랜치 | `main` |
| 단일 최신 인수인계 | [`docs/HANDOFF.md`](docs/HANDOFF.md) |

상세 스택·환경변수·폴더 구조는 [`CLAUDE.md`](CLAUDE.md) §2~5 참조.

---

## 2. 마지막 업데이트

| 시각 | 갱신자 | 내용 |
|---|---|---|
| 2026-05-19 | **메인** | **✅ Phase 26 근태관리 + 라운드10 A·B 트리거 배포** — A+B 머지 완료(aeafb29), 마이그레이션 성공(10테이블+기본데이터), 파일 삭제, 라운드10 A·B 트리거 발사 |
| 2026-05-19 | **메인** | **📐 Phase 26 근태관리 시스템 설계 진입** — 명세서 정독 완료. 2-Phase 분할(핵심 Step1~8 / AI·자동화 Step9~17). DB 10테이블·API 20개·신규 페이지 2개 설계 확정. A·B 트리거 작성 중 |
| 2026-05-19 | **메인** | **✅ Phase 25 WBS↔마일스톤 연동 완결** (main @ `bf9a4bb`) — C Q1~Q11 중 10 PASS·BUG-P25-1은 `49be67d`에서 이미 수정(milestones.html v=2). 마이그 3컬럼 완료·schema 활성화·마이그 파일 삭제 |
| 2026-05-19 | **메인** | **✅ Phase 24 성과 관리 시스템 완결** (main @ `bf5bfc6`) — C Q1~Q20 전원 PASS·BUG 0. 마이그 완료·단독 구현. R9도 이전 세션에서 이미 구현 완료(마이그 포함) |
| 2026-05-18 | **메인** | **✅ 라운드 8 완결** (main @ `6bfd66e`) — C Q1~Q10 PASS + BUG-R8-1·R8-2 fix. R9 B·A 병렬 진행 중 |
| 2026-05-18 | **메인** | **✅ 라운드 7 Phase 2 완결** (main @ `8b06826`) — Layer 3 힌트 시스템 + Layer 4 스케줄 도구 3개 + C BUG 3건 fix + 마이그레이션 완료 (ae04a13) |
| 2026-05-18 | **메인** | **✅ 라운드 7 Phase 1 머지 완료** (main @ `7e00835`) — Layer 1 배치 도구 4개 + Layer 2 파이프라인 2개 총 6개 도구 추가 (116→122개). Phase 2 시작: A(Layer3 힌트)+B(Layer4 스케줄)+C(검증) 동시 진행 |
| 2026-05-18 | **메인** | **🚀 라운드 7 AI Layer 1+2 Phase 1 발사** (main @ `0a31dc7`) — AI 에이전트 구조 확장 설계 완료. 설계서: docs/milestones/2026-05-18-round7-ai-layers.md |
| 2026-05-17 | **메인** | **🏁 라운드 1~6 전체 완결** (main @ `5086322`) — C 검증 54항목 전부 통과. R2 BUG 2건 포함 모두 해소. 게이미피케이션·큐레이션·팝업 DB 8테이블 + API 18개 + UI 5페이지 운영 중. |
| 2026-05-17 | **메인** | **🏁 라운드 5 발송 센터 UX 완결 (C Q1~Q10 전부 통과, BUG 0)** (main @ `7a2f557`) — 채널별 미리보기 탭(이메일·SMS·카카오·인앱) + 파일함 재사용 첨부 전부 PASS. |
| 2026-05-17 | **메인** | **🏁 라운드 4 3단 권한 체계 완결 (C Q1~Q8 전부 통과, BUG 0)** (main @ `a2a7a55`) — 로그인 role 하드코딩 제거·requireRole 헬퍼·admin 등급 체크·권한 정책 페이지 전부 PASS. |
| 2026-05-17 | **메인** | **🔄 라운드 4 3단 권한 체계 — B·A 트리거 발사** (main @ `6e69a0f`) — lib/admin-role.ts + roles-and-permissions.md + 마이그 완료(operator→admin 1건). B: 로그인 버그·super_admin 체크 7개·admin 체크 4개·admin-operators role 확장. A: admin-role-policy.html 신규 + iframe 4곳 등록. |
| 2026-05-17 | **메인** | **🏁 라운드 3 CMS 6건 완결 (C Q1~Q9 전부 통과, BUG 0)** (main @ `aea1267`) — R3 C 검증: 환불권한·자동발송중복차단·paidAt 백필·재활성화 API·채널검증 전부 PASS. |
| 2026-05-17 | **메인** | **🎯 라운드 1 SIREN 4건 fix 설계 완료 + A·B·C 병렬 트리거 배포 대기** (main @ 본 커밋) — Swain 결정: #2 B안(응답 endpoint)·#3 A안(회원 상세 강제 변경)·#4 B안(실명+익명 배지)·진행 4채팅 병렬. 설계서: `docs/milestones/2026-05-17-round1-siren.md`. DB 마이그 0건(컬럼 모두 존재). B 작업 6건(빌링키·3종 자동 status·user-my-reports 응답·자격 강제 endpoint), A 작업 4건(my-reports.js 필드 정정·STAGE_FLOW·익명 배지·회원 상세 모달), C 12개 시나리오. **A·B 트리거는 메인 응답 본문에 그대로 박힘 — Swain이 복붙해서 A·B·C 채팅 시작**. |
| 2026-05-16 | **메인** | **버그 픽스 3차 코드 완결 + 📐 Phase 23 설계 진입** (main @ `20af8b4`, 전부 푸시) — 계정과목 전면작업·#9/#11 매출 카테고리 2단계 계층·#7/#8 정기후원 효성·토스 중복 경고·출금전표 예산항목 드롭다운 전부 완료. 계정과목·매출카테고리 마이그 호출 확인·파일삭제·schema 활성화 완료. 버그3차 남은 건 Swain 운영 작업뿐(#16 HTTPS·#14 환경변수·#3 효성데이터). v3.0 설계도 정본화(docs 커밋)·Phase 23-0 골격 설계서 작성. ★ **재정 모듈 전체가 더미 → 마이그 불필요·v3.0 백지 재구축**. 미해결: "독립 앱 vs SIREN 내 독립 모듈" 메인 판단 → Swain 확인 대기. 상세 docs/HANDOFF.md §3.2. |
| 2026-05-16 | **메인** | **버그 픽스 3차 진행 중** (이전 세션) — `93f89ca` #13 계정과목 503 + `6dc57a3` #14-B 발송 멈춤. 이후 본 세션에서 계정과목·매출카테고리·#7/#8 마감. |
| 2026-05-15 | **메인** | **버그 픽스 2차 ✅ 마감** (main @ `967b4a5`) — `unwrap()` 함수가 #2·#3·#4 공통 원인 정리. #10·#13·#1·#6·#7 fix. C 검증 PASS 12/0. |
| 2026-05-15 | **메인** | **버그 픽스 1차 ✅ 마감** (main @ `dcfdc0f`) — Phase 22 완결 후 라이브 버그 15건. **push 자동화 발효**, 검증 정책 "C 정적 + Swain 라이브" 정정. |
| 2026-05-15 | **메인** | **🎉🎉🎉 Phase 22 전체 완결** (main @ `9e73e98`) — 22-A 매출 / 22-B 재정 3부작 / 22-C 지출 / 22-D 전표 3부작 완결. |
> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
✅ Phase 26 근태관리 완료 (2026-05-19, main @ aeafb29)
   - A+B 머지 완료, 마이그레이션 완료 (att_* 10테이블 + 기본 정책·휴가 종류 6건)
   - C 검증 트리거 발사 대기 중 (21개 항목)

🚀 라운드 10 A·B 트리거 발사 (2026-05-19)
   - A: feature/round10-comment-share-front (댓글 투표/신고 + 파일 공유 + 알림 설정 UI)
   - B: feature/round10-comment-share-back (API 7개 + AI 자동배정)
   - DB 마이그 불필요

⚠️ Swain 필수 액션
   - Kakao REST API 키 확인 (기존 키가 REST API 키인지 확인)
     developers.kakao.com > 내 애플리케이션 > 앱 키 > "REST API 키"
     → KAKAO_REST_API_KEY 환경변수 등록

🔧 정책 (2026-05-15 발효, 유지)
   - push 자동화: feature/·fix/ 브랜치 push 자율. main·force는 ask/deny
   - UI 검증: Swain 라이브 직접 (AI 채팅 브라우저 자동화·어드민 계정 없음)
```

**Swain 운영 액션** (작업 흐름 외):
- **KAKAO_REST_API_KEY** 환경변수 등록 (Phase 26 거점 주소 검색 필수)
- 카카오 심사 통과 후 환경변수 2개 등록 (ALIGO_TEMPLATE_BILLING_FAILED, ALIGO_TEMPLATE_CARD_EXPIRING) → 자동 발송

---

## 4. 진행 중 작업

> 완료된 병렬 작업 분담 정의는 git history + `docs/milestones-archive.md` 참고.
> 새 병렬 작업 시작 시 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §4 템플릿 사용.

### 4.1 라운드 1 SIREN 4건 fix (2026-05-17 ✅ 전체 완결)

설계서: [docs/milestones/2026-05-17-round1-siren.md](docs/milestones/2026-05-17-round1-siren.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| 메인 | 구조·머지 | 설계서 작성·머지 조율 | ✅ 완료 (69e791f 머지) |
| B | 백엔드 | 빌링키 비활성화·3종 자동 status·user-my-reports·자격 강제 | ✅ 완료 (머지됨) |
| A | 프론트 | my-reports.js·STAGE_FLOW·익명 배지·회원 상세 모달 | ✅ 완료 (머지됨) |
| C | 검증 | Q1~Q12 라이브 검증 | ✅ 완료 (12/12 통과, BUG-Q10 fix 포함, 0320fa2) |

### 4.2 라운드 2 워크스페이스 8건 + 구글 캘린더 (2026-05-17 ✅ 전체 완결)

설계서: [docs/milestones/2026-05-17-round2-workspace.md](docs/milestones/2026-05-17-round2-workspace.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| 메인 | DB·마이그·머지 | 마이그 3개 테이블 + schema.ts 활성화 | ✅ 완료 (a595339) |
| B | 백엔드 | assign 버그·blob orphan·completedAt·mentions·rsvp·restore·holidays·assignedByMe·구글캘 | ✅ 완료 (머지됨) |
| A | 프론트 | 휴지통 복원·RSVP UI·멘션 배지·구글캘 연동 UI | ✅ 완료 (머지됨) |
| C | 검증 | Q1~Q12 | ✅ 완료 (10통과 + BUG-Q4·Q6 fix, 61572bc) |

### 4.3 라운드 3 통합 CMS 6건 (2026-05-17 ✅ 전체 완결)

설계서: [docs/milestones/2026-05-17-round3-cms.md](docs/milestones/2026-05-17-round3-cms.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| 메인 | DB·마이그 | paidAt 마이그 + schema 활성화 | ✅ 완료 (033ee0d) |
| B | 백엔드 | 환불권한·중복차단·paidAt 적용·재활성화 API·채널검증 | ✅ 완료 (da40c44, 머지됨) |
| A | 프론트 | 빌링키 재활성화 UI | ✅ 완료 (d1052c0, 머지됨) |
| C | 검증 | Q1~Q9 | ✅ 완료 (9/9 통과, BUG 0, aea1267) |

### 4.4 라운드 4 3단 권한 체계 (2026-05-17 ✅ 전체 완결)

설계서: [docs/milestones/2026-05-17-round4-rbac.md](docs/milestones/2026-05-17-round4-rbac.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| 메인 | 헬퍼·마이그·문서 | lib/admin-role.ts + 마이그 완료 + roles 문서 | ✅ 완료 (6e69a0f) |
| B | 백엔드 | 로그인 버그·super_admin 7개·admin 4개·operators 수정 | ✅ 완료 (머지됨) |
| A | 프론트 | admin-role-policy.html + iframe 4곳 | ✅ 완료 (머지됨) |
| C | 검증 | Q1~Q8 | ✅ 완료 (8/8 통과, BUG 0, a2a7a55) |

### 4.5 라운드 5 발송 센터 UX (2026-05-17 ✅ 전체 완결)

설계서: [docs/milestones/2026-05-17-round5-send-ux.md](docs/milestones/2026-05-17-round5-send-ux.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| A | 프론트 | 채널별 미리보기 탭 + 파일함 재사용 첨부 | ✅ 완료 (머지됨) |
| C | 검증 | Q1~Q10 | ✅ 완료 (10/10 통과, BUG 0, 7a2f557) |

### 4.8 라운드 8 수정 API 4종 + 보고↔작업 자동동기화 (2026-05-18 📐 설계 완료)

설계서: [docs/milestones/2026-05-18-round8-update-sync.md](docs/milestones/2026-05-18-round8-update-sync.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| 메인 | 설계·머지 | 설계서 작성·머지 조율 | ✅ 완료 (6bfd66e) |
| B | 백엔드 | support/incident/harassment/legal update API 4종 + delete 1종 + workspace sync | ✅ 완료 (a74e3f6) |
| A | 프론트 | mypage-applications.js·mypage.html + my-reports.js·my-reports.html 수정 버튼·모달 | ✅ 완료 (720567b) |
| C | 검증 | Q1~Q10 라이브 검증 | ✅ 완료 (10/10 PASS, BUG 2건 fix, 6bfd66e) |

### 4.9 라운드 9 WBS 고급 + 채팅 편집 + 폼 응답 삭제 (이전 세션 구현 완료·C 검증 대기)

설계서: [docs/milestones/2026-05-18-round9-wbs-chat.md](docs/milestones/2026-05-18-round9-wbs-chat.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| 메인 | DB 마이그·머지 | migrate-chat-edit.ts 실행 완료·삭제 완료, schema.ts 컬럼 활성화 완료 | ✅ 완료 |
| B | 백엔드 | 서브태스크·체크리스트·반복·리마인더·채팅 편집/삭제/검색·폼 응답 삭제 API | ✅ 완료 (이전 세션) |
| A | 프론트 | workspace-kanban.js·chat-user.js·admin-form-submissions.html | ✅ 완료 (이전 세션) |
| C | 검증 | Q1~Q10+ 라이브 검증 | ⏸ 대기 |

### 4.10 라운드 10 댓글 투표·신고 + 파일 공유 + 알림 구독 (2026-05-18 📐 설계 완료)

설계서: [docs/milestones/2026-05-18-round10-comment-share-notify.md](docs/milestones/2026-05-18-round10-comment-share-notify.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| 메인 | 설계·머지 | DB 마이그 불필요, 기존 테이블 활용 | ⏸ 대기 (R9 완료 후) |
| B | 백엔드 | comment-vote·comment-report·admin 검토 + 파일 공유 + 알림 구독 + AI 법률 배정 7개 | ⏸ 대기 |
| A | 프론트 | incident.js 투표/신고 UI + workspace-files.js 공유 모달 + settings-notifications.js | ⏸ 대기 |
| C | 검증 | Q1~Q10+ 라이브 검증 | ⏸ 대기 |

### 4.7 라운드 7 AI 에이전트 구조 확장 Layer 1~4 (2026-05-18 🚀 Phase 1 진행 중)

설계서: [docs/milestones/2026-05-18-round7-ai-layers.md](docs/milestones/2026-05-18-round7-ai-layers.md)

**Phase 1 (✅ 완료)**

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| A | AI 배치 도구 | Layer 1: legal_reply_batch·harassment_reply_batch·chat_message_broadcast·notification_batch | ✅ 완료 (7a02f84) |
| B | AI 파이프라인 | Layer 2: email_send_by_filter·bulk_pipeline | ✅ 완료 (d589b37) |

**Phase 2 (✅ 머지 완료 — 마이그레이션 대기)**

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| A | AI 힌트 시스템 | Layer 3: ToolResult.suggestedNextSteps + 15개 핸들러 주입 | ✅ 완료 (7a02f84, 머지됨) |
| B | AI 스케줄 도구 | Layer 4: ai_scheduled_commands 테이블 + cron runner + schedule 3도구 | ✅ 완료 (d723cc2, 머지됨) |
| C | 버그픽스 + 검증 | BUG 3건 fix + Q1~Q6 라이브 검증 | 🔄 BUG fix 머지됨, 라이브 검증 마이그 후 |

**✅ 마이그레이션 완료**: ai_scheduled_commands 테이블 생성됨 (ae04a13)

### 4.6 라운드 6 게이미피케이션 + 큐레이션·팝업 (2026-05-17 ✅ 전체 완결)

설계서: [docs/milestones/2026-05-17-round6-gamification.md](docs/milestones/2026-05-17-round6-gamification.md)

| 채팅 | 영역 | 작업 항목 | 상태 |
|---|---|---|---|
| 메인 | DB·마이그·라이브러리 | 8테이블 마이그+schema.ts+badge-checker.ts | ✅ 완료 |
| B | 백엔드 | 18 API + 이벤트 후킹 3곳 | ✅ 완료 (머지됨) |
| A | 프론트 | 5 HTML + site-popup.js + iframe 12곳 | ✅ 완료 (머지됨) |
| C | 검증 | Q1~Q15 | ✅ 완료 (15/15 통과, BUG 0, a474978) |

---

## 5. 마일스톤 진행률 (CLAUDE.md §10 기준)

| 묶음 | 상태 |
|---|---|
| Phase 1 효성 CMS+ | ✅ 100% |
| Phase 2 토스 빌링 자동청구 | ✅ 100% |
| Phase 3 워크스페이스 본체 | ✅ 100% |
| Phase 3-extra 파일함 | ✅ 100% |
| 4순위 자잘한 버그 3건 | ✅ 100% |
| 5순위 #1 / #9 / #10 | ✅ 100% |
| 6순위 #6 자격 변경 | ✅ 코드+검증 100% (C 정적 분석 통과) |
| 6순위 #15 CSV + 엑셀 | ✅ 코드+검증 100% (C 정적 분석 통과) |
| 6순위 #16 단계 A·B·C | ✅ 100% (V1·V2·V3 통과, 이전 세션 완료) |
| 6순위 #16 단계 D | ✅ 100% — 코드+C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-10-rank6-16-d.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| 6순위 #8 1:1 매칭 채팅 | ✅ 100% — 코드+BUG-4 fix+C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-rank6-08-matching-chat.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 4 대표 보고 시스템** | ✅ 100% — 코드+BUG-3 fix+C V1·V2·V3 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-phase4-report.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 5~7 재정 관리** | ✅ 100% — 코드+BUG-5/6/7 fix+C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-phase5-7-finance.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| TypeScript 타입 에러 149건 | ✅ 100% — C 에러 149→0건 달성 (8e283dd, 로직 변경 없음) |
| **Phase 8 알림 채널 통합 인프라** | ✅ 100% — A 디스패처+마이그+cleanup / B 7자리 통합 / C 어드민 화면+Q24~Q27 라이브 통과 |
| **Phase 9 외부 API 실연동 + 수신 설정 UI** | ✅ 코드 100% — 9-A SMS·9-B 카카오 어댑터·9-B 수신 설정 UI / 9-B 라이브 검증 통과 (Q1) / C Q7-Q8 코드 정합성 PASS / 실발송은 환경변수 등록 후 자동 |
| **Phase 10 R1 템플릿 빌더** | ✅ 100% — 코드 머지 (8db8ffb·cef0f69) + C Q9 라이브 검증 통과 (2026-05-11). 업무 시나리오 클릭 테스트는 Swain 직접 (보고서 §6) |
| **Phase 10 R2 수신자 그룹** | ✅ 100% — 코드 머지 (7f2163b·b969bb2) + C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-phase10-r2.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 10 R3 발송 예약 큐** | ✅ 100% — 코드 머지 (897cad4·857674d) + C 라이브 검증 통과 + BUG-8 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase10-r3.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 10 R4 통합 마무리 (추적·AI·분석·재발송·이력)** | ✅ 100% — 코드 머지 완료 + C 라이브 검증 PASS + BUG-9 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase10-r4.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 11 멘션·구독** | ✅ 100% — 코드 머지 + C 라이브 검증 PASS + BUG 4건 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase11-12.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 12 신고 진행 공개 + 익명 강화** | ✅ 100% — 코드 머지 + C 라이브 검증 PASS + BUG 3건 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase11-12.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 13 신고 통계 대시보드** | ✅ 100% — 코드 머지 + C 라이브 검증 PASS + BUG 2건 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase13.md`) |
| **Phase 14 외부 기관 인계** | ✅ 100% — C 라이브 검증 PASS + BUG-14-07/08 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase14.md`) |
| **Phase 15 전문가 매칭 고도화** | ✅ 100% — C 라이브 검증 PASS + BUG-15-01~06 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase15.md`) |
| **Phase 16 통합 분석 대시보드** | ✅ 100% — C 라이브 검증 PASS + BUG-16-01/02 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase16.md`) |
| **Phase 17 보안·감사 강화** | ✅ 100% 마감 — 보안 로그·비활성 자동 로그아웃·감사 통계 / C 검증 PASS + BUG-17-01~05 fix. BUG-17-06(어드민 전화번호 마스킹) **의도적 보류** — 운영 불편 시 재논의 (lib/masking.ts 헬퍼 준비됨) |
| **Phase 18 성능 최적화** | ✅ 100% 마감 — lib/cache.ts (Blobs 캐시) + 대시보드·KPI 5~10분 캐시 + 후원통계 쿼리 통합. Phase 19에서 캐시 54% 성능 향상 확인 |
| **Phase 19 자동 테스트 보강** | ✅ 100% 마감 — scripts/healthcheck.mjs 헬스체크 스크립트 + C 검증 PASS + BUG-19-03/04(후원목록·KPI 500 에러) 라이브 회귀 fix |
| **Phase 20 어드민 UI/UX 리뉴얼** | Phase 20-A(완전 리뉴얼) ❌ 거부·폐기(2026-05-14 브랜치 3개 삭제) / Phase 20-B·20-C ✅ 점진 적용 완료(Cmd+K 검색·즐겨찾기 위젯·유가족·콘텐츠·시스템 그룹 등 main 머지·운영 중) / Phase 20 운영 안정성(모니터링+백업)은 별도 합의 필요 |
| **Phase 21 워크스페이스 v3 + 서비스 연동** | ✅ **100% 마감** (2026-05-12) — R1 (Q1~Q10 + BUG 2) / R2+R3 (Q1~Q16 + BUG 2) / R4 (Q1~Q18 + BUG 1) / 3개 라운드 모두 회귀 0 / 보고서 3종 docs/verify/2026-05-12-phase21-r1·r2r3·r4.md |
| **Phase 22-A 매출 통합 관리** | ✅ 100% 마감 (2026-05-15) — R1·R2·R3 합산 BUG 15건 해소 / 6 카테고리·승인·환불 누적·손익계산서·AI 도구 7개 / 운영 가능 |
| **Phase 22-C 지출 관리** | ✅ 100% 마감 (2026-05-15) — NPO 4분류 + 자유 추가·R2 영수증·승인·환불 누적·AI 도구 5개 / 운영 가능 |
| **Phase 22-B-R1 재정 화면 이전·기간 필터** | ✅ 100% 마감 (main @ `d28c833`, 2026-05-15) — 재정 6개 화면 통합 CMS 이전·지출 단일화·기간 필터 / C 검증 18/20 + BUG-016/017/018 fix / 옛 지출 데이터 0건 → NPO 4분류 통일 결정 |
| **Phase 22-B-R2 예산 편성·2단계 결재** | ✅ 100% 마감 (2026-05-15) — budget_plans+budget_lines·전년 실적 자동 채움·작성→상신→승인 / C 검증 11/12 + BUG fix |
| **Phase 22-D-R1 전표 시스템** | ✅ 100% 마감 (2026-05-15) — vouchers·계정과목 NPO 18개·증빙·예산 연결·반복 템플릿·AI 도구 4개 / C 검증 13/16 + BUG fix / 교차 확인 PASS |
| **Phase 22-B-R3 NPO 표준 회계 보고서** | ✅ 100% 마감 (main @ `c9f035a`, 2026-05-15) — 운영성과표+예산실적표·인쇄/엑셀/PDF·옛 테이블 코드 정리 / C 검증 12/0 + BUG-021 / **Phase 22-B 3부작 완결** |
| **Phase 22-D-R2 통장거래내역 자동화** | ✅ 100% 마감 (main @ `fc547f1`, 2026-05-15) — IBK 엑셀 클라이언트 파싱·입출금 대사 엔진·출금 전표 자동생성·거래처 마스터 자동학습 / C 검증 15/0 + BUG-1 fix |
| **Phase 22-D-R3 예산잠금·전표운영·재무제표** | ✅ 100% 마감 (main @ `9e73e98`, 2026-05-15) — 예산 잠금·지출결의서 인쇄·결산 보조·이상패턴 배지·반복전표 cron·재정상태표·현금흐름표 / C 검증 PASS 15/FAIL 3 → BUG-1~4 응답 키 fix / **Phase 22-D 완결·Phase 22 전체 마무리** |

| **라운드 1~6 (2026-05-17 사이클)** | ✅ 100% 완결 — SIREN 4건·워크스페이스 9건·CMS 6건·3단 권한·발송 UX·게이미피케이션+큐레이션·팝업 / C 검증 54항목 전부 통과 (R2 BUG 2건 제외 0) |
| **라운드 7 AI Layer 1~4 (2026-05-18~)** | 🔄 Phase 1+2 머지 완료 (main @ `8b06826`) — Layer 1~4 총 9개 도구 추가 + 힌트 시스템 + 스케줄 cron. **마이그레이션 호출 대기 → C Q1~Q6 라이브 검증 남음** |
| **라운드 8 수정 API 4종 + 보고 동기화** | ✅ 100% 완결 (main @ `6bfd66e`) — C Q1~Q10 전부 PASS + BUG-R8-1(MOCK→실 API) + BUG-R8-2(sync 상태값 enum 불일치) fix |
| **라운드 9 WBS 고급 + 채팅 편집** | 🔄 구현 완료 (이전 세션) — 마이그·백엔드·프론트 모두 완료. **C 라이브 검증 남음** |
| **Phase 24 성과 관리 시스템** | ✅ 100% 완결 (2026-05-19) — 단독 구현 + C Q1~Q20 전원 PASS·BUG 0. workspace.html 내부 패널 전환 방식 |
| **Phase 25 WBS↔마일스톤 유기적 연동** | 🔄 코드 완성 (2026-05-19) — 마이그 파일·AI 백그라운드 매칭·5개 API·게이지·보류큐·카드생성. **마이그레이션 대기**: `migrate-phase25-milestone-tasks?run=1` |
| **Phase 26 근태관리 시스템** | 🔄 코드 완성 + 마이그 완료 (2026-05-19) — att_* 10테이블 생성, A+B 머지 완료. **C 검증 대기** (21개 항목) |
| **라운드 10 댓글·공유·알림·AI 법률** | 📐 설계 완료 (2026-05-18) — DB 마이그 불필요. R9 완료 후 시작 |

**누적**: 약 87% / 약 820h+

---

## 6. 미해결 이슈 (Open Issues)

현재 미해결 0건. 모든 이슈 해결.

| ID | 발견 | 위치 | 심각도 | 상태 | 리포트 |
|---|---|---|---|---|---|
| ~~#BUG-9~~ | 2026-05-11 | `db/schema.ts` — `communicationSendRecipients`·`communicationSendJobs` 컬럼 누락 (R4 마이그 후 schema 미반영) | 🟠 High | ✅ 해결 (C verify R4 세션, tracking_token 등 6개 컬럼+인덱스 추가) | docs/verify/2026-05-11-phase10-r4.md §5 |
| ~~#BUG-8~~ | 2026-05-11 | `admin-send-job-create.ts:38` 어드민 ID NULL 저장 (BUG-5 회귀 클래스) | 🟠 High | ✅ 해결 (C verify R3 세션, 1줄 fix) | docs/verify/2026-05-11-phase10-r3.md §3 |
| ~~#BACKFILL-1~~ | 2026-05-10 | 효성 후원 결제일 NULL (44건) | 🟡 Medium | ✅ 해결 (2026-05-11) — 옛 자료 삭제 후 운영자 재 import 진행 (계약→수납 순서) | [docs/issues/2026-05-10-hyosung-paid-date-backfill.md](docs/issues/2026-05-10-hyosung-paid-date-backfill.md) |
| ~~#BUG-7~~ | 2026-05-10 | `admin-finance-expenditure-approve.ts` | 🟠 High | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-6~~ | 2026-05-10 | `admin-finance-expenditure-list.ts` | 🔴 Critical | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-5~~ | 2026-05-10 | `admin-finance-{budget-upsert,expenditure-create,expenditure-approve}.ts` | 🔴 High | ✅ 해결 | [docs/issues/2026-05-10-finance-audit-columns-null.md](docs/issues/2026-05-10-finance-audit-columns-null.md) |
| ~~#BUG-2~~ | 2026-05-10 | `cms-tbfa.js:60-90` | 🟠 High | ✅ 해결 (마일스톤 #16 단계 B 545b523/f026c6b) | [docs/issues/2026-05-10-cms-tbfa-demo-data.md](docs/issues/2026-05-10-cms-tbfa-demo-data.md) |
| ~~#BUG-1~~ | 2026-05-09 | `lib/auth.ts:128` | 🔴 Critical | ✅ 해결 (bb529f9) | [docs/issues/2026-05-09-requireActiveUser-uid-bug.md](docs/issues/2026-05-09-requireActiveUser-uid-bug.md) |

**처리 원칙**: 새 이슈 발견 시 `docs/issues/{날짜}-{키워드}.md` 별도 파일 + 본 표에 한 줄 인덱스. 해결 후 상태 갱신.

**해결된 이슈 archive**: 2026-05-14 정리로 `docs/issues/` 12건은 [docs/issues-archive.md](docs/issues-archive.md)에 압축 통합 (147줄). 위 표의 옛 `docs/issues/X.md` 링크는 더 이상 존재하지 않음 — 본문은 git history 또는 archive 참조.

---

## 7. worktree 현황 (4채팅 새 구조)

> 2026-05-10 적용. 모델·역할 분배는 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §1.

| 폴더 | 채팅 | 모델 | 역할 | Phase 1 브랜치 | Phase 2 브랜치 | 현재 상태 |
|---|---|---|---|---|---|---|
| `tbfa-mis` | **메인** | Opus 4.7 | 설계·머지·조율 | `main` | `main` | 라운드 8~10 설계 완료, 실행 대기 |
| `../tbfa-mis-A` | **A** | Sonnet 4.6 | 프론트 | — | `feature/round8-update-front` | ⏸ R8 B 완료 후 시작 |
| `../tbfa-mis-B` | **B** | Sonnet 4.6 | 백엔드 | — | `feature/round8-update-sync` | ⏸ 트리거 대기 중 |
| `../tbfa-mis-C` | **C** | Opus 4.7 | 검증 | — | `verify/round8` | ⏸ R8 A·B 머지 후 시작 |
| `../tbfa-mis-D` | D | — | 휴면 | — | — | 사용 안 함 |

**충돌 회피**: 폴더 단위 분리 → A·B 거의 0. 자세히 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §3.

**머지 순서 강제**: B → 마이그 → schema 활성화 → A → C. [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §5.

라운드 설계서 표준 양식: [`docs/PARALLEL_TEMPLATE.md`](docs/PARALLEL_TEMPLATE.md).

---

## 8. C 대기열 (Live-Verify Queue)

C(Opus 4.7)가 라이브 검증·fix·백필 대기 중인 작업. C는 매 세션 시작 시 큐에서 **가장 위 항목 1건**을 처리.

| # | 작업 | 종류 | 선행 조건 | 비고 |
|---|---|---|---|---|
| ~~Q-진단-2~~ | ~~#BACKFILL-1 백필 경로 결정·실행~~ | 마이그 갱신·실행 | — | ✅ 완료 — 자동 백필 불가 판정, Swain 결정으로 옛 효성 자료 삭제(897cad4). 재 import는 Swain 직접 (계약→수납 순서) |
| ~~Q4~~ | ~~6순위 #8 1:1 매칭 채팅 라이브 검증~~ | 라이브 검증 (지연된 검증) | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-rank6-08-matching-chat.md`). 페이지 4종 200·매칭/채팅 13개 함수 401·405 정상·BUG-4 fix 유지·회귀 0 |
| ~~Q5~~ | ~~Phase 4 대표 보고 시스템 V1·V2·V3 라이브 검증~~ | 라이브 검증 (지연된 검증) | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-phase4-report.md`). 페이지 200·API 4개 401·405 정상·BUG-3 fix 유지·AI 폴백 정합·회귀 0 |
| ~~Q6~~ | ~~Phase 5~7 재정 관리 라이브 검증~~ | 라이브 검증 (지연된 검증) | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-phase5-7-finance.md`). API 7개 401·405 정상·BUG-5/6/7 fix 유지·예산/지출/수입/보고서 정합성·회귀 0 |
| ~~Q7~~ | ~~Phase 9-A SMS 실 발송 검증~~ | 코드 정합성 | — | ✅ 2026-05-11 PASS. 실발송은 Aligo 3개 등록 후 자동. |
| ~~Q8~~ | ~~Phase 9-B 카카오 알림톡 실 발송 검증~~ | 코드 정합성 | — | ✅ 2026-05-11 PASS. 실발송은 심사 통과 후 환경변수 2개 등록 시 자동. |
| ~~Q9~~ | ~~Phase 10 R1 템플릿 빌더 검증~~ | 라이브 검증 | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-phase10-r1.md`). 페이지 4종 200·API 6개 401 정상·Q1~Q8 모두 PASS·회귀 0 |

**완료**: ~~Q1~~ Phase 9-B 라이브 (2026-05-10 통과) / ~~Q2~~ #BACKFILL-1 마이그 작성 (2026-05-10 main 안착) / ~~Q-진단~~ 진단 보강 + import 코드 분석 (2026-05-11) / ~~Q3~~ 6순위 #16 단계 D 라이브 (2026-05-11 통과) / ~~Q9~~ Phase 10 R1 라이브 (2026-05-11 통과) / ~~Q4~~ 6순위 #8 1:1 매칭 채팅 (2026-05-11 통과) / ~~Q5~~ Phase 4 대표 보고 시스템 (2026-05-11 통과) / ~~R2~~ Phase 10 R2 (2026-05-11 통과) / ~~Q6~~ Phase 5~7 재정 관리 (2026-05-11 통과) / ~~Q7~~ SMS 코드 정합성 (2026-05-11) / ~~Q8~~ 카카오 코드 정합성 (2026-05-11) / ~~R4~~ Phase 10 R4 라이브 검증 PASS + BUG-9 fix (2026-05-11)

처리 정책:
- 큐는 선입선출 + 선행 조건 충족된 것 우선
- 새 라운드의 검증 작업은 큐에 추가, 단 라운드 마감 우선순위는 메인 판단
- 지연된 검증(Q3~Q6)은 새 라운드 검증과 분리 (다른 영역 회귀 발견 시 별도 fix)
- 큐 갱신 의무: C가 작업 완료 시 본 표에서 제거 + §2 마지막 업데이트 행 추가

---

## 9. 참고 문서

- [`CLAUDE.md`](CLAUDE.md) — 자동 로드, 코딩 컨벤션·자율성 원칙
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — 단일 최신 인수인계 (한 화면)
- [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) — 4채팅 병렬 작업 가이드 (2026-05-10 갱신)
- [`docs/PARALLEL_TEMPLATE.md`](docs/PARALLEL_TEMPLATE.md) — 라운드 설계서 표준 양식 (신규)
- [`docs/PAGES.md`](docs/PAGES.md) — 페이지 진입점 카탈로그
- [`docs/REMAINING_WORK.md`](docs/REMAINING_WORK.md) — 잔여 작업 인벤토리
- [`docs/CONTEXT_OPTIMIZATION.md`](docs/CONTEXT_OPTIMIZATION.md) — 컨텍스트 다이어트 진단·결정 기록
- [`docs/issues/`](docs/issues/) — 오류 리포트
- [`docs/verify/`](docs/verify/) — 라이브 검증 보고서
- 영구 스냅샷: [`docs/handover/v20.md`](docs/handover/v20.md)
