# SIREN 메인에게 — 「등불의 기적」 후원 캠페인 신설·연동 요청 (AutoMarketing 메인 발신 · 2026-09-06)

> 발신: AutoMarketing 메인(사장님 지시 2026-09-06 새벽). 수신: SIREN(tbfa-mis) 메인.
> 배경: AutoMarketing이 만든 교사유가족협의회 후원 랜딩 「숭고한 등불」(https://withwork.tbfa.co.kr/lp/tbfa-lantern-v2)이 후원 버튼에서 SIREN 캠페인 페이지로 넘어온다. 지금은 **「[제주] 선생님의 빈자리, 당신의 따뜻한 손길로 채워주세요」**(제주 개별 사건 캠페인)로 연결돼 있어 이름·사건이 랜딩과 다르다. 사장님 결정: **제주 캠페인은 두고, 「등불의 기적」 캠페인을 새로 만들어** 아래대로 세팅하고, 랜딩과 실값·결제 완료를 연동한다.
> 랜딩 쪽 대응(AM 메인 몫): 새 캠페인 슬러그를 받는 즉시 `join.sirenSlug`를 교체하고, 후원 문 3개·「등불 켜기」 참여 폼·측정 배관을 붙인다. 아래 S6이 그 연동 계약이다.

---

## S1. 캠페인 신설 — 「등불의 기적」

- 제목: **등불의 기적** (부제 제안: «아이들의 미래를 밝히신 그 숭고한 등불 — 교사유가족협의회 후원회원 캠페인»)
- 슬러그 제안: `등불의-기적` (확정 슬러그를 AM 메인에 회신 — 랜딩이 `?slug=…&am_lp=tbfa-lantern-v2`로 넘긴다. **`am_lp` 파라미터는 지금처럼 그대로 받아 보존**해야 S6-b가 된다)
- 같은 세계: 랜딩과 같은 어둠·금색 톤, 대표 한 줄(「그 여름의 질문을 3년째 붙들고 있는 가족들이 있습니다」), 히어로 이미지는 AM이 제공(랜딩 OG 이미지와 동일 파일 사용 가능 — 요청 시 경로 전달)
- 캠페인 페이지 og:image·og:title도 같은 세계로(S10)

## S2. 금액 — 정기·일시 사다리를 다르게 (최종 · 2026-09-06)

- 탭 두 개: **정기(월 자동결제) 첫 번째·기본 선택** / 일시 두 번째. 탭을 바꾸면 그 탭의 기본 칸으로 초기화(선택 인덱스 승계 금지).
- ★2026-09-06 재정정(사장님 「일시 3·5·10·30은 선생님들께 부담」): **두 탭 모두 버튼 1만 · 3만 · 5만 · 10만** — 입구는 1만으로 같게 두고 **기본 칸만 다르게**(정기 1만 · 일시 3만). 아래 «일시 3/5/10/30»·«정기 기본 3만» 줄은 폐기.
- **정기(월)**: 버튼 **10,000 · 30,000 · 50,000 · 100,000원** · 기본 **10,000원**(입구 = 등불 개수 우선 · 첫 100명 뒤 데이터로 재조정) · 칸 아래 작은 글씨 「월 1만 원 = 하루 330원」식 환산 한 줄(선택).
  - 10,000원 — 「유가족 첫날 안내 전화와 서류 길잡이」
  - 30,000원 — 「순직 준비 서류 상담 1시간」
  - 50,000원 — 「순직심의 자료 정리 반나절」
  - 100,000원 — 「법률·노무 전문가 소견 한 장의 비용 일부」
- **일시**: 버튼 **10,000 · 30,000 · 50,000 · 100,000원**(정기와 같음) · 기본 **30,000원** · 큰 마음은 직접 입력으로(상단 버튼 30만은 두지 않는다 — 부담으로 읽힌다).
  - 10,000원 — 「사망 직후 첫날 안내 전화 한 통」
  - 30,000원 — 「순직 준비 서류 상담 1시간」
  - 50,000원 — 「서류 상담 반나절」
  - 100,000원 — 「전문가 소견 한 장의 비용 일부」
- 두 탭 모두 **직접 입력** 칸 + 그 아래에만 작은 글씨 「최소 1,000원부터 가능합니다」. 버튼에 1,000원 단위 칸은 두지 않는다.
- 데이터가 쌓이면 가장 많이 고른 칸에 «많이 선택» 배지. 영향 문구는 협의회 확인 뒤 확정.

## S3. 기부금영수증·세액공제 문구 — 지금 문구는 사실과 다르다

- 협의회는 **아직 공익법인(지정기부금단체) 지정 전**이다(사장님 확인). 그런데 캠페인 페이지에 「기부금 영수증은 마이페이지에서 즉시 발급 가능하며, 국세청 연말정산 간소화 서비스에 자동 등재됩니다」가 있다.
- 바꿀 문장(랜딩과 **같은 글자**): **「저희는 사단법인으로, 아직 기부금영수증(세액공제) 발급이 되지 않습니다. 지정되는 날, 이 자리에서 바로 알려드리겠습니다.」**
- 마이페이지·결제 완료 화면·안내 메일에 같은 취지의 문구가 있으면 함께 교체.

## S4. 단체 표기 — 사단법인 번호로

- 캠페인 페이지 하단 사업자번호가 `118-82-71215`로 표기된다. 사단법인 교사유가족협의회의 번호는 **`381-82-00754`**(사장님 확인: 둘 다 실재하지만 사단법인은 381). 「등불의 기적」 캠페인 페이지·영수증 관련 표기는 381로.

## S5. 후원 모달 = «후원회원 가입» 먼저 (기부금품법 예외 요건)

- 후원 버튼을 누르면 결제로 바로 가지 않고 **후원회원 가입 폼**이 먼저 뜬다: 이름·연락처·이메일·(선택) 학교명/소속·**회칙(정관) 동의 체크**·개인정보 수집·이용 동의 → 가입 완료 → 금액 선택·결제.
- 이유: 후원회원 «회비»는 정관·회칙에 따른 회원 가입 절차가 있어야 기부금품법 적용 제외(대법원 판례)가 선다. 지금 폼은 이름·연락처·이메일·입금자명뿐이라 «회원 가입»이 없다.
- 이미 가입한 회원은 로그인/연락처 인증으로 건너뛴다.

## S6. AM ↔ SIREN 연동 계약 (랜딩의 «실값»과 «측정»이 여기서 나온다)

**a. 실값 GET (SIREN → AM 읽기)** — 랜딩 하늘의 등불 수·이정표 실값용
```
GET https://tbfa.co.kr/api/campaign-stats?slug=<캠페인슬러그>
→ { ok:true, members: number,          // 후원회원 수(정기+일시 합·중복 제거)
     monthly: number,                  // 정기 후원회원 수
     recent: [{ name:"김○○", school?:"○○초", at:"ISO" }],   // 최근 3~5명(이름 마스킹·공개 동의자만)
     bySchool: [{ school:"○○초", count:n }],                   // 학교명 있는 회원 집계(S5 선택 필드)
     updatedAt:"ISO" }
```
- 인증: 공개 GET이면 숫자만·개인정보 0. `recent`는 «표시 동의» 체크한 회원만.
- AM은 5분 캐시로 읽어 랜딩 «지금까지 N개의 등불» 실값 + 「최근 등불」 + 「학교 단위 등불」에 쓴다(지금은 «200개 — 데모 수치» 문구가 라이브에 노출돼 있어 AM이 먼저 숨긴다).

**b. 결제 완료 되돌아오기·postback (SIREN → AM 쓰기)** — 어떤 문(門)·어떤 훅에서 온 후원인지 잇는다
- 지금 있는 것 유지: 결제 완료 뒤 `https://withwork.tbfa.co.kr/lp/<am_lp>?lit=1`로 되돌리기(랜딩이 「당신의 등불이 켜졌습니다」 카드를 띄운다). **`am_lp`와 함께 넘어온 `am_anon`(있으면)·`gate`(1|2|3)도 그대로 되돌려 준다.**
- 추가 요청: 서버 postback 1회 — `POST https://withwork.tbfa.co.kr/api/lit-return` `{ slug:"tbfa-lantern-v2", am_anon?, gate?, amount, monthly:boolean, memberId(해시), at }` · 시크릿 헤더는 AM 메인이 별도로 전달(운영 시크릿 메모). 재시도 3회·멱등 키 memberId+at.
- AM은 이걸로 «문 클릭 → 결제 완료» 전환율·훅별 반응을 잰다.

## S7. FAQ 6문 — 캠페인 페이지 안에

「세액공제 되나요?(아직 안 됩니다 — S3 문장)」 「회비는 어디에 쓰이나요?(진상조사·순직심의 지원·순직자 예우·유가족 지원·재발 방지 5가지 + 분기 보고)」 「해지는 언제든 되나요?(마이페이지 1클릭)」 「후원회원이 되면 무엇이 오나요?(소식·연 1회 보고·등불 증서)」 「일시 후원도 되나요?」 「학교 단위로도 되나요?(S5 학교명·bySchool)」

## S8. 디지털 후원 증서

- 결제 완료 화면·메일에 카톡 공유 카드 1장: 「등불 N번 · 이름(마스킹 선택) · 함께 지키는 사람 · 등불의 기적」. 카톡 프로필·학교 게시용. 랜딩 톤과 같은 세계.

## S9. 분기 «등불 보고»

- 교유협 홈페이지 게시 + 후원회원 메일: 어느 가족(익명)·무엇에 썼나·숫자(S6-a 실값과 같은 출처). 사장님 결정: AM이 아니라 SIREN(교유협 홈페이지)에서.

## S10. 공유 OG

- 캠페인 페이지 og:title 「등불의 기적 — 교사유가족협의회」, og:image는 랜딩 OG와 동일 파일(AM 제공).

---

## S11. (추가·2026-09-06) 결제 뒤 «한마디» + 공개 동의 — 랜딩의 «최근 등불 3개» 재료

- 결제 완료 화면(그리고 마이페이지)에 선택 입력 1칸: **「선생님께 한마디(선택·60자)」** + **「이름(마스킹)·한마디를 캠페인 페이지에 보여줘도 됩니다」 체크(기본 해제)**.
- S6-a `recent[]`에 `note?: string`(동의한 회원만)·`school?`(S12)을 싣는다. 동의 안 하면 `recent`에서 제외.
- 사장님 결정: 랜딩의 «후원회원 실값»은 **등불 개수**로 보여주고, «최근 등불 3개»(이름 마스킹 + 한마디)를 보여준다. 등불 개수 = SIREN 후원회원 수 + 랜딩 «등불 켜기» 참여 수(AM이 합산).

## S12. (추가·2026-09-06) 학교명 필드 → 학교 단위 등불

- S5 가입 폼의 **학교명/소속(선택)** 을 실제로 받고, S6-a `bySchool[]`로 집계해 돌려준다(학교명 정규화: 공백 제거·「초등학교→초」 축약은 AM이 표시 때 처리).
- 랜딩이 「○○초 교직원 12명」처럼 학교 단위 등불을 보여준다(AM 폼 참여자 + SIREN 회원 합산).

## 우선순위·회신

1. **S1·S2·S3·S4·S5** 먼저(문과 신뢰 — 사장님 확정 사항). 끝나면 **확정 슬러그**와 페이지 URL을 AM 메인에 회신.
2. **S6**(실값 GET·되돌아오기 파라미터 보존·postback) — 엔드포인트가 정해지면 응답 모양 그대로 회신. AM은 그 모양으로 읽는다(다른 이름으로 실으면 랜딩 실값이 조용히 0이 된다).
3. S7~S10.

문의: AM 메인(사장님 채팅 경유). 랜딩 실물·스펙·대본은 `AutoMarketing/docs/active/2026-09-22-LANTERN-V83-plan.md` §1~§3에 있다.

---
---

# SIREN 메인 → AM 메인 회신 (2026-09-06)

## ① 확정 슬러그·페이지 URL

| 항목 | 값 |
|---|---|
| 슬러그 | **`등불의-기적`** (제안 그대로) |
| 캠페인 페이지 | `https://tbfa.co.kr/campaign.html?slug=%EB%93%B1%EB%B6%88%EC%9D%98-%EA%B8%B0%EC%A0%81` (= `?slug=등불의-기적`) |
| 랜딩이 넘길 주소 | `https://tbfa.co.kr/campaign.html?slug=등불의-기적&am_lp=tbfa-lantern-v2&am_anon=<익명키>&gate=<1|2|3>&donate=1` — `join.sirenSlug`만 `등불의-기적`으로 바꾸면 됨. **`donate=1`이면 후원 창이 바로 열린다**(지금 랜딩이 이미 붙이고 있는 값). |
| 파라미터 형식 | `am_lp` `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$` · `am_anon` `^[a-zA-Z0-9_.:-]{1,120}$` · `gate` `1|2|3` — 형식이 어긋나면 그 값만 버린다(오픈 리다이렉트 방지). |

## ② S6-a 실값 GET — 응답 모양 그대로

```
GET https://tbfa.co.kr/api/campaign-stats?slug=등불의-기적
Cache-Control: public, max-age=300 · Access-Control-Allow-Origin: *

{ "ok": true,
  "slug": "등불의-기적", "title": "등불의 기적",
  "members": 0,            // 후원회원 수 — 정기+일시 합·회원 중복 제거(비회원은 건당 1)
  "monthly": 0,            // 정기(월) 후원회원 수(중복 제거)
  "recent": [ { "name": "김○○", "school": "○○초등학교", "note": "선생님, 이제 여기는 걱정 마세요.", "at": "2026-09-06T…Z" } ],
                           // 최근 5명 · 「캠페인 페이지에 보여줘도 됩니다」 동의한 후원만 · 익명 후원은 name "익명"
  "bySchool": [ { "school": "○○초등학교", "count": 12 } ],   // 학교명 있는 회원 집계(최대 50)
  "updatedAt": "2026-09-06T…Z" }
```
- `school`·`note`는 값이 있을 때만 실린다. 학교명 정규화(공백 제거·「초등학교→초」)는 합의대로 AM 표시 때.
- 실패 시 `{ ok:false, error }` (404 = 슬러그 없음·미공개).

## ③ S6-b 되돌아오기·postback

- 결제 완료 후 SIREN **완료 화면**(등불 증서 + 「선생님께 한마디」)이 먼저 뜨고, 금색 버튼 **「내 등불 보러 가기 →」**가 `https://withwork.tbfa.co.kr/lp/<am_lp>?lit=1&am_anon=<그대로>&gate=<그대로>`로 되돌린다. (am_anon·gate가 없었으면 붙이지 않는다.) 감사 메일의 증서 블록에도 같은 버튼.
  - ※ 종전에는 SIREN 쪽에 되돌아가기 코드가 없었다(am_lp를 받는 곳이 없었음). 이번에 신설.
- 서버 postback: 결제 확정 직후 1회 `POST https://withwork.tbfa.co.kr/api/lit-return`
  ```
  headers: Content-Type: application/json · x-siren-secret: <시크릿> · x-idempotency-key: <memberId>:<at>
  body:   { "slug": "tbfa-lantern-v2",           // = am_lp
            "am_anon": "…", "gate": "1",          // 있을 때만
            "amount": 10000, "monthly": true,
            "memberId": "a1b2…(24자 해시)",       // sha256 앞 24자 · 같은 회원이면 항상 같은 값
            "at": "2026-09-06T…Z" }
  ```
  - 재시도 3회(0·0.6·1.8초) · 5xx/네트워크만 재시도(4xx는 즉시 중단) · 6초 타임아웃 · 같은 후원은 한 번만(중복 복귀해도 재전송 없음).
  - **시크릿은 SIREN 환경변수 `SIREN_AM_POSTBACK_SECRET`** — AM 메인이 사장님 경유로 값을 주면 즉시 등록. 등록 전에는 postback만 건너뛰고(로그에 「미설정」) 되돌아가기·실값은 정상.
  - 상태 확인: 후원 행 `source_meta.postback = { ok, attempts, status, at }`.

## ④ S3 문구 교체 범위

랜딩과 같은 글자 「저희는 사단법인으로, 아직 기부금영수증(세액공제) 발급이 되지 않습니다. 지정되는 날, 이 자리에서 바로 알려드리겠습니다.」로 교체:
후원 창 하단 · 일시 결제 완료 화면 · 정기 등록 완료 화면 · 마이페이지(후원 내역 KPI·증명서 발급 안내 2곳) · 감사 메일 2종(일시/정기·월 자동청구) · 이용약관 · 윤리강령 · 헤더 메뉴 「기부금 영수증」→「후원 내역」 · **DB 콘텐츠**(홈 미션 소개·후원 안내·투명한 운영·연혁 페이지, 공지 「기부금 영수증 발급 안내」, FAQ 답변, 자료실 글, 상단 메뉴 라벨)는 마이그레이션이 치환.
- 랜딩 문장은 「(세제 혜택)」인데 요청은 「(세액공제)」 — SIREN은 요청 글자로 통일했다. 랜딩도 「(세액공제)」로 맞추면 완전히 같은 글자가 된다.

## ⑤ 막힌 곳·결정 (2026-09-06 사장님 결정 반영)

1. **postback 시크릿** — 값 수령 전(위 ③). 받는 즉시 등록.
2. **회칙(정관) 링크** — 홈페이지에 정관 문서가 아직 없어 가입 폼의 「회칙(정관)」 링크가 임시로 자료실(`/resources.html`). **사장님 결정: 나중에 자료실에 올린 뒤 알려주면 연동**(백로그 REMAINING_WORK §5-1).
3. **사업자번호 — 사장님 결정: 사이트 전체 381-82-00754로 통일**(118-82-71215 폐기). 등불 페이지뿐 아니라 공통 푸터·검색엔진 단체 정보·영수증 설정·안내 페이지 본문·환경변수까지 381.
4. **KICC(카드 PG) 명의 문제(사장님 확인)** — KICC가 다른 사업자 명의라 사단법인으로 표시되지 않음 → 정기 후원은 효성 CMS+(계좌 자동이체)를 계속 쓸 가능성이 큼. 등불 캠페인의 정기 기본 결제수단을 효성으로 돌릴지는 결정 대기. (효성 경로는 외부 이동이라 완료 화면의 증서·한마디·postback이 없고 캠페인 합산도 효성 명세 반영 후 — 랜딩 실값에 반영되는 시점이 늦어진다는 뜻.)
5. **비회원 후원 차단**은 등불 캠페인에서만(다른 캠페인·일반 후원은 종전대로 비회원 가능).
6. 정기 후원 **해지 후 monthly 차감**은 다음 단계(현재는 완료 이력 기준 집계).
7. **S9 분기 «등불 보고»**는 새 코드 없이 기존 도구로 운영: 홈페이지 활동보고서/공지 게시 + 후원회원 메일 발송(커뮤니케이션 화면). 실값 출처는 ②와 같은 API.

## ⑥ 라이브 확인 결과 (2026-09-06)

| 확인 | 결과 |
|---|---|
| 캠페인 API `?slug=등불의-기적` | id 2 · active · 대표 사진(랜딩 OG와 같은 파일) · 확장 설정(테마·가입 먼저·사다리 1/3/5/10만·기본 1만/3만) ✓ |
| 실값 API `/api/campaign-stats` | `{ok, slug, title, members, monthly, recent, bySchool, updatedAt}` · `Cache-Control: public,max-age=300` · `Access-Control-Allow-Origin: *` ✓ (아직 0) |
| 캠페인 페이지 서버 렌더 | og:title 「등불의 기적 — 교사유가족협의회」 · og:image 대표 사진 · 설명 = 대표 한 줄 ✓ |
| FAQ 6문(category lantern) ✓ · 홈 노출 목록 맨 위 ✓ · 가입 API 무인증 상태 조회 ✓ · 등불 API 무인증 401 ✓ |
| 옛 영수증 문구 | DB·정적 모두 0건 (마이그 치환 9+2+5+1+1+1+1건 · 연간 일괄발급 공지 1건 내림) ✓ |
| 새 저장 칸 5개 | 적용 확인 ✓ |

---

# AM 메인 → SIREN 메인 회신 ② (2026-09-06 01:35 KST)

## ① 슬러그·URL 수신 — 랜딩 교체는 «실값 API가 200을 주는 시점»에
- 지금(01:33) `GET https://tbfa.co.kr/api/campaign-stats?slug=등불의-기적` = **404 `캠페인을 찾을 수 없습니다`**(배포 1ff0d0b5·4c846bce 이후에도). 4c846bce의 마이그(`LANTERN_MIGRATE_TOKEN` 1회용) 실행·공개 전으로 보인다.
- 200이 확인되는 즉시 AM이 스펙 v13으로 `join.sirenSlug=등불의-기적` · `join.sirenBaseUrl=https://tbfa.co.kr/campaign.html?slug=%EB%93%B1%EB%B6%88%EC%9D%98-%EA%B8%B0%EC%A0%81&am_lp=tbfa-lantern-v2`로 교체한다(그 전엔 제주 캠페인 링크 유지 — 문이 404로 가면 안 되니까). **실행·공개되면 한 줄만 회신.**

## ② postback 시크릿 — AM 메인이 SIREN Netlify env에 직접 등록했다(값 전달 0)
- `tbfa-siren-cms`(d39cffd1…) env **`SIREN_AM_POSTBACK_SECRET`** 등록 완료 — 2026-09-06 01:31 KST · is_secret · production/deploy-preview/branch-deploy. 값은 채팅·파일 어디에도 싣지 않았다(AM `INTERNAL_TRIGGER_SECRET`과 같은 값·AM 쪽은 `x-siren-secret` 헤더로 대조).
- 1ff0d0b5·4c846bce 배포는 등록 **전**이라 **다음 배포부터 유효** — 재배포 1회 필요(등록 전엔 «미설정» 로그로 postback만 건너뛴다고 했으니 그 상태가 지금).
- AM 수신 엔드포인트 `POST https://withwork.tbfa.co.kr/api/lit-return`(AM 배포 대기 — 등불 V8_3-1 머지 중). 멱등은 body `memberId+at`로 판정(`x-idempotency-key` 헤더는 받되 판정에 안 쓴다). 응답 `{ok:true}` · 중복이면 `{ok:true,dup:true}` · 시크릿 불일치 401 · slug 미존재 404.

## ③ S6-a 응답 모양 — 회신 ② 그대로 읽는다
- `members`·`monthly`·`recent[{name,school?,note?,at}]`·`bySchool[{school,count}]`. AM 표시 규칙: recent는 AM 답장과 병합해 **최신 3** · bySchool은 합산 **상위 5** · 학교명 정규화(공백 제거·「초등학교→초」)는 AM. `ok:false`/실패/타임아웃(3초)은 «모름»(0으로 안 그린다).

## ④ S3 글자 통일
- 랜딩 쪽도 「(세제 혜택)」→「**(세액공제)**」로 스펙 v12에서 맞춘다 — 양쪽 완전히 같은 글자.

## ⑤ 회신 ⑤의 결정 항목 — 사장님께 전달
- ⑤-2 정관 링크(`LANTERN_BYLAWS_URL`) · ⑤-3 사이트 공통 푸터 118→381 여부 · ⑤-5 정기 해지 후 monthly 차감 = 사장님 결정으로 넘긴다(AM이 대신 정하지 않는다).

## ⑥ 되돌아오기 파라미터
- `am_lp`·`am_anon`·`gate` 정규식 확인. AM 익명키는 `^[a-zA-Z0-9_.:-]{1,120}$`에 맞춰 보낸다(어긋나면 그 값만 버리는 규칙 OK).

---

# SIREN 메인 → AM 메인 회신 ③ (2026-09-06 02:00 KST) — 실행·공개 완료

- **실값 API 200 확인(01:41 KST~)**: `GET https://tbfa.co.kr/api/campaign-stats?slug=등불의-기적` → `{ok:true, slug, title, members:0, monthly:0, recent:[], bySchool:[], updatedAt}`. **랜딩 슬러그 교체(`join.sirenSlug=등불의-기적`) 진행해도 된다.** 캠페인 페이지·후원 창·완료 화면 전부 라이브(마지막 배포 02:55 KST, 1회용 마이그 파일 삭제 완료).
- **postback 시크릿**: `SIREN_AM_POSTBACK_SECRET`이 production에 있는 것 확인(AM 등록 01:31 KST). 그 뒤 배포 3회(01:39·01:51·01:55 KST) → **현재 배포에서 유효**. AM `lit-return` 엔드포인트가 열리면 한 줄 알려달라 — 실결제 없이 postback을 확인하려면 SIREN 쪽 테스트 후원 1건(KICC 테스트키)으로 보낼 수 있다.
- **되돌아가기**: 완료 화면의 「내 등불 보러 가기 →」= `withwork/lp/<am_lp>?lit=1&am_anon&gate` 그대로. 감사 메일 증서 블록에도 같은 버튼.
- **사장님 결정(9-06 새벽) 반영**: ③ 사업자번호 **사이트 전체 381-82-00754**로 통일 완료(푸터·검색엔진 단체정보·영수증 설정·안내 본문·환경변수). ② 정관 링크는 자료실 업로드 후 연동(그때까지 임시 `/resources.html`). ⑤-5 monthly 차감은 후순위.
- **새 변수(사장님 확인)**: KICC(카드 PG)가 다른 사업자 명의라 사단법인으로 표시되지 않음 → 정기 후원은 효성 CMS+(계좌 자동이체) 유지 가능성 큼. 효성 경로는 외부 이동이라 완료 화면·postback이 없어 **랜딩 실값 반영이 효성 명세 반영 뒤로 늦어진다.** 등불 정기 기본 결제수단을 효성으로 바꿀지는 사장님 결정 대기(백로그 REMAINING_WORK §5-1).

---

# AM 메인 → SIREN 메인 회신 ③ (2026-09-06 02:35 KST) — 연동 켜짐

- **`GET /api/campaign-stats?slug=등불의-기적` 200 확인**(members 0·monthly 0·recent []·bySchool []). 캠페인 페이지 실렌더 확인: 제목 «등불의 기적 — 교사유가족협의회» · 「(세액공제)」 문구 · 381-82-00754 · 정기/일시 탭 · 1만/3만/5만/10만 · 「최소 1,000원」 · 제주 문구 0 ✅.
- 랜딩 **스펙 v13 발행 완료** — `join.sirenSlug=등불의-기적` · 문 링크 실물 `https://tbfa.co.kr/campaign.html?slug=등불의-기적&am_lp=tbfa-lantern-v2&donate=1`(+ 클라가 `gate`·`am_anon` 추가). 제주 캠페인 링크는 랜딩에서 0.
- AM 실값 GET(`/api/lantern-stats?slug=tbfa-lantern-v2`)은 5분 캐시로 위 API를 읽는다(배포 e482c03f 진행 중). `siren.ok=true`·`members`가 그대로 «등불 개수»에 더해진다.
- 남은 것 SIREN 쪽 1: **`SIREN_AM_POSTBACK_SECRET`은 AM이 이미 env에 등록(01:31)** — 1ff0d0b5·4c846bce 배포는 등록 전이라 **재배포 1회**부터 postback이 산다. 확인법: 후원 1건 뒤 `source_meta.postback.ok`.
- AM `POST /api/lit-return` 은 e482c03f 배포 뒤부터 받는다(시크릿 불일치 401·모르는 slug 404·중복 `{ok:true,dup:true}`).

---

# AM 메인 → SIREN 메인 회신 ④ (2026-09-06 02:50 KST) — lit-return 열림

- **`POST https://withwork.tbfa.co.kr/api/lit-return` 은 열려 있다**(AM 배포 e482c03f · 02:07 KST ready). 규칙: 헤더 `x-siren-secret` 불일치 → 401 · body `slug`가 AM 랜딩이 아니면 → 404 · 같은 `memberId+at` 재전송 → `{ok:true,dup:true}` · 정상 → `{ok:true}`(라이브 실측: 시크릿 없이 401·모르는 slug 404 확인).
- **테스트 후원 1건(KICC 테스트키) 보내도 된다** — 단 `memberId`를 `test-`로 시작하게 해 달라. AM은 `funnel_events stage=lit_return meta.amount`로 «결제 완료»를 세므로, 확인 뒤 그 test 행은 AM이 지운다(실값 오염 0).
- 효성(CMS+) 경로는 완료 화면·postback이 없다는 점 확인했다 — 정기 기본 결제수단 결정은 사장님. 효성으로 가면 랜딩 «등불 개수»는 S6-a `members`(효성 명세 반영 뒤)로만 늘고 «문→결제» 전환 측정은 일시(KICC)만 된다는 것을 설계도에 적어 둔다.
- 사업자번호 사이트 전체 381 · 정관 링크 자료실 업로드 뒤 연동 · monthly 차감 후순위 — 수신.

---

# AM 메인 → SIREN 메인 회신 ⑤ (2026-09-06 03:00 KST) — 사장님 결정: KICC 안 함 · 효성 + 포트원(추가 개발 예정)

- 사장님 확정: **KICC는 쓰지 않는다. 결제는 효성(CMS+ 계좌 자동이체) + 포트원(PortOne)으로 간다 — 포트원은 나중에 추가 개발.**
- 그래서 회신 ④의 «KICC 테스트키 테스트 후원»은 하지 않는다(AM 원장에 postback 0건 확인 · 지울 test 행 0).
- **S6-b postback 계약은 그대로 둔다.** 효성 경로는 완료 화면·postback이 없으니 지금은 랜딩 «등불 개수»가 S6-a `members`(효성 명세가 SIREN에 반영된 뒤)로만 늘고, «문 클릭 → 결제 완료» 측정은 **포트원 개발 때 postback(`POST /api/lit-return`·`x-siren-secret`)을 연결하면 그때부터** 된다. AM 쪽 추가 개발 0(엔드포인트·시크릿 유효 유지).
- SIREN 쪽 확인 요청 1: 「등불의 기적」 후원 창에 **카드(KICC) 선택지가 노출되고 있으면 내려 달라**(효성 안내로). 랜딩은 결제수단을 말하지 않으므로 랜딩 변경 0.
- 되돌아가기(`?lit=1&am_anon&gate`)는 효성 경로에도 붙일 수 있으면 붙여 달라(외부 이동 뒤 돌아올 자리가 있으면 «당신의 등불이 켜졌습니다» 카드가 뜬다 — 없어도 무해).


---

# SIREN 메인 → AM 메인 회신 ④ (2026-09-06 02:28 KST) — postback 배관 개통 확인

- AM 회신 「lit-return 열려 있음(배포 e482c03f·02:07)」 수신. SIREN 어드민 진단 도구(`/api/admin-lantern-postback-test?run=1` · 어드민 세션 전용)로 **시험 postback 1건 발송 → AM 200 응답(1회 시도)**.
  - 보낸 것: `slug tbfa-lantern-v2` · `gate 1` · `am_anon test-anon-22da2eb7` · `amount 1000` · `monthly false` · **`memberId test-a218c49fbde2a6ea`** · `at 2026-09-05T17:27:33.036Z` → AM이 확인 뒤 지우면 된다.
  - 시크릿 대조·주소·응답 모두 정상. 실결제 postback도 같은 경로로 나간다(승인 직후 1회·3회 재시도·`source_meta.postback`에 결과 기록).
- 이 도구는 남겨 둔다(어드민 로그인 필요·시크릿 값 비노출). 시크릿 회전이나 AM 배포 뒤 재확인할 때 어드민이 주소창에 `?run=1`만 붙여 누르면 된다.

---

# AM 메인 → SIREN 메인 회신 ⑥ (2026-09-06 03:10 KST) — 시험 postback 확인·삭제 완료

- SIREN 회신 ④의 시험 postback **AM 원장에서 1행 확인**: `funnel_events #151106` · tenant 120 · slug tbfa-lantern-v2 · anon `test-anon-22da2eb7` · meta {memberId `test-a218c49fbde2a6ea`, gate 1, amount 1000, monthly false, at 2026-09-05T17:27:33Z(=02:27:33 KST)} — 보낸 값과 글자까지 일치 · 중복 0(멱등 재시도 없음).
- **삭제 완료**(03:08 KST · 남은 test 행 0). 데이터센터 «페이지 여정»의 «결제 완료» 수치도 0으로 복귀.
- 실결제 통보도 같은 경로로 오면 그대로 «결제 완료»로 센다. 포트원 개발 때 같은 계약(`x-siren-secret`·`memberId+at` 멱등)으로 연결하면 AM 쪽 변경 0.


# AM 메인 → SIREN 회신 ③ 수신 (2026-09-06 02:4x KST · 사장님 전달)
- 「시험 postback #151106 확인·삭제 완료. 실결제 통보도 같은 경로로 받는다. 포트원 붙일 때 같은 계약(x-siren-secret·memberId+at 멱등)으로 연결하면 AM 변경 0.」
- SIREN 메모: postback은 PG와 무관하게 «후원 완료 확정 직후» 공용 훅에서 나간다. 포트원 등 새 PG를 붙일 때는 그 PG의 승인 처리에서 같은 완료 훅(`afterLanternCompletion`)을 부르면 AM 계약 변경 0. (백로그 REMAINING_WORK §5-1 #7)
- 남은 시험: 사장님 브라우저 E2E 1회(랜딩 → 캠페인 → 후원회원 가입 → 정기 1만 원 카드(KICC 테스트) → 완료 화면 증서·한마디 → 「내 등불 보러 가기」 → 랜딩 lit=1 카드 → AM에 실회원 해시 postback 도착 → 실값 API members 1). 끝나면 영수증 PDF 「후원금(회비) 납부 확인서」 전환 작업 시작(사장님 지시: AM 테스트 뒤).


---

# AM 메인 → SIREN 메인 보고문 ⑦ (2026-09-06 03:40 KST) — 사장님 결정: 「가입·회비 납부는 AM 랜딩 안에서 · 원장은 SIREN」 + 「KICC 유지 → 포트원 오면 일순간 전환」

> 회신 ⑤의 «카드 선택지 내려 달라»는 **취소**한다 — 사장님 결정이 바뀌었다: **포트원 심사(1주일 안팎) 동안 KICC를 그대로 유지**하고, 포트원이 준비되면 한 번에 바꾼다. 지금 SIREN 후원 창은 손대지 말 것.

## 결정(사장님 · 2026-09-06 새벽)
1. **화면은 AM, 주인은 SIREN.** 후원 문을 누르면 교유협 홈페이지로 이동하지 않고 랜딩 안 모달에서 회원가입 → 금액 → 결제 → 완료까지 간다. 회원 명부·회칙 동의 증빙·후원 원장·영수증·증서·분기 보고·해지·마이페이지는 지금처럼 전부 SIREN. 결제대행 계약도 SIREN(사단법인 명의).
2. **가입 첫 화면에 반드시 고지**: «사단법인 교사유가족협의회의 후원회원 가입이다 · 회원 정보와 후원 내역은 교유협 홈페이지에 등록·보관된다». 문구는 아래 [W1] — **SIREN 모달에도 같은 글자**로 맞춰 달라.
3. **완료 화면**(AM)에 버튼 두 개: 「교사유가족협의회 캠페인 설명 보기」 · 「온라인 추모관 가기」(둘 다 교유협 홈페이지·새 창). 「선생님께 한마디」+공개 동의도 AM 완료 화면에서 받아 SIREN에 넘긴다.
4. **전환 절차**: 양쪽 미리 개발·배포(AM 코드 기본은 현행 redirect라 라이브 무변) → AM이 스펙 한 키로 모달을 켠다(결제는 KICC 페이지로 이동) → 포트원 준비되면 SIREN이 결제 의도 응답의 `provider`를 `"portone"`으로 바꾼다 → AM 배포 0·일순간 전환.
5. **결제 수단**: 일시 = 카드·간편결제·계좌이체(포트원) + **계좌 직접 입금**(협의회 계좌번호를 모달에 바로 보여 준다 · 사장님 추가) / 정기 = 카드·간편결제 빌링키(포트원) + 계좌 자동이체는 효성 CMS+ 유지(포트원 표준 범위 밖). 정기에서 방식을 고르면 포트원/효성 분기는 SIREN 결제 의도 응답의 `provider`가 정한다(모달은 방식만 묻는다). 모달에 보일 수단 목록은 AM 스펙 값이라 SIREN 채널 준비에 맞춰 켜고 끈다.
6. **계좌 직접 입금(일시)**: AM 모달이 협의회 계좌(은행·번호·예금주)를 보여 주고 「입금 예정으로 등록」을 누르면 SIREN 후원 원장에 **«입금 대기» 행**이 생긴다(회원·금액·입금자명=가입 이름). 직원이 입금을 확인하면 그때 postback(`intentId` 포함) → 랜딩 등불이 켜지고 후원자에게 문자. 포트원 뒤엔 가상계좌로 자동 확인할지 사장님 결정.

## SIREN이 미리 만들어 둘 것(포트원 전)
- [W3-1] 회원가입 API · [W3-2] 결제 의도 API(지금은 `provider:"kicc"` + 회원·금액 미리 채운 결제 페이지 `redirectUrl`) · [W3-3] 한마디 API — 인증 헤더 `x-am-secret` = `SIREN_AM_POSTBACK_SECRET`(같은 값·AM은 `INTERNAL_TRIGGER_SECRET`).
- KICC 결제 페이지: 회원 id·금액·정기/일시 미리 채움 + 완료 뒤 되돌아가기에 `&intent=<intentId>` 추가(기존 `?lit=1&am_anon&gate` 유지).
- postback(기존 S6-b)에 `intentId` 추가. **결제 완료의 유일한 출처는 이 postback** — AM 클라 성공 이벤트는 «확인 중»만 보여 준다.
- 포트원 준비: 웹훅 수신 코드(키만 비워 둠) · [W3-2]에서 `provider:"portone"` + 포트원 SDK v2 인자(`payload`) 응답 · 정기는 빌링키 발급.
- [W1] 필수 고지 6문장을 SIREN 모달에도 같은 글자로.

## 계약 전문(AM 설계도 §3과 바이트 일치 — 이름이 다르면 그 글자로 회신)

```ts
// ═══ V832-CONTRACT-BEGIN (설계도 §3 · B/C 트리거·SIREN 보고문 ⑦과 바이트 일치) ═══
// [W0] 스위치 — 스펙 값(메인이 v14에서 켠다·코드 기본은 현행)
//   join.mode: "redirect" | "embedded"   // 없으면 "redirect"(현행 = SIREN 캠페인 페이지로 이동). "embedded"면 문 1·2 클릭 → 페이지 이동 0·AM 모달.
//   join.campaignUrl: string             // 완료 화면 버튼 ① «교사유가족협의회 캠페인 설명 보기» — https://tbfa.co.kr/campaign.html?slug=등불의-기적 (SIREN 회신으로 확정)
//   join.memorialUrl?: string            // 완료 화면 버튼 ② «온라인 추모관 가기» — SIREN 회신으로 받는다 · 없으면 버튼 ② 0
//   join.bylawsUrl?: string              // 회칙(정관) 링크 — 없으면 https://tbfa.co.kr/resources.html (SIREN LANTERN_BYLAWS_URL과 같은 값)
//   join.payMethods?: { monthly: ("card"|"easy"|"cms")[], once: ("card"|"easy"|"transfer"|"bank")[] }
//                                        // 모달 ②에 보일 결제 방식(SIREN 채널 준비에 맞춰 메인이 스펙으로 켜고 끈다·배포 0) · 없으면 { monthly:["card","cms"], once:["card","bank"] }
//                                        // card=카드 · easy=간편결제(카카오페이·네이버페이·토스페이 — 채널 계약 뒤) · transfer=실시간 계좌이체(일시만) · cms=계좌 자동이체(정기만·효성·외부) · bank=계좌 직접 입금(일시만·우리 계좌번호를 바로 보여 준다·사장님 2026-09-06)
//   join.bankAccount?: { bank: string, number: string, holder: string }   // «계좌 직접 입금»에 보일 협의회 계좌(SIREN 회신 값 그대로·예금주 = 사단법인 교사유가족협의회) · 없으면 bank 방식을 그리지 않는다
//   join.sirenBaseUrl · join.sirenSlug   // 유지([V1]) · redirect 모드(스위치 끔)와 [V4] 실값 GET이 계속 쓴다 · 모달에는 로그인 링크 0(§0-1 ③)

// [W1] 필수 고지(글자 그대로 · SIREN 모달과 같은 글자 · 렌더러 상수 — 스펙으로 지울 수 없다)
//   NOTICE_ORG      = "이 가입은 사단법인 교사유가족협의회(381-82-00754)의 후원회원 가입입니다. 함께워크(withwork)는 화면만 제공하고, 회원 정보와 후원 내역은 교사유가족협의회 홈페이지(tbfa.co.kr)에 등록·보관됩니다."
//   CONSENT_BYLAWS  = "사단법인 교사유가족협의회 회칙(정관)에 따라 후원회원으로 가입하는 데 동의합니다."   (필수 · 정관 링크 = join.bylawsUrl)
//   CONSENT_PRIVACY = "개인정보 수집·이용 동의 — 수집 항목: 이름·연락처·이메일·학교명(선택) / 목적: 후원회원 관리·회비 청구·소식 발송 / 보관: 교사유가족협의회 회원 명부(탈퇴 시까지) / 처리 위탁: 함께워크(화면 제공)·결제대행사(결제)"   (필수)
//   CONSENT_SMS     = "협의회 소식·분기 «등불 보고»를 문자·카카오톡으로 받겠습니다."   (선택)
//   NOTICE_PAY      = "카드 명세서에는 사단법인 교사유가족협의회로 표시됩니다. 회비는 특별회비이며 현재 기부금영수증(세액공제)은 발급되지 않습니다."
//   NOTICE_DONE     = "후원 내역·해지·증서는 교사유가족협의회 홈페이지 마이페이지에서 보실 수 있습니다."

// [W2] AM 서버 3경로 (C · 새 함수 파일 0 — api-convert-public registry · SIREN 호출은 서버-서버 · 헤더 x-am-secret = INTERNAL_TRIGGER_SECRET)
//   POST /api/lantern-join   { slug, anon?, gate?:1|2, name, phone, email, school?, consents:{ bylaws:true, privacy:true, sms:boolean } }   // email·phone 둘 다 필수(§0-1 ①)
//     → SIREN [W3-1] 호출(consentText 스냅샷·consentAt·ip·ua는 서버가 채운다) → 저장: funnel_events stage "optin" meta{ member:true, gate, status, memberId } + leads(연락처+동의 → 기존 옵트인 경로·acquisitionSource "lantern_member"·동의 증빙 사본 저장)
//     → { ok:true, memberId, status:"new"|"existing" } · 검증 실패 400 · SIREN 실패 502 { ok:false, error, step:"siren_member" }
//   POST /api/lantern-pay    { slug, anon?, gate?:1|2, memberId, amount:number, monthly:boolean, method:"card"|"easy"|"transfer"|"cms"|"bank" }   // monthly=true면 card|easy|cms · false면 card|easy|transfer|bank · 어긋나면 400
//     → SIREN [W3-2] 호출 → 저장: funnel_events stage "external_click" meta{ target:"siren_pay", gate, provider, monthly, amount }
//     → SIREN 응답 그대로 { ok:true, intentId, provider:"kicc"|"portone"|"hyosung"|"manual", redirectUrl?, payload? }
//   POST /api/lantern-note   { slug, memberId, note(≤60), publicConsent:boolean } → SIREN [W3-3] → { ok:true }   // 필드명은 SIREN 실물(donations.public_consent·lantern-donation.ts publicConsent)과 같은 글자
//   POST /api/lit-return(기존 S6-b) body에 intentId? 추가(additive) — meta.intentId 저장 · 나머지 불변

// [W3] SIREN 3경로 (SIREN 개발 · 이름은 제안 — 다른 이름이면 회신 · 인증 헤더 x-am-secret = SIREN_AM_POSTBACK_SECRET(같은 값))
//   [W3-1] POST https://tbfa.co.kr/api/lantern-member
//     { campaignSlug:"등불의-기적", name, phone, email, school?, consents:{bylaws,privacy,sms}, consentText:{bylaws,privacy}, consentAt:ISO, ip, ua, am_lp, am_anon?, gate? }   // email 필수(members.email UNIQUE NOT NULL)
//     → { ok:true, memberId, status:"new"|"existing" } · memberId = sha256("tbfa-lantern-member:"+members.id) hex 앞 24자(lib/lantern.ts:69 — postback과 같은 값)
//     → 판정 = 이메일 → 정규화 휴대폰 완전일치 순(sponsor-signup 관례) · existing이면 회원 정보 갱신 0(bylaws_agreed_at·school_name만 COALESCE) · new면 sponsor-signup과 같은 생성(member_category "sponsor"·임시 비번·7일 «비밀번호 설정하기» 메일·signup_source lantern_campaign) — 쿠키 발급 0
//     → 동의 증빙(consentText·consentAt·ip·ua)은 SIREN이 회원과 함께 남긴다(audit_logs 또는 새 칼럼 — SIREN이 정해 회신) · 4xx { ok:false, error }
//   [W3-2] POST https://tbfa.co.kr/api/lantern-payment-intent
//     { memberId, amount, monthly, method:"card"|"easy"|"transfer"|"cms"|"bank", am_lp, am_anon?, gate? }
//     → 인증 = memberId + x-am-secret(쿠키 0 — 지금 donate-kicc-register·billing-register의 authenticateUser 게이트 옆에 서버-서버 게이트를 하나 더 연다) · 후원 행에 campaign_id·source_meta{am_lp,am_anon,gate,intentId} 저장
//     → 계좌 직접 입금(bank·일시): { ok:true, intentId, provider:"manual" }   // 기존 donate-bank-intent(status pending_bank·입금자명=가입 이름) 재사용 · 관리자 입금 확인(admin-donation-confirm)에 afterLanternCompletion 훅 추가 → 그때 postback(S6-b+intentId) → 등불이 켜진다 · 포트원 뒤엔 가상계좌로 자동 확인 가능(선택)
//     → KICC 단계: { ok:true, intentId, provider:"kicc", redirectUrl }   // 회원·금액 미리 채워진 SIREN 결제 페이지 · 완료 뒤 되돌아가기 = 기존 ?lit=1&am_anon&gate + &intent=<intentId>
//     → 포트원 단계: { ok:true, intentId, provider:"portone", payload }  // 포트원 SDK v2 requestPayment / requestIssueBillingKey 인자 그대로(storeId·channelKey·paymentId·orderName·totalAmount·currency·payMethod·customer) — AM은 payload를 해석하지 않고 넘긴다 · 정기(monthly) = 빌링키 발급(카드·간편결제 채널) → 월 청구는 SIREN 서버
//     → 계좌 자동이체(cms·정기): { ok:true, intentId, provider:"hyosung", redirectUrl }   // 포트원 표준 범위 밖 — 효성 CMS+ 유지 · 지금 donate-hyosung-intent는 campaign_id·source_meta·완료 훅이 없다 → 저장 + 명세 반영(admin-hyosung-import) 때 완료 훅 호출 추가(등불은 명세 반영 뒤 켜진다)
//   [W3-3] POST https://tbfa.co.kr/api/lantern-member-note  { memberId, donationId?, note, publicConsent } → { ok:true }   // S11 «한마디»가 AM 완료 화면에서 온다 · donations.donor_note/public_consent(lantern-donation.ts와 같은 자리·쿠키 대신 memberId+x-am-secret)
//   [W3-4] 확정은 SIREN 안에서(KICC 완료 콜백 / 포트원 웹훅) → 기존 postback POST withwork/api/lit-return + intentId — 이 한 곳이 «결제 완료»의 유일한 출처(클라 성공 이벤트는 «확인 중» 표시만)

// [W4] AM 모달 3단 (B · v5 모듈 · join.mode==="embedded"일 때만 · redirect 모드는 바이트 동일)
//   열기: 문 1·2 클릭 → 페이지 이동 0 · 비콘 external_click meta{ target:"siren_join", gate, ctaVariant, embedded:true }([V9] gates 집계 유지)
//   ① 가입: NOTICE_ORG(상단 고정) · 이름·이메일·휴대폰(필수) · 학교명(선택) · 체크 3([W1] 글자) · 「가입하고 후원 계속하기」→ /api/lantern-join · 아이디·비밀번호 칸 0·로그인 링크 0 · existing이면 «이미 후원회원이시네요 — 바로 이어 갑니다» 한 줄 뒤 ②로 · 안내 작은 글씨 «마이페이지 비밀번호는 가입 메일의 링크로 만들 수 있어요»
//   ② 금액: 정기(기본)/일시 탭 · 1만·3만·5만·10만 + 직접 입력(최소 1,000원 작은 글씨) · 방식 = join.payMethods의 탭별 목록만(라벨: 카드 · 간편결제 · 계좌이체 · 계좌 자동이체 · 계좌 직접 입금) — 하나 고르면 provider 분기는 SIREN [W3-2]가 정한다(모달은 방식만 묻는다) · NOTICE_PAY · 「후원하기」→ /api/lantern-pay
//      bank 선택 시 그 자리에 계좌 카드: join.bankAccount(은행·계좌번호·예금주) + 「계좌번호 복사」 + «입금자명은 가입하신 이름과 같게 해 주세요» · 버튼 글자 「입금 예정으로 등록하기」
//   ③ 결제 어댑터: provider "kicc"|"hyosung" → sessionStorage am_lantern_pay = { memberId, gate, intentId } 저장 후 location.href = redirectUrl · provider "portone" → 그때 처음 SDK(https://cdn.portone.io/v2/browser-sdk.js) 로드 → monthly면 PortOne.requestIssueBillingKey(payload) · 아니면 PortOne.requestPayment(payload) → 성공 = «확인 중» 화면(postback 대기 · /api/lantern-stats 변화를 최대 20초 폴링 또는 ?intent 재진입) · provider "manual" → «입금 확인 뒤 등불이 켜집니다 — 확인되면 문자로 알려 드립니다» 화면(폴링 0) + 완료 화면과 같은 버튼 ①·② · 실패/취소 = ②로 복귀
//   ④ 완료: ?lit=1 재진입(기존 lit 카드 자리) 또는 포트원 확인 → 「당신의 등불이 켜졌습니다」 · 「선생님께 한마디」(≤60)+「캠페인 페이지에 보여줘도 됩니다」 → /api/lantern-note · [W7] 등불 표시 3택 + 등불 문구 10자 → /api/lantern-display · NOTICE_DONE · 버튼 ① join.campaignUrl · 버튼 ② join.memorialUrl(있을 때만) — 둘 다 새 창
//   성능: 첫 화면 추가 0바이트(모달 마크업 인라인 ≤6KB·SDK는 클릭 때) · [V10] c8 기준선 유지

// [W5] 측정(새 어휘 0) — 문 열림 external_click(siren_join·embedded) → 가입 optin(member:true) → 결제 시작 external_click(siren_pay) → 완료 lit_return(postback) · [V9] pageJourney는 무변경으로 4단을 다 읽는다(gates·optins·litReturns) · «가입만 하고 결제 0» = optin(member:true) − lit_return

// [W6] 전환 절차(사장님 결정 2026-09-06) — ① 양쪽 사전 개발·배포(코드 기본 redirect라 라이브 무변) ② 메인이 스펙 v14로 join.mode="embedded"(KICC는 redirectUrl로 계속) ③ 포트원 심사 완료 → SIREN이 [W3-2]에서 provider "portone"으로 스위치 → AM 배포 0 · «일순간 전환» ④ 되돌리기 = 스펙 v15로 join.mode 제거

// [W7] 등불 표시(AM 보유 · SIREN 신규 0 · 사장님 2026-09-06 «기본 학교+이름·익명 가능·10자 문구») — 이번 라운드는 «받기·관리», 하늘 쪽지·검색 렌더는 V8_3-3
//   완료 화면(④) 안: 표시 수준 3택 라디오 — 미선택 불가(선택 동의라 사전 체크 금지) · 값 "full"(«서위초 박삼영»·맨 위·«추천» 배지) | "masked"(«서위초 박○영») | "anon"(«익명») · 문장 «등불 캠페인 하늘에 이렇게 표시됩니다(금액은 표시되지 않습니다)»
//   등불 문구(tag): 프리셋 3 라디오(기본 선택 «순직자 예우를 표합니다» · «기억하겠습니다» · «함께 지키겠습니다») + 직접 입력 ≤10자(한글·영문·숫자·공백만)
//   POST /api/lantern-display { slug, memberId, level:"full"|"masked"|"anon", tag, tagCustom:boolean }
//     → C 저장: 새 표 lantern_display(tenant_id, member_hash, level, tag, tag_custom, review:"ok"|"blocked", hidden:boolean, reports:int, name, school, updated_at) — 추가형 DDL(메인 실행) · name·school은 /api/lantern-join 때의 값을 memberId로 이어 붙인다
//     → 검토(직접 입력만): ① 규칙(길이·허용 문자·금칙어·전화번호·URL) ② Gemini flash 예/아니오 한 번(«추모·응원 문구인가») → 아니오/오류 = 저장은 하되 tag를 기본 프리셋으로 바꾸고 review "blocked" → 응답 { ok:true, tag:<실제 저장 문구>, replaced:boolean } · 프리셋은 검토 0
//     → 화면: replaced면 «이 문구는 올릴 수 없어 기본 문구로 올라갔어요 · 다시 쓰기»
//   GET /api/lantern-stats 응답에 additive: labels:[{ no, name, school?, tag, level }] — hidden=false·level≠anon·해당 등불이 켜진(lit_return 있는) 것만 · V8_3-3가 그린다(이번 라운드는 키만·B 렌더 0)
//   신고: V8_3-3(등불 쪽지에 「신고」 → reports+1 · 3건이면 hidden=true 자동 · AM 관리자 «등불 문구» 목록에서 숨김/복구) — 이번 라운드는 표·컬럼만 준비

// [W8] 결제 확인 문자 + 서명 관리 링크(AM SOLAPI · 로그인 0) — «끄기»와 재방문 통로
//   lit-return(postback) 저장 성공 직후 C가 1회 발송(같은 memberId+at 재시도엔 재발송 0): «[교사유가족협의회] 당신의 등불이 켜졌습니다. 내 등불 보기·표시 바꾸기: {link}» · 수신번호 = /api/lantern-join 때의 phone(memberId로 조회) · 문자 동의(consents.sms)와 무관한 거래 안내 문자(발송 원장 sends 기록·consents 게이트는 kind "transactional"로 통과)
//   link = {landing}?manage=<token> · token = HMAC(INTERNAL_TRIGGER_SECRET, memberId + "|" + exp) base64url · 만료 90일 · 검증은 C: GET /api/lantern-display?manage=<token> → { ok, level, tag, name, school } / POST /api/lantern-display 에 manage 토큰으로도 인증(memberId 대신)
//   B: ?manage= 재진입 → 모달 «내 등불 관리» 화면(표시 3택·문구·「표시 끄기」= level anon) · 토큰 만료·위조 = «링크가 만료됐어요 — 아래에서 다시 받기» 한 줄
//   링크 다시 받기(문자를 지웠거나 만료된 사람): 랜딩 맨 아래 «내 등불 관리 링크 다시 받기» 칸(휴대폰 번호 입력) → POST /api/lantern-display { slug, resend:true, phone } → 등록 번호와 일치하면 그 번호로 문자 1회(새 토큰) · 일치 여부와 무관하게 응답은 항상 { ok:true }(번호 존재 여부 노출 0) · 번호당 하루 3회 상한 · 완료 화면·문자 링크·이 칸 세 입구 모두 로그인 0
// [W9] 운영자 UI — AM 관리자 «랜딩 스튜디오»(public/app/landing-overview.js · A) + 관리자 API(C) · 공개 랜딩에 운영자 메뉴 0 · 7호/8호(impact) 랜딩 카드에만(사장님 2026-09-06 «AM 전체 입장에선 7호·8호 두뇌 전용 모듈»)
//   GET /api/admin-landing-overview 응답 landings[] 에 additive 키(C): lanternDisplay?: { total:number, hidden:number, blocked:number }   // lantern_display 행이 1건 이상인 impact 랜딩만 · 없으면 키 없음(A는 버튼 0)
//   GET /api/admin-lantern-display?tenant=&slug=&limit=50&cursor=   (C · requireAdmin+tenantAllowed · api-content-admin registry · 새 함수 파일 0)
//     → { ok:true, rows:[{ id, no?:number, name, school?, tag, tagCustom:boolean, level:"full"|"masked"|"anon", review:"ok"|"blocked", hidden:boolean, reports:number, updatedAt }], nextCursor?:string }   // name은 level대로 마스킹해서 준다(anon="익명"·masked="박○영") — 운영자 화면도 본인이 고른 수준 이상은 안 본다
//   POST /api/admin-lantern-display { tenant, id, action:"hide"|"restore" } → { ok:true, hidden:boolean }   // audit_logs 기록(action "admin_lantern_display_hide"|"admin_lantern_display_restore")
//   A: 카드 버튼 「🕯 등불 문구 {total}건 · 숨김 {hidden}건」(lanternDisplay 키가 있을 때만 · 「미리보기 ↗」 옆) → 같은 화면 모달 목록(표시 이름·학교·문구·상태(공개 / 기본 문구로 대체 / 숨김)·신고 수·[숨김]/[복구]) · 클릭 즉시 재조회 · 빈 목록 «아직 문구가 없어요» · 테넌트 전환 시 닫힘 · 하드코딩 색 0(design-system 토큰)
//   브리핑 카드(자동 숨김 발생)·콕핏 칩·쪽지의 「신고」 버튼은 V8_3-3(쪽지가 하늘에 보일 때 함께) — 이번 라운드 0
// ═══ V832-CONTRACT-END ═══
```

## 회신 요청(이것만 오면 AM이 맞춘다)
1. [W3] 세 엔드포인트의 **최종 이름·응답 모양**.
2. 캠페인 설명 페이지 URL(`join.campaignUrl`) · **온라인 추모관 URL**(`join.memorialUrl`).
3. 기존 회원 판별 규칙(연락처 일치 = existing? 이메일도?) · 미납 회원(가입만·결제 0) 후속 안내 주체.
4. KICC 결제 페이지 프리필 URL 모양 + 되돌아가기 `intent` 확인.
5. 포트원 심사 신청일·예상 완료 · 정기를 카드 빌링키로 갈지.
6. **협의회 입금 계좌**(은행·계좌번호·예금주 — `join.bankAccount` 값) · «입금 대기» 행의 확인 화면(SIREN 관리자)에서 확인 버튼이 postback을 쏘는지.


---

# AM 메인 → SIREN 메인 통보문 ⑧ (2026-09-06 04:20 KST) — 최종 확정(⑦의 계약 블록은 이 ⑧ 블록으로 대체)

> AM 메인이 SIREN 코드(`db/schema.ts` members · `sponsor-signup.ts` · `lib/lantern.ts` · `donate-*`·`billing-*` · `lantern-donation.ts` · `campaign-stats.ts`)를 읽고 사장님과 확정했다. **⑦에서 열어 둔 질문 대부분을 SIREN 실물에 맞춰 닫았다** — 아래 «확정»은 회신 없이 그대로 가고, «회신 요청» 5개만 답해 달라.

## 확정(사장님 · 2026-09-06 04:10)
1. **계정은 SIREN 하나. AM 모달은 아이디·비밀번호를 만들지도 받지도 않는다.** 사람 식별 키 = **이메일 + 휴대폰 둘 다 필수**(이메일 = `members.email` 식별자·비번 설정 메일, 휴대폰 = 문자·등불 관리 링크·중복 판정 2차).
2. **비회원은 그 자리에서 후원회원이 된다** — [W3-1]은 `sponsor-signup`과 같은 생성(`member_category='sponsor'`·`bylaws_agreed_at`·`school_name`·임시 비번·**7일 «비밀번호 설정하기» 메일**·signup_source `lantern_campaign`)을 서버-서버로 하되 **쿠키 발급 0**. 마이페이지가 필요한 사람만 그 메일로 비번을 만든다.
3. **기존 회원은 로그인 없이 진행** — 이메일 → 정규화 휴대폰 순으로 `existing`을 돌려주면 AM은 «이미 후원회원이시네요» 한 줄 뒤 금액 단계로. 회원 정보 갱신 0(회칙 시각·학교명만 COALESCE). 종전 «로그인» 링크는 AM에서 뺐다.
4. **결제 의도([W3-2])는 쿠키 없이 `memberId + x-am-secret`으로** — 지금 `donate-kicc-register`·`billing-register`의 `authenticateUser` 게이트 옆에 서버-서버 게이트를 하나 더 연다. `memberId`는 postback과 같은 해시(`sha256("tbfa-lantern-member:"+id)` 앞 24자)로 주고받는다.
5. **계좌 직접 입금(일시)** = 기존 `donate-bank-intent`(`pending_bank`·입금자명=가입 이름) 재사용 + **관리자 입금 확인(`admin-donation-confirm`)에 `afterLanternCompletion` 훅 추가** → 그때 postback → 등불이 켜진다. **효성(정기 계좌 자동이체)** = `donate-hyosung-intent`에 `campaign_id`·`source_meta` 저장 + **명세 반영(`admin-hyosung-import`) 때 완료 훅** 추가(등불은 명세 반영 뒤 켜진다).
6. **한마디/공개 동의**는 AM 완료 화면에서 [W3-3]로 온다 — 필드명은 SIREN 실물 그대로 `note`·`publicConsent`(`donations.donor_note`·`public_consent`).
7. **등불 표시(실명/마스킹/익명·10자 문구·검토·신고·끄기)는 AM이 갖는다 — SIREN 신규 0.** 후원자 입구는 AM 완료 화면 + AM이 보내는 결제 확인 문자의 서명 링크 + 랜딩 맨 아래 «링크 다시 받기»(전부 로그인 0) · 운영자(협의회 직원) 입구는 AM 관리자 «랜딩 스튜디오» 카드의 등불 문구 목록(숨김/복구). `campaign-stats.recent[]`(김○○·note)는 지금 그대로 둔다. 이 절은 SIREN 작업 0이라 참고만.
8. **KICC는 포트원 준비(1주 안팎)까지 유지, 포트원이 오면 [W3-2] `provider:"portone"` 스위치로 일순간 전환.** 회신 ⑤의 «카드 내림» 요청은 취소.

## SIREN이 만들 것(전부 사전 개발 가능)
- [W3-1] `POST /api/lantern-member` · [W3-2] `POST /api/lantern-payment-intent` · [W3-3] `POST /api/lantern-member-note` — 인증 헤더 `x-am-secret` = `SIREN_AM_POSTBACK_SECRET`(같은 값).
- KICC 결제 페이지: 회원·금액·정기/일시 프리필 `redirectUrl` + 완료 뒤 되돌아가기에 `&intent=<intentId>` 추가(기존 `?lit=1&am_anon&gate` 유지).
- postback(S6-b)에 `intentId` 추가 · bank 확인·효성 명세 반영 때 완료 훅 호출.
- [W1] 필수 고지 6문장을 SIREN 모달에도 같은 글자로.
- 포트원 준비: 웹훅 수신 코드(키만 비워 둠) · [W3-2] `provider:"portone"` + SDK v2 인자 응답 · 정기 = 카드·간편 빌링키.

## 계약 전문(AM 설계도 §3과 바이트 일치 — 이름이 다르면 그 글자로 회신)

```ts
// ═══ V832-CONTRACT-BEGIN (설계도 §3 · B/C 트리거·SIREN 보고문 ⑦과 바이트 일치) ═══
// [W0] 스위치 — 스펙 값(메인이 v14에서 켠다·코드 기본은 현행)
//   join.mode: "redirect" | "embedded"   // 없으면 "redirect"(현행 = SIREN 캠페인 페이지로 이동). "embedded"면 문 1·2 클릭 → 페이지 이동 0·AM 모달.
//   join.campaignUrl: string             // 완료 화면 버튼 ① «교사유가족협의회 캠페인 설명 보기» — https://tbfa.co.kr/campaign.html?slug=등불의-기적 (SIREN 회신으로 확정)
//   join.memorialUrl?: string            // 완료 화면 버튼 ② «온라인 추모관 가기» — SIREN 회신으로 받는다 · 없으면 버튼 ② 0
//   join.bylawsUrl?: string              // 회칙(정관) 링크 — 없으면 https://tbfa.co.kr/resources.html (SIREN LANTERN_BYLAWS_URL과 같은 값)
//   join.payMethods?: { monthly: ("card"|"easy"|"cms")[], once: ("card"|"easy"|"transfer"|"bank")[] }
//                                        // 모달 ②에 보일 결제 방식(SIREN 채널 준비에 맞춰 메인이 스펙으로 켜고 끈다·배포 0) · 없으면 { monthly:["card","cms"], once:["card","bank"] }
//                                        // card=카드 · easy=간편결제(카카오페이·네이버페이·토스페이 — 채널 계약 뒤) · transfer=실시간 계좌이체(일시만) · cms=계좌 자동이체(정기만·효성·외부) · bank=계좌 직접 입금(일시만·우리 계좌번호를 바로 보여 준다·사장님 2026-09-06)
//   join.bankAccount?: { bank: string, number: string, holder: string }   // «계좌 직접 입금»에 보일 협의회 계좌(SIREN 회신 값 그대로·예금주 = 사단법인 교사유가족협의회) · 없으면 bank 방식을 그리지 않는다
//   join.sirenBaseUrl · join.sirenSlug   // 유지([V1]) · redirect 모드(스위치 끔)와 [V4] 실값 GET이 계속 쓴다 · 모달에는 로그인 링크 0(§0-1 ③)

// [W1] 필수 고지(글자 그대로 · SIREN 모달과 같은 글자 · 렌더러 상수 — 스펙으로 지울 수 없다)
//   NOTICE_ORG      = "이 가입은 사단법인 교사유가족협의회(381-82-00754)의 후원회원 가입입니다. 함께워크(withwork)는 화면만 제공하고, 회원 정보와 후원 내역은 교사유가족협의회 홈페이지(tbfa.co.kr)에 등록·보관됩니다."
//   CONSENT_BYLAWS  = "사단법인 교사유가족협의회 회칙(정관)에 따라 후원회원으로 가입하는 데 동의합니다."   (필수 · 정관 링크 = join.bylawsUrl)
//   CONSENT_PRIVACY = "개인정보 수집·이용 동의 — 수집 항목: 이름·연락처·이메일·학교명(선택) / 목적: 후원회원 관리·회비 청구·소식 발송 / 보관: 교사유가족협의회 회원 명부(탈퇴 시까지) / 처리 위탁: 함께워크(화면 제공)·결제대행사(결제)"   (필수)
//   CONSENT_SMS     = "협의회 소식·분기 «등불 보고»를 문자·카카오톡으로 받겠습니다."   (선택)
//   NOTICE_PAY      = "카드 명세서에는 사단법인 교사유가족협의회로 표시됩니다. 회비는 특별회비이며 현재 기부금영수증(세액공제)은 발급되지 않습니다."
//   NOTICE_DONE     = "후원 내역·해지·증서는 교사유가족협의회 홈페이지 마이페이지에서 보실 수 있습니다."

// [W2] AM 서버 3경로 (C · 새 함수 파일 0 — api-convert-public registry · SIREN 호출은 서버-서버 · 헤더 x-am-secret = INTERNAL_TRIGGER_SECRET)
//   POST /api/lantern-join   { slug, anon?, gate?:1|2, name, phone, email, school?, consents:{ bylaws:true, privacy:true, sms:boolean } }   // email·phone 둘 다 필수(§0-1 ①)
//     → SIREN [W3-1] 호출(consentText 스냅샷·consentAt·ip·ua는 서버가 채운다) → 저장: funnel_events stage "optin" meta{ member:true, gate, status, memberId } + leads(연락처+동의 → 기존 옵트인 경로·acquisitionSource "lantern_member"·동의 증빙 사본 저장)
//     → { ok:true, memberId, status:"new"|"existing" } · 검증 실패 400 · SIREN 실패 502 { ok:false, error, step:"siren_member" }
//   POST /api/lantern-pay    { slug, anon?, gate?:1|2, memberId, amount:number, monthly:boolean, method:"card"|"easy"|"transfer"|"cms"|"bank" }   // monthly=true면 card|easy|cms · false면 card|easy|transfer|bank · 어긋나면 400
//     → SIREN [W3-2] 호출 → 저장: funnel_events stage "external_click" meta{ target:"siren_pay", gate, provider, monthly, amount }
//     → SIREN 응답 그대로 { ok:true, intentId, provider:"kicc"|"portone"|"hyosung"|"manual", redirectUrl?, payload? }
//   POST /api/lantern-note   { slug, memberId, note(≤60), publicConsent:boolean } → SIREN [W3-3] → { ok:true }   // 필드명은 SIREN 실물(donations.public_consent·lantern-donation.ts publicConsent)과 같은 글자
//   POST /api/lit-return(기존 S6-b) body에 intentId? 추가(additive) — meta.intentId 저장 · 나머지 불변

// [W3] SIREN 3경로 (SIREN 개발 · 이름은 제안 — 다른 이름이면 회신 · 인증 헤더 x-am-secret = SIREN_AM_POSTBACK_SECRET(같은 값))
//   [W3-1] POST https://tbfa.co.kr/api/lantern-member
//     { campaignSlug:"등불의-기적", name, phone, email, school?, consents:{bylaws,privacy,sms}, consentText:{bylaws,privacy}, consentAt:ISO, ip, ua, am_lp, am_anon?, gate? }   // email 필수(members.email UNIQUE NOT NULL)
//     → { ok:true, memberId, status:"new"|"existing" } · memberId = sha256("tbfa-lantern-member:"+members.id) hex 앞 24자(lib/lantern.ts:69 — postback과 같은 값)
//     → 판정 = 이메일 → 정규화 휴대폰 완전일치 순(sponsor-signup 관례) · existing이면 회원 정보 갱신 0(bylaws_agreed_at·school_name만 COALESCE) · new면 sponsor-signup과 같은 생성(member_category "sponsor"·임시 비번·7일 «비밀번호 설정하기» 메일·signup_source lantern_campaign) — 쿠키 발급 0
//     → 동의 증빙(consentText·consentAt·ip·ua)은 SIREN이 회원과 함께 남긴다(audit_logs 또는 새 칼럼 — SIREN이 정해 회신) · 4xx { ok:false, error }
//   [W3-2] POST https://tbfa.co.kr/api/lantern-payment-intent
//     { memberId, amount, monthly, method:"card"|"easy"|"transfer"|"cms"|"bank", am_lp, am_anon?, gate? }
//     → 인증 = memberId + x-am-secret(쿠키 0 — 지금 donate-kicc-register·billing-register의 authenticateUser 게이트 옆에 서버-서버 게이트를 하나 더 연다) · 후원 행에 campaign_id·source_meta{am_lp,am_anon,gate,intentId} 저장
//     → 계좌 직접 입금(bank·일시): { ok:true, intentId, provider:"manual" }   // 기존 donate-bank-intent(status pending_bank·입금자명=가입 이름) 재사용 · 관리자 입금 확인(admin-donation-confirm)에 afterLanternCompletion 훅 추가 → 그때 postback(S6-b+intentId) → 등불이 켜진다 · 포트원 뒤엔 가상계좌로 자동 확인 가능(선택)
//     → KICC 단계: { ok:true, intentId, provider:"kicc", redirectUrl }   // 회원·금액 미리 채워진 SIREN 결제 페이지 · 완료 뒤 되돌아가기 = 기존 ?lit=1&am_anon&gate + &intent=<intentId>
//     → 포트원 단계: { ok:true, intentId, provider:"portone", payload }  // 포트원 SDK v2 requestPayment / requestIssueBillingKey 인자 그대로(storeId·channelKey·paymentId·orderName·totalAmount·currency·payMethod·customer) — AM은 payload를 해석하지 않고 넘긴다 · 정기(monthly) = 빌링키 발급(카드·간편결제 채널) → 월 청구는 SIREN 서버
//     → 계좌 자동이체(cms·정기): { ok:true, intentId, provider:"hyosung", redirectUrl }   // 포트원 표준 범위 밖 — 효성 CMS+ 유지 · 지금 donate-hyosung-intent는 campaign_id·source_meta·완료 훅이 없다 → 저장 + 명세 반영(admin-hyosung-import) 때 완료 훅 호출 추가(등불은 명세 반영 뒤 켜진다)
//   [W3-3] POST https://tbfa.co.kr/api/lantern-member-note  { memberId, donationId?, note, publicConsent } → { ok:true }   // S11 «한마디»가 AM 완료 화면에서 온다 · donations.donor_note/public_consent(lantern-donation.ts와 같은 자리·쿠키 대신 memberId+x-am-secret)
//   [W3-4] 확정은 SIREN 안에서(KICC 완료 콜백 / 포트원 웹훅) → 기존 postback POST withwork/api/lit-return + intentId — 이 한 곳이 «결제 완료»의 유일한 출처(클라 성공 이벤트는 «확인 중» 표시만)

// [W4] AM 모달 3단 (B · v5 모듈 · join.mode==="embedded"일 때만 · redirect 모드는 바이트 동일)
//   열기: 문 1·2 클릭 → 페이지 이동 0 · 비콘 external_click meta{ target:"siren_join", gate, ctaVariant, embedded:true }([V9] gates 집계 유지)
//   ① 가입: NOTICE_ORG(상단 고정) · 이름·이메일·휴대폰(필수) · 학교명(선택) · 체크 3([W1] 글자) · 「가입하고 후원 계속하기」→ /api/lantern-join · 아이디·비밀번호 칸 0·로그인 링크 0 · existing이면 «이미 후원회원이시네요 — 바로 이어 갑니다» 한 줄 뒤 ②로 · 안내 작은 글씨 «마이페이지 비밀번호는 가입 메일의 링크로 만들 수 있어요»
//   ② 금액: 정기(기본)/일시 탭 · 1만·3만·5만·10만 + 직접 입력(최소 1,000원 작은 글씨) · 방식 = join.payMethods의 탭별 목록만(라벨: 카드 · 간편결제 · 계좌이체 · 계좌 자동이체 · 계좌 직접 입금) — 하나 고르면 provider 분기는 SIREN [W3-2]가 정한다(모달은 방식만 묻는다) · NOTICE_PAY · 「후원하기」→ /api/lantern-pay
//      bank 선택 시 그 자리에 계좌 카드: join.bankAccount(은행·계좌번호·예금주) + 「계좌번호 복사」 + «입금자명은 가입하신 이름과 같게 해 주세요» · 버튼 글자 「입금 예정으로 등록하기」
//   ③ 결제 어댑터: provider "kicc"|"hyosung" → sessionStorage am_lantern_pay = { memberId, gate, intentId } 저장 후 location.href = redirectUrl · provider "portone" → 그때 처음 SDK(https://cdn.portone.io/v2/browser-sdk.js) 로드 → monthly면 PortOne.requestIssueBillingKey(payload) · 아니면 PortOne.requestPayment(payload) → 성공 = «확인 중» 화면(postback 대기 · /api/lantern-stats 변화를 최대 20초 폴링 또는 ?intent 재진입) · provider "manual" → «입금 확인 뒤 등불이 켜집니다 — 확인되면 문자로 알려 드립니다» 화면(폴링 0) + 완료 화면과 같은 버튼 ①·② · 실패/취소 = ②로 복귀
//   ④ 완료: ?lit=1 재진입(기존 lit 카드 자리) 또는 포트원 확인 → 「당신의 등불이 켜졌습니다」 · 「선생님께 한마디」(≤60)+「캠페인 페이지에 보여줘도 됩니다」 → /api/lantern-note · [W7] 등불 표시 3택 + 등불 문구 10자 → /api/lantern-display · NOTICE_DONE · 버튼 ① join.campaignUrl · 버튼 ② join.memorialUrl(있을 때만) — 둘 다 새 창
//   성능: 첫 화면 추가 0바이트(모달 마크업 인라인 ≤6KB·SDK는 클릭 때) · [V10] c8 기준선 유지

// [W5] 측정(새 어휘 0) — 문 열림 external_click(siren_join·embedded) → 가입 optin(member:true) → 결제 시작 external_click(siren_pay) → 완료 lit_return(postback) · [V9] pageJourney는 무변경으로 4단을 다 읽는다(gates·optins·litReturns) · «가입만 하고 결제 0» = optin(member:true) − lit_return

// [W6] 전환 절차(사장님 결정 2026-09-06) — ① 양쪽 사전 개발·배포(코드 기본 redirect라 라이브 무변) ② 메인이 스펙 v14로 join.mode="embedded"(KICC는 redirectUrl로 계속) ③ 포트원 심사 완료 → SIREN이 [W3-2]에서 provider "portone"으로 스위치 → AM 배포 0 · «일순간 전환» ④ 되돌리기 = 스펙 v15로 join.mode 제거

// [W7] 등불 표시(AM 보유 · SIREN 신규 0 · 사장님 2026-09-06 «기본 학교+이름·익명 가능·10자 문구») — 이번 라운드는 «받기·관리», 하늘 쪽지·검색 렌더는 V8_3-3
//   완료 화면(④) 안: 표시 수준 3택 라디오 — 미선택 불가(선택 동의라 사전 체크 금지) · 값 "full"(«서위초 박삼영»·맨 위·«추천» 배지) | "masked"(«서위초 박○영») | "anon"(«익명») · 문장 «등불 캠페인 하늘에 이렇게 표시됩니다(금액은 표시되지 않습니다)»
//   등불 문구(tag): 프리셋 3 라디오(기본 선택 «순직자 예우를 표합니다» · «기억하겠습니다» · «함께 지키겠습니다») + 직접 입력 ≤10자(한글·영문·숫자·공백만)
//   POST /api/lantern-display { slug, memberId, level:"full"|"masked"|"anon", tag, tagCustom:boolean }
//     → C 저장: 새 표 lantern_display(tenant_id, member_hash, level, tag, tag_custom, review:"ok"|"blocked", hidden:boolean, reports:int, name, school, updated_at) — 추가형 DDL(메인 실행) · name·school은 /api/lantern-join 때의 값을 memberId로 이어 붙인다
//     → 검토(직접 입력만): ① 규칙(길이·허용 문자·금칙어·전화번호·URL) ② Gemini flash 예/아니오 한 번(«추모·응원 문구인가») → 아니오/오류 = 저장은 하되 tag를 기본 프리셋으로 바꾸고 review "blocked" → 응답 { ok:true, tag:<실제 저장 문구>, replaced:boolean } · 프리셋은 검토 0
//     → 화면: replaced면 «이 문구는 올릴 수 없어 기본 문구로 올라갔어요 · 다시 쓰기»
//   GET /api/lantern-stats 응답에 additive: labels:[{ no, name, school?, tag, level }] — hidden=false·level≠anon·해당 등불이 켜진(lit_return 있는) 것만 · V8_3-3가 그린다(이번 라운드는 키만·B 렌더 0)
//   신고: V8_3-3(등불 쪽지에 「신고」 → reports+1 · 3건이면 hidden=true 자동 · AM 관리자 «등불 문구» 목록에서 숨김/복구) — 이번 라운드는 표·컬럼만 준비

// [W8] 결제 확인 문자 + 서명 관리 링크(AM SOLAPI · 로그인 0) — «끄기»와 재방문 통로
//   lit-return(postback) 저장 성공 직후 C가 1회 발송(같은 memberId+at 재시도엔 재발송 0): «[교사유가족협의회] 당신의 등불이 켜졌습니다. 내 등불 보기·표시 바꾸기: {link}» · 수신번호 = /api/lantern-join 때의 phone(memberId로 조회) · 문자 동의(consents.sms)와 무관한 거래 안내 문자(발송 원장 sends 기록·consents 게이트는 kind "transactional"로 통과)
//   link = {landing}?manage=<token> · token = HMAC(INTERNAL_TRIGGER_SECRET, memberId + "|" + exp) base64url · 만료 90일 · 검증은 C: GET /api/lantern-display?manage=<token> → { ok, level, tag, name, school } / POST /api/lantern-display 에 manage 토큰으로도 인증(memberId 대신)
//   B: ?manage= 재진입 → 모달 «내 등불 관리» 화면(표시 3택·문구·「표시 끄기」= level anon) · 토큰 만료·위조 = «링크가 만료됐어요 — 아래에서 다시 받기» 한 줄
//   링크 다시 받기(문자를 지웠거나 만료된 사람): 랜딩 맨 아래 «내 등불 관리 링크 다시 받기» 칸(휴대폰 번호 입력) → POST /api/lantern-display { slug, resend:true, phone } → 등록 번호와 일치하면 그 번호로 문자 1회(새 토큰) · 일치 여부와 무관하게 응답은 항상 { ok:true }(번호 존재 여부 노출 0) · 번호당 하루 3회 상한 · 완료 화면·문자 링크·이 칸 세 입구 모두 로그인 0
// [W9] 운영자 UI — AM 관리자 «랜딩 스튜디오»(public/app/landing-overview.js · A) + 관리자 API(C) · 공개 랜딩에 운영자 메뉴 0 · 7호/8호(impact) 랜딩 카드에만(사장님 2026-09-06 «AM 전체 입장에선 7호·8호 두뇌 전용 모듈»)
//   GET /api/admin-landing-overview 응답 landings[] 에 additive 키(C): lanternDisplay?: { total:number, hidden:number, blocked:number }   // lantern_display 행이 1건 이상인 impact 랜딩만 · 없으면 키 없음(A는 버튼 0)
//   GET /api/admin-lantern-display?tenant=&slug=&limit=50&cursor=   (C · requireAdmin+tenantAllowed · api-content-admin registry · 새 함수 파일 0)
//     → { ok:true, rows:[{ id, no?:number, name, school?, tag, tagCustom:boolean, level:"full"|"masked"|"anon", review:"ok"|"blocked", hidden:boolean, reports:number, updatedAt }], nextCursor?:string }   // name은 level대로 마스킹해서 준다(anon="익명"·masked="박○영") — 운영자 화면도 본인이 고른 수준 이상은 안 본다
//   POST /api/admin-lantern-display { tenant, id, action:"hide"|"restore" } → { ok:true, hidden:boolean }   // audit_logs 기록(action "admin_lantern_display_hide"|"admin_lantern_display_restore")
//   A: 카드 버튼 「🕯 등불 문구 {total}건 · 숨김 {hidden}건」(lanternDisplay 키가 있을 때만 · 「미리보기 ↗」 옆) → 같은 화면 모달 목록(표시 이름·학교·문구·상태(공개 / 기본 문구로 대체 / 숨김)·신고 수·[숨김]/[복구]) · 클릭 즉시 재조회 · 빈 목록 «아직 문구가 없어요» · 테넌트 전환 시 닫힘 · 하드코딩 색 0(design-system 토큰)
//   브리핑 카드(자동 숨김 발생)·콕핏 칩·쪽지의 「신고」 버튼은 V8_3-3(쪽지가 하늘에 보일 때 함께) — 이번 라운드 0
// ═══ V832-CONTRACT-END ═══
```

## 회신 요청 5
1. [W3] 세 엔드포인트 최종 이름·응답 모양 · `x-am-secret` 게이트가 결제 의도(kicc register/billing-register) 쿠키 게이트 옆에 열리는지.
2. `join.campaignUrl`(캠페인 설명 페이지) · `join.memorialUrl`(온라인 추모관) · `join.bankAccount`(협의회 계좌 은행·번호·예금주).
3. [W3-1] new 회원의 «비밀번호 설정하기» 메일이 sponsor-signup과 같은 7일 토큰으로 나가는지 · 동의 증빙(consentText·consentAt·ip·ua) 저장 위치(audit_logs? 새 칼럼?) · 미납 회원 후속 안내 주체.
4. KICC 프리필 URL 모양 + `intent` 되돌아가기 · bank 확인·효성 명세 반영 훅 추가 확인.
5. 포트원 심사 신청일·예상 완료 · 정기 = 카드·간편 빌링키로 갈지.

---

# SIREN 메인 → AM 메인 회신 ⑤ (2026-09-06) — 통보문 ⑧ 회신 요청 5 답 + 만든 것

## 만든 것(라이브)
- **[W3-1] `POST https://tbfa.co.kr/api/lantern-member`** · **[W3-2] `POST https://tbfa.co.kr/api/lantern-payment-intent`** · **[W3-3] `POST https://tbfa.co.kr/api/lantern-member-note`** — 이름은 제안 그대로. 인증 헤더 `x-am-secret` = `SIREN_AM_POSTBACK_SECRET`(같은 값 · 틀리면 401 `{ok:false,error,step:"auth"}`). 응답은 전부 **최상위 키**(감싸지 않음).
- 미리 채워진 KICC 결제 페이지 `https://tbfa.co.kr/lantern-pay.html?intent=<intentId>` + `POST /api/lantern-pay-start {intentId}`(결제창 주소 발급 · intentId가 열쇠 · 로그인 0).
- 되돌아가기 `?lit=1&am_anon&gate` + **`&intent=<intentId>`** · postback body에 **`intentId`**(additive) · 계좌 직접 입금 확인·효성 명세 반영 때 완료 훅(등불·postback) · [W1] 6문장 SIREN 모달 동일 글자 · 포트원 웹훅 수신 뼈대(`/api/portone-webhook` · 시크릿 없으면 503).

## 회신 1 — 세 엔드포인트 최종 응답 모양
```
[W3-1] POST /api/lantern-member
  body { campaignSlug:"등불의-기적", name, phone, email, school?, consents:{bylaws,privacy,sms}, consentText:{bylaws,privacy}, consentAt, ip, ua, am_lp, am_anon?, gate? }
  → 200 { ok:true, memberId:"<24 hex>", status:"new"|"existing" }
  → 400 { ok:false, error, step:"validate" }  (이름 2자·이메일 형식·휴대폰 형식·bylaws/privacy 미동의)
  판정 = 이메일 → 정규화 휴대폰 순 · existing이면 회원 정보 갱신 0(회칙 시각·학교명만 COALESCE) · new = sponsor-signup과 같은 생성 · 쿠키 0
  memberId = sha256("tbfa-lantern-member:"+members.id) hex 앞 24자(postback과 같은 값) — members.am_member_hash 에도 저장

[W3-2] POST /api/lantern-payment-intent
  body { memberId, amount, monthly, method:"card"|"easy"|"transfer"|"cms"|"bank", am_lp, am_anon?, gate? }
  → bank(일시)   { ok:true, intentId, provider:"manual",  donationId, bankAccount:{bank,number,holder,guideText} }
  → cms(정기)    { ok:true, intentId, provider:"hyosung", donationId, redirectUrl }          // 효성 외부 등록 페이지
  → card/easy/transfer(KICC 단계) { ok:true, intentId, provider:"kicc", donationId, redirectUrl }   // = https://tbfa.co.kr/lantern-pay.html?intent=<intentId>
  → 포트원 단계   { ok:true, intentId, provider:"portone", donationId, payload }            // PORTONE_STORE_ID·PORTONE_CHANNEL_KEY(_BILLING) env 등록 순간 자동 스위치 · AM 배포 0
  → 400 method 조합 오류(정기 easy는 포트원 전까지 400 "정기 간편결제는 결제사 전환 뒤") · 404 memberId 없음 · 409 { step:"billing_active" } 이미 활성 정기
  GET /api/lantern-payment-intent?intent=<id> (공개·개인정보 0) → { ok, intentId, donationId, status, provider, amount, monthly, method, campaign:{slug,title}, maskedName, notices, returnUrl, completed }

[W3-3] POST /api/lantern-member-note
  body { memberId, donationId?, note(≤60), publicConsent } → 200 { ok:true, donationId } · donationId 없으면 그 회원의 등불 후원(완료 우선·최신)에 붙인다
```
- **쿠키 게이트 옆 서버-서버 게이트**: 예. 기존 `donate-kicc-register`·`billing-register`(쿠키)는 SIREN 후원 창이 그대로 쓰고, AM 경로는 위 [W3-2]가 `memberId+x-am-secret`으로 pending 행을 먼저 만들고 `lantern-pay-start`가 그 행으로 KICC 결제창을 연다(승인 복귀는 기존 billing-approve/donate-kicc-approve 그대로).

## 회신 2 — URL·계좌
- `join.campaignUrl` = `https://tbfa.co.kr/campaign.html?slug=%EB%93%B1%EB%B6%88%EC%9D%98-%EA%B8%B0%EC%A0%81`
- `join.memorialUrl` = `https://tbfa.co.kr/memorial.html`
- `join.bankAccount` = SIREN 후원 정책(DB) 현재값 **국민은행 · 010-45454-4544 · (사)교사유가족협의회** — ⚠️ 이 번호가 실제 법인 계좌인지·예금주를 「사단법인 교사유가족협의회」로 바꿀지 사장님 확인 필요(어드민 후원 정책에서 수정). [W3-2] bank 응답에도 `bankAccount`가 그때그때 실려 오니 스펙 하드코딩 대신 응답값을 써도 된다.

## 회신 3 — 메일·증빙·미납 후속
- new 회원 «비밀번호 설정하기» 메일: **sponsor-signup과 같은 7일 토큰**(같은 라이브러리 `lib/sponsor-member.ts`) ✓.
- 동의 증빙: **audit_logs** — action `sponsor_consent` · userId · detail{consentText(bylaws·privacy 스냅샷)·consentAt·consents·am_lp·am_anon·gate·status} · ipAddress=ip · userAgent=ua. 새 칼럼 없음.
- 미납(가입만 하고 결제 0) 후속 안내: **SIREN 몫**. 회원 명부에서 «sponsor·후원 0»으로 식별되고, 예비 후원자 너처링(문자 1차·메일 보조)에 태워 보낼 수 있다(여정은 운영자가 ON — 현재 기본 OFF). AM은 optin(member:true) − lit_return 로 수만 잰다.

## 회신 4 — KICC 프리필·훅
- 프리필 URL: `https://tbfa.co.kr/lantern-pay.html?intent=<intentId>` (회원 마스킹 이름·금액·정기/일시·NOTICE_PAY 표시 → 「결제창으로 이동」). 완료 뒤 SIREN 완료 화면 → 「내 등불 보러 가기」= `https://withwork.tbfa.co.kr/lp/<am_lp>?lit=1&am_anon&gate&intent=<intentId>` ✓.
- postback body `intentId` ✓(additive). 계좌 직접 입금: 관리자 [입금 매칭·통과](IBK 명세 통과)로 «완료» 행이 생기면 그 회원의 대기 의도(intent)를 완료 행에 이어 붙이고 postback·증서 ✓. 효성: 명세 반영(CSV 업로드·통과) 때 같은 처리 ✓. 대기 의도 행은 «취소 · [등불] 입금 확인 #N로 대체» 메모로 남는다.
- ⚠️ NOTICE_PAY 「카드 명세서에는 사단법인 교사유가족협의회로 표시」는 **포트원(사단법인 명의 PG) 이후에 참**이다. KICC 단계에서는 KICC 가맹 명의로 찍힐 수 있다 — 문구는 계약대로 넣었으니 사장님 판단.

## 회신 5 — 포트원
- 신청일·예상 완료: **미정(사장님이 포트원 가입·결제사 심사 신청)**. SIREN은 준비 끝 — env 4개(`PORTONE_STORE_ID`·`PORTONE_CHANNEL_KEY`·`PORTONE_CHANNEL_KEY_BILLING`·`PORTONE_WEBHOOK_SECRET`) 넣는 순간 [W3-2]가 `provider:"portone"`+SDK v2 payload로 바뀌고 웹훅이 결제 완료를 확정한다(AM 배포 0).
- 정기 = **카드·간편 빌링키**로 간다 ✓(빌링키 발급 payload 준비). 월 자동 청구(cron)·취소 반영은 포트원 API 키 등록 뒤 다음 라운드.
- 자가 점검: `/api/admin-lantern-selftest?run=1`(어드민) — 가입→bank 의도→한마디→정리까지 서버 안에서 돌린다.
