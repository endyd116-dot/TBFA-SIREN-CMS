# 운영 전 전수 검수 — A영역 리포트 (SIREN 신고 + 유족지원 + 공개사이트·소통)

> 검수일: 2026-05-23 · 브랜치: `feature/r40-kicc-front` (HEAD `d37b6fd`) · 검수자: A채팅(읽기전용)
> 정책: 코드 수정·push 없음. 본 리포트만 commit. 발견사항 리포트 전용.

---

## 1. 요약

| 심각도 | 건수 | 한 줄 |
|---|---|---|
| **P0** (운영 차단) | **0** | 사이트 다운·결제·인증 즉시 장애 없음 |
| **P1** (출시 전 수정 권장) | **4** | 신고 수정 데이터 손실 / 전문가상담 내역 미표시 / 게시글 구독 버튼 실패 / 익명 신원공개 권한 게이팅 부재 |
| **P2** (출시 후 단기) | **3** | 신고 알림 딥링크 404 / 내신고 페이지네이션 어긋남 / 미정의 mock 잔재 |
| 관찰(정보) | 4 | 첨부 AI 미반영·차단가드 경미 불일치·잔재파일·urgency 어휘 |

**총평**: 신고 3종 접수·AI 분석·confirm 핵심 경로, 유족지원 신청/업로드/다운로드/보완, 채팅, 콘텐츠 조회는 **end-to-end 정상**이고 권한·익명 처리(첨부 다운로드 이중검증, 채팅 룸 가드, 익명 시 신원 null 저장)도 견고합니다. 다만 **"마이페이지 사후 흐름"(내신고 수정 / 전문가상담 내역 / 게시글 구독)에서 프론트↔백엔드 계약 불일치 3건**이 공통적으로 발견됐고, 모두 "성공한 듯 보이지만 실제로는 동작 안 함" 유형이라 사용자 신뢰에 직접 타격이라 출시 전 수정을 권장합니다.

---

## 2. 검수한 워크플로우 목록

| # | 워크플로우 | 결과 |
|---|---|---|
| 1 | 사건 신고 접수 → AI 분석 → 정식접수 confirm (`incident.js` ↔ `incident-report-create/confirm`) | ✅ PASS |
| 2 | 사건 목록·상세 공개 조회 (`incidents.ts`, status=active 필터) | ✅ PASS |
| 3 | 사건 댓글 작성/투표/신고 (`incident-comments.ts`, 비공개·숨김 필터) | ✅ PASS (단 P2-③ mock 잔재) |
| 4 | 괴롭힘 신고 접수 + AI게이트(후원자) + 일반신고(skipAi) (`harassment.js` ↔ create/confirm) | ✅ PASS |
| 5 | 법률 상담 접수 + AI 변호사 자동배정 (`legal.js` ↔ create/confirm) | ✅ PASS (단 P2-① 알림 딥링크) |
| 6 | 내 신고 목록·타임라인 조회 (`my-reports.js` ↔ `user-my-reports`) | ⚠️ 이슈 (P2-②) |
| 7 | 내 신고 수정(submitted) 3종 (`my-reports.js` ↔ `*-report/consultation-update`) | ❌ 이슈 (**P1-①**) |
| 8 | 익명 신원 단계적 공개 + 감사로그 (`admin-anonymous-reveal(-logs)`) | ⚠️ 이슈 (**P1-④** 권한) |
| 9 | 유족지원 신청 + 운영자/신청자 메일 + AI 우선순위 (`support.js` ↔ `support/create`) | ✅ PASS |
| 10 | 유족지원 첨부 업로드/다운로드 (`support/upload`·`support/download`) | ✅ PASS (권한 이중검증 견고) |
| 11 | 유족지원 보완 자료 제출 (`support-supplement`) | ✅ PASS |
| 12 | 회원 자격 변경 신청/조회 (`mypage-eligibility.js` ↔ `eligibility-request/status`) | ✅ PASS |
| 13 | 전문가(변호사·상담사) 매칭 신청 (`expert-match-request`) | ✅ PASS |
| 14 | 전문가 매칭 내역 조회·채팅입장 (`mypage-expert-match.js` ↔ `expert-match-list`) | ❌ 이슈 (**P1-②**) |
| 15 | 자유게시판 목록/상세/작성/수정/삭제 (`board.js` ↔ `board/*`) | ✅ PASS |
| 16 | 게시판 댓글 작성/삭제/멘션 (`board/comment-*`) | ✅ PASS |
| 17 | 게시글 구독(새 댓글 알림) 토글 (`board.js` 구독 버튼) | ❌ 이슈 (**P1-③**) |
| 18 | 1:1 채팅 방생성/메시지/이미지/읽음 (`chat-user.js` ↔ `chat/*`) | ✅ PASS (룸 권한·블랙리스트 견고) |
| 19 | 내 구독·멘션 알림 (`my-subscriptions.js` ↔ `user-post-subscriptions`·`user-mentions`) | ✅ PASS |
| 20 | 콘텐츠 조회 — 공지/FAQ(`/api/notices`·`/api/faqs`)·활동(`activity-posts`)·캠페인(`campaigns`) | ✅ PASS (응답키 정합) |

---

## 3. 발견사항

### 🔴 P1 — 출시 전 수정 권장

#### P1-① 신고 수정 시 본문·분류 변경이 저장되지 않음 (조용한 데이터 손실)
- **증상**: 마이페이지 "내 신고"에서 접수(submitted) 상태 신고를 수정하면 **제목만 저장되고 내용·분류 변경은 사라짐**. 게다가 수정 모달이 열릴 때 **본문칸이 빈 채로 뜸**. 그런데 "수정되었습니다" 성공 토스트는 표시돼 사용자는 저장된 줄 앎.
- **위치**:
  - 프론트 송신: [public/js/my-reports.js:471](public/js/my-reports.js#L471) — `body: { id, title, content, category, ...extra }` (본문을 `content`로 전송)
  - 백엔드 수신: [netlify/functions/incident-report-update.ts:35](netlify/functions/incident-report-update.ts#L35) / [harassment-report-update.ts:35](netlify/functions/harassment-report-update.ts#L35) / [legal-consultation-update.ts:35](netlify/functions/legal-consultation-update.ts#L35) — `body.contentHtml`만 읽음, `category`/`urgency`/`frequency`/`incidentDate` 미처리
  - 모달 빈 본문 원인: [netlify/functions/user-my-reports.ts:46-118](netlify/functions/user-my-reports.ts#L46) — 목록 응답에 `contentHtml`/`category` 자체를 SELECT하지 않음 → [public/js/my-reports.js:283](public/js/my-reports.js#L283)의 `report.contentHtml||report.content`가 둘 다 undefined
- **기대**: 접수 상태 신고의 내용·분류를 수정하면 그대로 반영돼야 함.
- **근거**: 필드명 불일치 — 프론트 `content` ↔ 백엔드 `contentHtml`. `title`만 양쪽 일치(legal의 `partyInfo`도 일치). 3종 모두 동일 패턴. `skipAi`(일반)로 접수한 괴롭힘·법률은 status가 `submitted`로 남아 수정 버튼이 실제 노출되므로 도달 가능.

#### P1-② 전문가 상담 내역이 항상 "내역 없음"으로 표시 (채팅 입장 불가)
- **증상**: 마이페이지 "전문가 상담 신청" 패널에서 변호사·심리상담사 매칭을 신청해도, "진행중"·"완료·종료" 탭 모두 **항상 "내역 없음"**. 배정·채팅방 개설 후에도 "💬 채팅방 입장" 버튼이 안 보임.
- **위치**:
  - 백엔드: [netlify/functions/expert-match-list.ts:102-109](netlify/functions/expert-match-list.ts#L102) — `status` 쿼리를 무시하고 `ok({ active:[...], closed:[...] })` 반환
  - 프론트: [public/js/mypage-expert-match.js:195-196](public/js/mypage-expert-match.js#L195) — `payload.items || payload.matches`만 읽음 (둘 다 미존재 → 항상 `[]`)
- **기대**: 신청 내역이 진행중/완료 탭에 표시되고, 배정 시 채팅방 입장 버튼 노출.
- **근거**: 응답 키 계약 불일치(`active`/`closed` 반환 ↔ `items`/`matches` 기대). 비교: 같은 페이지의 자격 변경 모듈([mypage-eligibility.js:132-136](public/js/mypage-eligibility.js#L132))은 `r.data.data` fallback으로 올바른 키를 읽어 정상 동작 → 이 모듈만 키가 어긋남. (후기 작성 버튼은 [mypage-match-feedback.js:200](public/js/mypage-match-feedback.js#L200)에 핸들러 존재해 정상.)

#### P1-③ 게시글 구독(새 댓글 알림) 버튼이 항상 실패
- **증상**: 게시글 상세에서 "🔕 구독하기" 클릭 시 **"네트워크 오류" 토스트**. 구독 상태 표시도 항상 미구독으로 고정.
- **위치**:
  - 프론트: [public/js/board.js:476](public/js/board.js#L476) `/api/board-subscription-status`, [public/js/board.js:497](public/js/board.js#L497) `/api/board-subscription-toggle` 호출
  - 실제 함수: 두 엔드포인트는 **존재하지 않음**. 구독 함수는 [netlify/functions/user-post-subscribe.ts:9](netlify/functions/user-post-subscribe.ts#L9) (`/api/user-post-subscribe`, POST=구독·DELETE=해제) 하나뿐이며 상태조회 엔드포인트도 없음.
- **기대**: 구독 버튼 클릭 시 구독/해제 토글, 현재 상태 표시.
- **근거**: 미존재 경로 → netlify.toml 캐치올 `[[redirects]] /* → /404.html (404)`([netlify.toml:35-38](netlify.toml#L35))로 HTML 404 반환 → `res.json()` 파싱 throw → catch → 네트워크 오류. 토글 의미도 다름(단일 toggle+`subscribe` bool ↔ POST/DELETE 분리)이라 경로만 고쳐선 불충분. 참고: 마이페이지 구독 목록([my-subscriptions.js:52](public/js/my-subscriptions.js#L52))은 올바른 `/api/user-post-subscriptions`를 써서 정상 → board-view의 구독 버튼만 깨짐.

#### P1-④ 익명 제보자 신원 공개에 super_admin 게이팅 부재 (권한·익명성)
- **증상**: 익명 신고자 신원 단계 공개(이름/유형 → 이메일/전화)가 **일반 관리자(`type='admin'`) 전원에게 허용**됨. SIREN에서 가장 민감한 작업인데, 코드베이스의 다른 민감 기능보다 보호가 약함.
- **위치**: [netlify/functions/admin-anonymous-reveal.ts:35-37](netlify/functions/admin-anonymous-reveal.ts#L35) — `requireAdmin`만 통과하면 실행. role 체크 없음.
- **기대(확인 필요)**: 신원 공개는 super_admin 한정 또는 별도 권한으로 게이팅하는 것이 정책상 자연스러움.
- **근거**: 같은 코드베이스가 기본연봉 변경 등은 `ctx.member.role === 'super_admin'`로 게이팅함([admin-members.ts:892](netlify/functions/admin-members.ts#L892), 외 40+ 함수에 super_admin 패턴 존재). 신원 공개는 전건 감사로그(`anonymous_reveal_logs`에 adminId·사유·IP·레벨)로 사후 추적은 되나 사전 차단은 없음. → **정책 결정 사항**: super_admin 한정으로 강화할지 Swain 확인 필요.

---

### 🟡 P2 — 출시 후 단기 수정

#### P2-① 신고 알림·워크스페이스 카드 딥링크가 404 페이지로 연결
- **증상**: 신고 접수 시 생성되는 워크스페이스 카드의 "원본 보기" 링크와 법률 변호사배정 사용자 알림 링크가 **존재하지 않는 페이지**를 가리킴 → 404.html.
- **위치**: [incident-report-create.ts:126](netlify/functions/incident-report-create.ts#L126)·[harassment-report-create.ts:124](netlify/functions/harassment-report-create.ts#L124)·[legal-consultation-create.ts:125](netlify/functions/legal-consultation-create.ts#L125) → `sourceRefUrl: /admin-siren.html#...`; [legal-consultation-create.ts:190](netlify/functions/legal-consultation-create.ts#L190) → `link: /mypage-siren.html#legal-...`
- **기대**: 실제 존재 페이지(예: `/admin.html#...`·`/mypage.html#...`)로 연결. (참고: [incident-report-confirm.ts:67](netlify/functions/incident-report-confirm.ts#L67)은 올바르게 `/admin.html#incident-reports` 사용.)
- **근거**: `public/`에 `admin-siren.html`·`mypage-siren.html` 부재 확인. 특히 mypage-siren 링크는 **사용자가 받는 알림**이라 클릭 시 404 체감. 영향: 알림→이동만 끊김(데이터 정상).

#### P2-② 내 신고 목록 페이지네이션 어긋남
- **증상**: 신고가 많을 때 페이지 버튼 수·이동 결과가 부정확.
- **위치**: [user-my-reports.ts:37](netlify/functions/user-my-reports.ts#L37) `limit=20` 고정·`total` 미반환 ↔ [my-reports.js:8](public/js/my-reports.js#L8) `PAGE_SIZE=10` + [my-reports.js:184](public/js/my-reports.js#L184)에서 `limit` 전송하지만 서버가 무시, [my-reports.js:198](public/js/my-reports.js#L198) `total`을 현재 페이지 행수로 대체.
- **기대**: 서버가 클라 `limit` 존중 + `total` 반환, 페이지네이션 일관.
- **근거**: 서버/클라 페이지 크기 불일치(20 vs 10) + total 미제공 → 총 페이지 수 오산·page 2 이동 시 항목 건너뜀.

#### P2-③ incident.js의 미정의 `MOCK_COMMENT_REPORT` 잔재
- **증상**: 댓글 신고 API가 비정상(예: 500) 응답할 때 `ReferenceError: MOCK_COMMENT_REPORT is not defined` 발생 → (try/catch가 흡수해) "오류가 발생했습니다" 일반 토스트.
- **위치**: [public/js/incident.js:720](public/js/incident.js#L720) — 정의되지 않은 `MOCK_COMMENT_REPORT` 참조 (주석 [457-458](public/js/incident.js#L457)에만 언급).
- **기대**: mock 잔재 제거. 실제 `comment-report.ts`는 존재하므로 정상 경로는 동작.
- **근거**: 변수 정의 부재 + 잔재 주석. 영향 낮음(정상 응답 시 미도달, 에러 시 catch로 흡수).

---

### ⚪ 관찰 (정보·경미)

- **유족지원 첨부 AI 미반영**: [support-create.ts:71-74](netlify/functions/support-create.ts#L71)가 첨부 key(문자열 경로)를 `Number(k)`로 변환 → 항상 NaN → AI 우선순위 분석에 첨부 미전달. 저장/상세표시/다운로드는 정상.
- **차단(suspended) 회원 가드 경미 불일치**: confirm 류([incident-report-confirm.ts:24](netlify/functions/incident-report-confirm.ts#L24))·채팅([chat-mine.ts:34](netlify/functions/chat-mine.ts#L34))·support 업로드 등은 `requireActiveUser` 대신 `authenticateUser` 사용 → 일반 정지 회원도 일부 동작 가능. 단 본인 스코프 한정 + 채팅은 별도 `chat_blacklist` 체크로 보완돼 위험 낮음.
- **잔재 파일(횡단 검수 위임 결과)**: `public/test-attachment.html` 테스트 페이지, `migrate-*.ts` 9개(1회용·호출 후 삭제 원칙)가 잔존 → 출시 전 정리 권장. (내 검수 범위 영역엔 토스/알리고 잔재 없음 — 깨끗.)
- **legal urgency 어휘 불일치**: 수정 모달은 `urgent/high/normal/low`([my-reports.js:318](public/js/my-reports.js#L318)) 제시, create는 `urgent/normal/reference`만 허용([legal-consultation-create.ts:25](netlify/functions/legal-consultation-create.ts#L25)). 어차피 update가 urgency 미처리(P1-①)라 현재는 무영향.

---

## 4. 검수 못한 / 부분만 본 영역

- **관리자 처리 화면 로직 심층**: `admin-incident-reports`·`admin-harassment-reports`·`admin-legal-consultations`·`admin-support`·`admin-expert-*`·`admin-eligibility-*`의 상태 전이·답변·배정 상세 로직은 **사용자 워크플로우 위주 검수**라 깊이 보지 않음. (익명 reveal·reveal-logs는 검수함.)
- **결제(donate/billing/payment/KICC 전환)**: 범위 외 — 다른 채팅 담당. (단 본 브랜치가 KICC 전환 중이므로 결제 잔재는 횡단 Explore 결과에 별도 기록됨.)
- **AI 라이브러리 내부**: `ai-incident/harassment/legal/priority`의 프롬프트·폴백 동작은 호출 계약만 확인, 내부 미검증.
- **캐시버스터(`?v=`) 정합**: HTML `<script>` 태그의 버전 일괄 대조는 미수행(JS 로직 정합 위주). 출시 전 변경 JS의 `?v=` 갱신 여부 별도 점검 권장.
- **curations 공개 노출 경로**: 공개 큐레이션 API 미발견(`admin-curations`만 존재) — 공개 노출이 별도 경로(캠페인·활동·공지)로 흡수되는지 미확정.
- **HTML `data-page` 매핑·partials 로드 순서**: 각 JS의 `document.body.dataset.page` 의존부는 코드로만 확인, 실제 HTML 속성 일치는 라이브 미검증.

---

## 5. 권장 조치 우선순위

1. **P1-① / P1-② / P1-③** (프론트↔백 계약 3건): 모두 "성공처럼 보이나 실동작 안 함" → 출시 전 수정. 수정 규모 작음(필드명/응답키/엔드포인트 정합).
2. **P1-④**: Swain 정책 결정 — 익명 신원공개 super_admin 한정 여부.
3. **P2-①**(딥링크) → 알림 신뢰 직결이라 빠른 후속.
4. P2-②·P2-③·관찰 항목은 후속 정리.

---

*검수 방식: 각 워크플로우를 프론트(JS/HTML) → API 호출 → 백엔드 함수 → DB까지 end-to-end 추적, 5축(① 단절 ② 로직연결 ③ 업데이트누락 ④ 회귀/잔재 ⑤ 권한·익명·무결성) 점검. 코드 무수정.*
