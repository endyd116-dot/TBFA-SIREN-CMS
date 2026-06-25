# 🔍 A 검증 트리거 — 후원자 너처링 시스템 (Phase 1·2)

> 메인이 빌드한 후원자 너처링 시스템을 A가 **검증**한다. **코드·로직 검증 + 라이브 진단(읽기전용)**.
> A는 **읽기/조사 위주, 코드 변경 시 commit만·push 금지, 여정 ON 토글 절대 금지**(발송 사고 방지). 환각0.

## 0. 시작 규칙
- `docs/rules/PARALLEL_GUIDE.md`, `CLAUDE.md §6`(자율성·검증), `§9`(회귀 위험) 정독.
- 베이스: 로컬 `main` 최신(메인이 푸시한 너처링 커밋들 포함). worktree 불필요(검증).
- 설계 출처: `docs/active/2026-06-26-donor-nurturing-design.md`.

## 1. 검증 대상 파일
- 엔진: `lib/nurture-engine.ts`
- cron: `netlify/functions/cron-nurture-runner.ts`
- API: `netlify/functions/admin-nurture.ts`
- UI: `public/admin-nurture.html`, `public/js/admin-nurture.js`
- 스키마: `db/schema.ts`(nurture_* 5테이블)
- 자동등록 연계: `lib/prospect-from-donation.ts`(일시→예비)
- CMS 등록: `public/cms-tbfa.html`·`public/js/cms-tbfa.js`(💌 후원자 너처링)

## 2. 검증 항목 (체크박스 — 1:1 보고)

### A. 엔진 로직 (`nurture-engine.ts`) — 핵심
- [ ] **due 윈도우**: `daysSince ∈ [day_offset, day_offset+GRACE(2)]` — 오래 전 분류된 회원이 여정 ON 시 **과거 단계 폭탄 안 맞는지**(윈도우 밖이면 skip) 트레이스
- [ ] **멱등**: `nurture_sends` UNIQUE(enrollment_id, step_id) + `ON CONFLICT DO NOTHING` — 같은 단계 2회 발송 불가 확인
- [ ] **동의 게이트**: email=`agree_email IS NOT FALSE`, sms=`agree_sms IS NOT FALSE AND phone_verified_at`, kakao=`kakao_marketing_consent_at AND phone_verified_at` — 미동의 발송 0 확인
- [ ] **빈도 상한**: 하루 1통·주 3통 서브쿼리(회원 단위, enrollment 조인) 정확성
- [ ] **전환 종료**: 세그먼트 이탈 시 `converted`(정기 전환)/`exited` 분기 + 재진입 처리
- [ ] **evergreen**: `last_evergreen_at` + cadence 간격(monthly30/quarterly90/anniversary365) + 발송 후 갱신
- [ ] **발송 연결**: `executeTrigger`(job+recipients 직접 스냅샷) → `triggerDispatchBackground` 재사용 정합. **executeTrigger는 그룹 resolve를 안 타므로 동의 필터를 엔진이 선행**하는지 재확인
- [ ] **OFF 안전**: `is_active=false` 여정은 enroll/발송 0

### B. 시드·템플릿
- [ ] 예비-일시(Phase1): D+2/7/14/30 단계 + 분기 영구 + 메일 5종, 템플릿 `{{이름}}` 치환 동작
- [ ] 정기·이탈(Phase2): 정기 D0+분기 / 이탈 D0·D30·D60+분기, 메일 6종
- [ ] 모든 여정 **is_active=false**(발송 0) 확인

### C. API·UI·CMS
- [ ] `admin-nurture`: GET 상태·saveStep/deleteStep·toggleJourney·saveEvergreen·preview(dryRun)·testSend — requireAdmin 게이트
- [ ] UI 3탭(정기/예비/잠재) 렌더·단계 저장/삭제·여정 토글·미리보기 흐름(코드 트레이스)
- [ ] CMS 등록 4곳: 사이드바·`page-nurture` section·titles 맵·tab분기(renderNurture)·권한맵(`siren_donation`) 정합

### D. 안전·리스크 점검
- [ ] **SQL**: `nurture-engine`의 `sql.raw` 인터폴레이션이 **숫자 id·화이트리스트 문자열(segment/channel)만** 들어가는지(주입 가능성 0) 점검
- [ ] **비용**: 여정 ON 대량 발송 시 디스패처 한도(시간당)·빈도상한으로 통제되는지
- [ ] **미지원 명시**: `potential`(잠재=별도 potential_donors) 세그먼트는 현 엔진 미지원(Phase 3) — UI/엔진이 안전하게 skip하는지

### E. 라이브 진단 (선택·읽기전용·시크릿)
- [ ] `netlify env:get INTERNAL_TRIGGER_SECRET` 취득 후, 배포본에서 nurture_* 테이블·시드 조회만(있다면). **?run / 토글 / 발송 트리거 금지**.

## 3. 보고 형식 (끝나면 이것만)
- 📊 진행률 X%/100
- **[확인 OK]** 항목 리스트
- **[버그·리스크]** 파일:라인 + 증상 + 영향 + 권장 수정(코드 바꾸면 commit만)
- **[질문/판단필요]** 메인 결정 필요 항목

**금지**: 여정 ON 토글, push, 발송 트리거(?run= 류), lib/auth·admin-guard 수정.
