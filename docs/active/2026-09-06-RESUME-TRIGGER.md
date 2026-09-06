# 트리거 — SIREN 메인 압축 세션 (2026-09-06) · 「등불의 기적」 깜빡임 근본 FIX + 후속

> Swain이 새 채팅 첫 메시지로 붙여 넣는 트리거. 이 세션의 역할 = **SIREN(tbfa-mis) 메인** 단독(A·B·C 없음).

## 0. 먼저 정독(순서대로)
1. 이 파일
2. [`docs/active/2026-09-06-lantern-session-handoff.md`](2026-09-06-lantern-session-handoff.md) — 직전 세션 서사·라이브 현황·열린 항목·**§4 깜빡임 진단과 FIX 설계**
3. [`PROJECT_STATE.md`](../../PROJECT_STATE.md) §2 최상단 블록 3개
4. 메모리 `project_lantern_campaign.md` · `reference_org_legal_info.md` · `code_standards.md` 1-b(시연 코드 함정)
5. 필요할 때만: 정본 [`docs/active/2026-09-22-lantern-campaign-handoff.md`](2026-09-22-lantern-campaign-handoff.md)의 통보문 ⑧ 계약 블록·SIREN 회신 ⑤(엔드포인트 모양)

## 1. 1순위 — 깜빡임 2건 근본 FIX (Swain: "신뢰를 깨는 것 같다 · 근본 FIX")
증상: `https://tbfa.co.kr/campaign.html?slug=등불의-기적` 여는 순간 밝은 기본 화면이 1초쯤 보이다 등불 화면으로 바뀜 · 「후원회원으로 함께하기」 누르면 모달이 떴다가 1초 뒤 내용(금액 칸·단계)이 바뀜.

- [x] **UX-1 페이지**: 서버가 최종 모양을 내보낸다 — `lib/shell-detail.ts` campaign case에 등불 레이아웃 SSR(+ body `lantern-page` + `#cmpRoot[data-ssr="lantern"]` + FAQ·실값 동봉) · 캠페인 데이터 `<script id="cmpData" type="application/json">` 동봉(`shell-render.injectPreload` 패턴) · `public/campaign.html`은 SSR 있으면 **hydrate만**(innerHTML 교체 0)·없으면 폴백 렌더. 서버·클라 마크업이 같아야 한다(클래스·id 목록 대조).
- [x] **UX-2 모달**: 열기 전에 최종 상태 — `public/js/donate.js`: 페이지 로드 때 extras로 모달 선적용(사다리·배지·고지·정기 탭·드롭다운) + `GET /api/sponsor-signup` 선조회 캐시 → 0/1단계 선결정 · 열기 리스너 capture 단계로(common.js보다 먼저) · `setTimeout(150)` 제거 · 상태 미확정 때만 「준비 중」 후 한 번에 노출 · 등불 아닌 후원 창은 종전 유지 · `init` 이중 등록 가드 유지.
- [x] 캐시버스터: `donate.js?v=`(11개 페이지 일괄 sed)·`campaign.html` 인라인 · `lantern.css` 바뀌면 4곳.
- [x] 검증: (a) `curl` 서버 HTML에 `lantern-page`·hero·FAQ·cmpData 존재 (b) 브라우저 — 첫 그림부터 등불, 이후 변화 0 · 클릭 즉시 최종 모달 (c) 다른 캠페인(제주)·홈 후원 창 회귀 0 (d) `node --check`·`tsc` · 자가 점검 `/api/admin-lantern-selftest?run=1`(어드민) 8/8 유지.
- [x] 배포 1회에 묶기: 병합 도구 정리 커밋(85c25e45·미배포)이 함께 나간다. `lib/release-drafts.ts` APP_VERSION 올리고 초안 1건(운영자 언어).

## 2. 2순위 — 영수증 PDF → 「후원금(회비) 납부 확인서」 (Swain 승인·AM E2E 끝났으므로 착수)
- [ ] `lib/pdf-receipt.ts`: 제목 「후원금(회비) 납부 확인서」 · 소득세법 각주 제거 · 「세액공제용 기부금영수증이 아닙니다. 공익법인 지정 후 별도 발급」 명시 · 단체 표기는 receipt_settings(사단법인·381·강서구 공항대로 426, 618호) · 마이페이지 버튼 라벨·`donation-receipt.ts` 파일명·메일 문구(`tplDonationThanks` 「후원 내역 보기」) 정합 · `cron-donation-receipt-annual` 연간 안내 문구 점검.
- [ ] 공익법인 지정 시 되돌릴 자리 주석 1줄.

## 3. Swain에게 안내할 것(세션 시작 때 한 번)
- 미확정 효성 수납 «신규» 16건: CMS 외부 등록 › 자료 업로드·통과 › 전부 선택 → [선택 자동 재매칭] → [선택 일괄 통과].
- 미완료 intent #214·#215·#216(사장님 시험 재시도) 후원 관리에서 취소.
- 포트원 심사 결과 → env 4개(`PORTONE_STORE_ID`·`PORTONE_CHANNEL_KEY`·`PORTONE_CHANNEL_KEY_BILLING`·`PORTONE_WEBHOOK_SECRET`) 받으면 그 라운드 시작(정기 빌링·월 청구 cron·취소 반영).
- 회칙(정관) 자료실 업로드 알림 → `LANTERN_BYLAWS_URL` 연동.

## 4. 규칙(이 세션 그대로)
- push = 배포 = 과금: 검증 묶음 뒤 **1회**. 문서만은 HEAD `[skip netlify]`(코드 커밋과 섞을 땐 HEAD에 금지).
- 삭제성 DB 조작 금지(분류기도 막음) → 어드민 URL 도구로 만들어 Swain 실행. 시크릿 env는 마스킹 → 1회용 `LANTERN_MIGRATE_TOKEN` 패턴.
- `public/js/*.js` 순수 JS(`node --check`) · `auth.js`는 최소 수정 · 캐시버스터 전 페이지 · `requireAdmin` 반환은 `res` · `/api/*` 함수 `export const config = { path }`.
- 답변·보고는 한국어·기능 위주(§6.14) · 진행률 % 한 줄(§6.16) · AM 메인과 주고받는 말은 정본 문서 말미에 「SIREN 회신 ⑧」부터 이어 쓰고, Swain 복붙용 한 줄로 전달.
