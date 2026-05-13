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
| 2026-05-14 (저녁) | **메인** | **🎉 AI 에이전트 Phase 1 검증 라운드 ✅ 완전 종료** — V7 PASS, BUG-05b 완전 해소 (member·media 도구 호출 진입 확인), 표준 §18.13 도메인 동기화 효과 입증. verify/ai-agent-phase1 → main 머지 (RESULTS·issues 12개 문서 흡수). 잔존: minor BUG-05c (옛 enum 입력 시 reply 안내 misleading — 데이터 정확성 무영향) |
| 2026-05-14 (오후) | **메인** | **Phase 20-A 거부된 어드민 UI 완전 리뉴얼 브랜치 3개 폐기** — feature/phase20a-back·front·live 로컬+원격 삭제. Swain이 옛 리뉴얼 시도를 거부했고 점진 수정 방향(Phase 20-B·20-C 머지)으로 진행한 작업물의 잔재. 운영 DB 잔여 테이블(`admin_favorites`·`admin_recent_views`)은 무해해서 일단 보류. Phase 17 검증 보고서는 별도 경로로 이미 main에 존재(docs/verify/2026-05-11-phase17.md) |
| 2026-05-14 (오후) | **메인** | **BUG-05b notice enum 도메인 전체 동기화 fix** (main @ `4e370ba`) — C V6 보고 `notices_list` description·`ALLOWED_NOTICE_CATEGORIES` 상수에 옛 enum 잔존 → LLM 학습으로 member/media 자체 거부. fix: 두 위치 일괄 정정. 표준 v1.3→v1.4 갱신 §18.13 신규(도메인 전체 동기화 의무). C V7 검증 대기 |
| 2026-05-14 (새벽 05:30) | **메인** | **🎉 AI 에이전트 v3 ✅ 개발 종료** (main @ `3ba204c`) — 도구 84개(Phase 1·2·3·4 종료) + 표준 v1.3 + BUG 6건 fix 누적 + 헤더 인증 fix + 라이브 검증 거의 100%. Phase 5는 미진행 (1주 운영 후 결정). 상세는 [HANDOFF.md §3.0] / 메모리 `project_ai_cost_safety.md` v3 |
| 2026-05-13 | **ai-cost** | **AI 비용 안전장치 + AI 에이전트 v2 ✅ 완료** (main @ `16b0b48`) — 5층 안전장치 + 도구 36개(읽기 17·변경 17) + 어드민 UI 3개 + 자동 알림 cron / 다음 세션에서 v3로 확장됨 |
| 2026-05-13 | **ai-cost** | **AI 비용 안전장치 Phase 1~4 + 어드민 UI ✅ 완료** — feature/ai-cost-safety @ ed651d4 / 20개 AI 기능 토글·기능별 한도·통합 로그 / lib(ai-feature·ai-cache·ai-rate-limit·ai-prompt-cache·ai-cost-monitor) / cron-ai-cost-alert(매일 09:00 임계·이상 패턴 이메일) / public/admin-ai-cost.html / 22개 호출 지점 featureKey 부착 / 미리보기 URL에서 검증 완료 / 다음: feature/ai-agent 머지 |
| 2026-05-12 | **메인** | **싸이렌 어드민 4건 fix ✅ 완료** — Bug-A1(src 미정의 ReferenceError·bea850a) / Bug-A2(증빙파일 컬럼 추가·2509d79) / Bug-A3(외부기관 init+SQL fix·2509d79) / Bug-A4(page.* 시드 완료·진단함수 삭제·89f158c) / Swain 검증 대기 |
| 2026-05-12 | **메인** | **R4 정식 설계서 작성 완료** — `docs/milestones/2026-05-12-phase21-r4-calendar-search.md` push / 카탈로그 §4 R3'→R4 명명 통일·설계서 링크 추가 / R2+R3 진행 중 사전 설계 완료 / B·A·C 시작 프롬프트 §6 포함 |
| 2026-05-12 | **메인** | **싸이렌 어드민 4건 fix 설계서 작성** — 메인 단독 작업용 / docs/milestones/2026-05-12-siren-admin-fixes.md / 4건(가입회원 멈춤·자격승인 증빙·외부기관 무반응·정적페이지) 사전 진단 완료 (Subagent) / 새 세션에서 진행 |
| 2026-05-12 | **메인** | **🎉 Phase 21 워크스페이스 v3 + 서비스 연동 ✅ 100% 마감** — R1·R2+R3·R4 3개 라운드 완료 / R4 C 검증(545644d) Q1~Q18 PASS + BUG-21R4-01(활동 피드 클릭 이동) fix 흡수(c1d8d16) / 회귀 0 / 보고서 3종 docs/verify/2026-05-12-phase21-r1.md·r2r3.md·r4.md / Phase 21 전체 약 23h (메인 5h / B 13.5h / A 17h / C 7h, 추정 대비 정확) |
| 2026-05-12 | **메인** | **Phase 21 R2+R3 ✅ 100% 마감 + §6.15 진행 중 채팅 알림 의무 신설** — C 검증(4ca61df) Q1~Q16 PASS + BUG-21R2R3-01(알림 시간 표시) fix 흡수(cb68157) / 메인 사전 fix BUG-R2R3-01(R&R 권한, 0dcb5e4) 흡수 / 회귀 0 / 보고서 `docs/verify/2026-05-12-phase21-r2r3.md` / CLAUDE §6.15 메인 push 알림 의무 정착 |
| 2026-05-12 | **메인** | **Phase 21 R2+R3 B 2차 + A 머지 완료 → C 트리거** — B 2차(007ce58): lib/workspace-sync 6함수 + API 7개 + 4종 hook + cron / A(b7b072a): 신규 6 + 수정 10 / fix(3e2b8d8): admin-service-rnr.js `data.mappings`→`data.items` 정합 / 응답 키 5개 1:1 일치 확인 / C 검증 트리거 가능 |
| 2026-05-12 | **메인** | **메타 정책 4종 정착** — §9.1.9 사전 정독(2190c92) / §6 체크박스 패턴(37d55db) / memory §4와 mock 트리거 임베드 정합(d45d290) / R4 설계서 사전 정정 (adminUsers→members + 템플릿 멱등) — 다음 라운드부터 schema 격차 패턴 차단 |
| 2026-05-12 | **메인** | **Phase 21 R1 ✅ 100% 마감 + R2+R3 트리거 준비 완료** — C 검증(e0bc08c) Q1~Q10 PASS + BUG-21R1-01/02 fix 흡수(e714fd7) / 회귀 0 / 보고서 `docs/verify/2026-05-12-phase21-r1.md` / R2+R3 통합 설계서(0ec11c9) + R4 결정 4건 완료 / A·B 신규 워크트리 전환·트리거 가능 |
| 2026-05-12 | **메인** | **Phase 21 R1 B·A 머지 완료 → C 트리거** — B(b044382: admin-workspace-tasks activityLog 50건) 머지(2e62ee3) / A(db0a8c0: 5페이지 사이드바·칸반→WBS·통합 모달·BroadcastChannel·#task hash·타임라인) 머지(88d9b38) / 충돌 0 / R2·R3 결정 7건 확정(설계서는 R1 마감 후 작성) |
| 2026-05-12 | **메인** | **Phase 21 R1 설계서 push + B·A 트리거 준비 완료** — 카탈로그(2026-05-12-phase21-workspace-v3-catalog.md) + R1 설계서(2026-05-12-phase21-r1-wbs-bridge.md) push (36d5dec) / 옛 phase21-front·back 백업(backup/phase21-phone-mask-*) + worktree A·B를 feature/phase21-r1-{front,back}으로 전환 / 베이스 main @ 36d5dec |
| 2026-05-11 | **메인** | **Phase 16 ✅ 100% + Phase 17 실API 연결 머지** — verify/phase16(21f6222) BUG-16-01/02 fix / feature/phase17-live(ea904f8) 머지 / Phase 17 schema 활성화 + 마이그 파일 삭제 (f906616) |
| 2026-05-11 | **메인** | **Phase 18 B 트리거 + A Phase 20 후보 발굴 트리거** — B Phase 18 캐싱·쿼리튜닝 진행 / A Opus 4.7 전환 후 Phase 20 후보 4개 발굴 / C Phase 17 검증 대기 |
| 2026-05-11 | **메인** | **Phase 15 verify + Phase 17 back 머지** — BUG-15-01~06 fix 흡수 / Phase 17 마이그 호출 필요 |
| 2026-05-11 | **메인** | **Phase 17 B·A 트리거 발송** — B back·A front 동시 작업 시작 / C Phase 14 완료→Phase 15 검증 진행 중 |
| 2026-05-11 | **메인** | **Phase 14 front 머지 완료** — feature/phase14-front(8dad0fd) / 기관관리·인계이력 화면 mock 상태 / C 검증 트리거 예정 |
| 2026-05-11 | **메인** | **Phase 13 검증 머지 + Phase 15 front mock 머지** — verify/phase13(e12d65f) BUG 2건 fix 흡수 / feature/phase15-front(8c5bb38) mock 상태 머지 |
| 2026-05-11 | **메인** | **Phase 14 B 머지 완료** — feature/phase14-back(3c0f081) 머지 / 신규 함수 8개 (기관·인계 7개 + 마이그) / ⏸ Swain 마이그 호출 + A front 재요청 필요 |
| 2026-05-11 | **메인** | **Phase 11+12 검증 머지 완료 + Phase 16+17 설계서 완성** — C verify BUG 7건 fix 흡수 / 통합 분석·보안 설계서 push |
| 2026-05-11 | **C 채팅** | **Phase 11+12 라이브 검증 PASS + BUG 7건 fix** — 응답키 불일치·신원식별 필드명·구독해제 메서드·감사로그 KPI 수정. 보고서 `docs/verify/2026-05-11-phase11-12.md` |
| 2026-05-11 | **메인** | **Phase 13 실 API 연결 + TS 0건 머지 완료** — A mock→실API(61f13fe) + C TS에러 149→0(8e283dd) 머지 |
| 2026-05-11 | **메인** | **Phase 13 B+A 머지 완료 (618033b)** — admin-incident-stats.ts 신규 / admin-siren-stats.js 신규 / admin.html 메뉴+섹션 추가 / A 실 API 연결 신호 발송 |
| 2026-05-11 | **메인** | **Phase 11+12 B 머지 완료 + 마이그 4테이블 성공** — feature/phase11-12-back 머지(d5beb76) / 4테이블 생성 / 마이그 파일 삭제(ef63481) |
| 2026-05-11 | **C 채팅** | **TypeScript 에러 149건 → 0건 완료** — 타입 전용 수정. 브랜치 fix/typescript-errors (8e283dd). 로직 변경 없음. |
| 2026-05-11 | 메인 | **Phase 10 R4 B 2차 머지 + A 머지** — AI 트리거·분석 백 13파일(8ecb46f) + 프론트 14파일 머지 |
> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
✅ Phase 21 R1 — 100% 마감 (2026-05-12)
   설계서: docs/milestones/2026-05-12-phase21-r1-wbs-bridge.md
   보고서: docs/verify/2026-05-12-phase21-r1.md (Q1~Q10 PASS + BUG-21R1-01/02 fix)
   main HEAD: e714fd7

🎉 Phase 21 워크스페이스 v3 + 서비스 연동 ✅ 100% 마감 (2026-05-12)
   ├─ R1 WBS↔워크툴 연동 기반 ✅ (Q1~Q10 + BUG 2건 fix)
   ├─ R2+R3 할당·이관·알림 + 서비스 동기화 + R&R ✅ (Q1~Q16 + BUG 2건 fix)
   └─ R4 캘린더·메모·피드·템플릿·검색 ✅ (Q1~Q18 + BUG 1건 fix)
   main HEAD: c1d8d16

🛡 사전 준비 (Swain 직접 액션)
   - 어드민이 운영자 관리 → R&R 매핑 탭에서 Fallback 담당자 + 카테고리별 1차/백업 시드
   - 마이페이지에서 본인 부재 일정·WBS 기본 보기 모드 설정 가능

✅ 싸이렌 어드민 4건 fix — 완료 (2026-05-12, Swain 검증 대기)
   Bug-A1: src 미정의 ReferenceError 제거 (bea850a)
   Bug-A2: 증빙파일 다운로드 컬럼 추가 (2509d79)
   Bug-A3: 외부기관 init+SQL 정상화 (2509d79)
   Bug-A4: page.* 시드 완료 + 진단함수 삭제 (89f158c)

⏸ 다른 후보 (별도 세션·합의 필요)
   - Phase 17 보안·감사 강화 — 코드 머지 완료, C 검증 보고서도 main에 존재(docs/verify/2026-05-11-phase17.md). BUG-17-04·05는 후속 권고, BUG-17-06 전화번호 마스킹은 Phase 21에서 부분 처리
   - Phase 18 성능 최적화 (feature/phase18-performance 빈 브랜치)
   - Phase 19 자동 테스트 보강 (설계서만 완성·빈 브랜치)
   - Phase 20-A 어드민 UI 완전 리뉴얼 — ❌ 거부·폐기됨(2026-05-14). Phase 20-B·20-C 점진 적용 main 머지·운영 중
   - Phase 22 미정 슬롯

🔵 R4 — B·A 동시 트리거 (R2+R3 C 검증과 평행)
   설계서: docs/milestones/2026-05-12-phase21-r4-calendar-search.md (체크박스+mock 임베드 적용)
   베이스: main @ c00d530
   ├─ A: ⏳ 시작 가능 (feature/phase21-r4-front)
   ├─ B: ⏳ 시작 가능 (feature/phase21-r4-back)
   └─ C(R4): ⏸ R4 B·A 머지 + R2+R3 C 마감 후 트리거
```

**Swain 운영 액션** (작업 흐름 외):
- 카카오 심사 통과 후 환경변수 2개 등록 (ALIGO_TEMPLATE_BILLING_FAILED, ALIGO_TEMPLATE_CARD_EXPIRING) → 자동 발송
- SMS 실발송 확인: 결제 실패 이벤트 발생 시 알림 로그에서 channel=sms, status=sent 확인

---

## 4. 진행 중 작업

> 완료된 병렬 작업 분담 정의는 git history + `docs/handover/v20.md` 참고.
> 새 병렬 작업 시작 시 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §4 템플릿 사용.

### 4.1 Phase 10 R3 — 통합 발송 시스템: 발송 예약 큐 (✅ 100% 마감)

코드 100% 머지 + C Q1~Q12 라이브 검증 통과 + BUG-8 fix. R4 진입.

### 4.2 Phase 10 R2 — 수신자 그룹 (✅ 100% 마감)

코드 100% 머지 + C Q1~Q9 라이브 검증 통과. 업무 시나리오 클릭 테스트는 Swain 직접.

### 4.3 Phase 10 R1·Phase 4·Phase 5~7 (✅ 100% 마감)

이번 세션 마감된 마일스톤:
- Phase 10 R1 템플릿 빌더 (보고서 docs/verify/2026-05-11-phase10-r1.md)
- Phase 10 R2 수신자 그룹 (보고서 docs/verify/2026-05-11-phase10-r2.md)
- Phase 4 대표 보고 V1·V2·V3 (보고서 docs/verify/2026-05-11-phase4-report.md)
- Phase 5~7 재정 관리 (보고서 docs/verify/2026-05-11-phase5-7-finance.md)
- 6순위 #16 단계 D / 6순위 #8 1:1 매칭 채팅

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
| **Phase 17 보안·감사 강화** | 🔵 B back + A front + 실API 연결 머지 완료 (마이그+schema 활성화 완료) / ⏸ C 라이브 검증 대기 |
| **Phase 18 성능 최적화** | 🟡 설계서 완성 / B 구현 진행 중 (feature/phase18-performance) |
| **Phase 19 자동 테스트 보강** | ✅ 설계서 완성 ([2026-05-11-phase19-healthcheck.md](docs/milestones/2026-05-11-phase19-healthcheck.md)) / ⏸ Phase 18 완료 후 B 트리거 |
| **Phase 20 어드민 UI/UX 리뉴얼** | Phase 20-A(완전 리뉴얼) ❌ 거부·폐기(2026-05-14 브랜치 3개 삭제) / Phase 20-B·20-C ✅ 점진 적용 완료(Cmd+K 검색·즐겨찾기 위젯·유가족·콘텐츠·시스템 그룹 등 main 머지·운영 중) / Phase 20 운영 안정성(모니터링+백업)은 별도 합의 필요 |
| **Phase 21 워크스페이스 v3 + 서비스 연동** | ✅ **100% 마감** (2026-05-12) — R1 (Q1~Q10 + BUG 2) / R2+R3 (Q1~Q16 + BUG 2) / R4 (Q1~Q18 + BUG 1) / 3개 라운드 모두 회귀 0 / 보고서 3종 docs/verify/2026-05-12-phase21-r1·r2r3·r4.md |
| Phase 22 | ⏸ 여유 슬롯 — 미래 기능 합의 시 채움 |
| **싸이렌 어드민 4건 fix** | ✅ 코드 완료 / Swain 검증 대기 — Bug-A1 ReferenceError(bea850a) / Bug-A2 증빙파일(2509d79) / Bug-A3 외부기관 init+SQL(2509d79) / Bug-A4 page.* 시드(89f158c) |

**누적**: 약 47% / 약 450h+

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

---

## 7. worktree 현황 (4채팅 새 구조)

> 2026-05-10 적용. 모델·역할 분배는 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §1.

| 폴더 | 채팅 | 모델 | 역할 | 영역 | 현재 상태 |
|---|---|---|---|---|---|
| `tbfa-mis` | **메인** | Opus 4.7 | 로직·DB 설계 + 머지·조율 | `docs/`, `PROJECT_STATE.md`, 머지 | ✅ Phase 21 마감 / 다음 작업 결정 대기 |
| `../tbfa-mis-A` | **A** | Sonnet 4.6 | 프론트 구현 | `public/`, `assets/` | ✅ Phase 21 전체 완료 (R1·R2+R3·R4) / ⏸ 다음 라운드 대기 |
| `../tbfa-mis-B` | **B** | Sonnet 4.6 | 백 구현 | `netlify/functions/`, `lib/`, `db/`, `drizzle/` | ✅ Phase 21 전체 완료 / ⏸ 다음 라운드 대기 |
| `../tbfa-mis-C` | **C** | Opus 4.7 | 라이브 검증 + fix + 백필 | 모든 영역 (검증·fix 한정) | ✅ Phase 21 R1·R2+R3·R4 검증 완료 (3개 보고서) |
| `../tbfa-mis-D` | D | — | 휴면 (큰 단독 라운드 시 가동) | — | 휴면 |

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
- 영구 스냅샷: [`docs/handover/v20.md`](docs/handover/v20.md), [`docs/handover/v17-expanded.md`](docs/handover/v17-expanded.md)
