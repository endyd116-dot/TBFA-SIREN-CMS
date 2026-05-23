# 운영 전 전수 검수 라운드 (Pre-launch Full-System Audit)

> 2026-05-23 설계 / 메인 · Swain 지시
> 목적: **운영(오픈) 전에 모든 기능을 전수 점검** — 워크플로우 단절·로직 미연결·업데이트 누락을 전부 찾아낸다.
> 결과물: **발견사항 리포트 + 심각도 분류만** (수정은 우선순위 합의 후 별도 라운드). 검수 중 코드 수정 ❌.
> 분할: **도메인별 4등분** (메인/A/B/C). 깊이: **전 기능 균등**.
> 실행: **새 메인 세션**에서 시작 → A/B/C 트리거 발동 → 리포트 취합.

---

## §0 핵심 원칙
1. **검수만, 수정 금지.** 각 AI는 발견사항을 리포트에 적기만 한다. P0(치명)라도 직접 안 고치고 보고만(메인이 우선순위 합의 후 별도 fix 라운드). → 4개 병렬 수정의 충돌·회귀 원천 차단.
2. **읽기 전용 + 리포트 파일 1개씩.** 코드 edit 없음 → 워크트리 충돌 없음. 각자 자기 리포트 파일만 생성/커밋(서로 다른 파일 = 충돌 0). push는 메인 단독.
3. **심각도 3단계**: `P0` 운영 즉시 장애(사이트 다운·결제/인증/발송 실패·데이터 유실·보안) / `P1` 기능 오작동·워크플로우 단절(사용자 영향) / `P2` 개선·정합·UX·dead code.
4. **증거 기반.** 발견마다 `위치(file:line)` + `증상` + `기대동작` + `근거`. 추측 금지.

## §1 검수 5축 (각 도메인에 공통 적용)
각 AI는 자기 도메인을 아래 5축으로 훑는다.

1. **워크플로우 end-to-end**: 도메인의 핵심 사용자/운영 시나리오를 코드로 끝까지 따라가며 단계 누락·끊김 확인. (예: 후원신청→결제→완료저장→영수증→알림→등급재계산이 전부 연결됐나)
2. **로직 연결(계약 정합)**: 클라이언트 호출 ↔ 서버 응답 필드/키 일치(다중 fallback), `export const config={path}` 라우팅, 가드(`requireAdmin`/`requireActiveUser`) 적용, 이벤트 `dispatch` ↔ 어댑터 연결, FK·외래키 흐름.
3. **업데이트 누락**: `db/schema.ts` ↔ 실제 코드/마이그 동기화, 캐시버스터(`?v=`) 갱신, iframe 4곳 라우팅 등록, cron `netlify.toml` 등록, 환경변수 정합, 페이지 링크/onclick 우회.
4. **회귀·잔재**: 옛 시스템 흔적(토스→KICC, 알리고/프록시→솔라피), mock/placeholder/`__MOCK__`/DEMO 잔존, dead code, 죽은 링크(404), 미사용 함수/파일.
5. **권한·보안·데이터**: 4계층 권한 정합, 익명 신고 익명성, 블랙(차단) 처리, NOT NULL/UNIQUE/DEFAULT 충돌, 금액·날짜 등 무결성.

## §2 도메인 4등분 (균등·경계 명확)

### 🟦 메인 — 후원·결제·인증·알림 + 총괄
- **인증/회원**: `auth-*`(signup·login·phone-verify·password-reset·email-verify), `members`, 등급(`grade-*`)·`donor-status`
- **후원/결제**: `donate-*`·`billing-*`(KICC)·`hyosung-*`(효성)·`donations`·빌키/정기·영수증·`kicc-webhook`
- **알림 발송 엔진**: `notify-dispatcher/adapters/events`·`communication-send`·`solapi-client`·`email`·발송 cron(`cron-*-billing`·`cron-billing-upcoming`·`cron-donation-receipt-annual`·`cron-notification-retry`·`cron-communication-send-dispatcher`)
- **+ 총괄**: 5축 방법론·리포트 양식 통일, A/B/C 리포트 취합 → 마스터 우선순위표, 도메인 경계 교차검증

### 🟩 A — SIREN 신고 + 유족지원 + 공개 사이트·소통
- **SIREN 신고**: `incident-*`·`harassment-*`·`legal-*`·익명(`anon-*`)·배정·`report-*.html`
- **유족지원**: `support-*`(심리·법률·장학)·대상자(`eligibility-*`)·전문가매칭(`expert-*`·`mypage-expert-match`)
- **공개/소통**: 게시판(`board*`)·채팅(`chat-*`)·`news`·`activities`·`campaigns`·`curations`·공개 페이지 흐름·`my-reports`·`my-subscriptions`

### 🟨 B — 워크스페이스 + 근태 + 성과 + 급여 + AI
- **워크스페이스**: `workspace-*`(칸반·캘린더·파일·템플릿·알림·활동로그)·`admin-workspace-*`
- **근태**: `attendance`·`att-*`(출퇴근·휴가·근무형태·외근·실시간·지도)·근태 cron
- **성과/급여**: 마일스톤·결산·비매출(`milestone-*`·`*-settlement`)·급여(`payroll-*`·명세서·공제·PAID)
- **AI**: AI 비서·에이전트·도구(`ai-agent-*`·`ai-task-*`·`ai-*`)·AI cron(`cron-agent`·`cron-task-risk`)·비용 안전장치

### 🟧 C — 어드민 CMS 운영 + 재정 + 권한 + 콘텐츠빌더 + 인프라
- **운영/통계**: `admin` 대시보드·통계·회원관리·KPI·`admin-hub`
- **재정**: `expense`·`revenue`·`budget`·`voucher`·`bank-transactions`·`finance-report`·`other-revenues`
- **권한**: 4계층 권한·역할(`roles`·RnR·`service-rnr/assignee`)·운영자·`eligibility-review`
- **콘텐츠/빌더**: 사이트빌더·홈 섹션·팝업·폼빌더(`admin-forms`/`form.html`)·`curations`·매뉴얼(`manual*`)
- **인프라 정합**: 전체 cron `netlify.toml` 등록 점검·iframe 4곳·캐시버스터 전수·환경변수·`migrate-*` 잔존 여부

> 경계 메모: "발송"은 **엔진/어댑터/cron=메인**, **발송 어드민 화면(admin-send-*·템플릿·그룹·잡·분석)=C**. 겹치면 메인이 교차검증 시 정리.

## §3 출력 형식 (각 AI 리포트)
파일: `docs/active/2026-05-23-prelaunch-audit/{main|a|b|c}.md`
```
# {영역} 전수 검수 리포트
## 요약: P0 n건 / P1 n건 / P2 n건
## 검수한 워크플로우 (시나리오 목록 + 각 PASS/이슈)
## 발견사항
- [P0] {증상} | 위치 file.ts:line | 기대: ... | 근거: ...
- [P1] ...
- [P2] ...
## 검수 못 한/불확실 영역 (시간·정보 부족)
```

## §4 진행 구조·트리거
- 모델: 표준(메인 Opus / A·B·C Sonnet 4.6 — 검수는 패턴 추종이라 적합). 단 결제·보안 깊이 필요 시 메인이 Opus로 재확인.
- 워크트리: **불필요**(읽기 전용·리포트 파일만). A/B/C는 자기 워크트리(`tbfa-mis-A/B/C`)에서 자기 리포트 파일만 생성·커밋(push 금지·메인 취합).
- A/B/C 트리거 전문은 §4.1~4.3 (체크박스 양식). 메인은 §2 메인 도메인 검수 + 취합.

### §4.1 A 트리거 / §4.2 B 트리거 / §4.3 C 트리거
새 메인 세션이 본 설계서 기준으로 발동(아래 "새 세션 kickoff" 참조). 각 트리거: [영역 라벨]+[자율주행: 코드수정 금지·읽기전용·리포트만·push금지]+[진행률 보고]+[5축 체크리스트]+[출력 형식].

## §5 취합·마감 (메인)
1. A/B/C 리포트 3개 + 메인 리포트 → **마스터 우선순위표**(P0→P1→P2, 도메인·중복 제거).
2. 도메인 경계 이슈 교차검증(중복/누락).
3. Swain에 P0/P1 우선 보고 → **수정 라운드 우선순위 합의** → 별도 fix 라운드(이번 라운드는 검수까지).
4. 마스터 리포트 → `docs/history/`로 이동, PROJECT_STATE 갱신.

## §6 갱신 이력
| 시각 | 변경 |
|---|---|
| 2026-05-23 | 설계(리포트전용·도메인4분할·균등깊이) — Swain 결정 반영. 새 메인 세션 실행 대기 |
