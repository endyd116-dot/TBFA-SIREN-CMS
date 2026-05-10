# Phase 10 R3 — 통합 발송 시스템: 발송 예약 큐 + 즉시 발송

> **작성**: 2026-05-11 / 메인 채팅 (Opus 4.7)
> **상위 Phase**: Phase 10 통합 발송 시스템 ([카탈로그](2026-05-10-phase10-22-catalog.md) §2 Phase 10)
> **선행**: Phase 10 R1 템플릿 빌더 (✅ 100% 마감), R2 수신자 그룹 (🟢 진행 중)
> **추정**: 메인 설계 1.5h(완료) / B 백 7~9h / A 프론트 6~7h / C 검증 2~3h / 합계 17~21h
> **모드**: **평행** (PARALLEL_GUIDE §2 정책)

> **참조**: [`PARALLEL_GUIDE.md`](../PARALLEL_GUIDE.md), [`PARALLEL_TEMPLATE.md`](../PARALLEL_TEMPLATE.md)

---

## 0. 라운드 목적

R1 템플릿 + R2 수신자 그룹을 결합해서 **실제 발송**. 두 가지 발송 방식:
- **즉시 발송** — 등록 즉시 큐에 진입, 다음 cron tick에 처리 시작
- **예약 발송** — 운영자가 지정한 시각에 자동 시작

발송 처리는 **cron 1분 단위 + chunk 50건/회**. Background Function 안 씀(15분 제한·실패 대응 어려움). chunk 방식이 안전 — 큰 발송도 여러 cron tick에 나눠 처리, 중간에 어떤 chunk가 실패해도 다음 tick이 이어받음.

채널은 R1 템플릿의 `channel` 필드(`email`/`sms`/`kakao`/`inapp`)에 고정. Phase 8 어댑터(`lib/notify-adapters/*`) 직접 호출 — Phase 8 이벤트 라우팅은 거치지 않음(R3는 마케팅성 발송, 사용자 수신 설정은 별도 라운드 R3.5에서 후처리).

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블 2종

#### `communication_send_jobs` — 발송 작업 메타

```typescript
// db/schema.ts 끝에 추가 — 마이그 호출 후 활성화
export const communicationSendJobs = pgTable("communication_send_jobs", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  name:              varchar("name", { length: 200 }).notNull(),       // 운영자가 식별하는 이름
  templateId:        integer("template_id").notNull()
                       .references(() => communicationTemplates.id, { onDelete: "restrict" }),
  recipientGroupId:  integer("recipient_group_id").notNull()
                       .references(() => recipientGroups.id, { onDelete: "restrict" }),
  channel:           text("channel").notNull(),                         // 템플릿에서 복사 — 'email'|'sms'|'kakao'|'inapp'
  scheduleType:      text("schedule_type").notNull(),                   // 'now' | 'scheduled'
  scheduledAt:       timestamp("scheduled_at"),                         // 'scheduled'면 필수
  status:            text("status").notNull().default("pending"),       // pending|processing|completed|failed|cancelled
  totalRecipients:   integer("total_recipients").notNull().default(0),  // 발송 시작 시 스냅샷 시점 N명
  successCount:      integer("success_count").notNull().default(0),
  failureCount:      integer("failure_count").notNull().default(0),
  lastError:         text("last_error"),                                // 마지막 chunk 처리 시 에러 (디버깅)
  startedAt:         timestamp("started_at"),
  completedAt:       timestamp("completed_at"),
  createdBy:         integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  statusIdx:      index("send_jobs_status_idx").on(t.status),
  scheduledIdx:   index("send_jobs_scheduled_idx").on(t.scheduledAt),
  templateIdx:    index("send_jobs_template_idx").on(t.templateId),
  groupIdx:       index("send_jobs_group_idx").on(t.recipientGroupId),
}));

export type CommunicationSendJob    = typeof communicationSendJobs.$inferSelect;
export type NewCommunicationSendJob = typeof communicationSendJobs.$inferInsert;
```

#### `communication_send_recipients` — 발송 수신자 스냅샷 + 발송 결과

```typescript
export const communicationSendRecipients = pgTable("communication_send_recipients", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  jobId:        integer("job_id").notNull()
                   .references(() => communicationSendJobs.id, { onDelete: "cascade" }),
  memberId:     integer("member_id").notNull()
                   .references(() => members.id, { onDelete: "set null" }),
  channel:      text("channel").notNull(),                  // job.channel 복사 (감사·재시도 시 변경 가능성 대비)
  status:       text("status").notNull().default("pending"), // pending|sending|sent|failed
  sentAt:       timestamp("sent_at"),
  error:        text("error"),                              // 실패 사유 (어댑터 에러 메시지)
  retryCount:   integer("retry_count").notNull().default(0),
  // 발송 시점에 변수 치환된 본문 스냅샷 (감사 + 재시도 시 동일성)
  renderedSubject: text("rendered_subject"),
  renderedBody:    text("rendered_body").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  jobIdx:           index("send_recipients_job_idx").on(t.jobId),
  jobStatusIdx:     index("send_recipients_job_status_idx").on(t.jobId, t.status),
  memberIdx:        index("send_recipients_member_idx").on(t.memberId),
}));

export type CommunicationSendRecipient    = typeof communicationSendRecipients.$inferSelect;
export type NewCommunicationSendRecipient = typeof communicationSendRecipients.$inferInsert;
```

### 1.2 기존 테이블 변경

없음. 본 라운드는 신규 테이블 2개만.

### 1.3 마이그레이션 SQL

```sql
-- IF NOT EXISTS · 멱등 보장
CREATE TABLE IF NOT EXISTS communication_send_jobs (
  id                 BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL,
  template_id        INTEGER NOT NULL REFERENCES communication_templates(id) ON DELETE RESTRICT,
  recipient_group_id INTEGER NOT NULL REFERENCES recipient_groups(id) ON DELETE RESTRICT,
  channel            TEXT NOT NULL,
  schedule_type      TEXT NOT NULL,
  scheduled_at       TIMESTAMP,
  status             TEXT NOT NULL DEFAULT 'pending',
  total_recipients   INTEGER NOT NULL DEFAULT 0,
  success_count      INTEGER NOT NULL DEFAULT 0,
  failure_count      INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  started_at         TIMESTAMP,
  completed_at       TIMESTAMP,
  created_by         INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS send_jobs_status_idx    ON communication_send_jobs(status);
CREATE INDEX IF NOT EXISTS send_jobs_scheduled_idx ON communication_send_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS send_jobs_template_idx  ON communication_send_jobs(template_id);
CREATE INDEX IF NOT EXISTS send_jobs_group_idx     ON communication_send_jobs(recipient_group_id);

CREATE TABLE IF NOT EXISTS communication_send_recipients (
  id               BIGSERIAL PRIMARY KEY,
  job_id           INTEGER NOT NULL REFERENCES communication_send_jobs(id) ON DELETE CASCADE,
  member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE SET NULL,
  channel          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  sent_at          TIMESTAMP,
  error            TEXT,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  rendered_subject TEXT,
  rendered_body    TEXT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS send_recipients_job_idx        ON communication_send_recipients(job_id);
CREATE INDEX IF NOT EXISTS send_recipients_job_status_idx ON communication_send_recipients(job_id, status);
CREATE INDEX IF NOT EXISTS send_recipients_member_idx     ON communication_send_recipients(member_id);

-- 시드 없음. 발송 작업은 운영자가 직접 등록.
```

### 1.4 schema.ts import 점검

- [x] `bigserial`, `varchar`, `text`, `integer`, `timestamp`, `index`, `pgTable` 모두 기존 import에 포함됨
- [ ] `communicationTemplates`(R1), `recipientGroups`(R2) 참조 — 둘 다 schema.ts 안에 정의됨 (R1·R2 머지 후)
- [ ] DB 적용 전 schema 정의는 **주석 처리** (마이그 후 활성화)

---

## 2. API 명세 (B용)

### 2.1 함수 목록 (총 9개 — API 7개 + cron 1개 + 마이그 1개)

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `netlify/functions/admin-send-jobs-list.ts` | `/api/admin-send-jobs-list` | GET | requireAdmin | 발송 작업 목록 (status·기간 필터·페이지네이션) |
| `netlify/functions/admin-send-job-detail.ts` | `/api/admin-send-job-detail` | GET | requireAdmin | 단일 작업 상세 (진행률·통계 포함) |
| `netlify/functions/admin-send-job-create.ts` | `/api/admin-send-job-create` | POST | requireAdmin | 신규 발송 작업 등록 (즉시·예약) |
| `netlify/functions/admin-send-job-cancel.ts` | `/api/admin-send-job-cancel` | POST | requireAdmin | 발송 취소 (pending·processing 상태만) |
| `netlify/functions/admin-send-job-recipients.ts` | `/api/admin-send-job-recipients` | GET | requireAdmin | 작업의 수신자 목록 (status 필터·페이지네이션) |
| `netlify/functions/admin-send-job-progress.ts` | `/api/admin-send-job-progress` | GET | requireAdmin | 실시간 진행률 (가벼운 응답 — 폴링용) |
| `netlify/functions/admin-send-job-preflight.ts` | `/api/admin-send-job-preflight` | POST | requireAdmin | 등록 전 미리보기 (수신자 N명·샘플 5명·렌더링 본문 1건) |
| `netlify/functions/cron-communication-send-dispatcher.ts` | (cron 등록 X — Netlify 콘솔 또는 netlify.toml에 schedule 등록) | Scheduled | (auth 없음) | 1분 단위 — pending 작업 시작 + processing 작업 chunk 처리 |
| `netlify/functions/migrate-phase10-send-jobs.ts` | `/api/migrate-phase10-send-jobs` | GET ?run=1 | requireAdmin | 1회용 마이그 (테이블 2종 + 인덱스 7종) |

### 2.2 함수별 상세

#### `admin-send-jobs-list` (GET)

**쿼리 파라미터** (모두 optional):
- `status`: `pending`|`processing`|`completed`|`failed`|`cancelled` 필터
- `from`, `to`: ISO 날짜 범위 (createdAt 또는 scheduledAt 기준 — 기본 createdAt)
- `q`: 작업 이름 부분 일치
- `limit`: 기본 50, 최대 200
- `offset`: 기본 0

**응답 (성공)**:
```json
{
  "ok": true,
  "rows": [
    {
      "id": 1,
      "name": "월간 뉴스레터 5월호",
      "templateName": "월간 뉴스레터 기본",
      "groupName": "정기 후원자",
      "channel": "email",
      "scheduleType": "scheduled",
      "scheduledAt": "2026-05-31T09:00:00",
      "status": "pending",
      "totalRecipients": 0,
      "successCount": 0,
      "failureCount": 0,
      "createdAt": "..."
    }
  ],
  "total": 12
}
```

`templateName`·`groupName`은 SELECT JOIN 결과 (drizzle 다중 leftJoin 체인 금지 — separate query + Map 매칭).

#### `admin-send-job-detail` (GET ?id=X)

**응답**:
```json
{
  "ok": true,
  "job": {
    "id": 1, "name": "...", "templateId": 5, "templateName": "...",
    "recipientGroupId": 3, "groupName": "...",
    "channel": "email",
    "scheduleType": "scheduled", "scheduledAt": "...",
    "status": "processing",
    "totalRecipients": 320, "successCount": 285, "failureCount": 5,
    "progressPercent": 90.6,
    "lastError": null,
    "startedAt": "...", "completedAt": null,
    "createdBy": 5, "createdAt": "...",
    "recipientStats": {
      "pending": 30, "sending": 0, "sent": 285, "failed": 5
    }
  }
}
```

#### `admin-send-job-create` (POST)

**요청**:
```json
{
  "name": "월간 뉴스레터 5월호",
  "templateId": 5,
  "recipientGroupId": 3,
  "scheduleType": "scheduled",
  "scheduledAt": "2026-05-31T09:00:00"
}
```
또는 즉시 발송:
```json
{
  "name": "긴급 안내",
  "templateId": 7,
  "recipientGroupId": 3,
  "scheduleType": "now"
}
```

**검증** (step=`validate`):
- `name`: 1~200자
- `templateId`: 존재하는 활성 템플릿이어야 함 (is_active=true)
- `recipientGroupId`: 존재하는 활성 그룹이어야 함 (is_active=true)
- `scheduleType`: `now`|`scheduled`
- `scheduledAt`: `scheduled`면 필수 + 미래 시각이어야 함 (현재 시각보다 ≥ 1분 뒤)
- 템플릿의 `channel`을 `job.channel`로 복사

**처리**:
- INSERT job (status='pending')
- `scheduleType='now'`이면 `scheduledAt = NOW()` (cron이 즉시 픽업)
- 이 시점에는 수신자 INSERT 안 함 — cron이 status='pending' → 'processing' 전환 시점에 그룹 resolve + recipient INSERT (스냅샷)

**응답**:
```json
{ "ok": true, "id": 42 }
```

#### `admin-send-job-cancel` (POST ?id=X)

- `pending`: 즉시 status='cancelled' (수신자 INSERT 안 됐으므로 단순 UPDATE)
- `processing`: status='cancelled' 마킹 — cron이 다음 chunk 시점에 작업 종료 처리 (이미 발송된 수신자는 그대로, 미발송 수신자는 status='cancelled'로 일괄 UPDATE)
- `completed`/`failed`/`cancelled`: 400 거부

**응답**: `{ ok: true, status: "cancelled" }`

#### `admin-send-job-recipients` (GET ?id=X&status=&limit=&offset=)

작업의 수신자 목록 페이지네이션. status 필터(pending·sending·sent·failed) 옵션.

**응답**:
```json
{
  "ok": true,
  "recipients": [
    {
      "id": 100, "memberId": 5, "memberName": "홍길동", "memberEmail": "...",
      "channel": "email",
      "status": "sent", "sentAt": "...",
      "error": null, "retryCount": 0
    }
  ],
  "total": 320
}
```

#### `admin-send-job-progress` (GET ?id=X)

가벼운 응답 — 클라이언트 5~10초 폴링용.

**응답**:
```json
{
  "ok": true,
  "progress": {
    "status": "processing",
    "totalRecipients": 320,
    "successCount": 285,
    "failureCount": 5,
    "progressPercent": 90.6,
    "lastError": null
  }
}
```

#### `admin-send-job-preflight` (POST)

등록 전 미리보기. DB 저장 X.

**요청**:
```json
{
  "templateId": 5,
  "recipientGroupId": 3
}
```

**응답**:
```json
{
  "ok": true,
  "preflight": {
    "channel": "email",
    "templateName": "...",
    "groupName": "...",
    "estimatedRecipients": 320,
    "sampleMembers": [...],
    "renderedSample": {
      "memberId": 1, "memberName": "홍길동",
      "subject": "5월 소식", "body": "홍길동님, ..."
    },
    "warnings": [
      "그룹에 회원이 0명입니다.",
      "템플릿이 비활성 상태입니다."
    ]
  }
}
```

샘플 1건은 그룹의 첫 회원 + 템플릿 변수 자동 치환 결과 (R1 `lib/template-render.ts` 활용).

#### `cron-communication-send-dispatcher` (Scheduled)

**스케줄**: 1분 단위 (`schedule = "* * * * *"` 또는 Netlify cron `every 1 minute`)

**처리 흐름**:

```typescript
// 의사 코드
async function dispatcher() {
  /* === 1단계: pending 작업 픽업 === */
  const pendingJobs = await db.select(...)
    .from(communicationSendJobs)
    .where(and(
      eq(status, 'pending'),
      lte(scheduledAt, sql`NOW()`)
    ))
    .limit(10);

  for (const job of pendingJobs) {
    try {
      // 그룹 resolve (R2 lib/recipient-resolve.ts)
      const memberIds = await resolveRecipients(group.criteria);
      
      // 수신자 INSERT (스냅샷) — 변수 치환 본문 포함
      const recipientRows = memberIds.map(mid => ({
        jobId: job.id, memberId: mid, channel: job.channel,
        status: 'pending',
        renderedSubject: render(template.subject, member),
        renderedBody:    render(template.bodyTemplate, member),
      }));
      await db.insert(communicationSendRecipients).values(recipientRows);
      
      // 작업 status='processing', totalRecipients 갱신
      await db.update(communicationSendJobs)
        .set({ status: 'processing', startedAt: NOW(), totalRecipients: memberIds.length })
        .where(eq(id, job.id));
    } catch (err) {
      await db.update(communicationSendJobs)
        .set({ status: 'failed', lastError: err.message })
        .where(eq(id, job.id));
    }
  }

  /* === 2단계: processing 작업 chunk 처리 === */
  const processingJobs = await db.select(...)
    .from(communicationSendJobs)
    .where(eq(status, 'processing'))
    .limit(5);  // 동시 처리 작업 5개

  for (const job of processingJobs) {
    // 50건씩 처리
    const chunk = await db.select(...)
      .from(communicationSendRecipients)
      .where(and(eq(jobId, job.id), eq(status, 'pending')))
      .limit(50);

    let success = 0, failure = 0;
    for (const r of chunk) {
      try {
        // 어댑터 직접 호출 (lib/notify-adapters/{email|sms|kakao|inapp})
        const adapter = ADAPTERS[r.channel];
        await adapter.send(member, { subject: r.renderedSubject, body: r.renderedBody });
        await db.update(communicationSendRecipients)
          .set({ status: 'sent', sentAt: NOW() })
          .where(eq(id, r.id));
        success++;
      } catch (err) {
        await db.update(communicationSendRecipients)
          .set({ status: 'failed', error: err.message, retryCount: r.retryCount + 1 })
          .where(eq(id, r.id));
        failure++;
      }
    }

    // 작업 카운터 갱신
    await db.update(communicationSendJobs)
      .set({ 
        successCount: sql`success_count + ${success}`,
        failureCount: sql`failure_count + ${failure}`,
      })
      .where(eq(id, job.id));

    // 모두 완료됐는지 확인
    const remaining = await db.select(count())...
      .where(and(eq(jobId, job.id), eq(status, 'pending')));
    if (remaining === 0) {
      await db.update(communicationSendJobs)
        .set({ status: 'completed', completedAt: NOW() })
        .where(eq(id, job.id));
    }
  }

  /* === 3단계: cancelled 처리 === */
  // status='cancelled'인 작업의 미발송 수신자 일괄 cancelled 처리
  await db.update(communicationSendRecipients)
    .set({ status: 'cancelled' })
    .where(and(
      eq(status, 'pending'),
      inArray(jobId, sql`SELECT id FROM communication_send_jobs WHERE status = 'cancelled'`)
    ));
}
```

**chunk 50건/회의 의미**:
- 1분당 50건 처리 → 시간당 3000건 → 1000명 발송 = 20분
- 동시 작업 5개 = 시간당 15000건
- 운영 규모(회원 1만 미만)에 충분, 부족하면 Phase 10 R4 또는 별도 라운드에서 chunk·동시 작업 늘림

**실패 재시도** (R3 범위 외):
- 본 라운드는 1회 시도 후 status='failed' 종료
- 재시도는 R3.5 또는 별도 `admin-send-job-retry-failed.ts`로 별도 처리

### 2.3 `lib/communication-send.ts` 헬퍼

```typescript
// lib/communication-send.ts
import type { ChannelName } from "./notify-events";

/**
 * 어댑터 직접 호출 — 이벤트 라우팅 없이 채널·본문 고정.
 * Phase 8 dispatch는 이벤트 기반이라 R3에 부적합.
 */
export async function sendViaAdapter(
  channel: ChannelName,
  member: { id: number; name: string; email?: string; phone?: string },
  payload: { subject?: string; body: string },
): Promise<{ ok: true } | { ok: false; error: string }> { /* ... */ }

/**
 * 작업 등록 시 검증 — 템플릿·그룹 활성·시각 미래
 */
export interface SendJobValidationResult {
  ok: boolean;
  errors: string[];
  template?: any;
  group?: any;
}
export async function validateSendJob(
  templateId: number,
  recipientGroupId: number,
  scheduleType: "now" | "scheduled",
  scheduledAt?: Date,
): Promise<SendJobValidationResult> { /* ... */ }
```

### 2.4 cron 등록

**`netlify.toml`** 또는 함수 파일 내 `export const config = { schedule: "* * * * *" }`:

```typescript
// netlify/functions/cron-communication-send-dispatcher.ts
export const config = { schedule: "* * * * *" };  // 1분 단위
```

> **주의**: Netlify Scheduled Functions는 1분 정확도 보장 안 됨 (10~30초 지연 가능). 운영상 OK.

### 2.5 회귀 점검 — 기존 흐름

- **Phase 8 디스패처(`lib/notify-dispatcher.ts`)** — 변경 0. R3는 어댑터만 직접 호출 (이벤트 dispatch 안 거침)
- **Phase 9 Aligo 어댑터** — 호출 시그니처 변경 0
- **R1 템플릿** — `is_active` 체크만 추가 (등록 시 검증)
- **R2 그룹** — `is_active` 체크 + `lib/recipient-resolve.ts` 호출 (resolveRecipients API 그대로)
- **다른 cron 함수** — schedule 충돌 0 (모두 다른 시각)

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 페이지 | 경로 | 진입점 | 권한 |
|---|---|---|---|
| `public/admin-send-jobs.html` | `/admin-send-jobs.html` | 어드민 사이드바 → 운영 → 발송 작업 | 어드민 |
| `public/admin-send-job-create.html` | `/admin-send-job-create.html` | 목록 페이지 → [+ 새 발송] 버튼 | 어드민 |
| `public/admin-send-job-detail.html` | `/admin-send-job-detail.html?id={id}` | 목록에서 작업 행 클릭 | 어드민 |

### 3.2 페이지별 와이어프레임

#### `admin-send-jobs.html` (목록)

```
┌─ 발송 작업 ─────────────────────────────────────────────────────────────┐
│                                                                          │
│  상태: [전체 ▼]  기간: [    ~    ]  검색: [    ]      [+ 새 발송]        │
│                                                                          │
│  ┌──┬─────────────┬──────────┬──────┬─────────┬──────────┬────────┐    │
│  │ID│ 이름         │ 템플릿    │ 그룹 │ 시간    │ 진행 상태 │ 진행률 │    │
│  ├──┼─────────────┼──────────┼──────┼─────────┼──────────┼────────┤    │
│  │ 1│월간 5월호    │월간 뉴스 │정기  │5/31 09  │진행 중   │285/320 │    │
│  │  │              │          │후원자│         │          │ 89%    │    │
│  │ 2│긴급 안내     │공지 기본 │전체  │즉시     │완료      │1250/   │    │
│  │  │              │          │      │         │          │1250    │    │
│  └──┴─────────────┴──────────┴──────┴─────────┴──────────┴────────┘    │
│                                                                          │
│  [< 이전]  1 / 3  [다음 >]                                               │
└──────────────────────────────────────────────────────────────────────────┘
```

- 상태 셀렉트: 전체/대기/진행 중/완료/실패/취소됨
- 기간: from·to 날짜 (createdAt 기준)
- 검색: 이름 부분 일치
- 새 발송 버튼 → `/admin-send-job-create.html`
- 행 클릭 → `/admin-send-job-detail.html?id=X`
- 진행 상태 색상: 회색(대기) / 파랑(진행 중) / 녹색(완료) / 빨강(실패) / 노랑(취소)

#### `admin-send-job-create.html` (새 발송 만들기)

```
┌─ 새 발송 만들기 ───────────────────────────────────────────────────┐
│                                                                     │
│  발송 이름:    [                                          ] (*)     │
│                                                                     │
│  템플릿:       [선택 ▼] (활성 템플릿 목록 — 채널 함께 표시)         │
│                예) "월간 뉴스레터 기본 (이메일)"                    │
│                                                                     │
│  수신자 그룹:  [선택 ▼] (활성 그룹 목록 — 인원 수 함께 표시)        │
│                예) "정기 후원자 (320명)"                            │
│                                                                     │
│  발송 시간:    ○ 즉시   ○ 예약                                      │
│                예약: [2026-05-31 09:00]                             │
│                                                                     │
│  ┌─ 미리보기 (템플릿·그룹 모두 선택 시 자동 표시) ────────┐        │
│  │  채널: 이메일                                          │        │
│  │  대상: 320명                                            │        │
│  │  샘플 1명 (그룹 첫 회원으로 자동 변수 치환):           │        │
│  │  ┌─────────────────────────────────────────┐           │        │
│  │  │ 홍길동님 / 5월 소식                     │           │        │
│  │  │ 홍길동님, 안녕하세요...                 │           │        │
│  │  └─────────────────────────────────────────┘           │        │
│  │  ⚠ 경고 (있을 시):                                     │        │
│  │   • 그룹에 회원이 0명입니다.                           │        │
│  └──────────────────────────────────────────────────────────┘        │
│                                                                     │
│  [취소]  [등록 (발송 시작은 cron 픽업 시점)]                       │
└─────────────────────────────────────────────────────────────────────┘
```

동작:
- 템플릿·그룹 둘 다 선택되면 `admin-send-job-preflight` 자동 호출 → 미리보기 표시
- 즉시 라디오 선택 시 시각 입력 칸 숨김
- 예약 라디오 선택 시 시각 입력 (datetime-local input) 노출 — 현재 시각보다 1분 이상 미래만 허용 (클라이언트 검증)
- 등록 시 `admin-send-job-create` POST → 성공 시 detail 페이지로 이동 또는 list로 이동 (사용자 토스트 + 이동)

#### `admin-send-job-detail.html` (발송 상세 + 진행 추적)

```
┌─ 발송 상세 #1: 월간 뉴스레터 5월호 ─────────────────────────────────┐
│                                                                       │
│  📋 작업 정보                                                         │
│  ─────────────────────────────────────────────────────────────       │
│  템플릿: 월간 뉴스레터 기본 / 채널: 이메일                            │
│  수신자 그룹: 정기 후원자                                             │
│  예약 시각: 2026-05-31 09:00                                          │
│  등록자: 관리자홍 / 2026-05-30 14:23                                  │
│                                                                       │
│  📊 진행률                                                            │
│  ─────────────────────────────────────────────────────────────       │
│  상태: 🔵 진행 중                                                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 89%                  │
│                                                                       │
│  ┌─ 통계 ─────────────────────────┐                                  │
│  │ 전체 수신자:  320명             │                                  │
│  │ 발송 성공:    285명 (89.0%)     │                                  │
│  │ 발송 실패:      5명 ( 1.6%)     │                                  │
│  │ 대기 중:       30명 ( 9.4%)     │                                  │
│  └─────────────────────────────────┘                                  │
│                                                                       │
│  [발송 취소] (진행 중일 때만 노출)                                   │
│                                                                       │
│  📨 수신자 목록                                                       │
│  ─────────────────────────────────────────────────────────────       │
│  필터: [전체 ▼] [성공만] [실패만] [대기 중]                           │
│  ┌──┬──────┬───────┬──────┬─────────────────┬──────────────────┐     │
│  │ID│ 회원 │ 이메일 │ 상태 │ 발송 시각        │ 실패 사유        │     │
│  ├──┼──────┼───────┼──────┼─────────────────┼──────────────────┤     │
│  │ 1│홍길동│hong..  │ 성공 │2026-05-31 09:01 │                  │     │
│  │ 2│김철수│kim..   │ 실패 │2026-05-31 09:02 │이메일 형식 오류   │     │
│  └──┴──────┴───────┴──────┴─────────────────┴──────────────────┘     │
│  [< 이전]  1 / 7  [다음 >]                                            │
└───────────────────────────────────────────────────────────────────────┘
```

동작:
- 페이지 진입 시 detail API 1회 + 수신자 목록 1회
- 진행 중(processing)이면 progress API 5초 폴링 → 통계·진행률 갱신
- 완료(completed) 또는 실패(failed) 또는 취소(cancelled)되면 폴링 중지
- 취소 버튼 → confirm → cancel API → 토스트 + 상태 갱신
- 수신자 목록 필터·페이지네이션

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 응답 처리 |
|---|---|---|
| 목록 진입 | `admin-send-jobs-list` GET | 표 렌더 |
| 새 발송 버튼 | (없음) | 생성 페이지 이동 |
| 템플릿/그룹 선택 (생성 페이지) | `admin-send-job-preflight` POST | 미리보기 영역 갱신 |
| 등록 버튼 | `admin-send-job-create` POST | 성공 토스트 → detail 페이지 이동 |
| 작업 클릭 (목록) | (없음) | detail 페이지 이동 |
| detail 페이지 진입 | `admin-send-job-detail` GET + `admin-send-job-recipients` GET | 정보·통계·수신자 목록 |
| detail 폴링 (진행 중) | `admin-send-job-progress` GET ?id=X | 진행률·통계만 갱신 |
| 취소 버튼 | `admin-send-job-cancel` POST ?id=X | 토스트 + 상태 갱신 |
| 수신자 필터 변경 | `admin-send-job-recipients` GET ?id=X&status=Y | 표 갱신 |

### 3.4 토스트·문구 모음

| 상황 | 문구 |
|---|---|
| 등록 성공 (즉시) | "발송이 등록되었습니다. 곧 시작됩니다." |
| 등록 성공 (예약) | "{시각}에 자동 발송됩니다." |
| 검증 실패 — 이름 비었음 | "발송 이름을 입력해 주세요." |
| 검증 실패 — 템플릿 비활성 | "선택한 템플릿이 비활성 상태입니다." |
| 검증 실패 — 그룹 0명 | "선택한 그룹에 회원이 없습니다." |
| 검증 실패 — 예약 과거 | "예약 시각은 현재로부터 1분 이후여야 합니다." |
| 취소 성공 | "발송이 취소되었습니다. 이미 발송된 수신자는 제외됩니다." |
| 취소 거부 (완료된 작업) | "이미 완료된 발송은 취소할 수 없습니다." |
| 폴링 중단 (완료) | "발송이 완료되었습니다." (한 번만) |

### 3.5 캐시버스터

신규 파일이라 v1로 시작:
- `public/admin-send-jobs.html` → `<script src="js/admin-send-jobs.js?v=1">`
- `public/admin-send-job-create.html` → `<script src="js/admin-send-job-create.js?v=1">`
- `public/admin-send-job-detail.html` → `<script src="js/admin-send-job-detail.js?v=1">`

`public/admin.html` 사이드바: 운영 그룹의 [👥 수신자 그룹] 다음에 `[📤 발송 작업]` 1줄 추가.

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오 (Q1~Q12)

| # | 시나리오 (사용자 동작) | 기대 동작 |
|---|---|---|
| Q1 | 어드민 → 사이드바 → 발송 작업 | 빈 목록 또는 기존 작업 표시 |
| Q2 | 새 발송 → 이름·템플릿·그룹·즉시 선택 → 미리보기 자동 표시 | 채널·N명·샘플 1건 표시, 등록 가능 |
| Q3 | Q2에서 등록 → detail 페이지 이동 | 상태 'pending' 또는 곧 'processing'으로 변경 |
| Q4 | 1~2분 후 detail 새로고침 또는 폴링 | 진행률 증가, 수신자 목록에 sent/failed 표시 |
| Q5 | 진행 중 작업 → 취소 버튼 | 'cancelled', 미발송 수신자 'cancelled', 토스트 |
| Q6 | 비활성 템플릿 선택해서 등록 시도 | 미리보기에 경고 + 등록 거부 토스트 |
| Q7 | 0명 그룹 선택해서 등록 시도 | 미리보기 경고 + 등록 가능하지만 즉시 'completed' (수신자 0명) |
| Q8 | 예약 시각 과거로 입력 | 클라이언트 거부 + 토스트 |
| Q9 | 예약 발송 등록 → 예약 시각 도래 | cron이 픽업 → 'processing' 전환, 진행 중 표시 |
| Q10 | 수신자 목록 필터 (성공만/실패만/대기) | 결과 행이 모두 해당 status |
| Q11 | 같은 템플릿+그룹으로 두 작업 등록 | 둘 다 정상 등록·발송 (작업 단위 격리 확인) |
| Q12 | 검색·기간·상태 동시 필터 | 결과 행이 모든 조건 만족 |

### 4.2 회귀 점검 영역

- **어드민 로그인** — 신규 테이블만 추가, members SELECT 영향 0
- **R1 템플릿 빌더** — 영역 분리, 템플릿 사용처(jobs.template_id FK)에 onDelete=restrict 추가만 영향 → 템플릿 삭제(soft delete) 시 R3 jobs 영향 0
- **R2 수신자 그룹** — 동일 (groups.id FK restrict)
- **Phase 8 디스패처** — 변경 0이 정상 (이벤트 기반, R3는 어댑터 직접 호출)
- **Phase 9 Aligo** — 어댑터 직접 호출만 추가, 어댑터 코드 변경 0
- **다른 cron 함수** — 시각 충돌 0
- **회원·후원 등 어드민 화면 2~3개** — schema import 회귀 광범위 점검

### 4.3 cron 동작 검증 (C 추가)

- cron이 1분 단위 실제 실행되는지 (Netlify 콘솔 또는 함수 로그)
- pending 작업이 scheduledAt 도래 시 processing으로 전환되는지
- chunk 50건이 정확히 처리되는지 (수신자 1000명 작업 등록 → 20분 후 완료 확인)
- 실패한 chunk 다음 cron이 이어받는지 (강제 에러 주입)
- 동시 작업 5개 한도가 지켜지는지

### 4.4 백필 필요 여부

- [x] 백필 불필요 — 신규 테이블만 추가, 기존 데이터 변환 X

### 4.5 성능·비용 점검 (C 추가)

- preflight API 응답 시간 — 그룹 1만 회원 규모에서 2초 미만
- detail + recipients 페이지 1회 진입 — 합계 1초 미만
- progress 폴링 — 0.3초 미만 (가벼운 응답)
- cron 1회 실행 시간 — 10초 미만 (Netlify Scheduled Function 한도 30초 권장)
- 어느 한 항목이라도 한도 넘으면 보고서 명시 + 인덱스·chunk 크기 조정 검토

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] **평행** (PARALLEL_GUIDE §2)

A·B 동시. A는 §2.2 응답 구조 + §3.2 와이어프레임 명세 그대로 작성.

### 5.2 머지 순서

```
1. B push + A push (평행)
2. B 머지 → main push
3. Netlify 배포 1~3분
4. 메인이 Swain께 마이그 호출 안내:
   /api/migrate-phase10-send-jobs?run=1
5. Swain 응답 success → 메인:
   - schema 정의 활성화
   - migrate-phase10-send-jobs.ts 삭제
   - cron 함수가 schedule 등록되었는지 Netlify 콘솔 확인 (자동 등록되지 않으면 netlify.toml 확인)
   → push
6. A 머지 → main push
7. C verify 트리거 → C 검증 (cron 동작 포함) → 라운드 마감
```

### 5.3 신규 환경변수

없음. Phase 8·9 어댑터(`ALIGO_*`, `RESEND_API_KEY`, `EMAIL_FROM` 등) 그대로 활용.

### 5.4 R2와 동시 진행 시 주의

- R2가 같이 진행 중이면 R3 schema 정의가 R2의 `recipientGroups`에 FK 의존
- B는 R3 작업 시작 전 origin/main에 R2가 머지됐는지 확인 → 안 됐으면 R2 머지·schema 활성화 후 R3 시작
- R3가 R2보다 먼저 머지되는 경우는 발생하지 않음 (R3 schema가 recipientGroups 참조)

### 5.5 cron schedule 등록

`netlify.toml` 또는 함수 파일 `export const config`:

```toml
# netlify.toml에 등록 시
[functions."cron-communication-send-dispatcher"]
  schedule = "* * * * *"
```

또는 함수 파일 안에:
```typescript
export const config = { schedule: "* * * * *" };
```

후자가 권장 (코드와 함께 버전 관리).

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용)

### 6.1 메인 — 본 설계서가 산출물 (생략)

### 6.2 B 채팅 — 백 구현

```
[B — Phase 10 R3 백 구현 (발송 예약 큐 + 즉시 발송)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase10-r3-back (베이스 origin/main 최신 — R2 머지 완료된 상태)
정독 (필수):
  - docs/milestones/2026-05-11-phase10-r3-send-queue.md §1·§2
  - PARALLEL_GUIDE §1.5(자동 진행)·§1.6(진행률 보고)·§3(영역)·§7(자체 검증)

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example, netlify.toml(필요시)
금지: public/, assets/

세팅:
  cd ../tbfa-mis-B
  git fetch origin
  git checkout -b feature/phase10-r3-back origin/main
  ※ R2(recipient_groups)가 origin/main에 머지된 상태인지 확인 — 안 됐으면 R2 머지 대기 후 시작

작업 순서:
  1) lib/communication-send.ts (§2.3)
     - sendViaAdapter: 채널·본문 받아 lib/notify-adapters/{email|sms|kakao|inapp} 직접 호출
     - validateSendJob: 템플릿·그룹 활성·시각 미래 검증
  2) netlify/functions/migrate-phase10-send-jobs.ts (§1.3 SQL)
     - requireAdmin + GET ?run=1 + 멱등 (테이블 2종 + 인덱스 7종)
  3) db/schema.ts §1.1 정의 추가 (주석 상태 — 마이그 후 메인이 활성화)
     ※ communicationTemplates(R1) + recipientGroups(R2) 둘 다 schema에 있어야 FK 가능
  4) API 함수 7종 (§2.1, cron·migrate 제외) — §2.2 명세 그대로
     - admin-send-jobs-list / detail / create / cancel / recipients / progress / preflight
  5) cron 함수 (§2.2 cron-communication-send-dispatcher)
     - export const config = { schedule: "* * * * *" }
     - 3단계 처리 (pending 픽업 → processing chunk 50 → cancelled 정리)
     - 동시 작업 5개 한도
  6) `npx tsc --noEmit` 통과 후 push
     ※ 누적 타입 에러 149건은 기존, 신규 코드만 0이면 OK

머지 전 체크 (CLAUDE.md §6 + §13):
  - export const config = { path } 7개 + cron 1개
  - requireAdmin 반환 auth.res 패턴
  - 응답 키 다중 fallback
  - try/catch step·detail·stack
  - schema import 회귀 0
  - cron 안에서 lib/template-render.ts(R1)·lib/recipient-resolve.ts(R2) 호출

진행률 보고 (PARALLEL_GUIDE §1.6):
  - lib/communication-send.ts + 마이그 + schema 완료 시 1회
  - API 7종 완료 시 1회
  - cron 함수 완료 + tsc 통과 시 1회
  - 형식: "현재 X% 완료 — {다음 단계}"

push 후 메인 보고: 브랜치명·커밋 해시·변경 파일 요약·tsc 결과.
```

### 6.3 A 채팅 — 프론트 구현

```
[A — Phase 10 R3 프론트 구현 (발송 예약 큐 + 즉시 발송)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase10-r3-front (베이스 origin/main 최신 — R2 머지 완료)
정독 (필수):
  - docs/milestones/2026-05-11-phase10-r3-send-queue.md §3
  - 응답 구조: 같은 설계서 §2.2
  - PARALLEL_GUIDE §1.5·§1.6·§3

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, .env.example, netlify.toml

모드: 평행 — B와 동시. 실 API 명세대로 작성, mock 사용 X.

세팅:
  cd ../tbfa-mis-A
  git fetch origin
  git checkout -b feature/phase10-r3-front origin/main

작업 순서:
  1) public/admin-send-jobs.html — §3.2 목록 와이어프레임
  2) public/js/admin-send-jobs.js — §3.3 매핑 (list API + 행 클릭 detail 이동)
  3) public/admin-send-job-create.html — §3.2 생성 와이어프레임 + 미리보기
  4) public/js/admin-send-job-create.js
     - 즉시/예약 라디오 → 시각 입력 토글
     - 템플릿+그룹 둘 다 선택 시 preflight 자동 호출
     - 예약 시각 검증 (현재로부터 1분 이상 미래)
     - 등록 → create API → detail 페이지로 이동
  5) public/admin-send-job-detail.html — §3.2 상세 + 진행 추적
  6) public/js/admin-send-job-detail.js
     - 페이지 진입 시 detail + recipients 1회
     - status='processing'이면 progress API 5초 폴링
     - 완료/실패/취소되면 폴링 중지
     - 취소 버튼 → confirm → cancel API
     - 수신자 목록 필터(전체/성공/실패/대기) + 페이지네이션
  7) public/admin.html 사이드바 운영 그룹의 [👥 수신자 그룹] 다음 줄에
     [📤 발송 작업] 메뉴 1줄 추가 (onclick 우회 패턴)
     ※ origin/main 최신 fetch 후 작업 — admin.html은 R1·R2가 이미 메뉴 추가
  8) §3.5 캐시버스터 ?v=1
  9) 화면 진입·생성·상세·폴링·취소 흐름 자체 점검 후 push

머지 전 체크:
  - §3.2 모든 필드·버튼·라디오·필터 존재
  - §3.4 토스트 문구 정확 일치
  - 즉시/예약 라디오 동적 동작
  - 폴링 시작·중지 정확 (5초 간격, 완료 시 멈춤)
  - public/ 외 변경 0

진행률 보고 (PARALLEL_GUIDE §1.6):
  - 목록 + 사이드바 메뉴 완료 시 1회
  - 생성 페이지 (preflight·예약/즉시 토글) 완료 시 1회
  - 상세 페이지 (폴링·취소·수신자 필터) + 캐시버스터 완료 시 1회
  - 형식: "현재 X% 완료 — {다음 단계}"

push 후 메인 보고: 브랜치명·커밋 해시·변경 파일 요약.
※ 라이브 검증·cron 동작 확인은 B 머지 + schema 활성화 + A 머지 후 C가 진행.
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase 10 R3 검증·fix (발송 예약 큐)]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase10-r3 (베이스 main @ {A 머지 후 커밋})
정독: docs/milestones/2026-05-11-phase10-r3-send-queue.md §4

세팅:
  cd ../tbfa-mis-C
  git fetch origin
  git checkout -b verify/phase10-r3 origin/main

작업 순서:
  1) §4.1 Q1~Q12 라이브 시나리오 (사용자 동작·결과 기록)
  2) §4.2 회귀 점검 — Phase 8·9·R1·R2 영향 0 확인
  3) §4.3 cron 동작 검증 (Netlify 콘솔 또는 함수 로그)
     - 1분 단위 실행 확인
     - pending → processing 전환 확인
     - chunk 50건 정확 처리 (테스트 작업 등록 후 추적)
     - 동시 작업 한도 5개
  4) §4.5 성능 점검 (preflight·detail·polling 응답 시간)
  5) bug 발견 시 fix 커밋 → 메인 보고
     ※ cron 관련 bug는 시간 민감 — 머지 우선
  6) 보고서 docs/verify/2026-05-11-phase10-r3.md
     - Q별 PASS/FAIL + 회귀 + cron + 성능
  7) push → 메인 보고

표현 규칙 (CLAUDE.md §6.14):
  - 함수명·코드 용어 없이 사용자 동작·결과 위주
  - 예) "5월 31일 09시로 예약한 발송이 그 시각에 자동 시작됨" (O)
  - 예) "cron-communication-send-dispatcher가 status='pending' SELECT 후 UPDATE" (X)

진행률 보고 (PARALLEL_GUIDE §1.6):
  - Q1~Q5 + 회귀 점검 완료 시 1회
  - cron 동작 검증 + 성능 점검 + 보고서 완료 시 1회
  - 형식: "현재 X% 완료 — {다음 단계}"

push 후 메인 보고: 브랜치명·커밋 해시·Q1~Q12 PASS/FAIL·회귀·cron·성능 결과.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B push + A push 보고 받음
- [ ] B 머지 → push → Netlify 배포
- [ ] Swain 마이그 호출 (`/api/migrate-phase10-send-jobs?run=1`) 응답 success
- [ ] schema 활성화 + 마이그 파일 삭제 → push
- [ ] cron schedule 등록 확인 (Netlify 콘솔 — Functions → Scheduled)
- [ ] A 머지 → push
- [ ] 라이브 진입 1차 점검 (페이지 200, 사이드바 메뉴, cron 첫 실행 로그)
- [ ] C verify 트리거 + 보고 흡수 (Q1~Q12 PASS·회귀 0·cron OK·성능 OK)
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 Phase 10 R3 행 갱신
- [ ] R4 (열람률·클릭률 추적) 설계 시작 또는 다음 우선순위 조정

---

## 8. R3 이후 라운드 예고

- **R4 열람률·클릭률 추적**: 이메일 open pixel + 링크 redirect 추적 + 통계 화면. R3 발송 작업 단위 통계.
- **R5 AI 트리거 자동 발송**: 이탈 위험 ↑ 회원에게 재참여 메시지·캠페인 부진 시 운영자 알림 등. 이미 운영 중인 이탈 점수·캠페인 부진 cron 활용.
- **R3.5 (옵션)**: 사용자 마케팅 수신 동의 컬럼 + 그룹 자동 필터, 실패 수신자 재시도, 어댑터별 rate limit 등 미세 조정.

R3 자체는 발송 시스템 본체 완성. R4·R5는 분석·자동화 레이어.
