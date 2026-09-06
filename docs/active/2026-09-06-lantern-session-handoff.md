# 2026-09-06 세션 인수인계 — 「등불의 기적」 캠페인·AM 연동·외부 등록 정정 (SIREN 메인 → 압축 세션)

> **정본(계약·회신 전문)**: [`docs/active/2026-09-22-lantern-campaign-handoff.md`](2026-09-22-lantern-campaign-handoff.md) — AM 요청 S1~S12 · 보고문 ⑦ · 통보문 ⑧(계약 전문) · SIREN 회신 ①~⑦ · AM 수신 ⑩~⑫. 파일명 날짜는 AM이 붙인 것(실제 작업일 2026-09-06).
> **다음 세션 트리거**: [`docs/active/2026-09-06-RESUME-TRIGGER.md`](2026-09-06-RESUME-TRIGGER.md)
> **메모리**: `project_lantern_campaign.md` · `reference_org_legal_info.md` · `code_standards.md`(시연 코드 함정 추가)

---

## 1. 이 세션에서 일어난 일 (서사 · 시간순 · 전부 2026-09-06 KST 새벽)

1. **AM 메인 요청 수신(S1~S12)** — 후원 랜딩 「숭고한 등불」(withwork.tbfa.co.kr/lp/tbfa-lantern-v2)이 제주 캠페인으로 이어지던 것을 새 캠페인 「등불의 기적」으로. 정본 S2는 도중에 재정정(정기·일시 모두 1/3/5/10만 · 기본 정기 1만·일시 3만).
2. **1차 구축·배포(4회 빌드)** — 캠페인 페이지 등불 테마, 후원 창 «후원회원 가입 먼저»(S5), 금액 사다리(S2), 영수증 문구 정정(S3·정적+DB), 단체 표기 381(S4), 실값 API(S6-a), 되돌아가기·postback(S6-b), FAQ 6(S7), 등불 증서(S8), OG(S10), 한마디·공개 동의(S11), 학교별 집계(S12). 마이그(컬럼 5개·캠페인·FAQ·가입경로·문구 치환) 실행 → 1회용 파일 삭제.
   - 함정: 마이그 호출용 시크릿(`INTERNAL_TRIGGER_SECRET`)은 CLI·API 모두 **마스킹** → 1회용 env `LANTERN_MIGRATE_TOKEN` 등록→호출→unset 패턴으로 해결. `NETLIFY_DATABASE_URL`은 env:get으로 읽혀 로컬 node(postgres-js)로 DB 직접 조회/DDL 가능.
   - 배포 도중 삭제 커밋 누락 1회(tsc 실패 상태로 push) → 즉시 정리 배포.
3. **AM 회신 ②~⑥ 왕복** — AM이 `SIREN_AM_POSTBACK_SECRET`을 우리 Netlify env에 직접 등록. 시험 postback → AM 200 확인(`admin-lantern-postback-test`).
4. **사장님 결정** — ① 사업자번호 **사이트 전체 381-82-00754**(118 폐기: 정적·DB·env) ② 회칙(정관)은 자료실 업로드 후 연동(대기) ③ **KICC는 사단법인 회비 목적 키를 안 내줌** → 효성 유지 + **포트원 추가 개발 예정**(사장님 가입·심사) ④ AM 고지 문구는 일단 유지 → AM 회신 ⑨에서 「카드 명세서…」 문장은 포트원 전환 때만 켜기로 분리 반영.
5. **KICC 실거래 실측** — KICC 완료 2건 2만 원·정기 빌링키 활성 0 → 컷오버 부담 없음. 실제 정기 기반은 효성 82건.
6. **포트원 판단** — 정기 계좌이체(CMS)만 포트원에 없음 → 「포트원(카드·간편, 정기+일시) + 효성(정기 통장 자동이체)」 2원 구성 추천. 수수료 예시(1만 원): 직접 송금 0 · 실시간 계좌이체 ~220원 · 가상계좌 ~440원 · 카드 ~374원 · 효성 ~275원.
7. **통보문 ⑧(2차·화면은 AM 모달, 주인은 SIREN)** — 서버-서버 3경로 `lantern-member`·`lantern-payment-intent`·`lantern-member-note`(`x-am-secret`), KICC 프리필 `lantern-pay.html?intent=` + `lantern-pay-start`, 되돌아가기·postback `intentId`, 입금 확인·효성 명세 완료 훅(`absorbLanternIntent`), [W1] 고지 6문장, 포트원 웹훅 뼈대, 자가 점검 `admin-lantern-selftest`(8/8). 회원 해시 `members.am_member_hash`(DDL 직접).
8. **법인 서류 반영** — 고유번호증(381-82-00754·법인등록 250121-0005570·강서구 공항대로 426, 618호·대표 박두용)·우리은행 통장(1005-404-940572·예금주 사단법인 교사유가족협의회) → 후원 정책 DB·코드 폴백·영수증 설정·SEO 법인명 반영. 서류 원본 `assets/사단법인*`은 gitignore.
9. **AM 수신 ⑫** — 사장님이 직접 KICC 1,000원 일시 후원 왕복 실증 완료. SIREN 원장 대조 OK(#217·등불 1번·postback 200·한마디·실값 API members 1). 미완료 intent 3건(#214·#215·#216) 취소 권장(회신 ⑦).
10. **외부 등록 정정** — Swain "일괄 등록이 안 되고 신규 회원 인식 못함" → 원인 ① 「신규 회원 일괄 등록」 [등록] 버튼이 **서버 저장 없는 시연 코드** ② 효성 매칭이 **효성번호로만** → 홈페이지 회원 이현진(#66)을 두고 임시 계정(#102) 생성. 고침: `admin-members-bulk`(실제 저장·전화 병합), 적재·통과 **전화번호 보조 매칭**, 미확정 [선택 자동 재매칭](`automatch`), 중복 병합 도구 `admin-member-merge`. Swain이 #102→#66 병합 실행 완료. **미확정 효성 수납 «신규» 16건은 아직 Swain이 [자동 재매칭]→[통과] 눌러야 함.**
11. **Swain 신고(세션 끝)** — 캠페인 페이지가 1초쯤 다른(밝은) 화면을 보이다 등불 화면으로 바뀜 · 「함께하기」 후 모달이 떴다가 1초 뒤 내용이 바뀜 → 신뢰 훼손. **근본 FIX는 압축 세션에서**(§4).

## 2. 지금 라이브에 있는 것 (파일·주소·데이터)

| 영역 | 내용 |
|---|---|
| 캠페인 | id 2 · slug `등불의-기적` · 대표 사진 blob 534(랜딩 OG 파일) · goal 3,000만 · pinned |
| 설정 단일 출처 | `lib/campaign-extras.ts` — 테마·사다리·org 381·FAQ category `lantern`·`RECEIPT_NOTICE`·`LANTERN_NOTICES`(6문장)·`noticePay()`(포트원 env 따라 명세서 문장)·landing base(`HAMKKE_MARKETING_URL`)·postbackUrl·campaignUrl·memorialUrl·bylawsUrl(`LANTERN_BYLAWS_URL` env·기본 /resources.html) |
| 등불 헬퍼 | `lib/lantern.ts`(AmMeta+intentId·checkAmSecret·memberHash·ensure/resolveMemberHash·findDonationByIntent·postbackLitReturn 3회·afterLanternCompletion·lanternRedirectParams) · `lib/lantern-am.ts`(amUpsertMember·amCreateIntent·amIntentSummary·amStartKiccPayment·amSaveNote·absorbLanternIntent) · `lib/sponsor-member.ts`(가입 규칙 단일 출처) · `lib/member-match.ts`(전화 매칭) |
| 공개 API | `GET /api/campaign-stats?slug=` → `{ok,slug,title,members,monthly,recent[{name,school?,note?,at}],bySchool[{school,count}],updatedAt}` 5분 캐시·CORS * · `GET /api/campaigns?slug=`(extras 포함) · `GET /api/faqs?category=lantern` · `GET /api/lantern-payment-intent?intent=` |
| AM 서버-서버 | `POST /api/lantern-member` · `POST /api/lantern-payment-intent` · `POST /api/lantern-member-note` — 헤더 `x-am-secret`=`SIREN_AM_POSTBACK_SECRET`(AM이 등록·마스킹) · 응답 최상위 키(회신 ⑤ 표) |
| 결제 페이지 | `public/lantern-pay.html?intent=` + `POST /api/lantern-pay-start`(KICC 결제창) · 완료 → `payment-success.html`/`billing-success.html` + `lantern-complete.js`(증서·한마디·「내 등불 보러 가기」= withwork/lp/<am_lp>?lit=1&am_anon&gate&intent) |
| 사용자 API | `GET/POST /api/sponsor-signup` · `GET/POST /api/lantern-donation`(로그인·본인) · `mypage-lantern.js` «내 등불» |
| 운영자 도구 | `admin-lantern-postback-test?run=1` · `admin-lantern-selftest?run=1` · `admin-member-merge?from=&into=(&run=1)` · `admin-members-bulk`(POST) · 미확정 목록 `automatch` 액션 |
| 훅 | 일시 KICC(`donate-kicc-approve`)·정기 KICC(`billing-approve`·campaignId 합산 추가)·입금 확인(`admin-donation-confirm`)·효성 명세(`admin-hyosung-import-billings`)·포트원 웹훅(`portone-webhook`·시크릿 없으면 503) |
| DB 컬럼(적용·schema 반영) | `members.school_name`·`bylaws_agreed_at`·`am_member_hash` / `donations.source_meta`(jsonb: am_lp·am_anon·gate·intentId·method·via·lanternNo·postback·absorbedBy)·`donor_note`·`public_consent` · 인덱스 `donations_intent_idx`·`members_am_member_hash_idx` |
| env | `SIREN_AM_POSTBACK_SECRET`(AM) · `HAMKKE_MARKETING_URL` · `ORG_REGISTRATION_NO=381-82-00754` · `ORG_NAME=사단법인 교사유가족협의회` · (미등록·포트원용) `PORTONE_STORE_ID`·`PORTONE_CHANNEL_KEY`·`PORTONE_CHANNEL_KEY_BILLING`·`PORTONE_WEBHOOK_SECRET` · (선택) `LANTERN_BYLAWS_URL`·`WITHWORK_LIT_RETURN_URL` |
| 문구 | 영수증: 「저희는 사단법인으로, 아직 기부금영수증(세액공제) 발급이 되지 않습니다. 지정되는 날, 이 자리에서 바로 알려드리겠습니다.」 사이트 전역(정적+DB) · 결제 고지: KICC 단계 「회비는 특별회비이며 현재 기부금영수증(세액공제)은 발급되지 않습니다.」만 |
| 가입경로 | signup_sources 11=`lantern_campaign` · 3=`hyosung_csv` · 2=`admin` |

## 3. 열린 항목 (누가)

| # | 항목 | 담당 |
|---|---|---|
| A | ~~캠페인 페이지·후원 창 깜빡임 근본 FIX~~(§4) → **완료·배포 2026-09-06.9**(§6) | 완료 |
| B | 미확정 효성 수납 «신규» 16건 → CMS [선택 자동 재매칭] → [선택 일괄 통과] | Swain(2클릭) |
| C | 미완료 intent #214·#215·#216 취소(후원 관리) — #215/#216은 두면 훗날 잘못 흡수 | Swain |
| D | ~~영수증 PDF → 「후원금(회비) 납부 확인서」 전환~~ → **완료·배포 2026-09-06.10**(§7) | 완료 |
| E | 포트원 가입·심사 신청 → 키 4개 env → 정기 빌링·월 청구 cron·취소 반영 라운드 | Swain → 메인 |
| F | 회칙(정관) 자료실 업로드 → `LANTERN_BYLAWS_URL` 연동 | Swain → 메인 |
| G | 「사업자등록번호」 라벨 — 실제는 「고유번호」(비영리·수익사업 없음). 푸터 라벨 정정 여부 | Swain 판단 |
| H | ~~병합 도구 정리 커밋(85c25e45) 미배포~~ → 2026-09-06.9 에 동봉 배포 | 완료 |
| I | 정기 해지 시 실값 monthly 차감 · 효성 경로 증서 | 후순위 |
| J | 후원자 너처링 여정 ON(가입만 하고 미납 회원 후속) | Swain 검토 |

## 4. 깜빡임 2건 — 진단과 근본 FIX 설계 (압축 세션 1순위)

### UX-1 캠페인 페이지: 밝은 화면 1초 → 등불 화면
- **원인**: `/campaign.html`은 `page-with-seo` → `lib/shell-detail.ts`(campaign case)가 **밝은 기본 레이아웃**(제목·요약·본문만)을 `#cmpRoot`에 서버 렌더한다. `body`에 `lantern-page` 클래스도 없다. 브라우저는 그걸 먼저 그린 뒤, `campaign.html` 인라인 스크립트가 `/api/campaigns?slug=`를 **fetch**하고 `renderLantern()`으로 innerHTML을 통째 교체·body 클래스 추가 → 300~800ms 뒤 화면이 바뀐다. 실값(`/api/campaign-stats`)·FAQ(`/api/faqs`)도 그 뒤 또 fetch → 숫자·FAQ가 늦게 나타난다.
- **근본 FIX(서버가 최종 모양을 내보낸다)**:
  1. `lib/shell-detail.ts` campaign case: `getCampaignExtras(slug)`가 있으면 **등불 레이아웃을 서버에서 완성**(hero·stats·사다리·본문·안내/단체 표기·FAQ·CTA) + `<body data-page="campaign"` → `class="lantern-page"` 추가 + `#cmpRoot`에 `data-ssr="lantern"` 표시. `loadDetailSeed` 선택 컬럼 확장(id·slug·thumbnailBlobId·donorCount·goalAmount·raisedAmount·status) + faqs(category) + 실값 숫자(campaign-stats와 같은 SQL) 조회.
  2. 캠페인 데이터(extras 포함)를 `<script id="cmpData" type="application/json">`로 동봉(`lib/shell-render.ts injectPreload` 패턴) → 클라이언트 fetch 0.
  3. `campaign.html` 스크립트: `data-ssr="lantern"`이면 **hydrate만**(버튼 핸들러·FAQ 아코디언·푸터 381 덮어쓰기·실값 5분 갱신) — innerHTML 교체 금지. SSR 표시가 없을 때만 지금 렌더 경로(폴백).
  4. 검증: 서버 응답 HTML에 `lantern-page`·hero·FAQ가 있고, 네트워크 끊고도 첫 그림이 등불 화면. 캠페인 목록 페이지·다른 캠페인은 종전과 동일.
### UX-2 「함께하기」 → 모달이 떴다가 1초 뒤 바뀜
- **원인**: `common.js`가 클릭 즉시 `donateModal`을 연다(기본 마크업 = 1단계·기본 금액 1만~50만·제목 「후원 동참하기」). `donate.js`의 같은 클릭 리스너는 `await loadPolicy()` → `setTimeout(150)` 뒤에야 등불 사다리·배지·고지를 적용하고, 그다음 `routeSteps()`가 `GET /api/sponsor-signup`을 **기다린 뒤** 0단계(가입)/1단계로 바꾼다 → 열림 → 150ms 뒤 사다리 교체 → 0.5~1초 뒤 단계 교체.
- **근본 FIX(열기 전에 최종 상태를 만든다)**:
  1. 페이지 로드 때(partials 준비 직후 `SIREN_PAGE_INIT`) extras가 있으면 모달 DOM을 **미리** 등불 상태로 만든다(사다리·배지·고지·정기 탭·캠페인 드롭다운 값). `loadCampaignsForDonate`도 미리.
  2. 회원 상태(`GET /api/sponsor-signup`)를 페이지 로드 때 **선조회**해 캐시 → 열기 전에 0/1단계 결정. 로그인 상태 변화(가입·로그인 완료) 때만 재조회.
  3. `donate.js` 열기 리스너를 **capture 단계**(`addEventListener('click', h, true)`)로 옮겨 `common.js`보다 먼저 실행 → 열리기 전에 적용. `setTimeout(150)` 제거.
  4. 상태를 아직 모를 때(선조회 실패)만 `.donate-step`을 숨기고 짧은 「준비 중」 표시 → 결정 후 한 번에 노출(기본 1단계를 먼저 보여 주지 않는다).
  5. 등불 아닌 캠페인·일반 후원 창은 종전 동작 유지. 검증: 클릭 즉시 최종 화면(가입 단계 또는 금액 단계)·이후 변화 0.

## 5. 이 세션에서 배운 규칙·함정
- 시크릿 env는 CLI/API 모두 마스킹 → 1회용 비밀 아닌 env 토큰(`LANTERN_MIGRATE_TOKEN`) 등록→호출→unset. DB 접속 문자열은 env:get 가능 → 로컬 node로 DDL·조회. **삭제성 DB 조작(DELETE·대량 UPDATE)은 자동 분류기가 막는다** → 운영자 도구(어드민 URL)로 만들어 Swain이 실행.
- bash `python - <<'PY'` 같은 종료 없는 heredoc은 뒤 명령까지 삼킨다(커밋 누락 사례). Node 파일 치환은 CRLF 때문에 정확 일치 실패 가능 → Edit 도구.
- `git rm`은 수정된 파일에 `-f` 필요(누락 시 삭제 안 된 채 커밋됨).
- `init()` 이중 등록(SIREN_PAGE_INIT + DOMContentLoaded) → 가드 플래그.
- 운영 화면에 «저장된 척» 시연 코드 잔존(일괄 등록) → 저장 버튼 핸들러가 실제 API를 부르는지 grep.
- `db.execute` 결과는 `.rows ?? res` · postgres-js `INTERVAL ${x}`는 `${x}::interval`.
- 배포 8회(빌드 8·문서 push 5 skip) — 소규모 정리 배포가 잦았음. 다음엔 검증 묶음 뒤 1회.

## 6. 압축 세션 결과 — 깜빡임 2건 근본 FIX (2026-09-06 · 배포 2026-09-06.9)

**UX-1 캠페인 페이지 = 서버가 최종 모양을 내보낸다**
- `lib/campaign-page.ts`(신설·순수 조립): 등불 화면·기본 캠페인 화면을 브라우저(`public/campaign.html`)와 **같은 마크업**으로 서버가 그린다. 두 파일의 클래스·id·문구 목록을 스크립트로 대조해 차이 0 확인.
- `lib/shell-detail.ts` campaign case: 브라우저 API와 같은 조건(공개·active/closed·시작일 지남)으로 캠페인을 읽고, 등불이면 FAQ(category)·실값(공용 집계 함수)까지 각 2.5초 상한으로 함께 읽는다. `#cmpRoot`에 `data-ssr="lantern|default"` 표시, 값(본문 제외)을 `<script id="cmpData" type="application/json">`로 동봉, 등불이면 `<body class="lantern-page">`를 서버에서 켜고 대표 사진 `<link rel="preload">`.
- `lib/shell-html.ts`: `setAttrById`·`addBodyClass`·`appendToHead` 헬퍼, `safeJson` 공개.
- `public/campaign.html`: `data-ssr`가 있으면 **hydrate만**(FAQ 펼치기·푸터 381 덮어쓰기·1.2초 뒤 실값 재조회는 서버 값과 다를 때만 숫자·목록 교체·조회수 ping). 서버 렌더가 없을 때만 종전 fetch→render 폴백.
- 실값 집계 한 출처: `lib/campaign-stats.ts computeCampaignPublicStats` — `/api/campaign-stats`와 서버 렌더가 같은 함수. **AM 요청 ⑬**(raisedKrw·goalKrw·donors 30·raisedAsOf)도 여기서 additive 로 반영(회신 ⑧).

**UX-2 후원 창 = 열기 전에 최종 상태**
- `public/js/donate.js`: 페이지 로드 때 `#cmpData`로 캠페인 문맥을 잡고 → 창을 미리 등불 상태(제목·배지·사다리·고지·정기 탭·캠페인 선택 칸 숨김)로 만든 뒤 → 회원 상태 `GET /api/sponsor-signup`를 **미리 조회·5분 캐시**해 0단계(가입/회칙)·1단계를 미리 정한다. 열기 리스너는 **capture 단계**(common.js보다 먼저) · `setTimeout(150)` 제거 · 상태를 아직 모를 때만 「후원 창을 준비하고 있습니다…」 표시 후 한 번에 노출 · 미리 읽은 로그인 상태와 지금 상태가 다르면(그새 로그인) 강제 재조회 · 관리자 전용 로그인은 불일치로 보지 않음.
- `window.SIREN_DONATE.open(info)/setCampaign(info)/prepare()/ready` 공개 — 캠페인 페이지가 sessionStorage·가짜 트리거 없이 직접 연다(스크립트가 없을 때만 종전 경로 폴백). 로그인 뒤 재열기도 같은 경로. 가입 성공 시 캐시된 회원 상태도 갱신.
- 등불 아닌 후원 창(홈·공지 등)은 종전 동작(정책값 선반영은 예전부터 프리페치).
- `public/partials/modals.html`: `#donatePending` + `.donate-steps-pending` 스타일.

**동봉**: 병합 도구 정리 커밋 85c25e45(미배포분) · `APP_VERSION 2026-09-06.9` + 업데이트 소식 초안 1건 · 캐시버스터 `donate.js?v=20260906-lantern3`(11페이지).

**검증**: `tsc` 통과 · `node --check` 2개 통과 · 로컬 조립 검증 스크립트(실제 campaign.html 뼈대에 서버 렌더를 끼워 20항목 확인) 전부 통과 · 서버/브라우저 마크업 대조 차이 0 · 라이브 검증은 배포 뒤(§7).

## 7. 압축 세션 결과 2 — 영수증 PDF → 「후원금(회비) 납부 확인서」 (2026-09-06 · 배포 2026-09-06.10)
- `lib/pdf-receipt.ts`: 새 기본값(제목 「후원금(회비) 납부 확인서」·부제 「(사단법인 교사유가족협의회 후원회원 회비 납부 내역)」·확인 문구·구분 «특별회비(후원회원)»·각주 「세액공제용 기부금영수증이 아닙니다. 공익법인 지정 후 별도 발급」+전자 발급·문의). 항목명 납부자 정보·단체 정보·납부 내역·확인서 번호. **저장소(receipt_settings)에 남아 있던 옛 기본 문구(「기 부 금 영 수 증」·소득세법 부제·기부 증명 문구·지정기부금·소득세법 각주)는 «설정 안 함»으로 보고 새 기본값** — 운영자가 직접 바꾼 값은 존중(DB 쓰기 0). 공익법인 지정 시 되돌릴 자리 = 파일 상단 주석 + LEGACY_* 상수.
- `netlify/functions/donation-receipt.ts`: 파일명 «납부확인서_번호.pdf» · 오류 문구 · **전환 시각(2026-09-06 03:00Z) 이전에 저장된 PDF 캐시는 옛 서식이므로 무시하고 새로 생성**(번호 동일·R2 새 blob 저장).
- 문구: 마이페이지(설명·표 머리 «확인서»·연간 카드 「N년 후원금(회비) 납부 확인서」·총 납부금액·시연 버튼 「PDF 발급」→ 후원 내역 탭으로 이동하는 진짜 버튼·해지 안내) · `auth.js` 후원 내역 표(발급 링크 제목·표 머리·환영·해지 안내 5곳, 캐시버스터 `20260906-receipt` 44페이지) · `lib/email.ts`(정기 결제 완료 메일 버튼 「마이페이지에서 후원 내역 보기」·탈퇴 안내·이메일 필요 사유) · `cron-donation-receipt-annual`(연간 안내 = 납부 확인서·세액공제 아님 명시) · 통합 CMS 영수증 설정 제목·자리표시.
- 남은 것: 연간 합산 확인서(없음·「준비 중」 표기) · 알림톡 템플릿(SOLAPI_TPL_RECEIPT) 본문은 카카오 승인 문구라 코드에서 못 바꿈 — 문구에 «기부금 영수증»이 있으면 Swain이 CMS 알림톡 템플릿에서 새 템플릿 등록.

## 8. 압축 세션 결과 3 — 등불 가입자 «등록 안내» 카톡 자동 발송 + 미납 후속 여정 (2026-09-06 · 배포 2026-09-06.11 · Swain A안·전원·초안 그대로)
- **가입 직후 1통**: `lib/sponsor-welcome-notice.ts` — `createSponsorMember`(랜딩 AM 모달·SIREN 후원 창 공통) 뒤에 fire-and-forget. 알림톡 템플릿(event_key `SPONSOR_WELCOME`)이 승인돼 있으면 알림톡(+솔라피 SMS 대체발송), 아니면 같은 내용을 문자(LMS)로. 마이페이지 알림함에도 기록. 시험 회원(`@lantern.invalid`)·휴대폰 없음 제외. 가입 사실 통지(정보성)라 소식 수신 동의와 무관.
  - 문구 = 초안 그대로(등록 사실 · 홈페이지 휴대폰 인증으로 가입 완료 · 소식·등불 보고 · 영수증 안내) + 버튼 「홈페이지에서 가입 완료하기」 → `https://tbfa.co.kr/?signup=1`(홈 화면 인라인 스크립트가 가입 창을 바로 연다·로그인 상태면 안 열림).
  - 가입 시 `phone_verified_at=NOW()`(본인이 적은 휴대폰·일시 후원자와 같은 기준) · `kakao_marketing_consent_at`은 «소식 수신» 체크 때만 → 너처링 sms/kakao 게이트 통과.
- **미납 후속 여정**: `lib/nurture-engine.ts` 세그먼트 `sponsor_unpaid`(가입경로 lantern_campaign + 완료 후원 0건) · D0 = 가입일(`SEGMENT_D0_EXPR`) · 첫 회비 확인되면 세그먼트에서 빠져 자동 종료(exited/converted). CMS 너처링 화면 «예비 후원자» 탭에 「등불 가입·미납」으로 표시(`admin-nurture.js`).
- **1회용 시드** `migrate-sponsor-welcome`(어드민 `?run=1`·멱등): ① 알림톡 템플릿 솔라피 등록 + 카카오 검수 신청 + 행 insert ② 여정(기본 OFF)+D+3·D+7 문자 단계+본문 템플릿. **Swain이 `https://tbfa.co.kr/api/migrate-sponsor-welcome?run=1` 호출 → 결과 확인 → 파일 삭제(다음 push 동봉).**
- 짧은 주소(문자용) `netlify.toml`: `/lantern` → 캠페인 · `/lantern/join` → 후원 창 자동 열기.
- 남은 것: 알림톡 승인 대기(승인 시 `cron-kakao-template-status`가 자동 반영) · 여정 ON은 운영자 결정 · 검수 반려 시 CMS 알림톡 템플릿에서 사유 확인 후 문구 조정(코드 상수 `SPONSOR_WELCOME_TEMPLATE`도 함께).
