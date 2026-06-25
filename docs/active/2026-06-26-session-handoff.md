# 인수인계 — 2026-06-26 세션 (소프트 압축 대비)

> 컨텍스트 압축 전 상태 스냅샷. 다음 컨텍스트가 이어서 진행할 수 있게 정리.
> main HEAD: `c4a6fb3`(코드) → 본 문서 push는 `[skip netlify]`(배포 0).

## 0. 이 세션에서 한 일 (요약)
1. **Neon DB 비용 절감**: 발송 큐 이벤트화 + 빈발 크론 :00 정렬(시간당 wake 2→1회). autosuspend 최저 5분(불가)·tbfa DB는 사용자 Neon키 접근 불가 확인 → [[project_db_cost_levers]].
2. **KICC 일시후원 미반영 조사**: 결론 = 2건(류수옥·김민정) 이미 completed 정상기록(누락 아님). pending 4건은 미완료 시도. 재발방지(approve 네트워크끊김→pending 유지·webhook pending/failed→completed 승격) 배포.
3. **'토스'→KICC 라벨 정정** (정기 후원자 화면 등).
4. **허브 다른 서비스 새 탭** 진입.
5. **근태 근무 스케줄 '혼합' 요일별 UI 복원**(display:none 토글 버그).
6. **일시후원자→예비 후원자 자동 등록**(lib/prospect-from-donation) + 백필 완료.
7. **★ 후원자 너처링 시스템 신규 구축**(아래 상세).

## 1. 후원자 너처링 시스템 (핵심 산출물)

**개념**: 4세그먼트(정기/예비-일시/예비-이탈/잠재) × D0~D365 타임라인 + D365후 영구(evergreen). **문자/카톡 1차 + 메일 보조**(메일은 잘 안 봄). 수신거부 채널별. 운영자가 통합 CMS에서 편집. **여정 전부 OFF**(운영자 검토 후 켜야 발송).

**DB 테이블**(생성·적용 완료): `nurture_journeys`(세그먼트당 1·is_active 기본 false)·`nurture_steps`(day_offset·channel·template_id·**email_template_id** 보조)·`nurture_evergreen_rules`(+email_template_id)·`nurture_enrollments`(member×journey 진행상태)·`nurture_sends`(단계당 1행·멱등 UNIQUE(enrollment,step)·job_id=메일job 추적용). + `potential_donors.email`(schema 보정).

**파일**:
- 엔진: `lib/nurture-engine.ts` — runNurture(daily). enroll·전환종료(converted/exited)·due 단계 다채널(sendMulti)·evergreen·syncPotentialLeads. 동의게이트(sms=agree_sms+phone_verified, kakao=consent+verified, email=agree_email+비placeholder)·블랙제외·하루1/주3 cap·grace 2일.
- cron: `netlify/functions/cron-nurture-runner.ts` (0 23 * * * = KST08:00).
- 발송 재사용: `lib/communication-auto-trigger.ts` executeTrigger(opts.unsubscribe) → 기존 디스패처.
- 수신거부: `lib/unsubscribe-token.ts`(HMAC)·`netlify/functions/unsubscribe.ts`·`public/unsubscribe.html`(채널별 거부/재동의).
- 어드민: `netlify/functions/admin-nurture.ts`(GET상태·saveStep/Ev·toggle·preview·testSend·**analytics**)·`public/admin-nurture.html`+`public/js/admin-nurture.js`(3탭+📊성과·단계마다 1차채널+보조메일칸). 통합 CMS iframe 등록(💌 후원자 너처링).
- 자동등록 연계: `lib/prospect-from-donation.ts`(일시후원=자동동의·전화있으면 phone_verified/kakao ON).

**시드(적용완료)**: 예비-일시 D+2/7/14/30·정기 D0·이탈 D0/30/60 + 각 분기 영구(전부 문자 1차+기존 메일 보조). 잠재 D0/4/10/18/26 문자 + 보조메일 + 월간 영구. 문자 템플릿 15·메일 템플릿 다수(communication_templates, category='nurture', 운영자 편집 가능).

**성과 대시보드**(📊성과 탭): 전체 발송(7/30일·채널별)·메일 오픈/클릭율·여정별 퍼널(등록/활성/전환/이탈)·전환율.

## 2. 켜기 전 체크리스트 (운영자/사장님)
1. 통합 CMS → 후원자 관리 → 💌 후원자 너처링 (Ctrl+F5)
2. 각 단계 문구(문자/보조메일) 검토 → [테스트] 본인에게 발송
3. [오늘 발송 미리보기]
4. 만족하면 여정 **발송 ON** (세그먼트별)
   - ON 시: 기존 세그먼트 회원 enroll(과거 단계는 grace 밖이라 폭탄 없음)·신규는 분류일 D0부터.

## 3. 열린 작업 / 다음 단계
### (P1) 카톡 알림톡 우회 — Swain 지시·미구축
- **문제**: 알림톡=정보성만(광고성 거절). **우회**: 알림톡을 "메시지 도착 알림"으로 — 내용은 문자/메일, 알림톡은 "확인해 주세요" 안내.
- **초안 템플릿**(Swain 승인 후 등록):
  ```
  [교사유가족협의회]
  {{이름}}님, 안녕하세요.
  협의회에서 {{이름}}님께 전하고 싶은 소식을 보내드렸어요.
  잠시 확인해 주시면 큰 힘이 됩니다. 감사합니다.
  (버튼: 소식 확인하기 → https://tbfa.co.kr/mypage.html)
  ```
- **빌드 경로**: 기존 `admin-kakao-templates`+`kakao_alimtalk_templates`+SOLAPI로 등록 → 카카오 검수(외부·1~2일) → 승인 시 엔진에 kakao를 1차/추가 채널로 라우팅. ⚠️ 검수 통과 보장 못 함(정보성 판정 여부는 카카오). 친구톡(마케팅 카톡)은 채널 친구 확보 선행.

### (P2) A 재검증 알려진 한계 (지금 미수정·발송 안전 무영향)
- nurture_sends.channel이 단계 1차 채널로만 기록 → 성과 channelTotals가 sms 과대·email 과소. (메일 정확수치는 emailTracking이 별도 정확.) 필요 시 채널별 집계 분리.
- 부분 코호트: 1차만 성공 시 메일 게이트로만 든 회원도 sent 기록(재시도 안 됨)·확률 낮음.
- evergreen sends INSERT/last_evergreen_at UPDATE 비원자성.

### (P3) 판단 보류
- Q1 phone_verified_at 과부하: 현행 유지(보안 부작용 0). 향후 OTP 증명 용도 쓰면 marketing_phone_ok 분리.
- Q2 잠재 lead 회원 대량 생성: 잠재 ON 시 members에 donor_type='none' lead 유입(500/회). 회원 통계 영향 인지.

## 4. 진행 중 검증
- A: 너처링 다채널 재검증 100% 완료(must-fix 2건 반영 확인). 트리거: `docs/active/2026-06-26-A-verify-nurture-2.md`.

## 5. 정책 리마인더 (이 세션 위반 → 시정)
- **최소배포**: 자체적용 마이그를 모아 1배포로. 매 commit push 금지. 문서만 push는 HEAD에 `[skip netlify]`. [[feedback_push_permission]]
- 너처링 콘텐츠·단계는 어드민 편집(하드코딩 금지 §6.18 — 시드는 communication_templates라 편집 가능).
