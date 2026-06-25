# 🔍 A 재검증 트리거 — 너처링 채널 전환(문자 1차·메일 보조)

> 1차 검증(메일 단일) 이후 **엔진을 다채널로 크게 재작성**했다. 변경분 집중 재검증.
> A는 **읽기/조사 위주·코드 변경 시 commit만·push 금지·여정 ON 토글 절대 금지**. 환각0.

## 0. 시작
- 정독: `docs/rules/PARALLEL_GUIDE.md`, `CLAUDE.md §6·§9`.
- 베이스: 로컬 `main` 최신(`0c4191e` 포함). 설계: `docs/active/2026-06-26-donor-nurturing-design.md`.
- 1차 검증 결과: `docs/active/2026-06-26-A-verify-nurture.md`(이미 반영된 fix: 채널 화이트리스트·블랙 제외).

## 1. 변경 파일(재검증 대상)
- 엔진 다채널: `lib/nurture-engine.ts` (sendMulti·primaryGateSql·reachablePrimary/Email·placeholder, 단계·evergreen 루프)
- 동의/리드: `lib/prospect-from-donation.ts`(일시후원 phone_verified·kakao ON), 엔진 `syncPotentialLeads`
- 수신거부: `lib/unsubscribe-token.ts`·`netlify/functions/unsubscribe.ts`·`public/unsubscribe.html`·`lib/communication-auto-trigger.ts`(executeTrigger opts.unsubscribe)
- 스키마: `db/schema.ts`(nurture_steps·evergreen `email_template_id`, potential_donors `email`)
- API/UI: `netlify/functions/admin-nurture.ts`·`public/js/admin-nurture.js`(보조 메일 칸)

## 2. 재검증 체크박스 (1:1 보고)

### A. 다채널 발송 정확성 (핵심)
- [ ] **1차+보조 분기**: `sendMulti`가 1차 채널 도달자에 1차 템플릿, 이메일 도달자에 보조 메일 템플릿 — 각각 맞는 템플릿으로 보내는지(SMS본문/메일본문 안 섞이는지)
- [ ] **placeholder 제외**: 이메일 없는 리드(`@noemail.tbfa.local`)가 메일 대상에서 빠지는지(SQL `NOT LIKE` + JS `isPlaceholder` 양쪽)
- [ ] **도달성 게이트**: sms=`agree_sms AND phone_verified_at`, kakao=`kakao_consent AND phone_verified_at`, email=`agree_email AND 비placeholder` — SQL(due 쿼리)·JS(reachable*) 일치
- [ ] **due 쿼리 eligibility**: 보조 메일 있을 때 `(1차 OR 메일)`, 없을 때 `(1차)` — 정확
- [ ] **단계당 1행·cap**: 다채널이어도 `nurture_sends` 단계당 1행(channel=1차) 기록 → 하루 1단계·주 3단계 cap 유지(멱등 UNIQUE(enrollment,step) 그대로)
- [ ] **부분 실패**: 1차/보조 중 하나만 성공해도 기록(`sent`)·둘 다 실패면 미기록 재시도 — 의도 확인
- [ ] SMS 템플릿이 HTML이 아닌 평문인지, 메일 템플릿만 HTML인지(채널-템플릿 정합)

### B. 동의·리드
- [ ] 일시후원 게스트 생성 시 `agree_email/sms`·`phone_verified_at`·`kakao_marketing_consent_at` ON(전화 있을 때) — 문자 1차 도달. 기존 회원 연결 시엔 미변경(opt-out 존중)
- [ ] `syncPotentialLeads`: 이메일 있으면 실주소+agree_email, 없으면 placeholder+agree_email=false. 전화 있으면 sms/kakao 동의·인증 ON. 기존 회원 매칭 시 연결만(중복 생성 0)·`linked_member_id` 멱등
- [ ] 채널 마이그 결과: 예비/정기/이탈 8단계 channel='sms'+email_template_id=기존메일, 잠재 5단계 sms, 문자 템플릿 15종

### C. 수신거부(채널별)
- [ ] 토큰 HMAC 서명·timingSafe·channel 포함. `/api/unsubscribe` GET/POST가 채널별 `agree_email`/`agree_sms`/`kakao_consent` 토글. 잘못 눌러도 재동의(on)
- [ ] executeTrigger가 너처링 발송(opts.unsubscribe)에만 푸터/무료수신거부 삽입(이메일 HTML·문자 평문)

### D. 안전·리스크
- [ ] SQL 주입: 엔진 sql.raw에 들어가는 건 숫자 id·화이트리스트(채널)·고정 gate 문자열뿐인지. admin saveStep/Ev 채널·주기 화이트리스트 유지
- [ ] 블랙 제외(`blacklisted_at IS NULL`) 단계·evergreen·enroll 전부 유지
- [ ] phone_verified_at를 동의 기반으로 ON 하는 것의 부작용(타 기능이 이 값을 보안 용도로 쓰는지) 점검·보고
- [ ] 여정 전부 OFF(발송 0) 확인

### E. 라이브 진단(선택·읽기전용·시크릿) — ?run/토글/발송 금지

## 3. 보고
- 📊 진행률 X%/100
- [확인 OK] / [버그·리스크 파일:라인+영향+권장] / [판단필요]
- 금지: 여정 ON, push, ?run= 발송, lib/auth·admin-guard 수정
