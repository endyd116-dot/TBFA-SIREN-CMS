# R45 최종 점검 — 일반 사용자 (C)

> 감사자: Opus 4.8 / 2026-05-29 / 베이스 9040dfb
> 점검: 사용자 진입 API 약 95 · 사용자 페이지 약 35 · 관련 JS 다수 · lib(auth) 발췌
> 커버리지: `requireActiveUser` 47파일 + 무가드 사용자 함수 전수 enumerate [O] · 10여정 심층정독 + 보안발견 적대검증 + 메인 핵심 5건 직접 재검증
> 관점: 비로그인 방문자 · 회원 · 신고자(익명 포함) · 후원자 · 유가족

---

## 진행 체크리스트 (체크포인트 — 매 여정 commit)

- [ ] 골격 생성·commit
- [x] ① 회원가입 (휴대폰/이메일 인증 → 가입 → 환영·알림)
- [x] ② 로그인·비번재설정·탈퇴
- [x] ③ 후원 (일시·정기·영수증)
- [x] ④ SIREN 신고 3종 + 내 신고 조회 (★익명성·IDOR)
- [x] ⑤ 유가족 지원 + 자격변경
- [x] ⑥ 추모관 (헌화·방명록·편지)
- [x] ⑦ 게시판 (열람·작성·댓글·신고·구독)
- [x] ⑧ 캠페인 (참여·서명)
- [x] ⑨ 채팅 (상담·전문가 배정·종료)
- [x] ⑩ 마이페이지 (포인트·뱃지·랭킹·알림설정)
- [x] 요약·최우선 5건 확정

---

## 요약

**총 66건 (US-001 ~ US-066)** — 일반 사용자 10여정 전수 감사.

- **[결함] P0 0 · P1 8 · P2 16 · P3 20 = 44건**
- **[갭] P0 0 · P1 9 · P2 9 · P3 4 = 22건**
- ※ P0는 0으로 분류했으나 **US-011(무인증 시뮬결제)은 2차 적대검증자가 P0 판정** — 실질 최상위 처리 권장(운영 시작 전 파일 삭제 필수).

### 최우선 5건 (보안 우선)

1. **[US-011] 무인증 시뮬레이션 결제 `/api/donate` 잔존** 〔결함·P1(2차검증 P0)·보안〕 — 누구나 로그인 없이 가짜 '완료' 후원을 무한 생성하고 임의 이메일로 협회 명의 메일 발송 + 재정/모금 통계 오염. **운영 시작 전 파일 삭제 필수.** (두 웨이브가 독립 재발견·둘 다 진짜 확정)
2. **[US-039] 게시판 글을 익명으로 전환 수정해도 작성자 실명이 그대로 노출** 〔결함·P1·익명성/PII〕 — 익명 보호를 기대한 회원의 실명이 공개 목록·상세에 노출. 적대검증 P1 확정.
3. **[US-001] 봉사자·전문가(변호사/심리상담사) 회원가입 전면 불가** 〔결함·P1〕 — 가입 모달 선택지(volunteer/expert)가 서버 허용 키와 어긋나 해당 유형 가입이 100% 실패. 전문가 가입이 상담 매칭에 필수면 P0. 메인 직접 확인 완료.
4. **[US-058] 알림 수신거부 설정이 무시되어 끈 알림도 계속 발송** 〔결함·P1·수신동의〕 — 설정 화면 키(underscore)와 발송 디스패처 키(점 표기)가 불일치해 사용자 on/off가 통째로 무시됨(수신동의 정합·법적 리스크).
5. **[US-059+US-060] 리워드 교환 재고 무차감 + 트랜잭션 부재 음수잔액** 〔결함·P1〕 — 재고 0짜리도 무한 교환, 동시 요청 시 포인트 음수(이중 차감). 포인트 자산 정합 훼손. 재고/동시성 모두 메인 확인.

### 그 외 P1 (운영 시작 전 정리 권장)

- **결함 P1**: [US-007] 마이페이지 회원정보 저장이 항상 405(죽은 기능, 메인 확인) · [US-057] 뱃지 화면 영구 500(메인 확인)
- **갭 P1**: [US-002] 가입 후 이메일 인증메일 미발송 · [US-013] 비회원 영수증 발급 경로 전무 · [US-022] 유족지원 상태변경(보완요청) 알림 부재 · [US-028] 본인 추모글 셀프 삭제 불가 · [US-036] 게시글 구독 새 댓글 알림 무호출(메인 확인) · [US-044] 캠페인 모금현황 자동갱신 부재 · [US-046] 캠페인 '서명·참여' 기능 부재 · [US-051] 전문가 배정 완료 사용자 알림 부재 · [US-061] 리워드 교환 취소 시 포인트 미환불

### 보안(IDOR·익명성·무인증·정보노출) 결함 모음 — 메인 우선 검토

- **무인증 write**: US-011(시뮬결제·외부 무인증), US-012(카드만료 IDOR write·P2)
- **익명성/PII**: US-039(익명전환 실명노출·P1), US-018(신고 상세 과다반환·P2), US-050(상담 어드민메모 사용자노출·P2), US-033(운영자 추적성 부족·반대 갭)
- **소유권 미검증(영향 한정)**: US-024(자격증빙 blob 귀속 오염·P2), US-054(전문가매칭 sourceId·P3)
- **금액·멱등**: US-016(KICC 금액 미반환 시 대조 스킵·P2), US-030(추모 신고수 조작·P2), US-066(KST 경계 포인트·P3)
- **XSS(우회형·내부 콘텐츠)**: US-034(약력 bioHtml·P3), US-049(캠페인 본문·P3)
- **차단 우회**: US-026(정지 회원 보완제출 통과·P3)

### 점검했으나 정상인 핵심 시나리오 (안심 목록·★전 영역 공통)

1. **★익명 SIREN 신고 익명성** — create 시 신고자 신원 null 저장, 댓글 '익명' 고정, 목록·상세·내신고·추모 어디서도 사용자에게 신원 노출 0. 실명화는 어드민 전용 reveal+감사로그로만.
2. **★핵심 IDOR 방어** — 후원/신고/지원/채팅/포인트/멘션의 본인 조회·수정·삭제가 `where memberId=user.uid`(또는 명시적 403)로 일관 차단. 무가드 함수도 대부분 `authenticateUser`로 인증(field=`uid`).
3. **★첨부 IDOR(R41 P0 재발 없음)** — support-download·blob-image 비공개 파일은 소유자·관리자만(소유권+attachments 포함 이중검증).
4. **인증 코어** — 로그인 브루트포스 잠금·타이밍/이넘 방어, 탈퇴·비번변경 본인 재확인, 비번재설정 토큰 1회용·만료, 세션 쿠키 httpOnly/Secure/본문 토큰 미노출.
5. **결제 코어** — register pending→approve 서버금액 대조(클라 금액 불신뢰), KICC approve 멱등(이중청구 차단), 후원/빌링 해지 시 빌링키·KICC 빌키까지 연동 해지.
6. **랭킹 PII** — 실명 대신 첫 글자+*** 마스킹·포인트만 노출.

---

## 메인 수합용 메모 (R45-MASTER 통합 시)

- **즉시(운영 시작 전 필수)**: US-011 파일 삭제. US-001 가입 매핑 정합(전문가 가입 필요 여부 확정). US-058 알림 키 통일.
- **마이그 필요(Swain 확인)**: US-005(phone UNIQUE), US-030(신고 로그 UNIQUE), US-042(parentId self-FK) — 설계 합의 후.
- **정책 결정 필요**: US-008/US-009(탈퇴 복구·재가입 안내 정합), US-013(비회원 영수증), US-046(서명·참여 범위), US-038(게시판 댓글 신고 범위).
- **환경변수**: US-010 `SITE_URL=https://tbfa.co.kr` 운영 체크.
- **경계(타 티어와 중복 가능)**: US-024(blob 소유권)·US-050(adminMemo)·US-033(운영자 추적성)은 어드민/운영자 관점과 겹칠 수 있어 MASTER에서 재배정.

---

## 결함·갭 목록

> ID prefix = `US-001` …  /  각 항목 `[결함]`/`[갭]` + P0~P3  /  IDOR·익명성 결함은 최우선.
> 표현: 사용자 시나리오 위주(증상), 위치·근거·권장수정은 정확한 파일·라인.

### 여정 ① 회원가입

> 비회원 → 휴대폰 SMS 인증 → 가입(`auth-signup`) → 환영메일·슈퍼어드민 알림. 직업군·signup_source 기록. 이메일 인증은 별도 흐름.
> 검토: auth-signup · auth-phone-verify-send/check · auth-email-verify-request/verify · lib/phone-verify · lib/notify · modals.html · auth.js
> 발견: [결함] P1 1 · P2 2 · P3 2 / [갭] P1 1

#### [US-001] 봉사자·전문가 회원가입이 전면 불가 (가입 모달 선택지 ↔ 서버 허용 목록 불일치)  〔결함·P1〕 ★메인검증 완료
- **역할/시나리오**: 봉사자 또는 전문가(변호사·심리상담사)로 가입하려는 비회원
- **위치**: `public/partials/modals.html:49-54` ↔ `netlify/functions/auth-signup.ts:46-108,241-243` · `public/js/auth.js:482`
- **증상**: 회원유형에서 '봉사자 회원' 또는 '전문가 회원(변호사/심리상담사)'을 고른 뒤 휴대폰 인증·약관·증빙을 모두 마치고 가입 버튼을 눌러도 '유효하지 않은 회원 유형' 안내만 뜨고 가입이 절대 완료되지 않음. 실제로는 일반·유가족 회원만 가입 가능.
- **근거**: 가입 모달 선택지 값은 `regular / family / volunteer / expert` 4종(modals.html:50-53). 서버는 `regular / family / teacher / lawyer / counselor` 5개 키만 허용(`MEMBER_TYPE_CONFIG`, auth-signup.ts:46-104)하고 그 외는 `유효하지 않은 회원 유형`으로 거절(241-243). `volunteer`·`expert`는 서버 키에 없어 무조건 실패. 전문가의 변호사/심리상담사 구분은 `expertType`로 따로 넘어오지만 서버는 `memberType`만 본다. **(메인 직접 확인 완료 — 모달 값과 서버 키가 실제로 어긋남)**
- **권장 수정**: 클라이언트에서 선택지→서버 키 매핑(`volunteer→teacher`, `expert`+`expertType`→`lawyer`/`counselor`) 추가가 가장 작은 수정. 단순 라벨이 아니라 증빙·2단계검증·승인 분기가 달라 매핑 정책 확정 필요. 전문가 가입이 운영 시작 시 법률/심리 상담 매칭에 필수라면 **P0로 격상**.
- **확신도**: 확실

#### [US-002] 가입 직후 이메일 인증 메일이 발송되지 않아 이메일 인증이 영구 미완료로 남음  〔갭·P1〕
- **역할/시나리오**: 방금 가입한 일반·유가족 회원
- **위치**: `netlify/functions/auth-signup.ts:327,448-512` · `public/js/auth.js:477-517`
- **증상**: 가입을 마치면 '환영합니다' 메일은 오지만 이메일 인증 링크 메일은 오지 않음. 사용자는 인증이 필요한지조차 모르고, 마이페이지에서 인증 배너를 발견해 '재발송'을 직접 누르기 전까지 이메일 인증이 영원히 미완료 상태로 남음.
- **근거**: 가입 시 `emailVerified: false`로 생성하고 환영메일만 발송 — 인증요청 호출이 전혀 없음. 정작 `email-verify-request.ts` 주석(line 7-8)은 '회원가입 직후 자동 호출'이라 명시하나 실제 호출부가 없음. 인증요청은 로그인 후 마이페이지 '재발송' 버튼으로만 도달 가능(auth.js:606-630).
- **권장 수정**: 가입 성공 직후 인증 메일을 1회 자동 발송하도록 연결(서버 측 권장). 승인대기 회원은 로그인 불가하므로 무인증 발송 경로 필요.
- **확신도**: 확실

#### [US-003] 휴대폰 인증 토큰이 가입 시 무효화되지 않아 10분간 재사용 가능  〔결함·P2·보안〕
- **역할/시나리오**: 휴대폰 인증 토큰을 보관/가로챈 사용자
- **위치**: `lib/phone-verify.ts:197-219` (`consumeVerifyToken` — SELECT만) · `netlify/functions/auth-signup.ts:267-278`
- **증상**: 한 번 발급된 휴대폰 인증 토큰이 10분 유효시간 동안 여러 가입 요청에 재사용될 수 있음. 이메일 UNIQUE·전화 중복검사가 1차 방어를 하지만 토큰 자체가 '일회용'이 아님.
- **근거**: `consumeVerifyToken`은 `SELECT ... WHERE verify_token=... AND verified=TRUE`만 하고 무효화(DELETE/used 플래그/만료)를 하지 않음. 이메일 인증 토큰이 사용 즉시 `usedAt`으로 무효화되는 것과 대조적.
- **권장 수정**: `consumeVerifyToken`을 트랜잭션 내 UPDATE(used 플래그 또는 `verify_token=NULL`)로 원자적 1회 소비 처리.
- **확신도**: 추정

#### [US-004] 휴대폰 인증 코드 무차별 방어가 '최신 행'에만 걸려 재발송 시 시도횟수 리셋  〔결함·P2·보안〕
- **역할/시나리오**: 타인 휴대폰 번호의 인증코드를 추측하려는 공격자
- **위치**: `lib/phone-verify.ts:139-168` (verifyCode — `created_at DESC LIMIT 1`) · 22-26 (발송 rate limit)
- **증상**: 6자리 코드를 5회 틀리면 그 행은 잠기지만, 재발송하면 새 행이 생겨 시도 횟수가 0부터 다시 시작. 발송은 시간당 5회·일 10회 가능하므로 누적 추측 시도 총량이 (시도한도×재발송한도)로 늘어남.
- **근거**: `verifyCode`는 최신 행만 보고 attempts를 그 행에 한정. `checkRateLimit`은 발송 빈도만 제한하고 누적 실패는 보지 않음. 6자리(100만분의1)라 현실 위협은 낮으나 표준 대비 방어 약함.
- **권장 수정**: phone+시간창 단위 누적 실패 카운터, 또는 재발송 시 직전 미사용 행 무효화 후 누적 attempts 합산.
- **확신도**: 추정

#### [US-005] 전화번호 DB UNIQUE 제약 부재 — 동시 가입 경합 시 중복 회원 생성 가능  〔결함·P3〕
- **역할/시나리오**: 같은 전화번호로 거의 동시에 두 번 가입하는 사용자/스크립트
- **위치**: `db/schema.ts:170,173` (email은 unique, phone은 제약 없음) · `netlify/functions/auth-signup.ts:291-300`
- **증상**: 같은 휴대폰번호로 두 가입 요청이 동시에 들어오면 둘 다 중복검사를 통과해 같은 전화번호 회원이 2개 생길 수 있음(레이스).
- **근거**: `email`은 `.unique()`지만 `phone`은 제약 없음. 전화 중복검사가 단순 SELECT 후 INSERT라 원자성 없음. 이메일은 UNIQUE가 최후 방어지만 전화는 없음.
- **권장 수정**: phone 부분 UNIQUE 인덱스(`withdrawn_at IS NULL` 조건) 추가 또는 INSERT 트랜잭션 락. **마이그레이션 필요 — Swain 확인 후 진행.**
- **확신도**: 추정

#### [US-006] 가입 성공 응답 키 불일치(`user` vs `member`)로 가입 직후 헤더가 로그인 상태로 안 바뀜  〔결함·P3〕
- **역할/시나리오**: 즉시 활성화되는 일반 후원 회원으로 막 가입한 사용자
- **위치**: `public/js/auth.js:64-71` (`res.data.data.user`) ↔ `netlify/functions/auth-signup.ts:526-538` (응답 키는 `member`)
- **증상**: 가입 성공 시 쿠키는 발급되나 우상단 헤더가 즉시 로그인 상태로 안 바뀜. 새로고침해야 보임(다음 방문 시 auth-me로 복구되어 영구 장애는 아님).
- **근거**: 클라이언트는 `this.user = res.data.data.user`를 읽는데 서버 응답 키는 `member` → `this.user`가 항상 undefined → `isLoggedIn()` false.
- **권장 수정**: `res.data.data.member || res.data.data.user` 다중 fallback(§6.2) 또는 가입 직후 auth-me 1회 호출.
- **확신도**: 확실

**점검했으나 정상(안심)**: 이메일 인증 토큰 SHA-256·1회용·24시간 만료·이메일변경 방어 견고 / 신규 가입자 `operatorActive=false` 명시(과거 자동 운영자권한 결함 차단) / 이메일 중복은 DB UNIQUE+앱 검사 이중 방어 / 비밀번호 bcrypt 10라운드·강도검증 / 승인 필요 직업군 가입 시 슈퍼어드민 알림 발송.

### 여정 ② 로그인·비밀번호재설정·탈퇴

> 로그인(잠금·블랙 가드 → JWT httpOnly 쿠키) → 세션(auth-me) → 비번 변경/재설정 → 탈퇴(즉시 익명화 + 빌링/블랙/토큰 정리).
> 검토: auth-login · auth-logout · auth-me · auth-password · auth-password-reset(-request) · auth-withdraw · lib/auth · lib/email · password-reset.html · mypage.html · auth.js
> 발견: [결함] P1 1 · P3 2 / [갭] P2 1

#### [US-007] 마이페이지 회원정보(이름·연락처·알림동의) 저장이 항상 405로 실패 — 죽은 기능  〔결함·P1〕 ★메인검증 완료
- **역할/시나리오**: 일반 회원이 마이페이지에서 연락처·알림 수신 동의를 바꾸고 '변경 사항 저장'을 누름
- **위치**: `netlify/functions/auth-me.ts:20,108` (GET 전용·경로 단독 소유) ↔ `public/js/auth.js:709-710` (PATCH 호출)
- **증상**: 회원이 마이페이지에서 이름·연락처·알림동의를 수정·저장하면 항상 '저장 실패'가 뜨고 아무것도 안 바뀜. 운영 시작 후 회원이 자기 정보를 스스로 고칠 수 없음.
- **근거**: `auth-me.ts:20` `if (req.method !== "GET") return methodNotAllowed()` — GET만 허용. 경로 `/api/auth/me`는 이 함수에만 등록(다른 PATCH 핸들러 없음). 클라이언트는 `PATCH /api/auth/me`로 프로필 저장을 보냄 → 405. **(메인 직접 확인 완료 — 경로 소유·GET전용·다른 PATCH 핸들러 부재 실측)**
- **권장 수정**: `auth-me.ts`에 PATCH 분기 추가(`authenticateUser` 후 `lib/validation.ts`의 `profileUpdateSchema`로 검증·UPDATE, 응답에 `data.user` 반환). 또는 별도 함수에 PATCH 등록.
- **확신도**: 확실

#### [US-008] 탈퇴 즉시 PII 완전삭제인데 메일·UI는 '30일 내 삭제·복구 가능'으로 안내 — 복구 물리적 불가  〔갭·P2〕
- **역할/시나리오**: 실수/충동 탈퇴 후 안내 메일을 보고 contact 주소로 복구를 요청하는 회원
- **위치**: `netlify/functions/auth-withdraw.ts:114-134` ↔ `lib/email.ts:998-1021`
- **증상**: 탈퇴 확인 메일은 '30일 이내 완전 삭제', '잘못 탈퇴 시 contact@…로 복구 문의'라 안내하지만, 실제로는 탈퇴 즉시 이름·연락처·이메일이 영구 익명화되어 운영자도 복원할 방법이 없음. 사용자는 유예·복구를 믿지만 시스템에 그 경로가 없음.
- **근거**: 탈퇴 시 즉시 `email=withdrawn-{id}-{ts}@deleted.local`, `name='탈퇴한 회원'`, `phone=null`, 비번 무력화. 원본은 메일 발송용 지역변수로만 쓰고 DB에 안 남음. 어드민은 status를 active로 되돌릴 수 있을 뿐 익명화된 PII는 복원 불가.
- **권장 수정**: (A) 메일·UI 문구를 '탈퇴 즉시 삭제·복구 불가'로 정정(가장 간단·정직, 운영 시작 전 권장), 또는 (B) 복구 제공 시 원본 PII를 암호화 보존 후 30일 크론 삭제하는 soft-delete 그레이스 구현.
- **확신도**: 확실

#### [US-009] 탈퇴 시 이메일이 해방되어 '같은 이메일 재가입 불가' 안내와 모순  〔결함·P3〕
- **역할/시나리오**: 탈퇴 직후 같은 이메일로 재가입을 시도하는 사용자
- **위치**: `netlify/functions/auth-withdraw.ts:114` ↔ `public/mypage.html:1034` ↔ `netlify/functions/auth-signup.ts:280-287`
- **증상**: 마이페이지 탈퇴 안내는 '같은 이메일 재가입 불가(별도 문의)'라 못 박지만, 실제로는 탈퇴 시 이메일이 비워져 즉시 같은 이메일 재가입이 됨. 잘못된 기대를 줌.
- **근거**: 탈퇴 시 이메일이 placeholder로 바뀌어 원래 이메일 UNIQUE가 풀림. 가입은 현재 활성 `members.email`만 중복검사하므로 placeholder는 매칭 안 됨 → 재가입 허용. UI는 반대로 안내.
- **권장 수정**: 정책 확정 후 (A) 문구 '재가입 가능'으로 수정 또는 (B) 가입 시 탈퇴자 원본 이메일 해시 조회로 차단.
- **확신도**: 확실

#### [US-010] 비밀번호 재설정 메일 링크가 SITE_URL 미설정 시 운영 도메인이 아닌 Netlify 기본 도메인으로 발송  〔결함·P3·운영〕
- **역할/시나리오**: 비밀번호를 잊어 재설정 메일 링크를 클릭하는 회원
- **위치**: `lib/email.ts:9,807`
- **증상**: 환경변수 `SITE_URL` 미설정 시 재설정 링크가 공식 도메인(tbfa.co.kr)이 아니라 `tbfa-siren-cms.netlify.app`로 나감. 사용자가 낯선 도메인을 피싱으로 의심하거나 쿠키/도메인 혼선.
- **근거**: `const SITE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app"` → 폴백이 Netlify 기본 도메인. CLAUDE.md는 사용자 대면 링크에 tbfa.co.kr 사용 명시.
- **권장 수정**: 운영 배포 전 `SITE_URL=https://tbfa.co.kr` 환경변수 확정(운영 체크리스트). 폴백 기본값도 운영 도메인으로 변경 권장.
- **확신도**: 추정

**점검했으나 정상(안심)**: 로그인 — 비번검증을 상태확인보다 먼저 + 미존재 이메일 더미해시(타이밍/이넘 방어) + 5회 실패 30분 잠금 + 감사로그 / 탈퇴·비번변경·정보조회 모두 본인 JWT 파싱·본인 행만(타인 ID 주입 불가) + 현재 비번 재확인 / 비번재설정 토큰 SHA-256·30분·1회용·발급 시 기존 토큰 무효화·미존재시도 동일 메시지(이넘 방지) / 탈퇴 후속 — 빌링키 비활성(자동결제 차단)·토큰 무효화·블랙 해제 완결 / 세션 쿠키 httpOnly·SameSite·운영 Secure·본문 토큰 미노출 / 401 시 전역 '세션 만료' 안내 존재.

### 여정 ③ 후원 (일시·정기·영수증)

> 일시후원(KICC 카드·계좌이체·효성 CMS) / 정기후원(빌링키 등록·자동청구) / 영수증(R2 PDF). KICC는 register(pending)→결제창→approve(서버 금액대조·completed) 패턴.
> 검토: donate · donate-bank/hyosung/kicc-* · donation-policy/receipt · donations-cancel/mine · billing-* · donate.js · billing-success.html · payment-success.html
> 발견: [결함] P1 1 · P2 2 · P3 2 / [갭] P1 1 · P2 1

#### [US-011] 무인증 시뮬레이션 결제 엔드포인트 `/api/donate`가 살아있어 누구나 가짜 '완료' 후원 생성·임의 메일 발송 가능  〔결함·P1·보안〕 ★적대검증: 진짜(P0→P1)
- **역할/시나리오**: 비로그인 외부인이 결제 없이 '완료' 후원 기록을 무한 생성하려는 시나리오
- **위치**: `netlify/functions/donate.ts:33,39,42-59,88,115`
- **증상**: 누구나 로그인 없이 후원 API에 요청만 보내면 실제 돈을 내지 않고도 '후원 완료' 기록이 DB에 쌓이고, 임의 입력 이메일로 협회 명의 감사 메일이 발송됨. 통계·캠페인 모금액·등급 산정이 가짜 금액으로 오염될 수 있음.
- **근거**: PG 연동 없이 `status = Math.random() > 0.05 ? "completed" : "failed"`(39)로 결제 시뮬레이션 후 completed면 donations INSERT(42-59) + 감사메일(88). `memberId = auth?.uid ?? null`(33)로 비로그인 허용. `config.path="/api/donate"`(115)로 외부 직접 POST 가능. 프론트(donate.js)는 이미 kicc-register/bank-intent/hyosung-intent만 호출하는 **미참조 레거시인데 배포에 잔존**.
- **적대검증 판정**: ✅ 진짜(confirmed). 실제 인증·소유권·PG검증 모두 부재(순수 create). **P0→P1 조정**(실제 자금이동·PII침해는 없으나 외부 무인증 write로 가짜 완료 후원·임의 발송·집계오염 실재). completed+campaignTag 레코드가 admin-donation-dashboard·admin-stats·admin-campaign-stats 집계에 유입됨을 확인.
- **권장 수정**: ★운영 시작 전 `donate.ts` 파일 삭제(또는 즉시 410/403 차단)로 라우트 제거. 실제 결제는 KICC approve·계좌 수동승인·효성 CSV 매칭 경로만 유지.
- **확신도**: 확실

#### [US-012] 카드 유효기간 등록 API에 인증·소유자 검증이 없어 결제번호 추측으로 타인 빌링키 만료월 변조 가능  〔결함·P2·IDOR〕 ★적대검증: 진짜(P1→P2)
- **역할/시나리오**: 악성 사용자가 결제번호(D-0000123→123)를 순차 추측해 타인 정기후원 빌링키 만료월을 조작
- **위치**: `netlify/functions/billing-card-expiry-set.ts:27-62`
- **증상**: 후원번호 숫자만 1,2,3…으로 바꿔 요청하면 자기 것이 아닌 다른 후원자의 카드 만료월을 덮어쓸 수 있음. 그 결과 피해 후원자의 카드 만료 사전 안내(30·14일 전)가 엉뚱하게 가거나 작동하지 않게 됨.
- **근거**: 함수에 `authenticateUser` 호출이 전혀 없음. `donationId` 조회 후 `if(!donation||!billingKeyId) 404` 외 소유자 일치 검사 없이 `UPDATE billing_keys SET card_expiry_month=... WHERE id=...`(58-62). 주석(13-15)도 '본인 결제 화면 입력이라 donationId 매칭만 확인'한다며 인증 생략을 자인. donationId는 success 페이지 URL로 노출·순차 serial. **(메인 직접 확인 완료)**
- **적대검증 판정**: ✅ 진짜(인증·소유권 0). **P1→P2 조정**(쓰는 값이 `card_expiry_month`(비밀 아님·포맷검증됨)뿐이고 영향은 만료 사전알림 오발송/누락으로 한정 — 빌키 탈취·결제·정보유출 아님).
- **권장 수정**: `authenticateUser` 추가 후 `donation.memberId === auth.uid` 소유자 검증 필수화(비회원 결제건은 별도 토큰 검증 또는 거부). R41 IDOR와 동일 부류.
- **확신도**: 확실

#### [US-013] 비회원 일시후원자가 기부금영수증을 받을 경로가 전무  〔갭·P1〕
- **역할/시나리오**: 회원가입 없이 카드/계좌이체로 후원한 비회원이 연말정산용 영수증을 발급받으려는 시나리오
- **위치**: `netlify/functions/donation-receipt.ts:51-73` · `public/payment-success.html:227-229`
- **증상**: 비회원 후원자는 결제 완료 화면에서 '영수증은 마이페이지에서 즉시 발급'이라 안내받지만, 정작 로그인할 마이페이지가 없어 영수증을 절대 받을 수 없음. 영수증 발급이 끝단에서 끊김.
- **근거**: `donation-receipt`는 관리자 또는 `d.memberId === user.uid`인 로그인 회원만 통과. 비회원 후원은 memberId=null → 항상 401/403. 그런데 success 페이지는 비회원에게도 '마이페이지에서 발급'이라 안내. 후원 메일에 영수증 토큰 링크나 비회원 발급 화면이 없음.
- **권장 수정**: ① 후원 완료 메일에 서명된 1회용 영수증 링크(donationId+만료 토큰) 포함, 또는 ② 이메일+후원번호 본인확인 발급 화면. 또는 비회원 후원 자체를 막고 가입 선행 요구(정책 결정).
- **확신도**: 확실

#### [US-014] 정기후원 첫 결제 실패 시 재시도·후속안내·운영자 알림이 전무  〔갭·P2〕
- **역할/시나리오**: 카드 등록은 성공했으나 한도초과 등으로 첫 회차 결제만 실패한 후원자
- **위치**: `netlify/functions/billing-approve.ts:143-179` · `public/billing-success.html:259-283`
- **증상**: 첫 결제 실패 시 '처리 중 오류' 페이지로 가지만 자동 재시도·'다시 등록' 버튼·운영자 통지가 없음. 후원자는 정기후원이 시작됐는지 모른 채 방치되고 협회도 실패를 인지 못함.
- **근거**: 첫 결제 실패 시 빌키를 isActive=false로 저장·donation을 failed 기록 후 `failRedirect`만 — 후원자/운영자 알림 호출 없음(성공 시에만 감사메일·알림). 실패 페이지에 재시도 진입점 없음. KICC fail 보조기록은 일시결제용이라 정기 첫 결제엔 미적용.
- **권장 수정**: 첫 결제 실패 분기에 ① 후원자 알림(BILLING_FAILED 템플릿) ② 운영자 notifyAllOperators 추가, 실패 페이지에 '다시 등록' 버튼.
- **확신도**: 확실

#### [US-015] 정기후원 등록 성공화면 '첫 결제일'이 존재하지 않는 응답 필드 참조로 항상 비어 있음  〔결함·P3〕
- **역할/시나리오**: 정기후원을 막 등록한 회원이 성공 화면에서 첫 결제일 확인
- **위치**: `public/billing-success.html:427-430` ↔ `netlify/functions/billing-mine.ts:101-120`
- **증상**: 성공 화면에서 '첫 결제일' 줄이 절대 표시되지 않음(사소한 표시 결함).
- **근거**: 화면은 `firstCharge.chargedAt`를 읽지만 billing-mine의 recentCharges는 `createdAt`만 반환 → 조건이 항상 거짓.
- **권장 수정**: `firstCharge.chargedAt || firstCharge.createdAt` 다중 fallback 또는 응답에 `chargedAt` 별칭 추가.
- **확신도**: 확실

#### [US-016] KICC 일시결제 승인 시 PG가 금액을 미반환하면 금액 대조를 건너뛰고 완료 처리  〔결함·P2·보안〕
- **역할/시나리오**: 결제 위변조 시도 또는 KICC 응답에 승인금액이 누락된 경우의 금액검증 우회
- **위치**: `netlify/functions/donate-kicc-approve.ts:104-111`
- **증상**: PG 승인 응답에 승인금액이 없으면 서버가 등록금액과의 일치 검사를 통째로 건너뛰고 후원을 '완료'로 확정. 특정 응답 형태에서 금액 위변조 방어가 무력화될 수 있음.
- **근거**: `if (typeof result.amount === "number" && result.amount !== donation.amount) {...failed}` — amount가 number가 아니면(undefined/문자열) 조건 전체가 거짓이라 대조 없이 통과. 등록금액은 서버 pending에서 가져와 클라 위변조는 막지만, PG 사후 대조가 'number일 때만' 동작.
- **권장 수정**: `result.amount`가 number 아니거나 누락이면 검증 실패(fail-closed)로 전환 — '없으면 거부'. `approveTrade`가 항상 숫자 반환 보장.
- **확신도**: 추정 (`lib/kicc` approveTrade 반환 타입 추가 확인 권장)

#### [US-017] 일시결제(KICC register) 채널이 `type='regular'`도 받아 자동청구 없는 '정기' 후원이 생길 수 있음  〔결함·P3〕
- **역할/시나리오**: 정기후원 의도로 일시결제 API에 type=regular를 보내거나 클라 분기 오류
- **위치**: `netlify/functions/donate-kicc-register.ts:25-34,84-90`
- **증상**: '정기'로 표시되나 실제로는 자동청구 빌링키 없이 1회성 카드결제로만 기록 → 다음 달 청구 안 됨.
- **근거**: 스키마가 `type: z.enum(["onetime","regular"]).default("onetime")`로 regular 허용 → donations.type에 저장되나 이 경로는 빌링키 생성 안 함. 프론트는 onetime만 보내지만 서버가 거르지 않음.
- **권장 수정**: register 스키마에서 type을 onetime 고정 또는 regular 거부. 정기는 billing-register로만 유입 강제.
- **확신도**: 추정

**점검했으나 정상(안심)**: donations-mine·billing-mine은 `authenticateUser` 후 `where memberId=auth.uid`로만 조회(타인 후원 IDOR 없음, billingKey 원문 마스킹) / donations-cancel·billing-cancel은 본인 소유 검증 후 해지 + 빌링키 비활성·KICC 빌키 삭제까지 연동(R41 fix) / donation-receipt(회원)은 completed+본인만 PDF, 강제 재생성은 관리자 한정 / KICC approve 멱등 — pgOrderNo 로드·이미 completed면 즉시 성공, 정기 첫회차 결정적 shopOrderNo로 이중청구 차단 / 결제금액은 register 단계 pending 선저장 후 approve가 그 금액으로 확정(클라 금액 불신뢰).

### 여정 ④ SIREN 신고 3종(사건·악성민원·법률) + 내 신고 조회

> 익명 지원 작성 → AI 1차 분석 → 정식 접수(confirm) → 마이페이지 '내 신고 현황'에서 진행단계·답변 조회·수정·삭제. **익명 신고자 신원 보호가 핵심 축.**
> 검토: incident/harassment/legal × (create·confirm·update·delete·detail·mine) · user-my-reports · user-my-report-detail · incident-comments · blob-image · admin-report-status-update · admin-anonymous-reveal
> 발견: [결함] P2 1 · P3 2 / [갭] P3 1 — **익명성·IDOR 핵심 방어는 정상(안심 목록 참조)**

#### [US-018] 내 신고 상세 조회가 전체 컬럼을 그대로 반환 — 익명 마스킹 불완전 + 내부 운영필드(담당자ID·워크스페이스ID·응답자ID) 노출  〔결함·P2·보안〕
- **역할/시나리오**: 익명으로 신고한 사용자가 마이페이지 '내 신고 현황'에서 자기 신고 상세를 열어볼 때
- **위치**: `netlify/functions/user-my-report-detail.ts:58-103`
- **증상**: 자기 신고 상세 조회 시 응답 본문에 운영 내부용 항목(배정 담당자·응답 운영자·워크스페이스 카드 연결값)이 그대로 실려 옴. 익명 마스킹은 전화·이메일만 비우고 이름(reporterName)은 비우지 않음.
- **근거**: `select().from(table)` 전체 컬럼 SELECT 후 `safeReport={...report}`에서 `reporterPhone/Email`만 undefined 처리하고 `reporterName·assignedTo·respondedBy·workspaceTaskId`는 그대로 spread 반환. **실제로는 익명 작성 시 create 단계에서 reporterName을 null로 저장하므로 현 시점 신원 누출은 없으나**, 마스킹 로직이 컬럼 추가/정책 변경에 취약하고 내부 운영필드까지 사용자에게 과다 반환됨(다른 *-detail은 화이트리스트 방식).
- **권장 수정**: 다른 상세 API처럼 사용자 노출 항목만 명시적으로 골라 반환하는 화이트리스트로 전환. 익명 마스킹 목록에 reporterName 추가, assignedTo·respondedBy·workspaceTaskId는 응답에서 제거.
- **확신도**: 확실

#### [US-019] '내 신고' 통합 목록(type=all)이 테이블별 offset을 따로 적용해 페이지 경계가 어긋남  〔결함·P3〕
- **역할/시나리오**: 3종을 한꺼번에 보는 통합 목록을 2페이지 이상 넘길 때(클라가 type=all로 호출하는 경로가 생길 경우)
- **위치**: `netlify/functions/user-my-reports.ts:46-156`
- **증상**: 신고가 많아 여러 페이지일 때 2페이지부터 일부 항목이 누락/중복되어 보일 수 있음.
- **근거**: type='all'일 때 3종 각각 `.limit().offset()`을 독립 적용 후 JS 정렬 → 합쳐진 시계열 페이지 경계와 불일치. total은 3종 합산이라 totalPages와 실제 내용이 어긋남. **현재 프론트는 항상 단일 type만 호출하므로 미노출 잠재 결함.**
- **권장 수정**: type=all은 UNION ALL 후 통합 정렬·offset 일괄 적용, 또는 통합 모드는 페이지네이션 비활성(전부 로드 후 클라 정렬). 또는 all 모드 페이징 제거.
- **확신도**: 추정

#### [US-020] 진행 단계 타임라인에 DB에 존재하지 않는 단계(in_progress·completed·responding)가 항상 표시됨  〔결함·P3〕
- **역할/시나리오**: '내 신고 현황'에서 '처리 단계 타임라인'을 펼쳐 진행 상황 확인
- **위치**: `public/js/my-reports.js:33-37`
- **증상**: 사건·악성민원 타임라인에 실제로는 절대 도달하지 않는 단계('처리 중'·'처리 완료')가 회색으로 항상 떠 있어 사용자가 '아직 단계가 남았나' 오해.
- **근거**: `STAGE_FLOW.incident/harassment`에 `in_progress·completed·responding`이 포함되나 `schema.ts:71·88` enum은 `[submitted, ai_analyzed, reviewing, responded, closed, rejected]`만 정의 → 두 신고 종류에서 영원히 active 안 되는 유령 단계.
- **권장 수정**: STAGE_FLOW를 각 종류 실제 DB enum과 1:1로 정합(사건·악성민원: submitted→ai_analyzed→reviewing→responded→closed, 반려는 rejected). legal만 matching/matched/in_progress 포함. STATUS_LABEL에 없는 'responding' 제거.
- **확신도**: 확실

#### [US-021] 정식 접수(confirm) 직후 신고자 본인에게 '접수→검토중' 자동 통지가 없음  〔갭·P3〕
- **역할/시나리오**: 사이렌 정식 접수를 선택한 직후, 운영자가 단계를 손대기 전까지 진행 알림을 못 받는 신고자
- **위치**: `netlify/functions/incident-report-confirm.ts:47-87` · `netlify/functions/admin-report-status-update.ts:138-168`
- **증상**: 정식 접수 시 화면은 '운영진 검토 후 답변'이라 하지만, 신고자에게 알림이 실제 가는 시점은 운영자가 수동으로 단계를 바꿀 때뿐. 운영자가 안 건드리면 신고자는 통지 없이 직접 마이페이지를 봐야 함.
- **근거**: confirm은 status를 reviewing으로 바꾸고 운영자에게만 notifyAllOperators 발송 — 신고자 본인 알림 없음. 신고자 알림은 admin-report-status-update의 수동 액션 의존. (익명 신고도 memberId가 항상 보존되어 알림 수신은 가능 — 익명성 문제 아님.)
- **권장 수정**: confirm 시 신고자 본인에게도 '신고가 정식 접수되어 검토가 시작되었습니다' 1회 통지 추가(익명 여부 무관 내부 memberId로 발송).
- **확신도**: 추정

**점검했으나 정상(안심·★핵심)**:
- **익명성 보장** — 익명 신고 시 create 단계에서 reporterName/Phone/Email을 모두 null 저장, 댓글 author_name은 작성 시점에 '익명' 고정. 목록·상세·내신고조회 어디서도 다른 사용자에게 익명 신고자 신원 노출 0. 신원 식별은 admin-anonymous-reveal(어드민 전용+감사로그)로만 가능.
- **IDOR 방어** — 모든 본인 조회·수정·삭제·확정 API가 `WHERE id=? AND memberId=user.uid` 또는 명시적 소유자 검사(불일치 403). 타인 신고 ID 주입 차단.
- **첨부 접근통제** — 신고 증거 첨부(blob-image)는 비공개 파일에 어드민 또는 업로더 본인(uploadedBy===user.uid)만 허용(R41 P0 Q2-001 fix 유지). 연번 추측으로 남의 증거 다운로드 불가.
- **정식 접수 멱등** — confirm이 `siren_report_requested IS NULL` 조건 원자적 UPDATE로 중복 접수·중복 알림 차단(3종 동일).
- **블랙 가드** — 신고 생성·확정·수정·댓글 쓰기에 requireActiveUser 적용(정지·탈퇴·블랙 fail-closed 차단).
- **수정 단계 제한** — 본인 수정은 운영자 검토 전(submitted·ai_analyzed)까지만, reviewing 건 직접 삭제 거부(검토 중 변조 방지).

### 여정 ⑤ 유가족 지원 + 자격변경

> 유가족 지원(심리상담·법률·장학) 신청(첨부 업로드)→조회·보완 / 교원 자격(현직·은퇴·예비·일반) 변경 신청→상태조회. 공개 응답폼 빌더(form)도 점검.
> 검토: support-create/update/delete/mine/download/upload/supplement · eligibility-request/status · admin-support · admin-eligibility-review · blob-upload/image · form/form-submit
> 발견: [결함] P2 1 · P3 2 / [갭] P1 1 · P2 2

#### [US-022] 운영자가 지원 신청 상태를 '보완 요청' 등으로 바꿔도 신청자에게 알림이 전혀 안 감  〔갭·P1〕
- **역할/시나리오**: 운영자가 유가족 지원 신청을 '보완 요청'/진행/완료로 바꿈. 신청자는 그 사실을 알 길이 없음
- **위치**: `netlify/functions/admin-support.ts:164-189`(인라인 분기)·225-258(메일은 sendEmail일 때만)
- **증상**: 신청자가 메일·앱 알림 어느 것도 못 받아, 본인이 수시로 마이페이지를 새로고침해야만 '보완 요청'이 떴는지 알 수 있음. 모르면 신청이 그대로 방치됨.
- **근거**: 인라인 단계변경 경로는 상태만 UPDATE하고 메일·알림 코드가 전무. 일반 PATCH 경로도 메일은 옵트인이며, admin-support 전체에 notifications 적재·notify-dispatcher 호출이 0건. **반면 자격변경(admin-eligibility-review)은 항상 notifications 적재 → 같은 '심사 결과 통지'인데 지원 쪽만 비대칭으로 빠짐.**
- **권장 수정**: 상태 전이(특히 supplement/completed/rejected) 시 자격변경과 동일하게 notifications INSERT(recipientType='user', link='/mypage.html#support')를 항상 수행. 인라인 경로에도 적용. 메일은 옵트인 유지하되 인앱 알림은 기본 발송.
- **확신도**: 확실

#### [US-023] 지원 신청 첨부를 업로드한 본인조차 다운로드 못 함 — 본인 증빙 재확인 끝단 부재  〔갭·P2〕
- **역할/시나리오**: 유가족 회원이 가족관계증명서 등 민감 증빙을 첨부해 신청한 뒤 마이페이지에서 '내가 무슨 파일 올렸지?' 재확인하려 함
- **위치**: `public/js/mypage-applications.js:471-473` (vs `netlify/functions/support-download.ts:80-94`)
- **증상**: 신청 첨부가 마이페이지 상세에서 파일명만 회색으로 뜨고 '(다운로드는 운영자 확인 후 안내)'만 보임. 본인이 올린 증빙을 클릭해도 못 받음.
- **근거**: **서버 support-download는 소유자(memberId===user.id)에게 다운로드를 허용**하는데, 클라이언트가 문자열 키 첨부에 대해 다운로드 링크를 만들지 않음(`else if typeof a==='string'` 분기에서 안내문만). support-mine이 attachments를 문자열 키 배열로 반환하므로 모든 신규 첨부가 이 분기에 걸려 다운로드 불가. 서버 기능은 있는데 화면 끝단이 없음.
- **권장 수정**: 문자열 키 분기에서 `/api/support/download?key=...&id=...` 링크 생성. support-download가 이미 소유자·attachments 포함 검증을 하므로 보안 추가비용 없음.
- **확신도**: 확실

#### [US-024] 자격변경 증빙으로 남의 비공개 파일 ID를 끼워넣을 수 있음 (소유권 미검증)  〔결함·P2·보안〕
- **역할/시나리오**: 악의적 회원이 자격변경 신청 시 evidenceBlobId에 자기 것이 아닌 임의 blob 번호(연속 정수)를 넣어 제출
- **위치**: `netlify/functions/eligibility-request.ts:47-51,79-91`
- **증상**: 타인이 올린 파일을 자기 자격변경 증빙처럼 첨부 가능. 운영자가 신청자 소유로 오인하거나, 피해자 파일이 엉뚱한 신청에 묶여 데이터 정합·PII 귀속이 어긋남.
- **근거**: `const n=Number(body.evidenceBlobId); if(Number.isFinite(n)&&n>0) evidenceBlobId=n` — 양수 검증만 하고 `blob_uploads.uploaded_by===meId`·context 확인 없이 그대로 INSERT. **(단 blob-image가 비공개 파일은 업로더 본인/관리자만 열람 허용하므로 공격자가 파일 내용을 직접 보지는 못함 → IDOR 열람은 차단. 귀속·정합 오염만 남는 한정 영향.)**
- **권장 수정**: INSERT 전 `SELECT id FROM blob_uploads WHERE id=$1 AND uploaded_by=$meId AND (context='eligibility_evidence' OR reference_id IS NULL)`로 본인 업로드 확인. support-create:64-71의 'support/{uid}/' 접두 검증과 동일 패턴.
- **확신도**: 확실

#### [US-025] 응답폼 빌더의 파일 필드는 실제 업로드 미구현 — 필수 파일 폼이 막다른 길  〔갭·P2〕
- **역할/시나리오**: 운영자가 신청폼에 '증빙 파일 첨부(필수)' 필드를 만들어 공개. 사용자가 파일을 골라 제출
- **위치**: `public/form.html:113-114,179-186` · `netlify/functions/form-submit.ts:114-134`
- **증상**: 사용자가 파일을 선택해도 실제 파일은 어디에도 저장되지 않음. 필드 도움말에 '파일 업로드는 D5 단계에서 지원 예정'이 그대로 노출. 필수 파일 필드면 제출은 통과하되 빈 값이 쌓임.
- **근거**: form.html file 케이스는 업로드 핸들러 없이 안내문만. 수집부는 File 객체를 JSON.stringify해 `{}`로 직렬화 → 서버 required 검증은 `String(v).trim()`이 '[object Object]'/'{}'가 되어 비어있지 않다고 오판 → 필수 통과하나 파일 유실.
- **권장 수정**: file 필드를 blob-upload(context='form_response')로 선업로드→blobId만 담는 흐름으로 완성, 또는 미구현이면 form.html file 렌더 비활성(제출 차단) + 어드민 폼빌더에서 file 필드 추가 차단.
- **확신도**: 확실

#### [US-026] 보완 제출·삭제 등 일부 지원 API가 차단(정지) 회원도 통과 — 가드 일관성 갭  〔결함·P3·보안〕
- **역할/시나리오**: 운영자가 정지(suspended)시킨 회원이 차단 전 만든 신청에 보완 자료를 계속 제출
- **위치**: `support-supplement.ts:33`·`support-delete.ts:27`·`support-mine.ts:23`(authenticateUser) vs `support-create.ts:29`·`eligibility-*.ts:27`(requireActiveUser)
- **증상**: 차단된 회원도 본인 신청에 한해 보완 제출·삭제·조회 가능. create와 자격변경은 차단되는데 후속 동작은 안 막혀 정책 비대칭.
- **근거**: 후속 API들이 `authenticateUser`만 써서 members.status(suspended/withdrawn) 확인을 안 함. (다만 `memberId===auth.uid` 소유권 검증은 있어 IDOR는 없음 → 차단 우회 영향만 한정.)
- **권장 수정**: support-supplement·delete·mine의 authenticateUser를 requireActiveUser로 통일(소유권 검증은 유지, status 게이트만 추가).
- **확신도**: 확실

#### [US-027] AI 우선순위 분석에 넘기는 첨부 ID가 항상 NaN으로 걸러져 첨부가 반영 안 됨  〔결함·P3〕
- **역할/시나리오**: 사용자가 긴급성을 보여주는 증빙(진단서 등)을 첨부해 신청 → AI 우선순위 판단이 첨부를 참고하길 기대
- **위치**: `netlify/functions/support-create.ts:80-83`
- **증상**: 첨부가 있어도 AI 우선순위 분석에 첨부 정보가 전혀 전달 안 됨(기능 손해, 장애는 아님).
- **근거**: `attachments.map((k)=>Number(k))` — attachments는 'support/{uid}/…' 문자열 키라 Number()가 NaN → `.filter(Number.isFinite)`로 전부 제거되어 attachmentIds는 항상 []. 저장용 safeAttachments와 별개 변수를 잘못 매핑.
- **권장 수정**: 첨부 개수/존재를 시그널로 넘기거나 blob 메타를 조회해 전달. 최소 attachmentIds 산출을 safeAttachments.length 기반으로 교정.
- **확신도**: 확실

**점검했으나 정상(안심)**: support-download는 로그인+(관리자 또는 소유자)+key가 해당 신청 attachments JSON에 포함되는지 이중검증(R41 P0 타인첨부 IDOR 재발 없음) / blob-image 비공개 파일은 관리자/업로더 본인만(증빙 ID 추측 열람 차단) / support-mine/update/delete/supplement 모두 `memberId===auth.uid` 소유자 검사 / eligibility 쿼리는 본인 한정 + pending 중복은 코드+DB 부분UNIQUE 이중방어 / support-create 첨부 키 'support/{uid}/' 접두 강제(끼워넣기 차단) / **자격변경 승인·반려 시 신청자에게 항상 인앱 알림 적재(자격변경 통지 끝단은 완결 — 지원과 대비)**.

### 여정 ⑥ 추모관 (헌화·방명록·편지)

> 촛불/국화 헌화(비로그인 가능) · 추모 메시지(방명록) 작성·공감·신고(회원) · 기억의 편지 작성·열람. AI 사전검토(memorial-moderation)로 부적절 글 비공개 보류.
> 검토: memorial-offering · memorial-messages/letters · memorial-summary · memorial-teacher(s) · admin-memorial-moderation · lib/memorial-moderation · memorial(-teacher).js
> 발견: [결함] P2 2 · P3 3 / [갭] P1 1 · P2 1 · P3 1 — **익명성·숨김처리 핵심 방어는 정상(안심 목록)**

#### [US-028] 본인이 쓴 추모 메시지·편지를 스스로 삭제/수정/숨김할 수 없음  〔갭·P1〕
- **역할/시나리오**: 추모 메시지/편지를 쓴 회원이 오타·격한 표현·개인정보가 들어간 글을 나중에 내리고 싶음
- **위치**: `netlify/functions/memorial-messages.ts:92-221`(POST=like/report/작성만) · `memorial-letters.ts:54-119`(작성만) · `public/js/memorial-teacher.js:176-314`(카드에 본인 삭제 버튼 없음)
- **증상**: 실수로 쓴 글, 감정이 격해 쓴 글, PII가 든 글을 작성자가 직접 지우거나 고칠 방법이 전혀 없음. 운영자에게 별도 연락해 삭제를 부탁하는 수밖에 없음(추모 공간 특성상 흔한 요구).
- **근거**: 메시지/편지 POST에 수정·삭제 분기 없음. 삭제/숨김은 admin-memorial-moderation(requireAdmin)에만 존재. 클라이언트 카드에도 '신고'·'공감'만 있고 본인 글 삭제 UI 없음.
- **권장 수정**: 본인(memberId===user.uid) 글에 한해 soft-delete·숨김 토글 API 추가 + 카드에 본인일 때만 '삭제' 노출. 소유자 검증은 where(memberId===user.uid).
- **확신도**: 확실

#### [US-029] AI 검토로 비공개 보류된 글이 작성 직후 본인 화면엔 정상 등록된 것처럼 보임  〔결함·P2〕
- **역할/시나리오**: 추모 메시지/편지를 작성한 회원
- **위치**: `public/js/memorial-teacher.js:239-245,305-311` · `memorial.js:362-373` · `memorial-messages.ts:206-217`/`memorial-letters.ts:105-115`(pendingReview:true 반환)
- **증상**: 부적절 판정으로 비공개 보류된 글도 '추모의 글이 등록되었습니다' 토스트가 뜨고 목록 맨 위에 보임. 새로고침하면 사라져 '왜 내 글이 없어졌지?' 혼란.
- **근거**: 서버는 flagged 시 isHidden=true 저장 + 응답에 pendingReview:true를 담지만, 클라이언트는 pendingReview 분기 없이 즉시 목록에 추가하고 동일 '등록' 토스트를 띄움. 다음 GET에선 isHidden=false만 조회되어 사라짐.
- **권장 수정**: 응답 pendingReview=true면 목록에 추가하지 말고 '검토 후 공개됩니다' 안내로 분기(편지도 동일).
- **확신도**: 확실

#### [US-030] 추모 글 신고에 중복방지·본인글 제외가 없어 한 회원이 신고수를 무제한 부풀릴 수 있음  〔결함·P2·보안〕
- **역할/시나리오**: 악의/장난성 회원이 멀쩡한 추모 글의 신고 버튼을 반복 클릭
- **위치**: `netlify/functions/memorial-messages.ts:142-160`(action=report)
- **증상**: 신고 버튼을 반복 누르면 신고 횟수가 계속 올라가, 운영자 '신고순' 상단에 정상 글이 올라가 부당하게 검토·숨김 대상이 됨. 자기 글에도 신고를 쌓을 수 있음.
- **근거**: report 분기가 메시지 존재만 확인 후 reportCount를 무조건 +1. 누가 신고했는지 기록·중복차단 없고 본인 글 제외도 없음. 운영자 화면은 desc(reportCount) 정렬이라 조작값이 우선순위에 반영.
- **권장 수정**: 신고 로그 테이블 (memberId, refTable, refId) UNIQUE로 1인 1신고 멱등 + 본인 글 신고 차단. **마이그 필요 — 설계 합의 후.**
- **확신도**: 확실

#### [US-031] 기억의 편지에는 신고 기능이 없어 부적절 편지를 사용자가 알릴 수 없음  〔갭·P2〕
- **역할/시나리오**: 추모관을 열람하는 회원이 부적절한 편지를 발견
- **위치**: `netlify/functions/memorial-letters.ts`(report 분기 없음) · `public/js/memorial-teacher.js:251-270`(letterEl에 신고 버튼 없음)
- **증상**: 방명록 메시지에는 '🚩 신고'가 있지만, 더 길고 노출 큰 '기억의 편지'에는 신고 버튼이 없음. AI 검토(fail-open)를 통과한 부적절 편지를 알릴 끝단 부재.
- **근거**: 편지 POST는 작성 전용, letterEl엔 신고·공감 버튼 없음. schema에 `memorialLetters.reportCount`가 정의돼 수용 의도는 있으나 경로 미구현.
- **권장 수정**: 편지에도 메시지와 동일한 신고 API·버튼 추가(중복방지 포함). reportCount 컬럼이 이미 있어 변경 최소.
- **확신도**: 확실

#### [US-032] 기억의 편지 목록 조회에 페이지네이션·상한이 없어 전건을 한 번에 반환  〔결함·P3〕
- **위치**: `netlify/functions/memorial-letters.ts:33-44`(limit 없음)
- **증상**: 편지가 수백·수천 건 쌓인 선생님 페이지를 열면 전건을 한 번에 내려받아 느려짐.
- **근거**: GET이 where+orderBy만 있고 `.limit()/offset` 없음(메시지는 PAGE_SIZE=20 있는 것과 대비). CLAUDE §6.3 위반.
- **권장 수정**: 편지 GET에 limit(예 50)+offset + '더 보기'.
- **확신도**: 확실

#### [US-033] 익명 작성 글의 실제 작성자를 운영자도 식별 못 해 반복 악용자 제재 불가  〔갭·P3·보안/경계〕
- **역할/시나리오**: 악성 글을 반복 게시하는 회원 / 막아야 하는 운영자
- **위치**: `netlify/functions/admin-memorial-moderation.ts:37-46,58-67`(authorName만 노출, memberId 미선택)
- **증상**: 익명 부적절 글을 반복 올려도 운영자 화면엔 '익명'으로만 보여 같은 사람인지 식별·차단 불가. 지워도 같은 사람이 계속 재게시.
- **근거**: 작성 시 memberId는 항상 저장되나 운영자 조회 SELECT는 authorName만 가져오고 memberId 미선택. **공개 익명성은 잘 지켜지나 운영자 추적성이 부족**(반대 방향 갭).
- **권장 수정**: 운영자 모더레이션 화면 전용으로 memberId(또는 마스킹 회원식별)를 함께 노출(공개 API는 현행 익명 유지).
- **확신도**: 추정

#### [US-034] 선생님 약력(bioHtml)이 정규식 기반 경량 살균 후 innerHTML 주입 — 우회형 XSS 여지  〔결함·P3·보안〕
- **위치**: `public/js/memorial-teacher.js:88-96` · `netlify/functions/memorial-teacher.ts:52`(원문 반환)
- **증상**: 약력 영역이 HTML로 그려지는데 위험 태그 제거가 정규식 몇 줄뿐이라 우회 입력 시 스크립트 실행 가능성.
- **근거**: safeBio가 `<script>`·따옴표형 on핸들러·javascript: 정규식 제거 후 innerHTML 주입. 따옴표 없는 `onerror=`·`<svg onload=>` 등 패턴 벗어난 입력은 잔존. bioHtml은 운영자/AI 작성 내부 콘텐츠라 위험은 제한적이나 신뢰경계 약함.
- **권장 수정**: DOMPurify 등 검증 살균기 교체 또는 서버측 화이트리스트 살균 후 저장.
- **확신도**: 추정

#### [US-035] 헌화 throttle(10초)가 단일 기준이라 의도적 카운트 부풀리기 가능  〔결함·P3〕
- **위치**: `netlify/functions/memorial-offering.ts:60-89`(THROTTLE_SECONDS=10)
- **증상**: 10초마다 헌화하면 카운트가 계속 올라가고, 비회원은 IP만 바꾸면 사실상 무제한 → '밝혀진 촛불·국화' 숫자의 진정성 저하.
- **근거**: 최근 10초 내 동일 기준 1건 존재 여부만 확인, 일/총량 상한·캡차 없음. (결제·포인트 아니라 영향은 신뢰도 한정.)
- **권장 수정**: throttle 창 확대 또는 (memberId/IP, teacherId) 일일 상한. 운영상 허용 가능하면 정책 수용 가능.
- **확신도**: 추정

**점검했으나 정상(안심)**: 익명 헌화·메시지·편지의 공개 응답에 memberId·실명 노출 0(authorName='익명'만) / 숨김(isHidden) 글은 모든 공개 목록·카운트에서 제외 / 공감 토글 (messageId,memberId) UNIQUE + count(*) 재집계로 멱등 / 작성·공감은 requireActiveUser(블랙·정지 차단)·작성자 memberId는 서버 토큰에서만 취득(위조 불가) / 비공개 선생님은 조회 404.

### 여정 ⑦ 게시판 (열람·작성·댓글·신고·구독)

> 목록·검색·상세 열람(비로그인) · 글 작성·수정·삭제(본인) · 댓글 작성·삭제(본인) · 게시글/카테고리 구독 토글·내 구독 관리.
> 검토: board-list/detail/create/update/delete · board-comment-create/delete · comment-report/vote · user-post-subscribe/subscriptions · admin-notify-subscribers · board(.js)·my-subscriptions.js
> 발견: [결함] P1 1 · P2 2 · P3 1 / [갭] P1 1 · P2 1 · P3 2

#### [US-036] 구독한 게시글에 새 댓글이 달려도 알림이 한 번도 발송되지 않음 (발신 함수 무호출)  〔갭·P1〕 ★메인검증 완료
- **역할/시나리오**: 게시글을 '🔕 구독하기'로 구독한 회원이 새 댓글 알림을 기대
- **위치**: `netlify/functions/board-comment-create.ts:66-83`(알림 발송 호출 없음) · `admin-notify-subscribers.ts`(호출처 0건, 경로는 `/api/ln`)
- **증상**: 구독해 둬도 누가 댓글을 달면 알림이 영영 오지 않음. 구독 기능의 유일한 존재 이유(새 댓글 알림)가 동작하지 않는 죽은 기능.
- **근거**: 댓글 INSERT 후 댓글 수만 +1할 뿐 구독자 알림 발송 호출 전무. **알림 발송기(`admin-notify-subscribers`, path=`/api/ln`)를 호출하는 코드가 전역 0건 — 작성됐지만 어디서도 트리거 안 됨.** (메인 직접 확인 완료 — 호출처 self-reference만 존재)
- **권장 수정**: 댓글 INSERT 직후 fire-and-forget으로 구독자 알림 생성 배선(알림 생성 로직을 lib로 추출해 직접 호출 권장 — 자기호출 인증 복잡성 회피).
- **확신도**: 확실

#### [US-037] 구독 알림 링크가 존재하지 않는 페이지(board-post.html)를 가리켜 클릭 시 404  〔결함·P2〕
- **위치**: `netlify/functions/admin-notify-subscribers.ts:145` (`link="/board-post.html?id="+postId`)
- **증상**: 구독 알림이 살아나더라도 클릭 시 실제 게시글이 아닌 없는 페이지로 가 404. 실제 페이지는 `board-view.html`.
- **근거**: `board-post.html`은 이 파일에만 등장(실제는 board.html/board-view.html/board-write.html 3개). 프론트는 모두 `/board-view.html?id=` 사용.
- **권장 수정**: link를 `/board-view.html?id=${postId}`로 정정(US-036과 함께).
- **확신도**: 확실

#### [US-038] 게시판 댓글에 '신고·추천' UI·API 배선이 없음 (신고·투표 FK가 사건댓글 전용)  〔갭·P2〕
- **역할/시나리오**: 부적절한 게시판 댓글을 신고하거나 추천하려는 회원
- **위치**: `public/js/board.js:327-345`(삭제 버튼만) · `comment-vote.ts`·`comment-report.ts`(FK가 incident_comments)
- **증상**: 자유게시판 댓글에는 신고·추천 버튼이 화면에 없고, 신고·투표 API는 SIREN 사건 댓글 전용이라 게시판 댓글엔 쓸 수 없음. 게시판 댓글 모더레이션 공백.
- **근거**: `schema.ts:1429·1437` commentVotes/commentReports의 commentId가 `.references(()=>incidentComments.id)` — board_comments가 아닌 incident_comments를 가리킴. 게시판 댓글 ID를 넣으면 FK 불일치로 동작 불가.
- **권장 수정**: (A) board_comments용 별도 투표/신고 테이블·API·UI 신설, 또는 (B) 비범위면 트리거의 '게시판 댓글 신고·추천' 항목을 SIREN 사건 댓글 여정으로 분리. 운영 시작 시 게시판 댓글 신고 부재는 모더레이션 공백.
- **확신도**: 확실

#### [US-039] 실명 글을 익명으로 전환 수정해도 작성자 실명이 목록·상세에 그대로 노출  〔결함·P1·익명성〕 ★적대검증: 진짜(P1)
- **역할/시나리오**: 실명으로 올린 글을 나중에 '익명으로 작성'으로 바꿔 민감 내용을 보호하려는 회원
- **위치**: `netlify/functions/board-update.ts:69-71`(isAnonymous만 갱신, authorName 미갱신) · `board-detail.ts:65`·`board-list.ts:46`(authorName 무조건 노출)
- **증상**: 실명 글을 '익명' 체크로 바꿔 저장하면 익명 플래그만 켜지고, 목록·상세의 작성자 이름은 예전 실명 그대로 표시됨. 익명 보호를 기대한 회원의 신원이 노출.
- **근거**: board-update는 isAnonymous만 갱신하고 authorName을 '익명'으로 재설정 안 함(authorName은 작성 시점에만 결정). board-detail/list는 isAnonymous와 무관하게 authorName 그대로 반환(memberId만 마스킹). board-detail은 비로그인도 조회 가능.
- **적대검증 판정**: ✅ 진짜·P1 유지. 노출 체인 전부 코드로 입증(작성 시점 authorName 1회 확정→update가 미갱신→detail/list 무조건 반환→클라 마스킹 없음). 인증·소유권 검사는 정상이나 **정당 소유자 본인의 익명 전환 요청에서 발생하는 PII 잔존 노출**이라 권한 가드와 무관. 작성 시점부터 익명인 글은 안전(authorName='익명' 저장) — 오직 '수정으로 익명 전환'하는 경우만 누설.
- **권장 수정**: board-update에서 isAnonymous=true 갱신 시 authorName='익명' 동반 설정 + board-detail/list 응답에서도 isAnonymous면 authorName='익명' 마스킹(양쪽 모두 권장). 댓글 측도 update 경로 신설 시 동일 적용.
- **확신도**: 확실

#### [US-040] 내 구독 관리 화면이 '구독 시작일·댓글 수·새 댓글 배지'를 영영 비워서 표시 (응답 계약 불일치)  〔결함·P2〕
- **위치**: `public/js/my-subscriptions.js:81-93` ↔ `netlify/functions/user-post-subscriptions.ts:73-78`
- **증상**: 구독 목록에서 제목은 보이나 '구독 시작: —', '댓글 0개'로만 뜨고 새 댓글 배지가 절대 안 뜸.
- **근거**: 서버는 `{id, postId, postTitle, createdAt}`만 반환하는데 화면은 `subscribedAt`(→createdAt)·`commentCount`·`unreadCount`를 읽음 → 항상 undefined.
- **권장 수정**: 응답에 subscribedAt(createdAt 별칭) + commentCount/unreadCount를 조인 산출. 최소한 '구독 시작'은 createdAt으로 즉시 채움.
- **확신도**: 확실

#### [US-041] 게시판 카테고리 전체 구독을 시작/조회하는 UI 진입점이 없어 사실상 사용 불가  〔갭·P3〕
- **위치**: `public/js/board.js:466-529`(게시글 단위 구독만) ↔ `user-post-subscribe.ts:39`(boardCategory 지원)
- **증상**: 서버·DB는 카테고리 전체 구독(boardCategory)을 지원하나 구독할 버튼이 어느 화면에도 없고, 내 구독 관리도 카테고리 구독을 안 보여줌.
- **근거**: 백엔드는 boardCategory 분기·boardSubscriptions 반환을 모두 구현했으나 프론트 진입점 부재(데드 코드 수준).
- **권장 수정**: 카테고리 구독을 노출하거나 백엔드 분기 정리. 최소 my-subscriptions에 boardSubscriptions 목록·해제 추가.
- **확신도**: 확실

#### [US-042] 댓글 하드 삭제 시 대댓글(자식)이 부모를 잃고 고아로 남음  〔결함·P3〕
- **위치**: `netlify/functions/board-comment-delete.ts:43` · `db/schema.ts:1006`(parentId FK 미설정)
- **증상**: 답글이 달린 댓글을 삭제하면 답글은 남는데 부모가 사라져 맥락 없는 댓글이 됨.
- **근거**: boardComments.parentId가 `.references()` 없는 단순 integer라 cascade·set null 미동작. comment-delete는 해당 id만 hard delete → 자식 parentId가 존재하지 않는 값으로 잔존.
- **권장 수정**: 삭제 시 자식 parentId를 null 정리, 또는 self-FK(onDelete set null) 부여(마이그·확인 후), 또는 부모를 tombstone soft-delete.
- **확신도**: 추정

#### [US-043] 게시글 신고 경로 부재 — 부적절 게시글을 회원이 신고할 수 없음  〔갭·P3〕
- **위치**: `public/js/board.js:251-277`(상세 액션에 목록/수정/삭제/구독만) · netlify/functions(board 신고 API 없음)
- **증상**: 댓글뿐 아니라 게시글 자체도 신고할 방법이 화면·API 모두 없음. 게시글 모더레이션은 어드민 수동 isHidden에만 의존.
- **근거**: comment-report는 reportType 'comment'|'incident'만 허용 — 게시글(post) 신고 타입 없음.
- **권장 수정**: 게시글 신고(타입 post)를 comment-report 확장 또는 별도 API로 제공 + 상세에 신고 버튼. 비범위면 어드민 능동 점검 운영 보완 명시.
- **확신도**: 추정

**점검했으나 정상(안심)**: 글 작성·수정·삭제 모두 requireActiveUser + memberId===user.uid 소유자 검사(타인 글 IDOR 차단) / 댓글 신고 중복방지(동일 commentId+memberId 409) / 댓글 추천 멱등(UNIQUE+onConflictDoNothing+COUNT 재집계) / 구독 알림 사칭 차단(발신자 본인 검증 후에만, 숨김 댓글 스킵) / 저장형 XSS 완화(작성·수정 시 서버에서 script·on*=·javascript: 제거 + 출력 escapeHtml) / 비로그인 열람 범위 적정(작성·구독은 로그인 필수, 숨김 글 제외).

### 여정 ⑧ 캠페인 (참여·서명)

> 캠페인 목록(campaigns.html)·상세(campaign.html)에서 진행률·모금현황 확인 후 '이 캠페인에 후원하기'로 캠페인 지정 후원. 콘텐츠는 어드민 CRUD(admin-campaigns).
> 검토: campaigns · donate · donate-kicc-*/bank-intent · admin-campaign-stats · admin-donation-confirm · donations-mine · cron-campaign-slump-check · donate.js · campaign(s).html
> 발견: [결함] P2 2 · P3 1 / [갭] P1 2 · P2 1  (+ /api/donate는 **US-011 중복** — 아래 참조)

> ⚠️ **US-011 재확인(중복)**: 이 여정의 독립 감사에서도 무인증 시뮬결제 `/api/donate`가 재발견됨. **두 번째 적대검증자는 P0로 판정**(재정/모금 통계 직접 오염·임의 메일 발송·무력화 통제 일체 부재·netlify.toml redirect 없음). US-011의 첫 검증자는 P1. **실질 우선순위 = 최상위(운영 시작 전 파일 삭제 필수).** 상세는 [US-011] 참조.

#### [US-044] 캠페인 모금현황(모금액·후원자수)이 후원 완료 시 자동 갱신되지 않음 — 관리자 수동 재계산 전까지 진행률 멈춤  〔갭·P1〕
- **역할/시나리오**: 후원자가 캠페인에 카드 후원을 완료한 직후 상세를 새로고침해도 모금액·후원자수·진행률 바가 그대로
- **위치**: `netlify/functions/donate-kicc-approve.ts:116-128`(완료 처리에 캠페인 갱신 없음) · `admin-campaign-stats.ts:54-58`(유일한 갱신 지점, 수동 POST)
- **증상**: 실제 후원이 들어와도 진행률·현재 모금액·후원자수가 옛 값이라 캠페인이 정체된 것처럼 보임. 후원 유도력 저하 + 부진 감지 크론까지 오판.
- **근거**: KICC approve·계좌이체 confirm 모두 donations만 갱신하고 campaigns.raisedAmount/donorCount 미갱신. raised_amount를 쓰는 유일한 코드는 admin-campaign-stats.recalcOne()(수동). 자동 recalc 크론 없음(cron-campaign-slump-check는 캐시값을 읽기만 함 → 갱신 안 된 값으로 부진 판정).
- **권장 수정**: 후원 완료 시점(KICC approve·계좌 confirm·효성 입금)에 campaignId가 있으면 recalcOne(campaignId)을 fire-and-forget 호출, 또는 시간 단위 자동 recalc 크론 추가.
- **확신도**: 확실

#### [US-045] 종료/비공개 캠페인 후원 차단이 클라이언트(버튼 숨김)에만 있고 서버 campaignId 검증 부재  〔결함·P2·보안〕
- **역할/시나리오**: 종료(closed)되어 후원 버튼이 사라진 캠페인도 다른 모달이나 직접 호출로 campaignId를 실어 후원하면 접수됨
- **위치**: `public/campaign.html:153,170-175`(isClosed면 버튼만 숨김) · `donate-kicc-register.ts:88`·`donate-bank-intent.ts:60-77`(campaignId 상태/기간 검증 없이 저장)
- **증상**: 종료·비공개로 내린 캠페인에 후원이 계속 쌓일 수 있어 종료 캠페인 모금액이 사후에 늘어나는 비정상.
- **근거**: 화면은 UI만 분기. 서버는 `campaignId: data.campaignId ?? null`만 저장하고 해당 캠페인의 존재/active/기간을 조회·검증하지 않음. status=closed·isPublished=false·endDate 경과 캠페인에도 연결 가능.
- **권장 수정**: 후원 등록 endpoint에서 campaignId 제공 시 campaigns를 조회해 isPublished=true·status='active'·(endDate 미경과) 검증, 위반 시 badRequest 또는 campaignId=null 강등.
- **확신도**: 확실

#### [US-046] 캠페인 페이지가 약속한 '서명·참여' 기능이 실제로 없음 — 후원 외 참여 경로 부재  〔갭·P1〕
- **역할/시나리오**: 소개문구('후원·서명·참여로 함께해 주세요')를 보고 들어온 사용자가 서명/참여 버튼을 찾음
- **위치**: `public/campaign.html:7,170-175`(CTA는 '후원하기' 단일) · netlify/functions(signature/petition/participant API 부재)
- **증상**: 모금형이 아닌 추모(memorial)·인식개선(awareness) 캠페인에 들어가도 '후원하기'만 노출되어 서명·참여 선언 같은 비금전 동참 수단이 전혀 없음.
- **근거**: 메타·문구에 '서명·참여' 명시. 그러나 CTA는 후원 모달뿐이고 signature/petition/campaign_participant 류 사용자 API·스키마 테이블 부재. awareness/memorial 캠페인은 모금 UI 비활성(goal 0)이라 사실상 '참여' 액션이 비어 있음.
- **권장 수정**: ① 서명/참여를 운영 시작에 포함할지 결정 → 포함 시 campaign_signatures(participants) 테이블 + 참여 API + 1인 1서명 멱등 + 어드민 집계 화면. ② 제외 시 메타·문구에서 '서명·참여'를 빼 기대와 일치.
- **확신도**: 확실

#### [US-047] '내 후원내역'에 어느 캠페인 후원인지 표시 불가 — 캠페인 참여 추적·참여증명 부재  〔갭·P2〕
- **위치**: `netlify/functions/donations-mine.ts:37,74`(campaignTag만 반환, campaignId·캠페인명 미조인) · `public/js/donate.js:280-282`(campaignTag=String(campaignId))
- **증상**: 내 후원내역에 캠페인 제목이 안 나오고, 카드 후원은 식별자가 숫자만 저장돼 사람이 알아볼 수 없음. 캠페인별 참여 이력·참여증명을 조회할 방법 없음.
- **근거**: donations-mine는 campaignTag만 select하고 campaigns 조인 없음. 카드 후원은 `campaignTag=String(campaignId)`로 숫자 id를 태그에 넣어 저장 → 표시값이 사람이 못 읽는 숫자.
- **권장 수정**: campaignId가 있으면 campaigns를 별도 조회(JS Map)해 캠페인 제목 함께 반환, 마이페이지에 '○○ 캠페인 후원' 표기. 캠페인별 내 기여 합계(참여증명) 검토.
- **확신도**: 확실

#### [US-048] 캠페인 식별자 이중 키(campaignId vs campaignTag) 혼재 — 경로별 집계 누락 위험  〔결함·P2〕
- **위치**: `admin-campaign-stats.ts:45`(WHERE campaign_id) · `donate.ts:56`(campaignTag만 저장) · `donate.js:280-282`(둘 다 전송)
- **증상**: campaignTag로만 저장된 후원(orphan /api/donate 경로 등)은 campaignId 기준 집계에 안 잡혀 캠페인 모금액이 실제보다 적게 보일 수 있음.
- **근거**: 집계 기준은 `WHERE campaign_id=...`. donate.ts는 campaignId 없이 campaignTag만 저장. donate.js는 임시방편으로 둘 다 전송(주석: '어느 키로 합산할지 확정 시 단일화') — 키 단일화 미완 상태로 운영 진입.
- **권장 수정**: 집계 표준 키를 campaignId로 확정, 모든 후원 생성 경로가 campaignId를 채우도록 통일. donate.js의 임시 매핑 제거.
- **확신도**: 확실

#### [US-049] 캠페인 상세 contentHtml 클라이언트 정규식 살균만 적용 — 우회형 XSS 잔존 가능  〔결함·P3·보안〕
- **위치**: `public/campaign.html:105-114`(sanitizeHtml 정규식) · `:168`(innerHTML 주입)
- **증상**: 캠페인 본문에 정규식 회피 패턴 마크업이 통과하면 방문자 측 실행 여지(주입 출처가 어드민 작성 콘텐츠라 노출면 제한적).
- **근거**: contentHtml을 정규식 살균 후 innerHTML 주입. 코드 주석 스스로 'DOMPurify/서버 화이트리스트 권장'이라 밝힘.
- **권장 수정**: 서버측 HTML 화이트리스트 또는 DOMPurify. 캠페인 작성 권한이 신뢰 운영자로 한정되는지 확인.
- **확신도**: 추정

**점검했으나 정상(안심)**: 캠페인 목록/상세 공개조회는 isPublished=true+status IN(active,closed)만 노출(draft 404) / 내 후원내역은 authenticateUser + where memberId=uid(IDOR 없음) / KICC 카드 후원은 register pending→approve 서버금액 대조·중복승인 차단 / 진행률·잔여일 계산 경계처리 정상(goal 0 시 null) / 캠페인 콘텐츠는 어드민 CRUD로 관리(하드코딩 아님).

### 여정 ⑨ 채팅 (상담·전문가 배정·종료)

> 마이페이지 1:1 상담 + 전문가 매칭 → 전문가 배정(어드민) → 메시지(텍스트·이미지·수정·삭제·검색) → 종료 → 피드백(별점·후기).
> 검토: chat-mine/messages/message-update/delete/search/image/upload · expert-match-request/list · expert-session-end · user-match-feedback(-status) · admin-expert-assign · chat-user.js · mypage-expert-match.js
> 발견: [결함] P2 1 · P3 3 / [갭] P1 1 · P2 2

#### [US-050] 상담 메시지 조회 시 어드민 전용 비공개 메모(adminMemo)가 사용자 브라우저로 전송됨  〔결함·P2·보안/정보노출〕 ★적대검증: 진짜(P1→P2)
- **역할/시나리오**: 사용자가 자기 상담방을 열어 메시지를 폴링(5초)할 때 응답 JSON에 운영자가 적어둔 비공개 메모가 포함됨
- **위치**: `netlify/functions/chat-messages.ts:83-118`
- **증상**: 사용자가 상담 채팅창을 열기만 해도 운영자가 그 상담에 대해 내부적으로 적어둔 메모(예: '진상 회원', '환불 거부 예정' 등 민감 판단)가 브라우저로 전달됨. 화면엔 안 보이나 개발자도구 네트워크 탭에서 누구나 읽을 수 있음.
- **근거**: GET 경로가 `db.select().from(chatRooms)`로 전체 컬럼을 가져와 `ok({messages, room})`로 room 전체 반환. `schema.ts:529 adminMemo`(운영자 전용)·unreadForAdmin·closedBy 등 내부 필드가 함께 노출. 클라이언트(chat-user.js)는 title/status/category만 읽지만 응답엔 전부 실림.
- **적대검증 판정**: ✅ 진짜(단 IDOR 아님 — 인증·소유권 가드는 정상 작동, 노출 대상은 '본인 방에 대한 어드민 메모'로 한정·자기노출). adminMemo는 실사용 필드(admin-chat-rooms에서 작성). **P1→P2 하향**(타인 PII 교차노출 아니고 관측에 개발자도구 필요).
- **권장 수정**: GET 응답 room을 명시적 컬럼 화이트리스트(id·category·title·status·lastMessageAt·unreadForUser·roomType·expertId·closedAt)로 좁혀 select. adminMemo는 isAdmin일 때만 포함(PATCH 경로는 이미 컬럼 명시 — GET·POST도 동일 정리).
- **확신도**: 확실

#### [US-051] 전문가 배정 완료 시 사용자에게 아무 알림이 없어 상담 시작이 지연됨  〔갭·P1〕
- **역할/시나리오**: 전문가 상담을 신청하고 운영자가 변호사/심리상담사를 배정해 채팅방이 열렸으나 사용자는 통지받지 못함
- **위치**: `netlify/functions/admin-expert-assign.ts:149-205` · `admin-expert-direct-assign.ts:159-214`
- **증상**: 신청자는 '운영자가 전문가를 배정하여 채팅방이 열립니다' 안내만 받고 끝. 실제 배정·채팅방 개설이 일어나도 메일·문자·인앱 알림이 전혀 없어 우연히 페이지를 다시 열 때까지 상담이 시작되지 않음(응답 지연·이탈).
- **근거**: 두 배정 함수 모두 트랜잭션으로 chat_rooms INSERT + expert_matches UPDATE(matched)만 하고 끝. notifications INSERT나 발송 호출 없음(grep 0건). notifications 테이블이 존재하는데 미활용.
- **권장 수정**: 배정 직후 fire-and-forget으로 notifications(recipientId=사용자, category='expert_match', link='/mypage#expertMatch') 1건 + 가능하면 알림톡/메일. 헤더 종 아이콘으로 노출.
- **확신도**: 확실

#### [US-052] 사용자가 전문가 매칭을 스스로 취소·종료할 수 없어 잘못 신청 시 막힘  〔갭·P2〕
- **역할/시나리오**: 전문가 상담을 잘못 신청했거나 불필요해진 사용자가 본인 취소를 원함
- **위치**: `netlify/functions/expert-session-end.ts:116-119` · `expert-match-request.ts:70-92`
- **증상**: 사용자는 pending/matched 상태 매칭을 스스로 취소·종료할 수 없음(종료 권한은 어드민·배정 전문가만). 동시에 같은 종류 진행 중 매칭이 있으면 신규 신청도 거절되어, 잘못 신청한 사용자는 운영자 처리까지 재신청 자체가 불가.
- **근거**: `if(!isAdmin && match.expertId !== viewerMemberId) return forbidden` — 신청자 본인은 종료 불가. 종료 사유 enum에 'user_canceled'가 정의돼 있으나 사용자가 트리거할 엔드포인트 없음. request 중복 가드가 pending/matched/active 모두 차단.
- **권장 수정**: 신청자 본인이 pending/matched에서 closedReason='user_canceled'로 취소하는 경로 추가(권한 분기에 'userId===viewerMemberId && status in (pending,matched)' 허용, 채팅방도 close). 또는 마이페이지 카드에 '신청 취소' 버튼.
- **확신도**: 확실

#### [US-053] 전문가 매칭 신청 시 운영자에게 알림이 없어 배정이 누락·지연될 수 있음  〔갭·P2〕
- **위치**: `netlify/functions/expert-match-request.ts:94-121`
- **증상**: 사용자가 '신청 제출'을 눌러도 운영자에게 새 신청 알림이 전혀 안 감. 운영자가 admin-expert-list?status=pending를 주기적으로 안 열면 신청이 며칠씩 묻힘.
- **근거**: request는 expertMatches INSERT(pending) 후 곧장 201만 반환. 운영자 알림·ADMIN_NOTIFY_EMAIL 발송 없음. 어드민은 pending 폴링에 의존.
- **권장 수정**: 신청 INSERT 직후 운영자 notifications(category='expert_match_pending') 1건 + 선택적 ADMIN_NOTIFY_EMAIL. 어드민 종 알림과 연동.
- **확신도**: 확실

#### [US-054] 전문가 매칭 신청의 sourceId가 신청자 소유인지 검증하지 않음  〔결함·P3·보안〕
- **위치**: `netlify/functions/expert-match-request.ts:58-110`
- **증상**: 신청 본문의 sourceId(연결 사건 번호)가 본인 데이터인지 확인 안 됨. 직접 호출 시 남의 사건 번호를 연결할 수 있음.
- **근거**: `sourceId = body?.sourceId ? Number(...) : null` 후 검증 없이 저장. 원천 테이블에서 소유자=uid 확인 없음. (단 sourceId가 사용자에게 추가 데이터를 노출하진 않고 운영자 참조용 메타라 영향 제한적.)
- **권장 수정**: sourceId 제공 시 sourceDomain별 원천 테이블에서 row 회원 id가 신청자 uid와 일치하는지 확인(불일치면 null 처리/거절).
- **확신도**: 추정

#### [US-055] 채팅 검색 결과에 보낸이 이름이 항상 '알 수 없음'으로 표시됨  〔결함·P3〕
- **위치**: `netlify/functions/chat-search.ts:65-70` · `public/js/chat-user.js:910`
- **증상**: 검색 결과 목록의 발신자 이름이 모두 '알 수 없음'(검색·하이라이트는 정상).
- **근거**: 서버는 `{id, content, senderRole, createdAt}`만 반환(senderName 없음). 클라이언트는 `m.senderName || '알 수 없음'`을 읽어 항상 폴백.
- **권장 수정**: 응답에 senderRole 기반 라벨('나'/'상담원'/'전문가') 추가 또는 senderName 함께 반환.
- **확신도**: 확실

#### [US-056] 전문가 매칭 신청 사유 최소 길이가 서버에서 강제되지 않음  〔결함·P3〕
- **위치**: `netlify/functions/expert-match-request.ts:57-68` · `public/js/mypage-expert-match.js:218`
- **증상**: 사유를 매우 짧게 보내도(클라 우회 시) 서버가 접수해 운영자 배정 판단 정보가 부족한 신청이 들어올 수 있음.
- **근거**: 서버는 `if(!reason)`로 비어있지 않은지만 확인. 클라이언트만 `reason.length < 10` 검증.
- **권장 수정**: 서버에서도 `reason.trim().length >= 10` 검증 추가(클라와 일치).
- **확신도**: 확실

**점검했으나 정상(안심)**: 채팅방·메시지·이미지 IDOR 방어 — chat-mine/messages/image/upload 모두 소유자(memberId=uid) 또는 배정 전문가(canEnterExpertRoom) 또는 어드민만(타인 상담 본문·첨부 403, 무인증 경로 없음) / 본인 메시지만 수정·삭제(5분 초과·종료방 차단·soft-delete 멱등) / 피드백은 본인 매칭·status=closed·중복(UNIQUE) 검증 후 별점 1~5 + 평균 재계산 / 이미지 업로드 MIME 화이트리스트+10MB+소유권 / 만료 첨부 정리 크론 멱등 / senderId===user.id 비교가 members.id 기준 정합(uid 회귀 아님).

### 여정 ⑩ 마이페이지 (포인트·뱃지·랭킹·알림설정)

> 요약(auth-me)·포인트(my-points)·뱃지(my-badges)·랭킹(ranking)·알림설정(notification-preferences)·리워드 교환(reward-redeem)·발송내역(user-my-send-history)·멘션.
> 검토: auth-me · my-points · my-badges · ranking · notification-preferences · reward-redeem · rewards-list · admin-reward-redemptions · user-my-send-history · lib/badge-checker · lib/notify-dispatcher/events · 각 페이지 JS
> 발견: [결함] P1 4 · P2 3 · P3 2 / [갭] P1 1 — **포인트/리워드/알림 정합 결함 다수**

#### [US-057] 뱃지 조회 API가 존재하지 않는 테이블 컬럼을 SELECT — 뱃지 화면 영구 빈 상태(500)  〔결함·P1·회귀〕 ★메인검증 완료
- **역할/시나리오**: 후원·로그인으로 뱃지를 획득한 회원이 마이페이지 '내 뱃지'를 열어 확인
- **위치**: `netlify/functions/my-badges.ts:18-26`
- **증상**: 실제 뱃지를 획득했어도 뱃지함이 항상 '아직 획득한 배지가 없습니다'로만 표시됨. 활동 보상이 화면에 전혀 반영 안 됨.
- **근거**: `.select({code: badgeDefinitions.code, nameKo: badgeDefinitions.nameKo, icon: badgeDefinitions.icon, awardedAt: memberBadges.awardedAt}).from(memberBadges)` — FROM에는 member_badges만 있는데 SELECT가 badge_definitions 3개 컬럼을 참조 → Postgres 'missing FROM-clause entry' 500. 게다가 member_badges 실제 컬럼은 `badge_code`(code 아님, schema.ts:3389). 프론트는 `.catch(()=>({}))`로 삼켜 빈 배지로 degrade. **(메인 직접 확인 완료 — FROM 단일·컬럼 불일치 실측)**
- **권장 수정**: member_badges에서 `badgeCode, awardedAt`만 조회 후 별도 defMap(이미 존재, line 29)으로 nameKo·icon 매칭. `r.code` 참조도 `r.badgeCode`로 정정.
- **확신도**: 확실

#### [US-058] 알림설정 화면 이벤트 키와 발송 디스패처 키 불일치 — 설정 꺼도 알림 계속 발송  〔결함·P1·알림정합〕
- **역할/시나리오**: 회원이 '워크스페이스 멘션'·'후원 결제 완료'·'유가족 신청 상태변경' 알림을 끄고 저장한 뒤 더 안 오기를 기대
- **위치**: `public/js/settings-notifications.js:15-35` vs `lib/notify-events.ts:9-30` / `lib/notify-dispatcher.ts:91-112`
- **증상**: 특정 알림을 끄고 저장해도 계속 발송됨(또는 켜도 무시됨). 설정 화면과 실제 발송 로직이 서로 다른 이벤트 이름을 써서 매칭이 안 됨.
- **근거**: 설정 UI는 키를 `workspace_mention`·`donation_confirmed`·`support_status_change`(underscore)로 저장하나, 디스패처가 dispatch하는 NotifyEvent는 `workspace.mention`·`billing.success`·`support.reply`(점 표기). `_resolveChannels`가 `WHERE event_type=${event}`(점 표기)로 조회 → 사용자가 저장한 underscore row와 절대 매칭 안 됨 → 항상 기본값 폴백 → 사용자의 on/off 무시.
- **권장 수정**: 설정 UI eventType 키를 `lib/notify-events.ts` NotifyEvent enum(점 표기·단일 출처)과 1:1 통일(donation_confirmed→billing.success 등). 또는 PUT 저장 시 서버에서 enum 화이트리스트로 정규화.
- **확신도**: 확실

#### [US-059] 리워드 교환 시 재고 차감이 없어 재고 0짜리도 무한 교환 가능  〔결함·P1〕 ★메인검증 완료
- **위치**: `netlify/functions/reward-redeem.ts:36-69`
- **증상**: 재고 1개로 등록된 리워드를 여러 사용자/여러 번 교환해도 모두 성공. 재고 한도가 무의미해 약속 수량보다 많은 교환이 쌓임.
- **근거**: `if(reward.stock !== null && reward.stock <= 0)`로 재고만 확인하고, 교환 성공 후 `rewards.stock`을 감소시키는 UPDATE가 어디에도 없음(전체·admin-reward-redemptions에 stock 미참조). **(메인 직접 확인 완료 — line 36 외 stock 참조 0건)**
- **권장 수정**: 교환 성공 시 `UPDATE rewards SET stock=stock-1 WHERE id=? AND stock>0`, affected=0이면 '재고 소진' 롤백. 포인트 차감·redemption INSERT와 트랜잭션 묶기.
- **확신도**: 확실

#### [US-060] 리워드 교환에 트랜잭션·잔액잠금 없음 — 동시 요청 시 음수 잔액(이중 차감) 가능  〔결함·P1〕
- **위치**: `netlify/functions/reward-redeem.ts:41-69`
- **증상**: 잔액 100P인데 100P 리워드를 동시에 두 번 교환하면 둘 다 성공해 잔액이 -100P로 떨어질 수 있음.
- **근거**: 잔액을 `SELECT SUM(delta)`로 읽고→검사→redemption INSERT→음수 포인트 로그 INSERT를 트랜잭션 없이 순차 수행. FOR UPDATE·원자적 차감·멱등 키 없음 → TOCTOU 경쟁.
- **권장 수정**: 교환을 단일 트랜잭션으로 감싸고 잔액 가드를 조건부 원자 차감 또는 SELECT FOR UPDATE로 결합. 클라이언트 멱등 토큰으로 중복 제출 차단.
- **확신도**: 추정

#### [US-061] 리워드 교환 취소/반려 시 포인트 미환불 — 후속 경로 부재  〔갭·P1〕
- **역할/시나리오**: 회원이 포인트로 교환 신청(pending) → 운영자가 재고 부족 등으로 취소(cancelled)
- **위치**: `netlify/functions/admin-reward-redemptions.ts:43-67` (대응: reward-redeem.ts:63-69 차감)
- **증상**: 교환이 취소돼도 차감된 포인트가 회원에게 안 돌아옴. 회원은 받지도 못한 리워드 때문에 포인트만 잃고 환불 창구도 없음.
- **근거**: 교환 시 `delta:-pointCost` 음수 로그로 즉시 차감. cancelled 처리는 상태만 바꾸고 환불 양수 로그 INSERT 없음(processed/cancelled 어느 경로에도 복원 부재).
- **권장 수정**: cancelled 전이 시 동일 referenceId로 `delta:+pointCost` 환불 로그 멱등 INSERT(중복 환불 방지) + 재고 복원 + 회원 환불 알림.
- **확신도**: 확실

#### [US-062] 마이페이지 '받은 메시지' 탭이 미등록 엔드포인트(/api/my-send-history) 호출 — 항상 빈 화면  〔결함·P2〕
- **위치**: `public/mypage.html:1340`
- **증상**: '받은 메시지' 탭이 실제 수신 내역이 있어도 항상 '받은 메시지가 없습니다'.
- **근거**: `fetch('/api/my-send-history')`를 호출하나 그 경로 등록 함수가 없음(grep 0건). 실제 함수는 `user-my-send-history.ts`가 `path:'/api/user-my-send-history'`로 등록. 미등록 경로 404→.catch로 삼킴. 응답 파싱도 `json.logs` 기대하나 실제는 rows/total로 키 불일치.
- **권장 수정**: fetch 경로를 `/api/user-my-send-history`로 정정, 파싱을 rows 기준으로(독립 페이지 my-send-history.js와 동일). 또는 탭을 my-send-history.html로 연결.
- **확신도**: 확실

#### [US-063] 받은 메시지 목록의 제목·본문·시각 필드명 불일치 — 제목 '협회 메시지' 고정·본문 '(내용 없음)'  〔결함·P2〕
- **위치**: `public/js/my-send-history.js:93-110,132-141` vs `netlify/functions/user-my-send-history.ts:28-47`
- **증상**: 받은 메시지가 표시돼도 제목이 모두 '협회 메시지', 일시가 '-', 클릭하면 본문이 항상 '(내용 없음)'.
- **근거**: 서버는 raw SQL로 `j.name AS job_name, r.sent_at, r.channel`만 반환(snake_case, rendered_subject·rendered_body 미선택). 프론트는 `r.jobName·r.sentAt·r.renderedSubject·r.renderedBody`(camelCase) 읽음 → 전부 undefined.
- **권장 수정**: SELECT에 rendered_subject·rendered_body 추가 + 별칭(AS "jobName"/"sentAt"/"renderedSubject"/"renderedBody") 부여, 또는 프론트가 snake_case로 읽도록 정정.
- **확신도**: 확실

#### [US-064] 받은 메시지 페이지 '마이페이지' 백링크가 존재하지 않는 /my.html로 이동(404)  〔결함·P3〕
- **위치**: `public/my-send-history.html:110`
- **증상**: '← 마이페이지'를 누르면 마이페이지가 아닌 404로 빠짐.
- **근거**: `href="/my.html"` — 실제는 `/mypage.html`이며 /my.html 파일은 없음(glob 0건).
- **권장 수정**: href·onclick의 '/my.html'을 '/mypage.html'로 정정.
- **확신도**: 확실

#### [US-065] 알림설정 화면이 빈 응답/실패 시 정의되지 않은 MOCK 상수를 참조 — 신규 회원은 설정 불가  〔결함·P2·런타임오류〕
- **역할/시나리오**: 아직 알림 이력이 없는 신규 회원이 알림 수신 설정 화면을 열어 채널을 미리 켜두려 함
- **위치**: `public/js/settings-notifications.js:74,83`(정의 부재) · `netlify/functions/notification-preferences.ts:23-38`
- **증상**: 신규 회원이 설정 화면을 열면 모든 분류가 '표시할 이벤트가 없습니다'로 비어 미리 설정 불가, 폴백 경로에선 스크립트 오류.
- **근거**: GET은 회원의 preferences row만 반환 → 신규는 [] → 빈 화면. 빈/실패 분기는 `MOCK_NOTIFICATION_PREFS.preferences`를 참조하나 이 상수가 어디에도 정의 안 됨 → ReferenceError.
- **권장 수정**: GET이 이벤트 카탈로그(NotifyEvent 목록)+어드민 기본 채널을 함께 내려 한 번도 설정 안 해도 전 이벤트가 표시되게, 또는 프론트에 실제 기본 카탈로그 정의(미정의 MOCK 참조 제거).
- **확신도**: 확실

#### [US-066] 일일 로그인 포인트 적립 일자 판정이 UTC 기준 — KST 자정 경계에서 중복/누락 가능  〔결함·P3·시간대〕
- **위치**: `netlify/functions/auth-login.ts:156-173`
- **증상**: 일일 로그인 포인트가 한국 날짜 기준 하루 1회가 아니라 UTC 경계에 따라 같은 한국 날짜에 두 번 적립되거나 누락될 수 있음.
- **근거**: `new Date().toDateString()` 비교가 서버 로컬(UTC) 기준 날짜라 KST(+9h)와 어긋남. KST 자정~09:00 구간은 UTC상 전날.
- **권장 수정**: KST 기준 yyyy-mm-dd로 비교, 또는 (memberId, eventType, kst_date) UNIQUE + INSERT ON CONFLICT DO NOTHING.
- **확신도**: 추정

**점검했으나 정상(안심)**: 랭킹은 비로그인 공개이나 실명 대신 첫 글자+*** 마스킹·포인트만 노출(PII 미노출) / 포인트·뱃지·멘션·발송내역·알림설정 모두 requireActiveUser + where memberId=uid(IDOR 차단) / 멘션 읽음 처리는 mentionedId=본인 조건(타인 멘션 임의 읽음 불가) / 알림 디스패처는 강제 채널(결제·법적 billing.failed·card.expiring)을 설정과 무관하게 항상 포함, 전화 미인증 시 sms/kakao 필터 / auth-me는 suspended/withdrawn 401 차단·본인 정보만 / 리워드 교환은 잔액부족·비활성·재고0 사전 차단·추적성 로그(재고차감·환불·동시성은 별도 결함).

