# Phase 21 R2+R3 — 할당·이관·알림 + 서비스↔카드 동기화 + R&R 통합

> **작성**: 2026-05-12 / 메인 채팅
> **상위 Phase**: Phase 21 워크스페이스 v3 + 서비스 연동 ([카탈로그](2026-05-12-phase21-workspace-v3-catalog.md))
> **추정**: 메인 설계 2.5h / B 백 9h / A 프론트 8h / C 검증 3.5h / 합계 23h
> **모드**: **평행 + 단계 머지** (B는 schema 머지 → 마이그 → API 머지 2단계 / A는 mock으로 평행)
> **베이스**: R1 머지 완료 main HEAD (현재 `46c8b72`, C 검증 PASS 후 갱신)
> **통합 사유**: Swain 지시(2026-05-12) — 두 라운드 영역이 명확히 분리되어 평행 가능. 한 마이그·한 검증 사이클로 머지 흐름 절약.

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블 (4개)

```typescript
// db/schema.ts 끝에 /* === Phase 21 R2+R3 === */ 헤더 후 추가
// 마이그 호출 후 활성화 (초기엔 주석)

/* === Phase 21 R2+R3 === */

// 1) 카드 이관 이력 (토스)
export const workspaceTaskTransfers = pgTable("workspace_task_transfers", {
  id:            bigserial("id", { mode: "number" }).primaryKey(),
  taskId:        integer("task_id").notNull().references(() => workspaceTasks.id, { onDelete: "cascade" }),
  fromUid:       integer("from_uid").notNull().references(() => adminUsers.id, { onDelete: "set null" }),
  toUid:         integer("to_uid").notNull().references(() => adminUsers.id, { onDelete: "set null" }),
  reason:        text("reason"),                          // 선택 입력
  transferredBy: integer("transferred_by").notNull().references(() => adminUsers.id, { onDelete: "set null" }),
  transferredAt: timestamp("transferred_at").defaultNow().notNull(),
}, (t) => ({
  taskIdx: index("ws_task_transfers_task_idx").on(t.taskId),
  fromIdx: index("ws_task_transfers_from_idx").on(t.fromUid),
  toIdx:   index("ws_task_transfers_to_idx").on(t.toUid),
}));

// 2) 카드 워처 (관찰자 — 본인만 자기 등록)
export const workspaceTaskWatchers = pgTable("workspace_task_watchers", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  taskId:    integer("task_id").notNull().references(() => workspaceTasks.id, { onDelete: "cascade" }),
  watcherUid: integer("watcher_uid").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  addedAt:   timestamp("added_at").defaultNow().notNull(),
}, (t) => ({
  uniq:      uniqueIndex("ws_task_watchers_uniq").on(t.taskId, t.watcherUid),
  taskIdx:   index("ws_task_watchers_task_idx").on(t.taskId),
  watcherIdx: index("ws_task_watchers_watcher_idx").on(t.watcherUid),
}));

// 3) R&R 매핑 (서비스 유형 × 1차+백업)
//    serviceKind: "incident" | "harassment" | "legal" | "support"
//    serviceCategory: enum 값 또는 null(대분류 매핑) 또는 "_fallback"(Fallback 슬롯)
export const serviceRnr = pgTable("service_rnr", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  serviceKind:      varchar("service_kind", { length: 20 }).notNull(),
  serviceCategory:  varchar("service_category", { length: 50 }),     // null = 대분류 매핑
  primaryUid:       integer("primary_uid").references(() => adminUsers.id, { onDelete: "set null" }),
  backupUid:        integer("backup_uid").references(() => adminUsers.id, { onDelete: "set null" }),
  isFallback:       boolean("is_fallback").default(false).notNull(), // Fallback 슬롯 표시
  updatedBy:        integer("updated_by").references(() => adminUsers.id, { onDelete: "set null" }),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniq:        uniqueIndex("service_rnr_uniq").on(t.serviceKind, t.serviceCategory),
  kindIdx:     index("service_rnr_kind_idx").on(t.serviceKind),
  fallbackIdx: index("service_rnr_fallback_idx").on(t.isFallback),
}));

// 4) (선택) 알림 분류는 workspaceNotifications에 컬럼 추가로 처리 (1.2 참조)
```

### 1.2 기존 테이블 컬럼 추가

| 테이블 | 컬럼 | 타입 | 제약 | 용도 |
|---|---|---|---|---|
| `adminUsers` | `outOfOffice` | boolean | default false NOT NULL | 부재 여부 (시작·종료 사이에는 자동 true 계산 가능하나 명시 컬럼도 유지) |
| `adminUsers` | `outOfOfficeStart` | date | NULL | 부재 시작일 (포함) |
| `adminUsers` | `outOfOfficeEnd` | date | NULL | 부재 종료일 (포함) |
| `adminUsers` | `outOfOfficeNote` | text | NULL | "휴가/교육/병가 등" 자유 메모 |
| `workspaceTasks` | `assignedBy` | integer | NULL · FK → adminUsers.id | 카드 최초 할당자 (할당한 작업 탭 조회용) |
| `workspaceTasks` | `sourceServiceKind` | varchar(20) | NULL | "incident" / "harassment" / "legal" / "support" — 서비스에서 자동 생성된 경우만 |
| `workspaceTasks` | `sourceServiceId` | integer | NULL | 원본 서비스 row id |
| `workspaceNotifications` | `category` | varchar(20) | NULL | "assign" / "due" / "mention" / "transfer" / "watcher" / "system" (분류) |
| `workspaceNotifications` | `linkUrl` | varchar(500) | NULL | 알림 클릭 시 이동할 경로 (예: `/workspace-kanban.html#task=123`) |
| `incidentReports` | `assignedTo` | integer | NULL · FK → adminUsers.id | 담당 운영자 |
| `incidentReports` | `workspaceTaskId` | integer | NULL · FK → workspaceTasks.id ON DELETE SET NULL | 자동 생성된 카드 |
| `incidentReports` | `category` | varchar(30) | NULL | 신고 카테고리 (신규 — 없었음) |
| `harassmentReports` | `assignedTo` | integer | NULL · FK → adminUsers.id | 담당 운영자 |
| `harassmentReports` | `workspaceTaskId` | integer | NULL · FK → workspaceTasks.id ON DELETE SET NULL | 자동 생성된 카드 |
| `legalConsultations` | `assignedTo` | integer | NULL · FK → adminUsers.id | 담당 운영자 (기존 `assignedLawyerId`는 변호사용 — 별개) |
| `legalConsultations` | `workspaceTaskId` | integer | NULL · FK → workspaceTasks.id ON DELETE SET NULL | 자동 생성된 카드 |
| `supportRequests` | `assignedAdminId` | integer | NULL · FK → adminUsers.id | 담당 운영자 (기존 `assignedMemberId`는 사용자/전문가용 — 별개) |
| `supportRequests` | `workspaceTaskId` | integer | NULL · FK → workspaceTasks.id ON DELETE SET NULL | 자동 생성된 카드 |

> `incidentReports.category`는 enum 안 쓰고 varchar로 (자유 확장 — R&R 탭에서 정의된 값만 사용). 시드 4종: `school_violence`(학교폭력) / `neighborhood_conflict`(이웃갈등) / `traffic_accident`(교통사고) / `other`(기타). 어드민이 R&R 매핑 시 카테고리 선택.

### 1.3 마이그레이션 SQL

```sql
-- IF NOT EXISTS · 멱등 보장

-- 1) workspaceTaskTransfers
CREATE TABLE IF NOT EXISTS workspace_task_transfers (
  id BIGSERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
  from_uid INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  to_uid INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  reason TEXT,
  transferred_by INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  transferred_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ws_task_transfers_task_idx ON workspace_task_transfers(task_id);
CREATE INDEX IF NOT EXISTS ws_task_transfers_from_idx ON workspace_task_transfers(from_uid);
CREATE INDEX IF NOT EXISTS ws_task_transfers_to_idx ON workspace_task_transfers(to_uid);

-- 2) workspaceTaskWatchers
CREATE TABLE IF NOT EXISTS workspace_task_watchers (
  id BIGSERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
  watcher_uid INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  added_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ws_task_watchers_uniq ON workspace_task_watchers(task_id, watcher_uid);
CREATE INDEX IF NOT EXISTS ws_task_watchers_task_idx ON workspace_task_watchers(task_id);
CREATE INDEX IF NOT EXISTS ws_task_watchers_watcher_idx ON workspace_task_watchers(watcher_uid);

-- 3) serviceRnr
CREATE TABLE IF NOT EXISTS service_rnr (
  id BIGSERIAL PRIMARY KEY,
  service_kind VARCHAR(20) NOT NULL,
  service_category VARCHAR(50),
  primary_uid INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  backup_uid INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS service_rnr_uniq ON service_rnr(service_kind, service_category);
CREATE INDEX IF NOT EXISTS service_rnr_kind_idx ON service_rnr(service_kind);
CREATE INDEX IF NOT EXISTS service_rnr_fallback_idx ON service_rnr(is_fallback);

-- 4) admin_users 부재 컬럼
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS out_of_office BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS out_of_office_start DATE;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS out_of_office_end DATE;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS out_of_office_note TEXT;

-- 5) workspace_tasks 컬럼
ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS source_service_kind VARCHAR(20);
ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS source_service_id INTEGER;
CREATE INDEX IF NOT EXISTS ws_tasks_assigned_by_idx ON workspace_tasks(assigned_by);
CREATE INDEX IF NOT EXISTS ws_tasks_source_service_idx ON workspace_tasks(source_service_kind, source_service_id);

-- 6) workspace_notifications 컬럼
ALTER TABLE workspace_notifications ADD COLUMN IF NOT EXISTS category VARCHAR(20);
ALTER TABLE workspace_notifications ADD COLUMN IF NOT EXISTS link_url VARCHAR(500);
CREATE INDEX IF NOT EXISTS ws_notifs_category_idx ON workspace_notifications(category);

-- 7) 4종 서비스 컬럼
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS category VARCHAR(30);
CREATE INDEX IF NOT EXISTS incident_reports_assigned_idx ON incident_reports(assigned_to);

ALTER TABLE harassment_reports ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE harassment_reports ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS harassment_reports_assigned_idx ON harassment_reports(assigned_to);

ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS legal_consultations_assigned_idx ON legal_consultations(assigned_to);

ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS assigned_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS support_requests_assigned_admin_idx ON support_requests(assigned_admin_id);

-- 8) 시드: 신고 카테고리 4종 (incident_reports에 카테고리 신설하지 않지만 R&R 매핑에서 사용)
-- 실제 INSERT는 service_rnr 시드로
INSERT INTO service_rnr (service_kind, service_category, is_fallback, updated_at) VALUES
  ('_global', '_fallback', TRUE, NOW())
ON CONFLICT DO NOTHING;
-- (실제 운영자 UID 할당은 어드민이 R&R 탭에서 직접 지정 — 시드에서 ID 가정 X)
```

### 1.4 schema.ts import 점검

- [ ] `bigserial`, `uniqueIndex`, `boolean`, `date` import 라인 확인 (기존에 있을 가능성 높으나 누락 시 추가)
- [ ] DB 적용 전 schema 정의는 **주석 처리** (마이그 후 활성화)
- [ ] append-only — 파일 끝에 `/* === Phase 21 R2+R3 === */` 헤더 후 추가

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `netlify/functions/migrate-phase21-r2r3.ts` | `/api/migrate-phase21-r2r3` | GET ?run=1 | super_admin | 1회용 마이그 (호출 후 삭제) |
| `netlify/functions/admin-workspace-task-transfer.ts` | `/api/admin-workspace-task-transfer` | POST | requireAdmin | 카드 이관(토스) + 이력 + 알림 |
| `netlify/functions/admin-workspace-task-watchers.ts` | `/api/admin-workspace-task-watchers` | GET·POST·DELETE | requireAdmin | 본인 워처 등록·해제·조회 |
| `netlify/functions/admin-workspace-notifications.ts` | `/api/admin-workspace-notifications` | GET·POST | requireAdmin | 알림 조회·읽음·전체 읽음 |
| `netlify/functions/admin-workspace-tasks.ts` (수정) | `/api/admin-workspace-tasks` | GET | requireAdmin | `assignedByMe=1` 필터 추가 + 카드 done 시 서비스 종결 hook |
| `netlify/functions/admin-service-rnr.ts` | `/api/admin-service-rnr` | GET·POST·DELETE | requireAdmin | R&R CRUD (어드민만 편집) |
| `netlify/functions/admin-service-assignee.ts` | `/api/admin-service-assignee` | POST | requireAdmin | 서비스 담당자 변경 + 카드 동기 |
| `netlify/functions/admin-user-preferences.ts` | `/api/admin-user-preferences` | GET·POST | requireAdmin | 부재 토글 등 개인 설정 |
| `netlify/functions/cron-workspace-due-reminder.ts` | `(schedule)` | scheduled | — | 마감 24h/72h 알림 (KST 09:00 = UTC 00:00) |
| `netlify/functions/admin-workspace-task-comments.ts` (수정) | `/api/admin-workspace-task-comments` | POST | requireAdmin | @멘션 시 알림 발송 보강 |
| `netlify/functions/incident-report-create.ts` (수정) | (기존) | POST | (기존) | 자동 카드 생성 hook |
| `netlify/functions/harassment-report-create.ts` (수정) | (기존) | POST | (기존) | 자동 카드 생성 hook |
| `netlify/functions/legal-consultation-create.ts` (수정) | (기존) | POST | (기존) | 자동 카드 생성 hook |
| `netlify/functions/support-create.ts` (수정) | (기존) | POST | (기존) | 자동 카드 생성 hook |

### 2.2 함수별 상세

#### `admin-workspace-task-transfer.ts` (POST)

**요청**:
```json
{ "taskId": 123, "toUid": 7, "reason": "휴가라 다른 분이 처리" }
```
- `reason`은 선택 (빈 문자열·생략 가능)

**응답 (성공)**:
```json
{
  "ok": true,
  "data": {
    "transferId": 45,
    "fromUid": 5,
    "toUid": 7,
    "task": { "id": 123, "assigneeUid": 7, "assignedBy": 5 }
  }
}
```

**처리 단계**:
1. `auth` — `requireAdmin`
2. `validate` — `taskId` int, `toUid` int, `reason` string|undefined, 본인 → 본인 금지
3. `select_task` — `workspaceTasks` 단건 + 본인이 현재 담당자인지 검증
4. `insert_transfer` — `workspaceTaskTransfers`에 row 추가 (`fromUid=현재 담당자`, `toUid=요청 toUid`)
5. `update_task` — `workspaceTasks.assigneeUid = toUid`, `assignedBy` 유지 (최초 할당자 보존)
6. `insert_notification` — 받는 사람에게 알림 (`category="transfer"`)
7. `insert_activity` — `workspaceActivityLog`에 `task.transfer` 액션 기록
8. `broadcast_hint` — 응답에 `broadcast: { event: "task:updated", taskId }` 힌트 (클라이언트가 BroadcastChannel 발신)
9. `map` — 응답 매핑

#### `admin-workspace-task-watchers.ts`

- **GET ?taskId=X** — 해당 카드의 워처 목록 (본인 포함)
- **POST { taskId }** — 본인을 워처로 추가 (UNIQUE 충돌 시 idempotent)
- **DELETE ?taskId=X** — 본인을 워처에서 제거

> **핵심 권한 규칙**: `watcherUid`는 **무조건 본인 UID(`auth.user.uid`)**. 다른 사람을 워처로 추가하는 요청은 거부. 사용자 결정 — 본인만 자신을 워처로 등록.

#### `admin-workspace-notifications.ts`

- **GET ?limit=10** — 본인 알림 최근 N건 (`memberId = auth.user.uid`)
  - 응답: `{ items: [...], unreadCount: N }`
- **POST { id } 또는 { all: true }** — 읽음 처리 (`readAt = now`)

> `workspaceNotifications.memberId`가 `admin_users.id`를 가리키는지 확인 (기존 schema). 만약 members 테이블이면 별도 `admin_member_id` 같은 컬럼 추가 필요.

#### `admin-workspace-tasks.ts` 확장

기존 GET 리스트(`?list=1`)에 필터 추가:
- `assignedByMe=1` — `workspaceTasks.assignedBy = auth.user.uid AND assigneeUid != auth.user.uid` (내가 다른 사람에게 시킨 것)
- 응답 구조 기존 유지 (`{ items, total }`)

기존 PATCH/PUT(상태 변경)에서 `status = "done"`으로 바뀔 때:
- 카드에 `sourceServiceKind`·`sourceServiceId`가 있으면 `lib/workspace-sync.ts::closeServiceFromTask` 호출 → 해당 서비스 status를 "closed" 등으로 갱신

#### `admin-service-rnr.ts`

- **GET** — R&R 매핑 전체 조회 (어드민·일반 운영자 둘 다 조회 가능 — 자기 매핑 확인용)
- **POST { serviceKind, serviceCategory, primaryUid, backupUid }** — 매핑 upsert
- **DELETE ?id=X** — 매핑 삭제

> **편집 권한**: `requireAdmin` + `auth.user.role === 'super_admin'` 또는 `editorRoles`. POST·DELETE는 슈퍼 어드민만. GET은 일반 운영자도 가능.

Fallback 슬롯은 `isFallback=true`인 row 1개 (전역). UI에서 R&R 탭 최상단에 별도 렌더.

#### `admin-service-assignee.ts` (POST)

**요청**:
```json
{ "serviceKind": "incident", "serviceId": 42, "newAssigneeUid": 7, "reason": "재배정 사유 (선택)" }
```

**처리**:
1. 서비스 row 단건 조회 (assignedTo 확인)
2. 서비스 `assignedTo` 갱신
3. 해당 서비스에 연결된 `workspaceTaskId`가 있으면 카드도 동기 (이관 형식 — workspaceTaskTransfers row 추가 + assigneeUid 갱신)
4. 알림 발송
5. **양방향 동기화 무한 루프 방지** — `lib/workspace-sync.ts`에 `_syncOrigin` 로컬 변수로 처리. 카드 갱신 시 origin 표시, 그 origin이면 서비스 갱신 skip. 코드 레벨로만 처리 (DB 컬럼 X).

#### `admin-user-preferences.ts`

- **GET** — 본인의 부재 토글 상태 (`outOfOffice`, `outOfOfficeStart`, `outOfOfficeEnd`, `outOfOfficeNote`)
- **POST { outOfOfficeStart, outOfOfficeEnd, outOfOfficeNote }** — 부재 예약 등록·수정
- **DELETE** — 부재 즉시 해제

> `outOfOffice` 자동 계산: 매 조회 시 `today >= start AND today <= end`면 true (cron 필요 없음).

#### `cron-workspace-due-reminder.ts` (Scheduled Function)

**schedule**: `"0 0 * * *"` (UTC 00:00 = KST 09:00)
**path 없음** (Netlify 제약 — Scheduled Function은 custom path 금지)

**처리**:
1. `workspaceTasks`에서 `status NOT IN ('done', 'archived')` 카드 중:
   - `dueDate BETWEEN today+23h AND today+25h` → 24h 알림
   - `dueDate BETWEEN today+71h AND today+73h` → 72h 알림
2. 각 카드 담당자(`assigneeUid`)에게 `workspaceNotifications` row 추가 (`category="due"`)
3. 워처들에게도 동일 알림
4. 이미 같은 카드·같은 단계(24h/72h) 알림 발송 이력 있으면 skip (idempotent — `linkUrl` + `category` + 발송 일자로 중복 체크)

#### `admin-workspace-task-comments.ts` 수정

기존 POST에 멘션 처리 보강:
- `mentions` JSONB가 비어있지 않으면 각 mentioned UID에게 알림 (`category="mention"`)

#### 4종 서비스 create endpoint 수정 (hook)

**incident-report-create.ts / harassment-report-create.ts / legal-consultation-create.ts / support-create.ts**

각 함수의 INSERT 직후, `lib/workspace-sync.ts::createWorkspaceTaskFromService` 호출:

```ts
// 의사 코드
const taskId = await createWorkspaceTaskFromService({
  serviceKind: "incident",
  serviceId: insertedRow.id,
  category: insertedRow.category ?? null,
  title: `[신고] ${insertedRow.title} - ${reporterDisplay}`,
  priority: aiSeverity === "high" ? "high" : "normal",
});
// 카드 ID를 서비스 row의 workspace_task_id 컬럼에 저장
await db.update(incidentReports).set({ workspaceTaskId: taskId, assignedTo: ... }).where(...);
```

실패해도 서비스 접수 자체는 성공해야 함 (try/catch + 로그만).

### 2.3 `lib/` 헬퍼

#### `lib/workspace-sync.ts` 신규

```ts
// 시그니처 (의사)
export async function resolveAssigneeByService(opts: {
  serviceKind: string;
  serviceCategory?: string | null;
}): Promise<{ uid: number; via: "primary" | "backup" | "fallback" } | null>;
// 1) R&R에서 (serviceKind, serviceCategory) 매핑 조회
// 2) primaryUid 부재 체크 (today 범위) — 부재면 backupUid 사용
// 3) 둘 다 없으면 Fallback 슬롯(isFallback=true) 사용
// 4) 모두 실패면 null (미할당 풀로)

export async function createWorkspaceTaskFromService(opts: {
  serviceKind: string;
  serviceId: number;
  category?: string | null;
  title: string;
  priority?: "low" | "normal" | "high" | "urgent";
}): Promise<number>; // 생성된 task id 반환
// 1) resolveAssigneeByService 호출
// 2) 담당자 결정 (없으면 미할당 풀 — assigneeUid=null + sourceServiceKind 표시)
// 3) workspaceTasks INSERT (sourceServiceKind, sourceServiceId, assignedBy=담당자)
// 4) 알림 발송 (category="assign")
// 5) 활동 로그
// 6) 1차 부재라 백업이 받았으면 1차 담당자에게도 "복귀 후 확인" 메모 알림(category="system")

export async function transferWorkspaceTask(opts: {
  taskId: number;
  toUid: number;
  reason?: string;
  transferredBy: number;
}): Promise<void>;
// workspaceTaskTransfers INSERT + workspaceTasks.assigneeUid 갱신 + 알림 + 활동 로그

export async function syncAssigneeFromService(opts: {
  serviceKind: string;
  serviceId: number;
  newAssigneeUid: number;
  reason?: string;
  origin: "service";  // 무한 루프 방지 플래그
}): Promise<void>;
// 서비스 담당자 변경 → 카드 담당자도 동기 (origin="service"면 카드 변경 시 다시 서비스로 안 보냄)

export async function closeServiceFromTask(opts: {
  taskId: number;
  origin: "card";
}): Promise<void>;
// 카드 done → 원본 서비스 status를 closed로
// origin="card"면 서비스 변경이 다시 카드로 돌아오지 않게 skip 플래그 전달

export async function closeTaskFromService(opts: {
  serviceKind: string;
  serviceId: number;
  origin: "service";
}): Promise<void>;
// 서비스 status=closed → 연결된 카드 done
```

내부적으로 `_syncContext` 비공개 변수 (Module level Map<requestId, origin>)로 무한 루프 방지. 또는 함수 인자로 `origin` 명시적 전달 + idempotent 체크 (서비스 status가 이미 closed면 skip).

**필수 체크**:
- [ ] 모든 함수 try/catch + step 라벨 + detail + stack
- [ ] `export const config = { path: "/api/..." }` (cron 제외)
- [ ] `requireAdmin` 반환 `auth.res`
- [ ] schema import 누락 0
- [ ] 마이그 함수 호출 성공 후 즉시 삭제

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 페이지 | 경로 | 진입점 | 권한 |
|---|---|---|---|
| `public/workspace.html` (수정) | `/workspace.html` | 워크스페이스 > 워크툴 | 어드민 |
| `public/workspace-kanban.html` (수정) | `/workspace-kanban.html` | 워크스페이스 > WBS | 어드민 |
| `public/workspace-notifications.html` (신규) | `/workspace-notifications.html` | 알림 벨 드롭다운 → "전체 보기" | 어드민 |
| `public/admin.html` (수정) | `/admin.html` | 운영자 관리 → R&R 탭 (신규) | 어드민 (편집은 슈퍼 어드민만) |
| `public/admin-siren.html` (수정) | `/admin-siren.html` | 신고/괴롭힘/법률 상세 → 담당자 박스 자동 마운트 | 어드민 |
| `public/mypage.html` (수정) | `/mypage.html` | 마이페이지 → 부재 토글 카드 신설 | 운영자 본인 |

### 3.2 페이지별 와이어프레임

#### `workspace.html` — 워크툴 메인 (패널 추가)

기존 4대 패널(내 작업·지시함·일정·메모)에 다음 추가:

```
┌─ 워크툴 ─────────────────────────────────────────────────┐
│ [상단: 새 작업·새 일정·메모·알림 벨 ⓥ]                  │
│                                                          │
│ ┌─[내 작업]─┐ ┌─[할당받은 작업(=지시함 rename)]─┐        │
│ │ 카드 N개 │ │ 카드 N개 │                              │
│ └──────────┘ └────────────────────────────────┘        │
│                                                          │
│ ┌─[할당한 작업 신규]─┐ ┌─[일정]─┐                       │
│ │ 카드 N개 + 현재 담 │ │       │                       │
│ │ 당자·진행률 표시   │ │       │                       │
│ └────────────────────┘ └────────┘                       │
│                                                          │
│ ┌─[메모]─┐ ┌─[🚨 미할당 서비스 — 어드민만]─┐            │
│ │       │ │ R&R 없는 서비스 카드 N건       │            │
│ └────────┘ └────────────────────────────────┘            │
│                                                          │
│ ┌─[팀 활동 피드]──────────────────────────────────┐      │
│ └─────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────┘
```

> "할당한 작업" 패널 — 카드 클릭 시 WBS 이동, 카드에 "현재 담당자: OO / 진행률 50%" 표시.
> "🚨 미할당" 패널 — `auth.user.role === 'super_admin'`일 때만 노출.

#### `workspace-kanban.html` 카드 상세 모달 — 신규 영역

기존 모달 (#wkCardModal)의 탭 또는 측면에 추가:
- **[토스 버튼]** — 현재 담당자인 본인이 누를 수 있음. 클릭 시 토스 모달 오픈
- **[거쳐온 담당자 체인]** — 미니 아바타 + 이름 ("김OO → 박OO → 이OO" 식, 최근 5명)
- **[워처 추가/해제 버튼]** — 본인 워처 등록·해제 토글 (눈 아이콘)
- **[원본 서비스 보기 버튼]** — `sourceServiceKind`/`sourceServiceId` 있으면 표시 → 클릭 시 해당 어드민 화면으로

토스 모달 (신규):
```
┌─ 작업 토스 ──────────────────────────┐
│ 받는 사람: [드롭다운 — 운영자 목록]   │
│         (부재 중이면 "부재 중 ⚠️")    │
│                                       │
│ 사유 (선택):                          │
│ [텍스트 입력 — 비워둬도 OK]            │
│                                       │
│         [취소]  [토스]                │
└───────────────────────────────────────┘
```

#### 알림 드롭다운 (워크툴 우측상단 벨 클릭)

```
┌─ 알림 ───────────────────────┐
│ [모두 읽음]                  │
│                              │
│ ● 김OO이 작업 "X"을 토스했어요│
│   3분 전 [할당]              │
│                              │
│ ● 작업 "Y" 마감 24시간 전     │
│   1시간 전 [마감]            │
│                              │
│ ○ @멘션 — 박OO이 댓글에서     │
│   당신을 언급했어요           │
│   어제 [멘션]                │
│                              │
│ ─────────────                │
│ [전체 보기]                  │
└──────────────────────────────┘
```

- ● = 안 읽음 / ○ = 읽음
- 클릭 시 `linkUrl`로 이동 + 해당 알림 읽음 처리
- 카테고리 배지 색상: assign(파랑) / due(빨강) / mention(초록) / transfer(주황) / system(회색)

#### `workspace-notifications.html` (신규)

```
┌─ 알림 전체 보기 ───────────────────────────┐
│ [필터: 전체 / 할당 / 마감 / 멘션 / 시스템]│
│ [모두 읽음] [읽은 것 숨기기]              │
│                                            │
│ (알림 리스트 — 페이지네이션 또는 무한스크롤)│
└────────────────────────────────────────────┘
```

#### `admin.html` 운영자 관리 — R&R 탭 신규

기존 운영자 관리 화면에 탭 추가: [운영자 목록] / [R&R 매핑]

R&R 탭 와이어프레임:
```
┌─ R&R 매핑 (어드민만 편집) ─────────────────────┐
│                                                │
│ ┌─ Fallback 담당자 (R&R 없을 때 자동 할당) ─┐ │
│ │ [드롭다운: 운영자 선택]    [저장]          │ │
│ └──────────────────────────────────────────┘ │
│                                                │
│ ┌─ 서비스별 매핑 ──────────────────────────┐ │
│ │ 신고                                      │ │
│ │  ├─ 학교폭력  [1차: 김OO] [백업: 박OO]   │ │
│ │  ├─ 이웃갈등  [1차: 이OO] [백업: 최OO]   │ │
│ │  └─ ... [+추가]                          │ │
│ │                                          │ │
│ │ 괴롭힘 (5종 — parent/student/admin/...)  │ │
│ │  ├─ 학부모    [1차] [백업]                │ │
│ │  └─ ...                                  │ │
│ │                                          │ │
│ │ 법률 (5종 — school_dispute/civil/...)    │ │
│ │ 지원 (supportCategoryEnum 종)            │ │
│ └──────────────────────────────────────────┘ │
│                                                │
│ ※ 일반 운영자는 본 화면을 읽기 전용으로 봄    │
└────────────────────────────────────────────────┘
```

#### `admin-siren.html` 서비스 상세 — 담당자 박스 자동 마운트

신고/괴롭힘/법률 상세 페이지에 박스 추가:
```
┌─ 담당자 ─────────────────────────────┐
│ 현재: 김OO (1차)                      │
│ 백업: 박OO (휴가 중 ⚠️ ~5/15 복귀)    │
│                                       │
│ [담당자 변경] [원본 카드 보기]         │
└───────────────────────────────────────┘
```

#### `mypage.html` — 부재 토글 카드 신규

마이페이지 메인 영역에 카드 추가:
```
┌─ 내 부재 일정 ─────────────────────┐
│ 현재 상태: ✅ 근무 중                 │
│                                     │
│ [부재 예약]                         │
│  시작: [날짜 선택]                  │
│  종료: [날짜 선택]                  │
│  사유: [텍스트 — 휴가/교육/병가...]  │
│  [예약 저장]                        │
│                                     │
│ 예약된 부재: 2026-05-15 ~ 05-20 (휴가)│
│ [해제]                              │
└─────────────────────────────────────┘
```

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | API | 요청 | 응답 처리 | 토스트 |
|---|---|---|---|---|
| 카드 모달 "토스" 버튼 → 모달 | (모달 오픈만) | — | — | — |
| 토스 모달 확정 | POST `/api/admin-workspace-task-transfer` | `{taskId, toUid, reason}` | 모달 닫기 + BroadcastChannel 발신 + 카드 갱신 | "토스 완료" / 서버 detail |
| 카드 모달 워처 토글 | POST·DELETE `/api/admin-workspace-task-watchers` | `{taskId}` | 버튼 상태 토글 | "관찰 등록" / "관찰 해제" |
| 카드 모달 "원본 서비스 보기" | (네비게이션) | — | 서비스 종류별 어드민 화면 이동 | — |
| 워크툴 "할당한 작업" 패널 로드 | GET `/api/admin-workspace-tasks?list=1&assignedByMe=1` | — | 카드 리스트 렌더 + 현재 담당자·진행률 표시 | — |
| 워크툴 미할당 풀 패널 (어드민) | GET `/api/admin-workspace-tasks?list=1&unassigned=1` | — | 카드 리스트 | — |
| 알림 벨 클릭 | GET `/api/admin-workspace-notifications?limit=10` | — | 드롭다운 렌더 | — |
| 알림 항목 클릭 | POST `/api/admin-workspace-notifications` `{id}` 읽음 + 페이지 이동 | `{id}` | 읽음 + linkUrl 이동 | — |
| "모두 읽음" | POST `/api/admin-workspace-notifications` `{all:true}` | — | 카운트 0 | "모두 읽음" |
| 운영자 관리 R&R 탭 진입 | GET `/api/admin-service-rnr` | — | 매핑 표 렌더 | — |
| Fallback 담당자 저장 | POST `/api/admin-service-rnr` `{serviceKind:"_global", isFallback:true, primaryUid}` | — | 표 갱신 | "저장 완료" |
| 카테고리별 매핑 저장 | POST `/api/admin-service-rnr` `{serviceKind, serviceCategory, primaryUid, backupUid}` | — | 표 갱신 | "저장 완료" |
| 서비스 상세 "담당자 변경" | POST `/api/admin-service-assignee` | `{serviceKind, serviceId, newAssigneeUid, reason}` | 담당자 박스 갱신 + 알림 토스트 | "담당자 변경 완료" |
| 마이페이지 부재 예약 저장 | POST `/api/admin-user-preferences` | `{outOfOfficeStart, outOfOfficeEnd, outOfOfficeNote}` | 카드 갱신 | "부재 예약 저장" |
| 마이페이지 부재 해제 | DELETE `/api/admin-user-preferences` | — | 카드 갱신 | "부재 해제" |

### 3.4 토스트·문구 모음

| 상황 | 문구 |
|---|---|
| 토스 성공 | "{받는 사람 이름}님께 토스했어요" |
| 토스 — 본인 → 본인 | "자기 자신에게는 토스할 수 없어요" |
| 워처 등록 | "이 작업을 관찰합니다" |
| 워처 해제 | "관찰을 해제했어요" |
| R&R 저장 (어드민) | "매핑이 저장됐어요" |
| R&R 편집 권한 없음 | "어드민만 편집할 수 있어요" |
| 서비스 담당자 변경 | "{새 담당자}님께 인계됐어요" |
| 부재 예약 저장 | "{시작}~{종료} 부재 예약" |
| 부재 해제 | "근무 상태로 돌아왔어요" |
| 마감 알림 클릭 | (이동만, 토스트 없음) |
| 알림 모두 읽음 | "모든 알림을 읽음 처리했어요" |
| 미할당 카드 클릭 (어드민) | (WBS 이동만) |
| 자동 카드 생성 후 첫 진입 | "{서비스 종류}가 워크스페이스에 추가됐어요" (1회만) |

### 3.5 캐시버스터

신규·변경 JS·CSS:
- `public/js/workspace-task-modal.js?v=2` (토스·워처 버튼 추가)
- `public/js/workspace-sync-channel.js?v=2` (알림 channel 추가)
- `public/js/workspace.js?v=5` (할당한 작업·미할당·알림 드롭다운)
- `public/js/workspace-kanban.js?v=5` (토스 모달·워처·거쳐온 체인·원본 서비스 보기)
- `public/js/workspace-notifications.js?v=1` (신규)
- `public/js/admin-service-rnr.js?v=1` (신규)
- `public/js/admin-service-assignee.js?v=1` (신규 — 서비스 상세 담당자 박스 자동 마운트 모듈)
- `public/js/mypage-out-of-office.js?v=1` (신규)
- `public/css/workspace-notifications.css?v=1` (신규)

`workspace-notifications.html` 신규 페이지 + `admin.html`·`mypage.html`·`admin-siren.html`·`workspace.html`·`workspace-kanban.html` 수정.

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오

| # | 시나리오 | 기대 동작 |
|---|---|---|
| Q1 | 어드민이 운영자 관리 R&R 탭에서 Fallback 담당자 + 신고 4종·괴롭힘 5종·법률 5종·지원 N종 매핑 저장 | 매핑 저장 성공 + 다음 단계 시나리오에 활용 |
| Q2 | 사용자가 SIREN 신고 접수 (카테고리 "학교폭력") | 1차 담당자(R&R 매핑된 운영자)의 워크스페이스에 카드 자동 생성, 카드 모달에 "원본 서비스 보기" 버튼 + 사이드 메뉴 |
| Q3 | 사용자가 R&R 매핑 없는 새 카테고리로 신고 (예: 미매핑 카테고리) | Fallback 담당자에게 카드 자동 생성 |
| Q4 | 1차 담당자가 마이페이지에서 부재 예약 (2026-05-13~05-20) → 5/14에 신고 접수 | 백업 담당자에게 카드 생성 + 1차 담당자 워크스페이스에 "복귀 후 확인" 메모 알림 |
| Q5 | 운영자가 카드 모달에서 "토스" → 다른 운영자 선택 + 사유 입력 후 확정 | 카드가 받는 사람 칸반으로 이동, 거쳐온 담당자 체인에 "원담당자 → 받는 사람" 표시, 받는 사람에게 알림, 활동 로그에 토스 기록 |
| Q6 | 운영자가 카드 모달 "관찰하기" 클릭 → 다른 운영자가 그 카드 수정 | 관찰자에게 알림 발송 |
| Q7 | 본인이 본인을 토스 시도 | "자기 자신에게는 토스할 수 없어요" 토스트 |
| Q8 | 워크툴 "할당한 작업" 패널 — 내가 토스한 카드가 보이고 현재 담당자·진행률 표시 | 카드 클릭 시 WBS로 이동해 상세 모달 자동 오픈 |
| Q9 | 알림 벨 클릭 → 드롭다운 → 알림 항목 클릭 | 해당 카드/서비스로 이동 + 알림 자동 읽음 처리 |
| Q10 | 알림 드롭다운 "전체 보기" → `/workspace-notifications.html` 진입 | 알림 전체 + 필터(전체/할당/마감/멘션/시스템) 동작 |
| Q11 | 댓글에서 @운영자명 멘션 후 저장 | 멘션된 운영자에게 알림(category="mention") 발송 |
| Q12 | 마감 24시간 전 카드의 다음날 KST 09:00 시점 cron 실행 (수동 트리거 또는 시간 변경 테스트) | 담당자·워처들에게 마감 알림 발송 |
| Q13 | 카드 done 처리 | 원본 서비스 status가 "closed"로 자동 변경 |
| Q14 | 어드민이 서비스 상세 "담당자 변경" 클릭 → 다른 운영자 선택 | 서비스 담당자 변경 + 카드 담당자도 동기 + 양쪽 알림 + 카드 모달의 거쳐온 체인 갱신 |
| Q15 | 일반 운영자가 운영자 관리 R&R 탭 접근 | 읽기 전용으로 매핑 표 볼 수 있음, 편집 버튼 disabled / "어드민만 편집할 수 있어요" 토스트 |
| Q16 | 어드민 워크툴에 "🚨 미할당" 패널 노출 / 일반 운영자 워크툴에는 비노출 | 권한별 조건부 노출 |

### 4.2 회귀 점검 영역

- WBS 카드 모달 기존 동작 (체크리스트·첨부·댓글·@멘션·드래그·북마크·보류·아카이브·progress)
- R1에서 도입한 통합 모달·BroadcastChannel·#task hash·타임라인
- 워크툴 메인 기존 4대 패널 (내 작업·할당받은=지시함·일정·메모)
- 어드민 로그인 (광범위 — schema 대규모 변경 시)
- 4종 서비스 접수 (incident/harassment/legal/support) — 기존 사용자 진입 동작 정상
- 게시판 댓글 @멘션 기존 동작 (Phase 11 영향 영역)
- 마이페이지 기존 영역 (부재 카드 추가가 다른 영역 영향 X)

### 4.3 백필 필요 여부

- [x] 백필 필요 — R&R 매핑 시드 (Fallback 슬롯 row 1개만)
- [ ] 기존 서비스 row 백필 (assignedTo·workspaceTaskId) 불필요 — 신규 접수부터 적용
- [ ] 기존 카드 백필 (assignedBy) 불필요 — assigneeUid를 기본값으로 둘 수 있음

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [ ] 직렬
- [ ] 평행 (단계머지 없음)
- [x] **평행 + 단계 머지** (B는 schema 1차 머지 → 마이그 호출 → API 2차 머지 / A는 mock으로 평행)

사유: schema 변경 폭이 큼 (4테이블 + 9컬럼). schema·마이그를 먼저 안착시키고 API를 별도 머지하면 schema 회귀 영향 조기 발견 가능. A는 mock 응답으로 평행 작업하다 B 2차 머지 후 실 API 연결.

### 5.2 머지 순서

```
1. B 1차 push (schema.ts + 마이그 함수만)
2. 메인 1차 머지 → push
3. Netlify 배포 1~3분 대기
4. 메인이 Swain께 마이그 URL 안내: /api/migrate-phase21-r2r3?run=1
5. Swain 응답 success 보고 → 메인 또는 C가 schema 활성화·마이그 파일 삭제 → push
6. B 2차 push (API 함수 + lib/workspace-sync.ts + 4종 서비스 hook + cron)
7. 메인 2차 머지 → push
8. (병행) A push (mock 상태로 작업 진행 중 → 실 API 연결 보강)
9. 메인 A 머지 → push
10. C 검증 트리거 → C push → 메인 머지 → 라운드 마감
```

### 5.3 신규 환경변수

**없음**.

> Cron Function은 Netlify 환경변수 추가 없이 `netlify.toml`에 schedule만 등록 (기존 패턴과 동일).

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용)

### 6.1 메인 — 본 설계서가 산출물 (이미 작성 완료)

### 6.2 B 채팅 — 백 구현

```
[B — Phase 21 R2+R3 백 구현 (할당·이관·알림 + 서비스↔카드 동기화 + R&R 통합)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase21-r2r3-back (신규 생성 — 시작 시 git switch -c feature/phase21-r2r3-back origin/main)
베이스: main @ (R1 C 검증 통과 후 갱신된 HEAD — 시작 시점에 메인이 안내)
정독 (필수): docs/milestones/2026-05-12-phase21-r2-r3-assign-sync.md §1·§2
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담), §7 (자체 검증), §10 (사고 사례)

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

이번 라운드 핵심:
  - DB 변경 폭 큼 (신규 테이블 3개 + 컬럼 9개)
  - schema.ts append-only — 파일 끝에 /* === Phase 21 R2+R3 === */ 헤더 후 추가
  - 마이그 함수 1개로 모든 변경 통합 (멱등 IF NOT EXISTS / ON CONFLICT DO NOTHING)
  - 평행+단계 머지 — 1차(schema+마이그) → Swain 호출 → 2차(API+lib+hook+cron)

작업 순서 (1차):
  1) schema.ts 끝에 §1.1 4테이블 정의 추가 (주석 상태 — 마이그 후 활성화)
     ※ import 라인에 bigserial·uniqueIndex·boolean·date 누락 점검
  2) 마이그 함수 작성: netlify/functions/migrate-phase21-r2r3.ts
     - GET ?run=1 + requireAdmin 체크
     - §1.3 SQL 그대로 실행
     - 진단 모드 (GET 기본) — 각 테이블·컬럼 존재 여부 응답
  3) `npx tsc --noEmit` 통과
  4) 1차 push → 메인 보고

작업 순서 (2차, Swain 마이그 호출 + 메인 schema 활성화 후):
  5) lib/workspace-sync.ts 작성 (§2.3 시그니처 그대로)
     - resolveAssigneeByService (R&R + 부재 체크 + Fallback)
     - createWorkspaceTaskFromService (카드 자동 생성 + 알림 + 활동 로그 + 1차 부재 시 복귀 메모)
     - transferWorkspaceTask (토스)
     - syncAssigneeFromService / closeServiceFromTask / closeTaskFromService (양방향 동기화 — origin 플래그)
  6) API 함수 8개 작성 (§2.1 표 그대로 — 명세 §2.2)
     - admin-workspace-task-transfer / admin-workspace-task-watchers / admin-workspace-notifications
     - admin-workspace-tasks 수정 (assignedByMe 필터 + done 시 closeServiceFromTask)
     - admin-service-rnr / admin-service-assignee / admin-user-preferences
     - admin-workspace-task-comments 수정 (멘션 알림 보강)
  7) 4종 서비스 create endpoint에 hook 추가 (incident-report/harassment-report/legal-consultation/support)
  8) cron-workspace-due-reminder.ts — schedule "0 0 * * *" (path 금지)
  9) netlify.toml에 cron 등록
 10) `npx tsc --noEmit` 통과 + curl 단위 동작 확인
 11) 2차 push → 메인 보고

머지 전 체크 (CLAUDE.md §6 + §13):
  - export const config = { path } (cron 제외)
  - requireAdmin 반환 auth.res
  - 응답 키 다중 fallback (data.X || X)
  - try/catch step·detail·stack
  - schema import 누락 0 (bigserial 사고 사례)
  - 양방향 동기화 origin 플래그로 무한 루프 방지

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약 + 마이그 호출 URL.
```

### 6.3 A 채팅 — 프론트 구현

```
[A — Phase 21 R2+R3 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase21-r2r3-front (신규 — 시작 시 git switch -c feature/phase21-r2r3-front origin/main)
베이스: main @ (R1 C 검증 통과 후 갱신된 HEAD — 메인 안내)
정독 (필수): docs/milestones/2026-05-12-phase21-r2-r3-assign-sync.md §3·§4
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담)

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

모드: 평행 mock — B 1차(schema·마이그) 머지 후라도 API 함수가 아직 없으니 mock 응답으로 작업 시작
       B 2차(API) 머지 후 실 API 연결로 전환 (메인 신호 받음)

mock 응답 예시 (B 2차 머지 전까지 사용):
  - GET /api/admin-workspace-notifications?limit=10
    { ok: true, data: { items: [{id:1, category:"assign", linkUrl:"/workspace-kanban.html#task=1", title:"카드 X 할당", readAt: null, createdAt: "2026-05-12T..."}], unreadCount: 1 } }
  - GET /api/admin-workspace-tasks?list=1&assignedByMe=1
    { ok: true, data: { items: [{id:1, title:"...", assigneeUid: 7, assigneeName:"박OO", progress: 50, ...}], total: 1 } }
  - GET /api/admin-service-rnr
    { ok: true, data: { fallback: {primaryUid:1, primaryName:"최고관리자"}, mappings: [{serviceKind:"incident", serviceCategory:"school_violence", primaryUid:7, backupUid:8}] } }
  - GET /api/admin-user-preferences
    { ok: true, data: { outOfOffice: false, outOfOfficeStart: null, outOfOfficeEnd: null, outOfOfficeNote: null } }

작업 순서:
  1) 신규 페이지: public/workspace-notifications.html + 신규 JS public/js/workspace-notifications.js
  2) public/js/workspace-task-modal.js 확장 (토스 모달 + 워처 토글 + 거쳐온 체인 + 원본 서비스 버튼)
  3) public/js/workspace-kanban.js 확장 (카드 모달에 위 UI 마운트, BroadcastChannel으로 알림도 발신)
  4) public/js/workspace.js 확장 — 워크툴 메인에:
     - "할당한 작업" 패널 신설
     - 어드민 권한일 때 "🚨 미할당" 패널 조건부 표시
     - 우측상단 알림 벨 드롭다운 (workspace-sync-channel 알림 채널 활용)
  5) public/js/admin-service-rnr.js (신규) — 운영자 관리 R&R 탭
  6) public/js/admin-service-assignee.js (신규) — 서비스 상세 담당자 박스 자동 마운트 (admin-siren.js·admin.js에서 import)
  7) public/admin.html — R&R 탭 마크업 추가
  8) public/admin-siren.html — 담당자 박스 영역 추가 (자동 마운트)
  9) public/mypage.html + public/js/mypage-out-of-office.js — 부재 토글 카드 신설
 10) public/css/workspace-notifications.css — 드롭다운·페이지 스타일
 11) workspace.html·workspace-kanban.html·admin.html·admin-siren.html·mypage.html·workspace-notifications.html 모두에 신규 JS·CSS <script>/<link> 추가
 12) §3.5 캐시버스터 갱신
 13) 화면 진입·각 버튼·모달 동작 확인 후 push

머지 전 체크:
  - §3.2 모든 와이어프레임 필드·버튼 존재
  - §3.4 토스트 문구 정확 일치
  - public/ 외 파일 변경 0
  - mock 응답 키 ↔ B 2차 명세(§2.2) 키명 1:1 일치 (불일치 시 머지 후 코드 변경 필요)
  - 어드민 권한별 조건부 노출 (미할당 패널, R&R 편집 버튼)

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약 + mock 사용 위치 목록.
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase 21 R2+R3 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase21-r2r3 (신규 — 시작 시 git fetch origin && git switch -c verify/phase21-r2r3 origin/main)
정독: docs/milestones/2026-05-12-phase21-r2-r3-assign-sync.md §4
참고: docs/PARALLEL_GUIDE.md §7 (검증 책임)

작업 순서:
  1) §4.1 Q1~Q16 라이브 시나리오 (라이브 URL — admin/admin12345 로그인)
     - 사전 준비: Q1에서 R&R 매핑·Fallback 슬롯 시드
     - Q2~Q4 서비스↔카드 동기화·R&R·부재 흐름
     - Q5~Q9 토스·워처·할당한 작업·알림
     - Q10~Q11 알림 페이지·멘션
     - Q12 마감 cron (수동 트리거 또는 시간 변경)
     - Q13~Q14 양방향 동기화·서비스 담당자 변경
     - Q15~Q16 권한 조건부 노출
  2) §4.2 회귀 점검 (특히 WBS 카드 모달·통합 모달·4종 서비스 접수·게시판 댓글 멘션)
  3) bug 발견 시 fix 커밋 (브랜치 그대로) → 메인 보고
  4) §4.3 백필: Fallback 슬롯 시드 (1회용 마이그)
  5) 보고서 docs/verify/2026-05-12-phase21-r2r3.md 작성
  6) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주 (CLAUDE.md §6.14).
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B 1차 push → 메인 머지 → Swain 마이그 호출 → schema 활성화·마이그 파일 삭제
- [ ] B 2차 push → 메인 머지 → A에게 실 API 연결 신호
- [ ] A push → 메인 머지 (B 2차 응답 키 ↔ A mock 키 1:1 일치 점검)
- [ ] C 검증 PASS or fix 머지 완료
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 — Phase 21 R2+R3 ✅ 100% 갱신
- [ ] R3'(원래 R4) 설계서 작성 시작 (`2026-05-12-phase21-r3-calendar-memo-search.md`)

---

## 8. 사용자 결정 사항 (확정)

R2 (4건):
- 토스 사유: 선택 입력
- 할당한 작업 탭 위치: 워크툴 메인 신규 패널
- 워처 권한: 본인만 자신 등록
- 마감 알림 시각: KST 09:00 일괄

R3 (7건):
- R&R 단위: 세분류 (기존 enum + 신고에 카테고리 신설)
- 미매핑 서비스: Fallback 담당자 슬롯 (R&R 탭 최상단 명시 지정)
- 부재 토글 시점: 시작·종료 둘 다 날짜 지정 (예약 형태)
- 부재 중 기존 카드: 그대로 유지 (자동 이관 X)
- 카드↔서비스: 완전 양방향 자동 동기화 (origin 플래그로 무한 루프 방지)
- 양방향 무한 루프 방지: 코드 레벨 origin 플래그 + idempotent (DB 컬럼 X)
- 부재 자동 만료: cron 없이 쿼리 시점 계산

---

**설계서 마지막 갱신**: 2026-05-12 (초안 작성)
