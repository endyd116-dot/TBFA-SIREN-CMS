# 발송 업체 이전: 알리고+Oracle프록시 → 솔라피(SOLAPI)

> 2026-05-23 시작. 배경/인프라 상세는 메모리 `reference_sms_kakao_proxy.md` 참조.

> **🏁 2026-05-27 종결 — 알림톡 DB 관리 시스템으로 완성.** 아래 "재개 절차"의 *"env 7개(SOLAPI_TPL_*) 설정"*은 **폐기**됨. 카카오 알림톡은 이제 **운영자 CMS에서 등록→검수→승인 자동 관리**(테이블 `kakao_alimtalk_templates` + 솔라피 관리 API + cron 상태추적 + `admin-kakao-templates` 화면)하며, 어댑터가 **DB에서 이벤트별 승인 템플릿ID·pfId 조회**(env 추가 0개·pfId 자동조회). 기존 승인 6종은 마이그(`migrate-kakao-templates`·호출·삭제 완료)로 시드. 검증 `docs/history/verify/2026-05-27-kakao-templates.md`. SMS·MMS·프록시폐기는 기완료 → **솔라피 이전 전체 종결**. (KICC 대기 2는 별도 트랙·유지.)

## ★ 재개 절차 (2026-05-23 세션 종료 시점 — 새 세션은 여기부터)

**코드는 사실상 100% 완료·배포됨.** 알림톡은 env 미설정이라 placeholder(미발송)로 대기 중. 외부 승인 2건만 기다리는 상태.

### 완료 (배포됨)
- ✅ SMS(휴대폰 인증) 솔라피 전환·라이브 검증. SMS는 시스템·AI·수동 발송 전부 솔라피.
- ✅ 인증 유효 10분→3분 + 3:00 카운트다운 타이머.
- ✅ 알림톡 6종 솔라피 등록 + 카카오 검수요청(INSPECTING). pfId·templateId 아래 표.
- ✅ 알림톡 어댑터(`lib/notify-adapters/kakao-aligo.ts`) 6종 전부 + 신규 이벤트 3종(`notify-events.ts`).
- ✅ 발송 트리거 6종 전부 연결: 결제실패·카드만료·출금완료(기존 cron-kicc-billing) / 출금예정(`cron-billing-upcoming`)·영수증(`cron-donation-receipt-annual`) 신규 cron / 후원변경(`billing-approve` 재등록 시).
- ✅ 발송템플릿 DB 카카오 코드 UH→솔라피 재연결(migration 호출 완료·파일 삭제).

### 대기 1 — 카카오 알림톡 승인 (1~3 영업일) → 승인되면 (내가):
1. **Netlify env 7개 설정** (아래 값) → placeholder 자동 해제 → 6종 솔라피 발송 시작:
   - `SOLAPI_KAKAO_PFID=KA01PF260523120325582xPyYFhJqfpX`
   - `SOLAPI_TPL_BILLING_FAILED=KA01TP2605231214003525WUwOGmim0W`
   - `SOLAPI_TPL_CARD_EXPIRING=KA01TP260523121256837nKbXfT9yJmh`
   - `SOLAPI_TPL_BILLING_SUCCESS=KA01TP260523121400847w7Zc33l4Rh2`
   - `SOLAPI_TPL_BILLING_UPCOMING=KA01TP260523121401287K1HFcLOPAtS`
   - `SOLAPI_TPL_RECEIPT=KA01TP260523121401738OKTpRObBtvl`
   - `SOLAPI_TPL_DONOR_CHANGE=KA01TP260523121402219EEVDf8bclV2`
2. 알림톡 라이브 테스트(실제 카톡 도착 확인).

### ✅ 2026-05-23 추가 완료 (프록시 폐기까지 끝냄 — 코드상 알리고/프록시 흔적 0)
- **MMS 솔라피 교체·실발송 테스트 완료**(`solapiSendMms` — 스토리지 업로드→imageId→MMS, statusCode 2000 확인).
- **프록시·OCI 코드 전면 폐기**: `proxy-server/`·`lib/oci-client.ts`·`netlify/functions/cron-warmup.ts`·`lib/aligo-kakao-client.ts` 삭제 + netlify.toml cron-warmup 제거 + `.env.example` 알리고→솔라피 교체. `aligo-client.ts`는 SMS·MMS 둘 다 솔라피 위임. `communication-send.ts` 마케팅 카카오는 정책 스킵.
- **남은 것 = Oracle VM(인스턴스) 실제 삭제**: Swain이 OCI 콘솔 → `aligo-proxy` 인스턴스 + 예약 IP 삭제 (코드는 이미 안 쓰니 아무 때나). cron-warmup 제거로 자동 ping/재부팅도 중단됨.

### 대기 2 — KICC MID 권한 (별도 트랙·`docs/active/2026-05-21-r40-kicc.md`): Swain이 KICC에 권한 요청 → 풀리면 일시 가상계좌 구현 + 정기 효성 노출 점검 + 라이브 결제.

### 환경변수 현황 (Netlify·설정됨)
`SOLAPI_API_KEY`·`SOLAPI_API_SECRET`·`SOLAPI_SENDER`(=01028075242·Swain 개인폰 임시). SMS 발송 중. 솔라피 한도: 사업자인증+한도증설 신청 진행 중(기본 50건/일).

## 알림톡 6종 (알리고 원본 = 카카오 승인본·솔라피 재등록 기준)
모두 **강조표기형**(노란 강조제목 바). 변수는 `#{한글변수}`. 버튼은 별도 표기 외 전부 웹링크 "교사유가족협의회 홈이동" → `https://tbfa.co.kr/`(모바일/PC 동일).

### UH_7533 — 정기 결제 실패
강조제목: `정기 결제 실패`
```
[교사유가족협의회] #{회원이름}님, 이번 달 후원 결제 안내드려요

#{회원이름}님, 안녕하세요.
교사유가족협의회입니다.

이번 달 보내주시기로 한 정기 후원 #{금액}원이
안타깝게도 결제되지 못했어요.

▪ 사유: #{실패사유}
▪ 연속 실패: #{연속실패횟수}회
▪ 다음 시도일: #{재시도일자}

카드 한도와 잔액, 카드 정보를
한 번만 살펴봐 주시면 좋겠습니다.

#{회원이름}님의 따뜻한 마음이
유가족 곁에 끊김 없이 닿을 수 있도록
[후원 정보 확인] 버튼으로 잠시 점검해 주세요.

언제나 함께해 주셔서 진심으로 감사드립니다.
```
변수: 회원이름·금액·실패사유·연속실패횟수·재시도일자 / 버튼: **채널추가**("채널추가") + 대체발송 LMS(장문). (알리고 원본대로 — 본문의 [후원 정보 확인]은 텍스트)
코드 매핑: 회원이름←name, 금액←amountFmt, 실패사유←failureReason, 연속실패횟수←failCount, 재시도일자←retryStr (env `ALIGO_TEMPLATE_BILLING_FAILED`, NotifyEvent.BILLING_FAILED)

### UH_9634 — 등록 카드 만료 안내
강조제목: `등록 카드 만료 안내`
```
[교사유가족협의회] #{회원이름}님, 등록 카드 만료일을 안내드려요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

정기 후원에 등록하신 카드의 만료일이 가까워졌어요.

- 카드 만료일: #{카드만료일}
- 잔여 일수: #{잔여일수}일

만료일 이후에는 정기 출금이 잠시 멈출 수 있어 미리 안내드려요. 카드 정보는 마이페이지에서 한 번 살펴봐 주시면 좋겠습니다.

#{회원이름}님의 따뜻한 마음이 유가족 곁에 끊김 없이 닿을 수 있기를 바라며,

언제나 함께해 주셔서 진심으로 감사드립니다.
```
변수: 회원이름·카드만료일·잔여일수 / 버튼: 웹링크 "교사유가족협의회 홈이동"
코드 매핑: 회원이름←name, 카드만료일←cardExpiryStr, 잔여일수←daysUntilExpiry (env `ALIGO_TEMPLATE_CARD_EXPIRING`, NotifyEvent.CARD_EXPIRING)

### UH_9633 — 정기 후원금 출금 완료 안내
강조제목: `정기 후원금 출금 완료 안내`
```
[교사유가족협의회] #{회원이름}님, 후원 출금이 무사히 완료되었어요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

이번 달 정기 후원 #{출금금액}원이 무사히 출금되었습니다.

- 출금 일시: #{출금일시}
- 누적 후원: #{누적후원금액}원

#{회원이름}님께서 보내주신 따뜻한 마음이 유가족 곁에 또 한 걸음 닿았습니다.

기부금 영수증은 마이페이지에서 확인하실 수 있어요.
언제나 함께해 주셔서 진심으로 감사드립니다.
```
변수: 회원이름·출금금액·출금일시·누적후원금액 / 버튼: 웹링크 "교사유가족협의회 홈이동"
코드: 미구현(NotifyEvent.BILLING_SUCCESS 어댑터 미지원) → 교체 시 발송 로직 신규 연결 필요(cron-kicc-billing 성공 분기)

### UH_9632 — 정기 후원금 자동 출금 예정 안내
강조제목: `정기 후원금 자동 출금 예정 안내`
```
[교사유가족협의회] #{회원이름}님, 이번 달 후원 출금을 안내드려요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

이번 달 정기 후원 #{출금금액}원이 다음과 같이 자동 출금될 예정이에요.

- 출금 예정일: #{출금예정일}
- 결제 수단: #{결제수단}

#{회원이름}님의 따뜻한 마음이 유가족 곁에 한결같이 닿고 있습니다.

언제나 함께해 주셔서 진심으로 감사드려요.
```
변수: 회원이름·출금금액·출금예정일·결제수단 / 버튼: 웹링크 "교사유가족협의회 홈이동"
코드: 미구현 → 교체 시 "출금 N일 전 사전 안내" 발송 로직 신규 필요

### UH_9636 — 연간 기부금 영수증 발급 안내
강조제목: `연간 기부금 영수증 발급 안내`
```
[교사유가족협의회] #{회원이름}님, 기부금 영수증 발급을 안내드려요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

#{연도}년도 한 해 동안 보내주신 마음을 정리해 안내드려요.

- 연간 후원 총액: #{연간후원금액}원
- 발급 가능 기간: #{발급가능기간}
- 영수증 종류: #{영수증종류}

기부금 영수증은 마이페이지에서 발급받으실 수 있어요.

#{연도}년 한 해 동안 #{회원이름}님께서 보내주신 따뜻한 마음이 유가족 곁에 깊이 닿았습니다.

언제나 함께해 주셔서 진심으로 감사드립니다.
```
변수: 회원이름·연도·연간후원금액·발급가능기간·영수증종류 / 버튼: 웹링크 "교사유가족협의회 홈이동"
코드: 미구현 → 연말 영수증 발급 안내 발송 로직 신규 필요

### UH_9635 — 후원 정보 변경 처리 완료
강조제목: `후원 정보 변경 처리 완료`
```
[교사유가족협의회] #{회원이름}님, 후원 정보 변경이 완료되었어요

#{회원이름}님, 안녕하세요. 교사유가족협의회입니다.

요청하신 후원 정보 변경이 처리 완료되었습니다.
- 변경 항목: #{변경항목}
- 변경 후 내용: #{변경후내용}
- 처리 일시: #{처리일시}

변경된 내용은 마이페이지에서 확인하실 수 있어요.

#{회원이름}님과 함께 걷는 이 길에 깊이 감사드립니다.
```
변수: 회원이름·변경항목·변경후내용·처리일시 / 버튼: 웹링크 "교사유가족협의회 홈이동"
코드: 미구현 → 후원 정보 변경 시 발송 로직 신규 필요

## 솔라피 등록 결과 (2026-05-23 — API로 등록·검수요청 완료, 카카오 심사중)
- 발신프로필(pfId/channelId): `KA01PF260523120325582xPyYFhJqfpX` (@교사유가족협의회)
- 카테고리: 전부 `004001`(이용안내/공지) · 강조표기형(emphasizeTitle=각 제목, emphasizeSubtitle="교사유가족협의회") · 버튼 웹링크
- 등록 API: `POST /kakao/v2/templates` (필드: **channelId**·name·content·categoryCode·emphasizeType:"TEXT"·emphasizeTitle·emphasizeSubtitle·buttons[{buttonType:"WL",buttonName,linkMo,linkPc}]). 검수요청: `PUT /kakao/v2/templates/{id}/inspection`.

| 템플릿 | templateId | 변수(한글) |
|---|---|---|
| 등록 카드 만료 안내 | `KA01TP260523121256837nKbXfT9yJmh` | 회원이름·카드만료일·잔여일수 |
| 정기 결제 실패 | `KA01TP2605231214003525WUwOGmim0W` | 회원이름·금액·실패사유·연속실패횟수·재시도일자 |
| 정기 후원금 출금 완료 안내 | `KA01TP260523121400847w7Zc33l4Rh2` | 회원이름·출금금액·출금일시·누적후원금액 |
| 정기 후원금 자동 출금 예정 안내 | `KA01TP260523121401287K1HFcLOPAtS` | 회원이름·출금금액·출금예정일·결제수단 |
| 연간 기부금 영수증 발급 안내 | `KA01TP260523121401738OKTpRObBtvl` | 회원이름·연도·연간후원금액·발급가능기간·영수증종류 |
| 후원 정보 변경 처리 완료 | `KA01TP260523121402219EEVDf8bclV2` | 회원이름·변경항목·변경후내용·처리일시 |

→ env 후보: `SOLAPI_KAKAO_PFID` + 템플릿별 `SOLAPI_TPL_CARD_EXPIRING`·`SOLAPI_TPL_BILLING_FAILED`·`SOLAPI_TPL_BILLING_SUCCESS`·`SOLAPI_TPL_BILLING_UPCOMING`·`SOLAPI_TPL_RECEIPT`·`SOLAPI_TPL_DONOR_CHANGE`. 카카오 승인(APPROVED) 후 코드 연결.

## 잔존 알리고 경로 전수조사 (2026-05-23) + 4종 트리거 결정

**Swain 확정 4종 발송 시점**: 출금완료=정기결제 성공 직후 / 출금예정=출금 3일 전 / 영수증=매년 1월 중순 / 후원변경=변경 처리 즉시.

**발송 경로 2갈래**:
- (A) 시스템 이벤트 = `notify-dispatcher` → 어댑터(`sms-aligo`✅솔라피위임 / `kakao-aligo`✅솔라피 2종). BILLING_FAILED·CARD_EXPIRING dispatch는 `cron-kicc-billing.ts:342`·`cron-billing-card-expiry.ts:176`.
- (B) 마케팅/AI자동/수동 발송 = `communication-send.ts`(`sendViaAdapter`) ← `cron-communication-send-dispatcher`·`cron-auto-trigger-evaluator`. SMS는 `aligoSend()`(✅솔라피). **카카오는 `sendKakaoDirect()`가 알리고 직접 호출이나 "임의본문 불가 정책"으로 이미 skip 처리**(주석 line4-5). MMS는 `aligoSendMms()`(⚠️알리고).

**아직 알리고 쓰는 곳(교체/폐기 대상)**:
| 파일·함수 | 처리 |
|---|---|
| `lib/aligo-kakao-client.ts` 전체 | 폐기(어댑터가 솔라피로 대체) |
| `lib/communication-send.ts sendKakaoDirect()` | 현재 skip 중 — 솔라피도 등록템플릿만 → 유지(또는 등록 6종 매핑) |
| `lib/aligo-client.ts aligoSendMms()` | 솔라피 이미지(Storage 업로드→imageId)로 재구현 |
| `cron-kicc-billing.ts:264` BILLING_SUCCESS | 출금완료 알림톡 트리거 미연결(현재 이메일만) |

**4종 트리거 구현 메모**:
- 출금완료(UH_9633): BILLING_SUCCESS는 이미 dispatch됨(params: amount·chargedAt·nextChargeAt). 어댑터에 case 추가 + **누적후원금액은 별도 쿼리** 필요. 변수 회원이름·출금금액·출금일시·누적후원금액.
- 출금예정(UH_9632): **신규 cron** — billingKeys.nextChargeAt = today+3 스캔 → 신규 이벤트 dispatch. 변수 회원이름·출금금액·출금예정일·결제수단.
- 영수증(UH_9636): **신규 cron**(연 1회·1월 중순) — 전년 완료 후원 합산. 변수 회원이름·연도·연간후원금액·발급가능기간·영수증종류.
- 후원변경(UH_9635): 후원정보(카드·금액) 변경 처리 함수에 dispatch 추가(사이트 미확정 — 추가 조사 필요). 변수 회원이름·변경항목·변경후내용·처리일시.

**권장 실행 순서 = 카카오 승인(APPROVED) 직후 일괄**: env(pfId+6 templateId) 설정 → push 배포 → 알림톡 2종 라이브 테스트 → 4종 트리거 구현 → MMS 솔라피 → 발송템플릿 DB 카카오본문 정리(SMS대체용) → 프록시·OCI 폐기. (미승인 시 알림톡 발송 불가라 블라인드 코딩 지양)

## 코드 교체 시 할 일 (승인·pfId·templateId 확보 후)
1. `lib/solapi-client.ts solapiSendAlimtalk` 사용 — env `SOLAPI_KAKAO_PFID` + 템플릿별 `SOLAPI_TEMPLATE_*`(templateId).
2. `lib/notify-adapters/kakao-aligo.ts` → 솔라피 어댑터로 교체. 변수 맵을 한글 변수명으로 구성(회원이름·금액 등).
3. 기존 2종(결제실패·카드만료) 외 4종은 발송 트리거 로직 신규 연결(출금완료/예정·영수증·후원변경).
4. `aligoSendMms` 솔라피 이미지 발송으로 교체.
5. 프록시·OCI 잔재 제거 + Oracle 박스 폐기.
