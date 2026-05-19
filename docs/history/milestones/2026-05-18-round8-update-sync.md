# 라운드 8 — 수정 API 4종 + 보고↔작업 자동 동기화

> **작성**: 2026-05-18 / 메인 채팅
> **추정**: 메인 설계 1h / B 백 3h / A 프론트 2h / C 검증 2h / 합계 8h
> **모드**: 평행 (A는 mock으로 시작)

---

## §0 요구사항 확정

| 항목 | 결정 |
|---|---|
| 수정 허용 상태 | `status = 'submitted'` 일 때만 허용. 그 외 상태에서는 403 반환 |
| 보고↔작업 동기화 | 워크스페이스 작업 status → `done` 변경 시 연결 보고/신청 자동 `resolved` |
| 법률 상담 삭제 | 기존 DELETE API 없음 → 신규 추가 (submitted만) |
| 인증 | 4종 수정 API 모두 `requireActiveUser` (본인 데이터만) |

---

## §1 DB 설계

### 1.1 신규 테이블
없음 (기존 컬럼 충분)

### 1.2 기존 테이블 컬럼 추가
없음 (updatedAt 이미 존재)

### 1.3 마이그레이션
불필요

---

## §2 API 명세

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `support-update.ts` | `/api/support-update` | PATCH | requireActiveUser | 유가족 지원 신청 수정 |
| `incident-report-update.ts` | `/api/incident-report-update` | PATCH | requireActiveUser | 사건 보고 수정 |
| `harassment-report-update.ts` | `/api/harassment-report-update` | PATCH | requireActiveUser | 괴롭힘 보고 수정 |
| `legal-consultation-update.ts` | `/api/legal-consultation-update` | PATCH | requireActiveUser | 법률 상담 수정 |
| `legal-consultation-delete.ts` | `/api/legal-consultation-delete` | DELETE | requireActiveUser | 법률 상담 삭제 |
| `admin-workspace-tasks.ts` (수정) | `/api/admin-workspace-tasks` | PATCH | requireAdmin | status=done 시 연결 보고 자동 resolved |

### 2.2 함수별 상세

#### `support-update` (PATCH `/api/support-update`)

**권한**: `requireActiveUser`

**요청**:
```json
{
  "id": 123,
  "title": "수정된 제목",
  "content": "수정된 내용",
  "category": "legal",
  "attachments": "[]"
}
```

**응답 (성공)**:
```json
{ "ok": true, "id": 123 }
```

**응답 (실패 — 수정 불가 상태)**:
```json
{
  "ok": false,
  "error": "이미 처리 중인 신청은 수정할 수 없습니다.",
  "step": "check_status"
}
```

**처리 단계**:
1. `auth` — requireActiveUser
2. `validate` — id, title, content 필수 확인
3. `select_request` — supportRequests WHERE id = ? AND memberId = auth.uid
4. `check_status` — status !== 'submitted' → 403 "이미 처리 중인 신청은 수정할 수 없습니다."
5. `update` — title, content, category, attachments, updatedAt 업데이트
6. `map` — `{ ok: true, id }`

---

#### `incident-report-update` (PATCH `/api/incident-report-update`)

**권한**: `requireActiveUser`

**요청**:
```json
{
  "id": 123,
  "title": "수정 제목",
  "contentHtml": "<p>수정 내용</p>",
  "attachmentIds": "[]",
  "category": "teacher_death"
}
```

**응답 (성공)**:
```json
{ "ok": true, "id": 123 }
```

**처리 단계**:
1. `auth` — requireActiveUser
2. `validate` — id, title, contentHtml 필수
3. `select_report` — incidentReports WHERE id = ? AND memberId = auth.uid
4. `check_status` — status !== 'submitted' → 403
5. `update` — title, contentHtml, attachmentIds, category, updatedAt
6. `map`

---

#### `harassment-report-update` (PATCH `/api/harassment-report-update`)

**권한**: `requireActiveUser`

**요청**:
```json
{
  "id": 123,
  "title": "수정 제목",
  "contentHtml": "<p>수정</p>",
  "attachmentIds": "[]",
  "category": "parent",
  "occurredAt": "2025-01-01T00:00:00Z",
  "frequency": "반복"
}
```

**응답 (성공)**:
```json
{ "ok": true, "id": 123 }
```

**처리 단계**:
1. `auth` → `validate` → `select_report` → `check_status` → `update` → `map`

---

#### `legal-consultation-update` (PATCH `/api/legal-consultation-update`)

**권한**: `requireActiveUser`

**요청**:
```json
{
  "id": 123,
  "title": "수정 제목",
  "contentHtml": "<p>수정</p>",
  "attachmentIds": "[]",
  "category": "school_dispute",
  "urgency": "high",
  "occurredAt": "2025-01-01T00:00:00Z",
  "partyInfo": "상대방 정보"
}
```

**응답 (성공)**:
```json
{ "ok": true, "id": 123 }
```

**처리 단계**:
1. `auth` → `validate` → `select_consultation` → `check_status` → `update` → `map`

---

#### `legal-consultation-delete` (DELETE `/api/legal-consultation-delete`)

**권한**: `requireActiveUser`

**요청**:
```json
{ "id": 123 }
```

**응답 (성공)**:
```json
{ "ok": true }
```

**처리 단계**:
1. `auth` — requireActiveUser
2. `validate` — id 필수
3. `select_consultation` — legalConsultations WHERE id = ? AND memberId = auth.uid
4. `check_status` — status !== 'submitted' → 403 "이미 처리 중인 상담은 삭제할 수 없습니다."
5. `delete` — DELETE FROM legalConsultations WHERE id = ?
6. `map` — `{ ok: true }`

---

#### `admin-workspace-tasks.ts` 수정 — 보고↔작업 자동 동기화

**기존 파일에 추가할 로직** (PATCH status 처리 블록 안에):

```
status → 'done' 으로 변경될 때:
  IF task.sourceType IN ('support', 'incident', 'harassment', 'legal') AND task.sourceId IS NOT NULL:
    UPDATE 해당 테이블 SET status = 'resolved', updatedAt = now() WHERE id = task.sourceId
    
sourceType 매핑:
  'support'    → supportRequests
  'incident'   → incidentReports  
  'harassment' → harassmentReports
  'legal'      → legalConsultations
```

응답에 `syncedReport: { type, id }` 필드 추가 (클라이언트 확인용).

---

## §3 화면 명세

### 3.1 페이지 목록

| 페이지 | 수정 내용 |
|---|---|
| `public/mypage-applications.js` | 지원 신청 목록에 "수정" 버튼 추가 (submitted만) |
| `public/my-reports.js` | 사건/괴롭힘/법률 목록에 "수정" 버튼 추가 (submitted만) |
| `public/my-reports.html` | 수정 모달 HTML 추가 |
| `public/mypage.html` | 수정 모달 HTML 추가 (support용) |

### 3.2 수정 모달 구조 (공통)

```
┌─ 신청 수정 ─────────────────────────────────────────┐
│  [제목 입력]                                        │
│  [내용 textarea]                                    │
│  [카테고리 select]                                  │
│  [기타 필드 (괴롭힘: 발생일/빈도, 법률: 긴급도)]    │
│                                                     │
│  [취소]  [수정 저장]                                │
└──────────────────────────────────────────────────── ┘
```

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 요청 body | 응답 처리 |
|---|---|---|---|
| 지원 신청 목록에서 "수정" 클릭 | — | — | 수정 모달 오픈 (기존 데이터 채움) |
| 수정 모달에서 "저장" 클릭 | `/api/support-update` | `{id, title, content, category}` | 모달 닫기 + 목록 갱신 |
| 사건 보고 "수정" 클릭 → 저장 | `/api/incident-report-update` | `{id, title, contentHtml, category}` | 목록 갱신 |
| 괴롭힘 보고 "수정" 클릭 → 저장 | `/api/harassment-report-update` | `{id, title, contentHtml, ...}` | 목록 갱신 |
| 법률 상담 "수정" 클릭 → 저장 | `/api/legal-consultation-update` | `{id, title, contentHtml, ...}` | 목록 갱신 |
| 법률 상담 "삭제" 클릭 | `/api/legal-consultation-delete` | `{id}` | 목록에서 항목 제거 |

### 3.4 토스트 문구

| 상황 | 문구 |
|---|---|
| 수정 성공 | "수정되었습니다." |
| 삭제 성공 | "삭제되었습니다." |
| 수정 불가 상태 | "이미 처리 중인 항목은 수정할 수 없습니다." |
| 권한 없음 | "권한이 없습니다." |

### 3.5 캐시버스터

- `public/mypage-applications.js?v=N+1`
- `public/my-reports.js?v=N+1`

---

## §4 검증 시나리오

| # | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | 사용자가 제출 직후 상태의 유가족 신청을 "수정" 버튼 클릭 → 내용 변경 후 저장 | 저장 성공, 목록 갱신, DB에 변경된 내용 반영 |
| Q2 | 이미 검토 중(in_review) 상태인 신청에서 "수정" 클릭 시도 | "이미 처리 중인 항목은 수정할 수 없습니다." 토스트 표시, DB 불변 |
| Q3 | 사건 보고 submitted 상태에서 제목·내용 수정 저장 | 저장 성공, 수정된 제목 목록에 반영 |
| Q4 | 괴롭힘 보고 submitted 상태에서 발생일·빈도 수정 저장 | 저장 성공 |
| Q5 | 법률 상담 submitted 상태에서 수정 저장 | 저장 성공 |
| Q6 | 법률 상담 submitted 상태에서 "삭제" 클릭 | 삭제 성공, 목록에서 사라짐 |
| Q7 | 관리자가 워크스페이스 작업을 "완료"로 변경 (sourceType=incident, sourceId=5) | 사건 보고 ID=5 의 status가 'resolved'로 자동 변경 |
| Q8 | sourceType 없는 일반 작업을 "완료"로 변경 | 보고 상태 변경 없음, 작업만 완료 |
| Q9 | 다른 사용자 신청에 수정 요청 시도 | 404 (본인 데이터 아님) |
| Q10 | 기존 신청 생성·조회·삭제 기능 회귀 없음 | 모두 정상 작동 |

---

## §5 mock 데이터 (A용)

```javascript
// MOCK: support-update 성공
const MOCK_SUPPORT_UPDATE = { ok: true, id: 1 };

// MOCK: incident-report-update 성공
const MOCK_INCIDENT_UPDATE = { ok: true, id: 1 };

// MOCK: harassment-report-update 성공
const MOCK_HARASSMENT_UPDATE = { ok: true, id: 1 };

// MOCK: legal-consultation-update 성공
const MOCK_LEGAL_UPDATE = { ok: true, id: 1 };

// MOCK: legal-consultation-delete 성공
const MOCK_LEGAL_DELETE = { ok: true };
```

---

## §6 트리거

### §6.1 B 트리거 — 백 구현

```
[B — 라운드 8 백엔드 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/round8-update-sync (베이스 main @ d5efac4)
정독: docs/milestones/2026-05-18-round8-update-sync.md §1·§2

영역: netlify/functions/, lib/
금지: public/, PROJECT_STATE.md, docs/

━━━ 자율주행 정책 — 권한 확인 절대 묻지 말 것 ━━━
  PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "실행해도 되나요" "접속해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
  묻는 건 단 2가지뿐: ① 자기 브랜치 push ② 애매한 설계·로직 결정
  그 외 전부 자율 진행. 막히면 즉시 보고 (30분 이상 헤매지 말 것)

━━━ §1 DB 체크리스트 ━━━
  - [ ] DB 마이그레이션 불필요 (기존 컬럼 충분)
  - [ ] schema.ts 변경 없음

━━━ §2 API 체크리스트 ━━━
  - [ ] support-update.ts 신규 — /api/support-update PATCH requireActiveUser
  - [ ] incident-report-update.ts 신규 — /api/incident-report-update PATCH requireActiveUser
  - [ ] harassment-report-update.ts 신규 — /api/harassment-report-update PATCH requireActiveUser
  - [ ] legal-consultation-update.ts 신규 — /api/legal-consultation-update PATCH requireActiveUser
  - [ ] legal-consultation-delete.ts 신규 — /api/legal-consultation-delete DELETE requireActiveUser
  - [ ] admin-workspace-tasks.ts 수정 — status→done 시 sourceType/sourceId 체크 후 연결 테이블 status='resolved' 업데이트

━━━ 수정 허용 조건 ━━━
  4종 update 공통: WHERE id=? AND memberId=auth.uid → status!='submitted'이면 403 "이미 처리 중인 항목은 수정할 수 없습니다."

━━━ 보고↔작업 sync 로직 ━━━
  admin-workspace-tasks.ts PATCH 핸들러에서 status='done' 처리 블록 안에:
  sourceType='support' → UPDATE support_requests SET status='resolved'
  sourceType='incident' → UPDATE incident_reports SET status='resolved'
  sourceType='harassment' → UPDATE harassment_reports SET status='resolved'
  sourceType='legal' → UPDATE legal_consultations SET status='resolved'
  테이블명은 schema.ts의 실제 테이블명 사용 (snake_case)

━━━ 응답 구조 (키명 임의 변경 금지) ━━━
  update 4종: { "ok": true, "id": number }
  delete:     { "ok": true }
  workspace sync 추가 응답 필드: "syncedReport": { "type": string, "id": number } | null

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/round8-update-sync
  □ export const config = { path } 5개 신규 파일 전부
  □ requireActiveUser 반환 auth.res (requireAdmin 아님!)
  □ status 체크는 auth 다음, validate 다음 'check_status' step 라벨
  □ npx tsc --noEmit 통과
```

### §6.2 A 트리거 — 프론트 구현

```
[A — 라운드 8 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/round8-update-front (베이스 main @ d5efac4)
정독: docs/milestones/2026-05-18-round8-update-sync.md §3·§5

영역: public/
금지: lib/, netlify/functions/, db/, PROJECT_STATE.md, docs/

━━━ 자율주행 정책 — 권한 확인 절대 묻지 말 것 ━━━
  PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "실행해도 되나요" "접속해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
  묻는 건 단 2가지뿐: ① 자기 브랜치 push ② 애매한 설계·로직 결정
  그 외 전부 자율 진행. 막히면 즉시 보고 (30분 이상 헤매지 말 것)

━━━ mock 데이터 (B 머지 전 사용) ━━━
const MOCK_SUPPORT_UPDATE    = { ok: true, id: 1 };
const MOCK_INCIDENT_UPDATE   = { ok: true, id: 1 };
const MOCK_HARASSMENT_UPDATE = { ok: true, id: 1 };
const MOCK_LEGAL_UPDATE      = { ok: true, id: 1 };
const MOCK_LEGAL_DELETE      = { ok: true };

━━━ §3 화면 체크리스트 ━━━
  - [ ] mypage-applications.js: 유가족 지원 신청 목록 항목에 status='submitted'일 때만 "수정" 버튼 렌더링
  - [ ] mypage.html: 지원 신청 수정 모달 HTML (제목·내용·카테고리 필드) 추가
  - [ ] my-reports.js: 사건/괴롭힘/법률 목록 항목에 status='submitted'일 때만 "수정" 버튼
  - [ ] my-reports.js: 법률 상담에 "삭제" 버튼 추가 (submitted만)
  - [ ] my-reports.html: 사건 수정 모달 (제목·contentHtml·카테고리)
  - [ ] my-reports.html: 괴롭힘 수정 모달 (제목·contentHtml·카테고리·발생일·빈도)
  - [ ] my-reports.html: 법률 상담 수정 모달 (제목·contentHtml·카테고리·긴급도·partyInfo)
  - [ ] 저장 성공: "수정되었습니다." 토스트 + 목록 갱신
  - [ ] 오류: 서버 error 메시지 토스트 표시
  - [ ] 캐시버스터: mypage-applications.js?v=N+1, my-reports.js?v=N+1

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/round8-update-front
  □ mock 사용 위치 주석으로 표기 (B 머지 후 실 API 전환 대비)
  □ api() 헬퍼 사용 (이중 stringify 금지)
  □ public/ 외 파일 변경 0
```

### §6.3 C 트리거 — 검증

```
[C — 라운드 8 검증]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/round8 (베이스 main @ B·A 머지 후 커밋)
정독: docs/milestones/2026-05-18-round8-update-sync.md §4

Q1~Q10 라이브 시나리오 순서대로 검증.
보고서: docs/verify/2026-05-18-round8.md
```

---

## §7 머지 순서

```
1. B push (feature/round8-update-sync) → 메인 main 머지 → push
2. Netlify 배포 대기 (1~3분)
3. DB 마이그레이션 없으므로 바로 4단계
4. A push (feature/round8-update-front) → 메인 main 머지 → push
5. C 검증 트리거 → C push (verify/round8) → 메인 머지 → 라운드 8 마감
```
