# A 영역(SIREN 신고·유족지원·공개사이트) 전수 검수 리포트
> 2026-05-23 / A 검수자

---

## 요약: P0 1건 / P1 4건 / P2 4건

---

## 검수한 워크플로우 (시나리오 목록 + 각 PASS/이슈)

| # | 워크플로우 | 결과 |
|---|---|---|
| W1 | 사건 제보 접수 → AI 분석 → 워크스페이스 카드 생성 → 담당자 배정 | PASS (흐름 정상) |
| W2 | 익명 제보 작성 → 본인 상세 조회 | P0 이슈 (reporterName 노출) |
| W3 | 제보 정식 접수 결정 (confirm) → 운영자 알림 | PASS |
| W4 | 악성민원 신고 접수 → AI 분석 → 워크스페이스 연동 | PASS (흐름 정상) |
| W5 | 법률 상담 접수 → AI 분석 → 변호사 자동 배정 → 알림 | PASS |
| W6 | 신고 수정 (submitted 상태) | P1 이슈 (내용 필드명 불일치 — 수정 무음 실패) |
| W7 | 법률 상담 삭제 | P1 이슈 (상태 검증 없음 — reviewing 상태도 삭제 가능) |
| W8 | 본인 신고 목록 조회 (my-reports 페이지) | PASS (API, 응답키 정합) |
| W9 | 익명 신고자 신원 공개 (어드민) | PASS (단계적 공개 + 감사 로그 정상) |
| W10 | 어드민 신고 목록 조회 (사건/악성민원/법률) | P1 이슈 (익명 신고에도 reporterName + memberName 무조건 노출) |
| W11 | 유족지원 신청 → AI 우선순위 → 메일 발송 → 워크스페이스 연동 | PASS |
| W12 | 대상자 자격 변경 신청 (eligibility-request) | PASS |
| W13 | 대상자 자격 변경 현황 조회 (eligibility-status) | PASS |
| W14 | 전문가 매칭 신청 (expert-match-request) | PASS |
| W15 | 전문가 매칭 목록 조회 (expert-match-list) | PASS |
| W16 | 전문가 1:1 세션 종료 (expert-session-end) | PASS |
| W17 | 채팅방 생성·메시지 송수신·읽음 처리 | PASS |
| W18 | 채팅 블랙리스트 차단 처리 | PASS |
| W19 | 게시판 글쓰기 → 댓글 → 조회수 증가 | PASS |
| W20 | 게시판 익명 작성 → 목록/상세 표시 | PASS (authorName을 "익명"으로 저장, memberId는 조회에 포함되나 UI 미노출) |
| W21 | 내 신고 현황 페이지 (my-reports.html) | P1 이슈 (W6 동일 — 수정 불가) |
| W22 | 내 구독 관리 페이지 (my-subscriptions.html) | PASS |
| W23 | 공개 게시판 목록 (로그인 불필요) | PASS |
| W24 | 사건 댓글 작성·투표·신고 (incident-comments) | PASS |
| W25 | 익명 신고: isAnonymous=true 시 DB에 reporterName/Phone/Email=null 저장 | PASS (create 단계) |

---

## 발견사항

### [P0] 익명 신고 상세 조회 시 reporterName 누출

- **위치**: `netlify/functions/user-my-report-detail.ts` 98~103행
- **증상**: `isAnonymous=true`인 신고의 상세 조회 응답에서 `reporterPhone`, `reporterEmail`은 마스킹하지만 `reporterName`은 그대로 포함됨. 비록 익명 신고 시 DB에 `reporterName=null`로 저장되기 때문에 실제로 노출되는 값은 null이지만, **마스킹 코드에 reporterName 누락**이라는 보안 정책 미완성 상태. 만약 향후 신고 수정 시 isAnonymous 전환이 생기거나 다른 경로로 저장될 경우 이름 누출 가능성.
- **기대동작**: `if (report.isAnonymous)` 블록 안에서 `reporterName`도 `undefined`로 마스킹해야 함.
- **근거**: `user-my-report-detail.ts:100-103` — `reporterPhone`·`reporterEmail`만 마스킹, `reporterName` 누락.
- **추가 맥락**: 현재 `incident-report-create.ts:69`, `harassment-report-create.ts:60`, `legal-consultation-create.ts:58`에서 `isAnonymous ? null : me.name`으로 저장하므로 실제 값은 null이지만, 보안 정책 코드가 불완전하여 잠재 위험.

---

### [P1-1] 신고 수정 시 내용이 저장되지 않는 버그 (필드명 불일치)

- **위치**: `public/js/my-reports.js` 471행 vs `netlify/functions/incident-report-update.ts` 35행, `harassment-report-update.ts` 35행, `legal-consultation-update.ts` 35행
- **증상**: 수정 모달에서 "저장하기" 버튼 클릭 시 서버에 `{ id, title, content, category, ... }` 형태로 전송하는데, 서버 3개는 모두 `body.contentHtml`을 읽음. `body.contentHtml`이 undefined이므로 내용 업데이트 조건이 걸리지 않아 제목만 바뀌고 내용은 변경되지 않음. 성공 토스트는 뜨지만 실제 내용은 저장 안 됨.
- **기대동작**: 클라이언트가 `contentHtml` 키로 보내거나, 서버가 `body.content`도 fallback으로 읽어야 함.
- **근거**: `my-reports.js:471` — `body: JSON.stringify({ id, title, content, category, ...extra })` / `incident-report-update.ts:35` — `const contentHtml = body.contentHtml !== undefined ? ...`.

---

### [P1-2] 법률 상담 사용자 삭제 시 상태 검증 없음

- **위치**: `netlify/functions/legal-consultation-delete.ts` 전체 (44행 직접 삭제)
- **증상**: `incident-report-delete.ts`와 `harassment-report-delete.ts`는 `sirenReportRequested=true && status='reviewing'`인 경우 삭제를 거부하지만, `legal-consultation-delete.ts`는 상태와 무관하게 어드민이 검토 중인 건도 사용자가 삭제할 수 있음.
- **기대동작**: `status`가 `submitted`(또는 `ai_analyzed`) 이외의 경우에는 사용자 삭제를 거부해야 함.
- **근거**: `legal-consultation-delete.ts:44` — 상태 체크 코드 없이 바로 `db.delete()`. `incident-report-delete.ts:40-43`에는 방어 코드 있음.

---

### [P1-3] 어드민 신고 목록에서 익명 신고자 이름·회원명 무조건 노출

- **위치**: `netlify/functions/admin-incident-reports.ts` 53~71행, `admin-harassment-reports.ts` 49~73행, `admin-legal-consultations.ts` 49~70행
- **증상**: 어드민 목록 API에서 `isAnonymous=true`인 행도 `reporterName`(신고서에 기재된 이름)과 `memberName`(members 테이블에서 JOIN한 실제 회원명)을 필터링 없이 그대로 응답에 포함. 별도의 `admin-anonymous-reveal` API(단계적 공개 + 감사 로그)가 있음에도 우회하여 노출됨.
- **기대동작**: 어드민 목록에서는 익명 신고에 `reporterName = null`, `memberName = null`로 마스킹하고, 신원 확인은 `admin-anonymous-reveal` API를 통해서만 허용해야 함(보안 설계 의도 일관성).
- **근거**: `admin-incident-reports.ts:58,70` — SELECT에 `reporterName`·`memberName` 모두 포함, 익명 여부 조건 없음.
- **참고**: 어드민 권한 자체는 `requireAdmin` 가드로 보호되어 있으므로 일반 사용자 노출은 아님. 그러나 설계 의도상 단계적 공개 절차를 우회하는 것은 P1 수준.

---

### [P1-4] 법률 상담 상세 조회(사용자)에서 익명 처리 없이 개인정보 응답

- **위치**: `netlify/functions/legal-consultation-detail.ts` 46~61행
- **증상**: `isAnonymous=true`인 법률 상담의 상세 조회 응답에서 `partyInfo`(당사자 정보) 필드를 마스킹 없이 그대로 응답. 또한 `reporterName`/`reporterPhone`/`reporterEmail` 필드도 (null이지만) 마스킹 코드 없이 그대로 포함.
- **기대동작**: 익명 신청의 경우 개인식별 가능 필드 마스킹 (특히 `partyInfo`는 null이 아닐 수 있음 — 익명이어도 당사자 정보를 입력하는 경우).
- **근거**: `legal-consultation-detail.ts:50` — `partyInfo: r.partyInfo`를 익명 여부 무관하게 응답. `user-my-report-detail.ts`는 마스킹 코드가 있으나 `legal-consultation-detail.ts`는 별도 API로 마스킹 없음.
- **참고**: `incident-report-detail.ts`와 `harassment-report-detail.ts`도 동일 패턴이지만 해당 테이블에 `partyInfo`가 없으므로 영향 없음.

---

### [P2-1] 게시판 수정 시 익명 설정 변경 허용 (authorName 불일치 가능)

- **위치**: `netlify/functions/board-update.ts` 54~56행
- **증상**: 수정 API에서 `isAnonymous`를 변경할 수 있지만, `authorName` 컬럼은 업데이트하지 않음. 최초 작성 시 `isAnonymous=true`였다면 `authorName='익명'`으로 저장되고, 수정 시 `isAnonymous=false`로 변경해도 `authorName`은 여전히 '익명'으로 남음.
- **기대동작**: `isAnonymous` 변경 시 `authorName`도 함께 갱신하거나, 수정 시 익명 전환 자체를 막아야 함.
- **근거**: `board-update.ts:54-56` — `isAnonymous` 업데이트 가능, `board-update.ts:38-53` — `authorName` 업데이트 없음.

---

### [P2-2] `legal-consultation-create.ts` export const config 위치

- **위치**: `netlify/functions/legal-consultation-create.ts` 248행 (파일 맨 끝)
- **증상**: `export const config = { path: "..." }`가 `export default` 아래에 위치. Netlify Functions v2에서는 동작하지만, 관례상 `export default` 앞에 위치해야 하며 다른 파일들과 일관성이 없음.
- **기대동작**: `export const config`를 파일 상단 또는 `export default` 직전에 배치.
- **근거**: `legal-consultation-create.ts:27` — `export default async ...`, `248행` — `export const config`. 비교: `support-create.ts:257`도 동일 패턴이므로 두 파일 공통 이슈.

---

### [P2-3] 타임라인에 `responding` 상태 표기 불일치

- **위치**: `public/js/my-reports.js` 35행 (`STAGE_FLOW.harassment`)
- **증상**: 화면 타임라인 흐름에 `harassment` 유형이 `'responding'` 단계를 포함하지만, `STATUS_LABEL`에는 `'responding'` 키가 없음(정의된 STATUS_LABEL에는 `responded` 만 있음). 해당 상태에서 라벨이 `'responding'`(원시값)으로 그대로 표시됨.
- **기대동작**: `STATUS_LABEL['responding'] = '답변 작성 중'` 추가하거나 STAGE_FLOW에서 `'responding'`을 `'responded'`로 수정.
- **근거**: `my-reports.js:19-29` — `STATUS_LABEL`에 `responding` 없음. `my-reports.js:35` — `STAGE_FLOW.harassment`에 `'responding'` 포함.

---

### [P2-4] 사건 댓글 작성에 `requireActiveUser` 미적용 (블랙 차단 우회)

- **위치**: `netlify/functions/incident-comments.ts` 96~97행 (POST)
- **증상**: 게시판 댓글(`board-comment-create.ts`)은 `requireActiveUser`를 적용하여 차단된 사용자의 댓글 작성을 막지만, 사건 댓글(`incident-comments.ts`)의 POST는 `authenticateUser`만 사용하여 차단(블랙) 회원도 댓글 작성 가능.
- **기대동작**: `authenticateUser` → `requireActiveUser`로 교체하여 블랙 사용자 차단 적용.
- **근거**: `incident-comments.ts:96` — `const user = authenticateUser(req)`. `board-comment-create.ts:23` — `const _r = await requireActiveUser(req)`.

---

## 검수 못 한/불확실 영역

1. **실제 DB 스키마 vs schema.ts 동기화**: 마이그레이션 이력 SQL(`drizzle/` 폴더)을 schema.ts와 1:1 비교하지 못함. 컬럼이 실제 DB에 존재하는지 코드로만 확인.
2. **`chat-search.ts`, `chat-message-delete.ts`의 `is_deleted` 컬럼**: 주석에 "마이그 후 활성화"라고 명시되어 있으나, 실제 마이그레이션 완료 여부 및 schema.ts 반영 여부 미확인.
3. **익명 신고의 `memberId` 항상 저장**: DB에 `memberId`가 저장되어 어드민이 `members` 테이블을 직접 조회하면 신고자 식별 가능. 이는 설계 의도(어드민만 reveal 가능)이나, `admin-anonymous-reveal` 절차를 우회하는 JOIN이 여러 어드민 API에 이미 존재(P1-3 참고).
4. **`report.html` 파일의 역할 혼동**: `public/report.html`이 실제로는 "활동 보고서" 페이지(`data-page="support"`)이며 "사건 제보" 페이지가 아님. SIREN 신고 HTML 진입점 `report-*.html` 카탈로그와의 정합성 확인이 불완전.
5. **전문가 매칭 후 채팅방 자동 생성 흐름**: 어드민이 매칭 승인 후 채팅방이 자동 생성되는 로직(`admin-expert-match-assign` 등)은 시간상 확인하지 못함.
6. **`admin-anon-audit.html`, `admin-anon-reveal.html` 프론트 검수**: 서버 API는 검수했으나 어드민 UI 페이지 코드 미확인.
