# Phase 10 R4 — 통합 발송 시스템 마무리 (추적·AI 트리거·분석·재발송·이력)

> **작성**: 2026-05-11 / 메인 채팅 (Opus 4.7)
> **상위 Phase**: Phase 10 통합 발송 시스템 ([카탈로그](2026-05-10-phase10-22-catalog.md) §2 Phase 10 단계 4·5)
> **선행**: R1 템플릿 빌더 ✅ / R2 수신자 그룹 ✅ / R3 발송 큐 ✅
> **추정**: 메인 설계 2h(완료) / B 백 12~14h / A 프론트 13~15h / C 검증 3~4h / 합계 30~35h
> **모드**: **평행** (PARALLEL_GUIDE §2)
> **특징**: 큰 라운드 — 카탈로그 R4(추적) + R5(AI 트리거)를 통합. A·B 작업량 ↑로 메인 대기 시간 ↓ (Swain 정책 2026-05-11)

> **참조**: [`PARALLEL_GUIDE.md`](../PARALLEL_GUIDE.md), [`PARALLEL_TEMPLATE.md`](../PARALLEL_TEMPLATE.md)

---

## 0. 라운드 범위 — 6개 영역

본 라운드는 Phase 10 발송 시스템 마무리. 카탈로그 단계 4(열람·클릭률)와 5(AI 트리거)를 통합하고, 운영자 편의 기능(재발송·이력 검색·분석 대시보드) 추가.

| # | 영역 | 책임 | 의존 |
|---|---|---|---|
| **A** | 이메일 추적 인프라 (open pixel + link click) | B | R3 (수신자 스냅샷) |
| **B** | AI 트리거 자동 발송 + 5종 시드 | B | R1·R2·R3 |
| **C** | 트리거 관리 화면 | A | A 영역 머지 |
| **D** | 발송 분석 대시보드 | A | A 영역 머지 |
| **E** | 실패 수신자 재발송 | B+A | R3 |
| **F** | 발송 이력 통합 검색 (회원별) | B+A | R3 + 추적 |

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블 3종

#### `communication_tracking_events` — 열람·클릭 이벤트

```typescript
// db/schema.ts 끝에 추가 — 마이그 호출 후 활성화
export const communicationTrackingEvents = pgTable("communication_tracking_events", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  recipientId:  integer("recipient_id").notNull()
                  .references(() => communicationSendRecipients.id, { onDelete: "cascade" }),
  eventType:    text("event_type").notNull(),    // 'open' | 'click'
  trackedAt:    timestamp("tracked_at").defaultNow().notNull(),
  // click 이벤트일 때 어떤 링크인지
  linkUrl:      text("link_url"),
  // 추가 메타 (User-Agent·IP — 마케팅 표준 분석용)
  userAgent:    text("user_agent"),
  ipAddress:    varchar("ip_address", { length: 45 }),
}, (t) => ({
  recipientIdx:  index("tracking_events_recipient_idx").on(t.recipientId),
  eventTypeIdx:  index("tracking_events_type_idx").on(t.eventType),
  trackedAtIdx:  index("tracking_events_tracked_at_idx").on(t.trackedAt),
}));

export type CommunicationTrackingEvent    = typeof communicationTrackingEvents.$inferSelect;
export type NewCommunicationTrackingEvent = typeof communicationTrackingEvents.$inferInsert;
```

#### `communication_auto_triggers` — AI 트리거 정의

```typescript
export const communicationAutoTriggers = pgTable("communication_auto_triggers", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  name:             varchar("name", { length: 100 }).notNull(),
  description:      text("description"),
  // 트리거 종류:
  //   'churn_risk'         — 이탈 위험 회원 재참여 (이탈 점수 임계치 이상)
  //   'campaign_slump'     — 캠페인 부진 시 운영자 알림
  //   'welcome'            — 신규 회원 환영 (가입 후 N일)
  //   'anniversary'        — 후원 기념일 축하 (정기 후원 N개월)
  //   'birthday'           — 생일 축하
  //   'custom_filter'      — 운영자 정의 (필터 조건)
  triggerType:      text("trigger_type").notNull(),
  // 트리거 조건 (JSONB):
  //   churn_risk: { "min_score": 70, "max_score": 100 }
  //   welcome: { "days_after_signup": 1 }
  //   anniversary: { "every_months": 6 }
  //   birthday: { } (설정 불필요)
  //   custom_filter: { "filter": [...같은 R2 화이트리스트] }
  conditions:       jsonb("conditions").default(sql`'{}'::jsonb`).notNull(),
  // 발송 매핑:
  templateId:       integer("template_id").notNull()
                      .references(() => communicationTemplates.id, { onDelete: "restrict" }),
  // recipientGroupId가 있으면 우선 적용. 없으면 trigger_type 기본 그룹 자동 생성
  recipientGroupId: integer("recipient_group_id")
                      .references(() => recipientGroups.id, { onDelete: "set null" }),
  channel:          text("channel").notNull(),
  // 실행 정책:
  isActive:         boolean("is_active").default(true).notNull(),
  cooldownDays:     integer("cooldown_days").default(30).notNull(),  // 같은 회원에 N일 내 재발송 금지
  lastRunAt:        timestamp("last_run_at"),                          // cron이 마지막 평가한 시각
  totalRuns:        integer("total_runs").default(0).notNull(),
  totalSent:        integer("total_sent").default(0).notNull(),
  createdBy:        integer("created_by").references(() => members.id, { onDelete: "set null" }),
  updatedBy:        integer("updated_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  triggerTypeIdx: index("auto_triggers_type_idx").on(t.triggerType),
  activeIdx:      index("auto_triggers_active_idx").on(t.isActive),
}));

export type CommunicationAutoTrigger    = typeof communicationAutoTriggers.$inferSelect;
export type NewCommunicationAutoTrigger = typeof communicationAutoTriggers.$inferInsert;
```

#### `communication_auto_trigger_runs` — 트리거 실행 이력 (쿨다운 + 감사)

```typescript
export const communicationAutoTriggerRuns = pgTable("communication_auto_trigger_runs", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  triggerId:    integer("trigger_id").notNull()
                  .references(() => communicationAutoTriggers.id, { onDelete: "cascade" }),
  memberId:     integer("member_id").notNull()
                  .references(() => members.id, { onDelete: "set null" }),
  // 발송된 작업 (NULL이면 cooldown으로 스킵)
  sendJobId:    integer("send_job_id")
                  .references(() => communicationSendJobs.id, { onDelete: "set null" }),
  status:       text("status").notNull(), // 'sent' | 'cooldown_skip' | 'condition_unmet'
  ranAt:        timestamp("ran_at").defaultNow().notNull(),
}, (t) => ({
  triggerIdx:    index("auto_trigger_runs_trigger_idx").on(t.triggerId),
  memberTriggerIdx: index("auto_trigger_runs_member_trigger_idx").on(t.memberId, t.triggerId),
  ranAtIdx:      index("auto_trigger_runs_ran_at_idx").on(t.ranAt),
}));

export type CommunicationAutoTriggerRun    = typeof communicationAutoTriggerRuns.$inferSelect;
export type NewCommunicationAutoTriggerRun = typeof communicationAutoTriggerRuns.$inferInsert;
```

### 1.2 기존 테이블 컬럼 추가

| 테이블 | 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|---|
| `communication_send_recipients` | `tracking_token` | varchar(64) | UNIQUE | open pixel·click redirect 식별용. 발송 시점에 nanoid 생성 |
| `communication_send_recipients` | `opened_at` | timestamp | NULL | 첫 열람 시각 (캐시) |
| `communication_send_recipients` | `first_clicked_at` | timestamp | NULL | 첫 클릭 시각 (캐시) |
| `communication_send_recipients` | `open_count` | integer | DEFAULT 0 | 누적 열람 횟수 |
| `communication_send_recipients` | `click_count` | integer | DEFAULT 0 | 누적 클릭 횟수 |
| `communication_send_jobs` | `triggered_by_auto_id` | integer | NULL, FK auto_triggers(set null) | AI 트리거가 만든 작업 표시 |

### 1.3 마이그레이션 SQL

```sql
-- IF NOT EXISTS · 멱등 보장

-- 1. tracking_events
CREATE TABLE IF NOT EXISTS communication_tracking_events (
  id            BIGSERIAL PRIMARY KEY,
  recipient_id  INTEGER NOT NULL REFERENCES communication_send_recipients(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  tracked_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  link_url      TEXT,
  user_agent    TEXT,
  ip_address    VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS tracking_events_recipient_idx   ON communication_tracking_events(recipient_id);
CREATE INDEX IF NOT EXISTS tracking_events_type_idx        ON communication_tracking_events(event_type);
CREATE INDEX IF NOT EXISTS tracking_events_tracked_at_idx  ON communication_tracking_events(tracked_at);

-- 2. auto_triggers
CREATE TABLE IF NOT EXISTS communication_auto_triggers (
  id                  BIGSERIAL PRIMARY KEY,
  name                VARCHAR(100) NOT NULL,
  description         TEXT,
  trigger_type        TEXT NOT NULL,
  conditions          JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id         INTEGER NOT NULL REFERENCES communication_templates(id) ON DELETE RESTRICT,
  recipient_group_id  INTEGER REFERENCES recipient_groups(id) ON DELETE SET NULL,
  channel             TEXT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  cooldown_days       INTEGER NOT NULL DEFAULT 30,
  last_run_at         TIMESTAMP,
  total_runs          INTEGER NOT NULL DEFAULT 0,
  total_sent          INTEGER NOT NULL DEFAULT 0,
  created_by          INTEGER REFERENCES members(id) ON DELETE SET NULL,
  updated_by          INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auto_triggers_type_idx   ON communication_auto_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS auto_triggers_active_idx ON communication_auto_triggers(is_active);

-- 3. auto_trigger_runs
CREATE TABLE IF NOT EXISTS communication_auto_trigger_runs (
  id            BIGSERIAL PRIMARY KEY,
  trigger_id    INTEGER NOT NULL REFERENCES communication_auto_triggers(id) ON DELETE CASCADE,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE SET NULL,
  send_job_id   INTEGER REFERENCES communication_send_jobs(id) ON DELETE SET NULL,
  status        TEXT NOT NULL,
  ran_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auto_trigger_runs_trigger_idx        ON communication_auto_trigger_runs(trigger_id);
CREATE INDEX IF NOT EXISTS auto_trigger_runs_member_trigger_idx ON communication_auto_trigger_runs(member_id, trigger_id);
CREATE INDEX IF NOT EXISTS auto_trigger_runs_ran_at_idx         ON communication_auto_trigger_runs(ran_at);

-- 4. send_recipients 컬럼 추가
ALTER TABLE communication_send_recipients
  ADD COLUMN IF NOT EXISTS tracking_token   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS opened_at        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS first_clicked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS open_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_count      INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS send_recipients_tracking_token_idx
  ON communication_send_recipients(tracking_token) WHERE tracking_token IS NOT NULL;

-- 5. send_jobs 컬럼 추가
ALTER TABLE communication_send_jobs
  ADD COLUMN IF NOT EXISTS triggered_by_auto_id INTEGER REFERENCES communication_auto_triggers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS send_jobs_triggered_by_idx ON communication_send_jobs(triggered_by_auto_id);

-- 6. 시드 — AI 트리거 5종 (Swain이 활성화 토글로 운영)
-- 템플릿 ID는 R1 시드 또는 운영자가 만든 템플릿 ID로 자동 매핑 (마이그에서 SELECT 후 사용)
-- 시드는 비활성 상태로 INSERT — 운영자가 검토 후 활성화
INSERT INTO communication_auto_triggers
  (name, description, trigger_type, conditions, template_id, channel, is_active, cooldown_days)
SELECT
  '이탈 위험 회원 재참여',
  '이탈 점수 70점 이상 + 최근 90일 활동 없는 회원에게 재참여 메시지 발송',
  'churn_risk',
  '{"min_score":70,"max_score":100,"min_days_inactive":90}'::jsonb,
  t.id,
  'email',
  false,
  60
FROM communication_templates t
WHERE t.category = 'auto_trigger' AND t.is_active = true
ORDER BY t.id ASC
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO communication_auto_triggers
  (name, description, trigger_type, conditions, template_id, channel, is_active, cooldown_days)
SELECT '캠페인 부진 운영자 알림', '캠페인 목표 대비 50% 미달 시 운영자에게 알림',
  'campaign_slump', '{"threshold_percent":50}'::jsonb,
  t.id, 'inapp', false, 7
FROM communication_templates t WHERE t.is_active = true ORDER BY t.id ASC LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO communication_auto_triggers
  (name, description, trigger_type, conditions, template_id, channel, is_active, cooldown_days)
SELECT '신규 회원 환영', '가입 후 1일 뒤 환영 메시지 발송',
  'welcome', '{"days_after_signup":1}'::jsonb,
  t.id, 'email', false, 365
FROM communication_templates t WHERE t.is_active = true ORDER BY t.id ASC LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO communication_auto_triggers
  (name, description, trigger_type, conditions, template_id, channel, is_active, cooldown_days)
SELECT '정기 후원 6개월 기념', '정기 후원이 6개월 단위 누적된 회원에게 감사 메시지',
  'anniversary', '{"every_months":6}'::jsonb,
  t.id, 'email', false, 30
FROM communication_templates t WHERE t.is_active = true ORDER BY t.id ASC LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO communication_auto_triggers
  (name, description, trigger_type, conditions, template_id, channel, is_active, cooldown_days)
SELECT '회원 생일 축하', '회원 생일 당일 축하 메시지',
  'birthday', '{}'::jsonb,
  t.id, 'email', false, 365
FROM communication_templates t WHERE t.is_active = true ORDER BY t.id ASC LIMIT 1
ON CONFLICT DO NOTHING;
```

> **주의**: 시드 매칭 — `communication_templates`에 활성 템플릿 1개 이상 있어야 시드 5건 INSERT. 없으면 시드 0건 (마이그 응답에 명시). 시드 모두 `is_active=false`로 INSERT — 운영자가 트리거 관리 화면에서 검토 후 활성화.

### 1.4 schema.ts import 점검

- [x] `bigserial`, `varchar`, `text`, `integer`, `boolean`, `jsonb`, `timestamp`, `index`, `pgTable`, `sql` 모두 기존 import에 포함됨
- [ ] `communicationTemplates`(R1), `recipientGroups`(R2), `communicationSendJobs`(R3), `communicationSendRecipients`(R3), `members` 참조 — 모두 schema.ts에 정의됨
- [ ] DB 적용 전 schema 정의는 **주석 처리** (마이그 후 활성화)

---

## 2. API 명세 (B용) — 총 17개 + cron 2개

### 2.1 함수 목록

| # | 함수 파일 | 경로 | 메서드 | 권한 | 영역 |
|---|---|---|---|---|---|
| **추적** |
| 1 | `track-open.ts` | `/api/track-open` | GET | public (token 검증) | A |
| 2 | `track-click.ts` | `/api/track-click` | GET | public (token 검증) | A |
| **AI 트리거 관리** |
| 3 | `admin-auto-triggers-list.ts` | `/api/admin-auto-triggers-list` | GET | requireAdmin | B |
| 4 | `admin-auto-trigger-detail.ts` | `/api/admin-auto-trigger-detail` | GET | requireAdmin | B |
| 5 | `admin-auto-trigger-create.ts` | `/api/admin-auto-trigger-create` | POST | requireAdmin | B |
| 6 | `admin-auto-trigger-update.ts` | `/api/admin-auto-trigger-update` | POST | requireAdmin | B |
| 7 | `admin-auto-trigger-delete.ts` | `/api/admin-auto-trigger-delete` | POST | requireAdmin | B |
| 8 | `admin-auto-trigger-toggle.ts` | `/api/admin-auto-trigger-toggle` | POST | requireAdmin | B |
| 9 | `admin-auto-trigger-runs.ts` | `/api/admin-auto-trigger-runs` | GET | requireAdmin | B |
| **분석 대시보드** |
| 10 | `admin-send-analytics-overview.ts` | `/api/admin-send-analytics-overview` | GET | requireAdmin | D |
| 11 | `admin-send-analytics-job.ts` | `/api/admin-send-analytics-job` | GET | requireAdmin | D |
| 12 | `admin-send-analytics-channel.ts` | `/api/admin-send-analytics-channel` | GET | requireAdmin | D |
| **재발송** |
| 13 | `admin-send-job-retry.ts` | `/api/admin-send-job-retry` | POST | requireAdmin | E |
| 14 | `admin-send-job-retry-failed.ts` | `/api/admin-send-job-retry-failed` | POST | requireAdmin | E |
| **이력 검색** |
| 15 | `admin-member-send-history.ts` | `/api/admin-member-send-history` | GET | requireAdmin | F |
| 16 | `user-my-send-history.ts` | `/api/user-my-send-history` | GET | requireActiveUser | F |
| **헬퍼·인프라** |
| 17 | `lib/communication-tracking.ts` | (헬퍼) | — | — | A |
| 18 | `lib/communication-auto-trigger.ts` | (헬퍼) | — | — | B |
| **cron** |
| C1 | `cron-auto-trigger-evaluator.ts` | (Scheduled) | `*/30 * * * *` | — | B |
| C2 | `cron-tracking-stats-rollup.ts` | (Scheduled) | `0 */6 * * *` | — | D |
| **마이그** |
| M | `migrate-phase10-r4-tracking-ai.ts` | `/api/migrate-phase10-r4-tracking-ai` | GET ?run=1 | requireAdmin | — |

### 2.2 함수별 상세 — 핵심 함수만

#### `track-open` (GET, public)

**쿼리 파라미터**: `token` (recipients.tracking_token)

**처리**:
1. token으로 recipients SELECT
2. 발견 시: open_count +1, opened_at NULL이면 NOW() 설정, tracking_events INSERT (event_type='open')
3. 1×1 투명 PNG 응답 (Content-Type: image/png)
4. 발견 안 됨 또는 에러 시에도 1×1 PNG 응답 (조용히 실패 — 클라이언트 영향 0)

**응답**: 1×1 transparent PNG binary (43 bytes 정도)

#### `track-click` (GET, public)

**쿼리 파라미터**: `token` + `to` (원본 URL — base64 또는 URL 인코딩)

**처리**:
1. token으로 recipients SELECT
2. 발견 시: click_count +1, first_clicked_at NULL이면 NOW(), tracking_events INSERT (event_type='click', link_url=to)
3. 302 redirect → `to` 파라미터의 원본 URL
4. 발견 안 됨: 그래도 redirect (사용자 영향 0)

**보안**: `to` URL이 외부 도메인이면 redirect 거부 (오픈 redirect 방지). 내부 도메인 또는 명시적 화이트리스트만.

#### `admin-auto-trigger-create` (POST, requireAdmin)

**요청**:
```json
{
  "name": "장기 미발생 후원자 재참여",
  "description": "...",
  "triggerType": "churn_risk",
  "conditions": { "min_score": 75, "min_days_inactive": 120 },
  "templateId": 5,
  "recipientGroupId": null,
  "channel": "email",
  "cooldownDays": 60
}
```

**검증**:
- `triggerType`: 6종 enum 외 거부
- `conditions`: 종류별 필수 키 검증 (예: `welcome`은 `days_after_signup` 필수)
- `templateId`: 활성 템플릿이고 `channel` 일치해야 함
- `cooldownDays`: 1 이상 365 이하

**응답**: `{ ok: true, id: NN }`

#### `admin-auto-trigger-toggle` (POST ?id=X)

**요청**: `{ "isActive": true }` 또는 `{ "isActive": false }`

**처리**: trigger.is_active 단순 UPDATE

#### `admin-send-analytics-overview` (GET)

**쿼리**: `from`, `to` (ISO 날짜 — 기본 최근 30일)

**응답**:
```json
{
  "ok": true,
  "overview": {
    "total_jobs": 42,
    "total_recipients": 12500,
    "delivered": 12350,
    "deliveryRate": 98.8,
    "openRate": 35.2,
    "clickRate": 8.4,
    "byChannel": {
      "email": { "sent": 10000, "openRate": 38.0, "clickRate": 9.0 },
      "sms":   { "sent": 1500,  "openRate": null, "clickRate": null },
      "kakao": { "sent": 800,   "openRate": null, "clickRate": null },
      "inapp": { "sent": 200,   "openRate": 60.0, "clickRate": 25.0 }
    },
    "trend": [
      { "date": "2026-04-12", "sent": 350, "opened": 130, "clicked": 30 },
      ...
    ]
  }
}
```

#### `admin-send-job-retry-failed` (POST ?id=X)

**처리**:
1. job의 status='failed' 수신자 SELECT
2. 새 send_job 생성 (이름에 `(재발송 #N)` 자동 붙임)
3. 새 recipients에 실패 회원만 복사 (rendered_subject·body 동일)
4. 원본 job의 retried_to_job_id 같은 필드 추가? — 단순화 위해 새 job의 description에 "원본 job ID #X 실패분 재발송" 메모만

#### `cron-auto-trigger-evaluator` (Scheduled `*/30 * * * *`)

**처리 흐름** (30분 단위):

```
1. is_active=true인 trigger 모두 SELECT
2. 각 trigger마다:
   a. trigger_type별 평가:
      - churn_risk: members.churnScore >= conditions.min_score AND last_active_at <= NOW() - INTERVAL conditions.min_days_inactive
      - welcome: 가입 후 정확히 days_after_signup일 경과한 회원
      - anniversary: 정기 후원이 every_months 단위 누적된 회원
      - birthday: 생일이 오늘
      - campaign_slump: 캠페인 진행률 < threshold_percent
      - custom_filter: lib/recipient-resolve(criteria) 호출
   b. 후보 회원 ID 추출
   c. 쿨다운 체크 — auto_trigger_runs에서 (member_id, trigger_id, status='sent') 최근 cooldown_days 내 있으면 제외
   d. 남은 회원에 대해:
      - send_job 생성 (triggered_by_auto_id=trigger.id)
      - send_recipients INSERT (rendered 본문 포함)
      - auto_trigger_runs INSERT (status='sent')
   e. trigger.lastRunAt + total_runs +1 + total_sent += N 갱신
3. 다음 trigger
```

**비용 통제**:
- trigger 평가 1회당 최대 1000명 (그 이상은 다음 cron tick으로)
- 동시 trigger 처리는 직렬 (병렬은 R5+ 별도 라운드)

#### `cron-tracking-stats-rollup` (Scheduled `0 */6 * * *`)

**처리** (6시간 단위):
- tracking_events에서 최근 6시간 신규 이벤트 → recipients의 open_count·click_count·opened_at·first_clicked_at 갱신
- 이미 fast path(track-open·track-click 함수)에서 즉시 갱신하므로 이건 백업·정합성 보정용
- 단순 UPDATE 쿼리 1개

### 2.3 헬퍼 함수

#### `lib/communication-tracking.ts`

```typescript
export function generateTrackingToken(): string;
export function buildOpenPixelUrl(token: string): string;
export function buildClickRedirectUrl(token: string, originalUrl: string): string;
/**
 * 본문에서 모든 <a href="..."> 추출 후 redirect URL로 치환
 * 또한 본문 끝에 <img src="open-pixel-url" /> 자동 추가
 */
export function injectTrackingIntoHtml(htmlBody: string, token: string): string;
/** 평문 이메일은 추적 X — 그대로 반환 */
export function injectTrackingIntoText(textBody: string, _token: string): string;
```

#### `lib/communication-auto-trigger.ts`

```typescript
export async function evaluateTrigger(trigger: AutoTrigger): Promise<{
  candidateMemberIds: number[];
  skippedByCooldown: number;
}>;
export async function executeTrigger(trigger: AutoTrigger, memberIds: number[]): Promise<{
  sendJobId: number;
  recipientsCreated: number;
}>;
```

### 2.4 회귀 점검 — 기존 발송 흐름 변경

- **R3 cron(`cron-communication-send-dispatcher`)**: recipient INSERT 시점에 tracking_token 자동 생성 (R3 cron 코드 1줄 수정 — `tracking_token: generateTrackingToken()`)
- **R3 발송 어댑터 호출 시점**: 이메일이면 `injectTrackingIntoHtml(renderedBody, token)`으로 변환 후 발송
- **다른 채널(SMS·카카오·인앱)**: 추적 X — 그대로 발송

---

## 3. 화면 명세 (A용) — 5개 페이지

### 3.1 페이지 목록

| # | 페이지 | 경로 | 진입점 | 권한 | 영역 |
|---|---|---|---|---|---|
| 1 | `admin-auto-triggers.html` | `/admin-auto-triggers.html` | 사이드바 → 운영 → AI 자동 발송 | 어드민 | C |
| 2 | `admin-auto-trigger-edit.html` | `/admin-auto-trigger-edit.html?id=X` | 트리거 목록 → 신규/수정 | 어드민 | C |
| 3 | `admin-send-analytics.html` | `/admin-send-analytics.html` | 사이드바 → 운영 → 발송 분석 | 어드민 | D |
| 4 | `admin-member-send-history.html` | `/admin-member-send-history.html?memberId=X` | 회원 상세 화면 → "이 회원에게 보낸 메시지" 버튼 | 어드민 | F |
| 5 | `my-send-history.html` | `/my-send-history.html` | 마이페이지 → 받은 메시지 | 사용자 | F |

(추가) `admin-send-job-detail.html`(R3) 화면 보강 — "실패만 재발송" 버튼·"개별 재발송" 버튼 추가 (영역 E).

### 3.2 와이어프레임 — 핵심 페이지

#### `admin-auto-triggers.html` (트리거 목록)

```
┌─ AI 자동 발송 트리거 ─────────────────────────────────────────────┐
│                                                                    │
│  종류: [전체 ▼]  활성: [모두 ▼]                  [+ 신규 트리거]   │
│                                                                    │
│  ┌──┬─────────────┬──────┬─────────┬──────┬──────┬──────┐         │
│  │ID│ 이름         │ 종류  │ 채널    │ 활성 │ 누적 │ 동작 │         │
│  │  │              │       │         │      │ 발송 │      │         │
│  ├──┼─────────────┼──────┼─────────┼──────┼──────┼──────┤         │
│  │ 1│이탈 재참여   │이탈  │이메일   │ ON   │ 320  │편집·│         │
│  │  │              │위험  │         │      │      │이력  │         │
│  │ 2│생일 축하     │생일  │이메일   │ OFF  │  0   │편집·│         │
│  └──┴─────────────┴──────┴─────────┴──────┴──────┴──────┘         │
│                                                                    │
│  [< 이전] 1 / 1 [다음 >]                                           │
│                                                                    │
│  💡 AI 트리거는 30분마다 자동 평가됩니다.                          │
│      활성화된 트리거의 조건을 만족하는 회원에게 자동 발송됩니다.   │
└────────────────────────────────────────────────────────────────────┘
```

- 종류 셀렉트: 전체 / 이탈 위험 / 캠페인 부진 / 신규 환영 / 후원 기념 / 생일 / 운영자 정의
- 활성: 전체 / 활성만 / 비활성만
- 행 동작: [편집] (트리거 편집 페이지) · [이력] (실행 이력 모달)
- 활성 토글은 행에서 직접 클릭 (체크박스)

#### `admin-auto-trigger-edit.html` (트리거 편집)

```
┌─ AI 자동 발송 트리거 [신규 / 수정 #1] ──────────────────────────┐
│                                                                  │
│  이름:       [이탈 위험 회원 재참여                    ] (*)     │
│  설명:       [....]                                               │
│                                                                  │
│  종류:       [이탈 위험 ▼]                                       │
│              ◯ 이탈 위험   ◯ 캠페인 부진   ◯ 신규 환영           │
│              ◯ 후원 기념일  ◯ 생일       ◯ 운영자 정의 필터     │
│                                                                  │
│  ┌─ 조건 (종류별 동적) ─────────────────────────────┐            │
│  │ 이탈 위험인 경우:                                  │            │
│  │   최소 점수:    [70  ] ~ [100 ]                    │            │
│  │   최소 비활성: [90 일]                              │            │
│  │                                                    │            │
│  │ 신규 환영인 경우:                                  │            │
│  │   가입 후:    [1  ] 일 뒤                          │            │
│  │                                                    │            │
│  │ 후원 기념인 경우:                                  │            │
│  │   매:         [6  ] 개월                            │            │
│  │                                                    │            │
│  │ 운영자 정의 필터인 경우:                           │            │
│  │   [수신자 그룹 선택 화면 재사용 — R2 빌더]         │            │
│  └────────────────────────────────────────────────────┘            │
│                                                                  │
│  발송 매핑:                                                       │
│  ─────────────────────                                           │
│  채널:       ○ 이메일  ○ SMS  ○ 카카오  ○ 인앱                  │
│  템플릿:     [선택 ▼] (활성 템플릿 + 채널 일치 필터)             │
│  특정 그룹:  [선택 ▼] (선택 안 하면 트리거 종류 기본 그룹 자동) │
│                                                                  │
│  실행 정책:                                                       │
│  ─────────────────────                                           │
│  쿨다운:     [60   ] 일 (같은 회원에 N일 내 재발송 금지)         │
│  활성 상태:  ☑ 활성                                               │
│                                                                  │
│  [+ 미리보기] (현재 조건으로 후보 회원 N명 + 샘플 5명 표시)     │
│                                                                  │
│  [취소]  [저장]                                                   │
└──────────────────────────────────────────────────────────────────┘
```

종류별 조건 입력 영역이 동적으로 변경됨. `custom_filter` 선택 시 R2 필터 빌더 임베드 (또는 새 창으로 그룹 선택).

#### `admin-send-analytics.html` (발송 분석 대시보드)

```
┌─ 발송 분석 대시보드 ─────────────────────────────────────────────┐
│                                                                    │
│  기간: [최근 30일 ▼]  (또는 [2026-04-12] ~ [2026-05-11])           │
│                                                                    │
│  ┌─ 핵심 지표 ───────────────────────────────────┐                 │
│  │ 발송 작업: 42건   /   대상자 12,500명          │                 │
│  │ 전송: 12,350명 (98.8%)                          │                 │
│  │ 열람률: 35.2%                                   │                 │
│  │ 클릭률:  8.4%                                   │                 │
│  └────────────────────────────────────────────────┘                 │
│                                                                    │
│  ┌─ 채널별 ────────────────────────────────────────────┐           │
│  │       │ 발송   │ 전송   │ 열람률 │ 클릭률 │ 실패  │           │
│  │ 이메일│ 10,000 │  9,950 │ 38.0%  │  9.0%  │ 50    │           │
│  │ SMS   │  1,500 │  1,485 │ —      │ —      │ 15    │           │
│  │ 카카오│    800 │      0 │ —      │ —      │ 800   │           │
│  │ 인앱  │    200 │    200 │ 60.0%  │ 25.0%  │ 0     │           │
│  └──────────────────────────────────────────────────────┘           │
│                                                                    │
│  ┌─ 일별 추이 (Chart.js 라인 차트) ──────────────────┐              │
│  │  발송·열람·클릭 일별 그래프                        │              │
│  │  [Chart.js 컨테이너]                                │              │
│  └──────────────────────────────────────────────────────┘             │
│                                                                    │
│  ┌─ Top 작업 (열람률 기준) ─────────────────────────┐              │
│  │ 1. 5월 뉴스레터       — 열람률 45.2%             │              │
│  │ 2. 정기 후원 감사     — 열람률 42.1%             │              │
│  │ 3. ...                                             │              │
│  └────────────────────────────────────────────────────┘              │
│                                                                    │
│  ┌─ AI 트리거 효과 ────────────────────────────────┐               │
│  │ 이탈 재참여:  발송 320 / 열람 110 (34.4%)        │               │
│  │ 신규 환영:    발송  85 / 열람  60 (70.6%)        │               │
│  │ ...                                               │               │
│  └────────────────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────────┘
```

차트는 Chart.js (CDN) 사용. 운영 사이트에 이미 도입됨.

#### `admin-member-send-history.html` (회원별 발송 이력)

```
┌─ 회원 발송 이력 #5 (홍길동) ─────────────────────────────────────┐
│                                                                    │
│  채널: [전체 ▼]   기간: [    ~    ]                                │
│                                                                    │
│  ┌──┬──────────┬──────┬──────────────┬──────┬──────┬──────┐       │
│  │ID│ 발송 작업 │ 채널  │ 발송 시각     │ 상태 │ 열람 │ 클릭 │       │
│  ├──┼──────────┼──────┼──────────────┼──────┼──────┼──────┤       │
│  │1 │5월 뉴스레│이메일│ 5/11 09:00    │ 성공 │ ✓    │ ✓    │       │
│  │2 │생일 축하 │이메일│ 5/01 09:00    │ 성공 │ ✓    │ ─    │       │
│  │3 │공지 안내 │SMS    │ 4/20 14:00    │ 실패 │ ─    │ ─    │       │
│  └──┴──────────┴──────┴──────────────┴──────┴──────┴──────┘       │
│                                                                    │
│  💡 행 클릭 → 그 회원에게 발송된 본문 미리보기 모달                │
│  [< 이전] 1 / 3 [다음 >]                                            │
└────────────────────────────────────────────────────────────────────┘
```

#### `my-send-history.html` (사용자 마이페이지)

비슷한 구조. 본인 회원 ID로 자동 필터. 본문 미리보기는 평문(보안). 첨부 없음. 회원 자신의 메시지 수신 이력 확인용.

### 3.3 사용자 동작 → API 매핑 (요약 — 풀 표는 §6 작업 순서)

각 페이지가 호출하는 API와 응답 처리는 §2.2 명세 그대로.

### 3.4 토스트·문구 모음

| 상황 | 문구 |
|---|---|
| 트리거 등록 성공 (비활성으로) | "트리거가 등록되었습니다. 검토 후 활성화해 주세요." |
| 트리거 활성 | "트리거가 활성화되었습니다. 30분 안에 첫 평가가 시작됩니다." |
| 트리거 비활성 | "트리거가 비활성화되었습니다. 진행 중인 발송은 영향 없음." |
| 미리보기 — 후보 0명 | "현재 조건에 맞는 회원이 0명입니다." |
| 검증 실패 — 종류별 조건 누락 | "{종류}는 {필드} 입력이 필요합니다." |
| 재발송 (실패만) | "{N}명에게 재발송이 등록되었습니다." |
| 재발송 (개별) | "1명에게 재발송이 등록되었습니다." |
| 분석 데이터 없음 | "선택한 기간에 발송 이력이 없습니다." |

### 3.5 캐시버스터 + 사이드바 메뉴

신규 v1. 사이드바 운영 그룹의 [📤 발송 작업] 다음에:
- `[🤖 AI 자동 발송]` (admin-auto-triggers.html)
- `[📊 발송 분석]` (admin-send-analytics.html)

회원 상세 화면(기존)에 [메시지 이력] 버튼 추가 → admin-member-send-history.html 모달 또는 페이지 이동.
사용자 마이페이지(기존)에 [받은 메시지] 메뉴 1개 추가.

---

## 4. 검증 시나리오 (C용) — Q1~Q18

### 4.1 라이브 시나리오

| # | 시나리오 | 기대 |
|---|---|---|
| Q1 | 사이드바 → AI 자동 발송 | 시드 5건 비활성으로 표시 |
| Q2 | 트리거 신규 → 이탈 위험 → 조건 입력 → 미리보기 | 후보 N명·샘플 5명 표시 |
| Q3 | 트리거 활성 토글 | "활성화됨" 토스트, 30분 안 첫 평가 안내 |
| Q4 | cron 30분 후 강제 트리거 (Netlify 콘솔) | 활성 트리거 평가 → 발송 작업 자동 생성, lastRunAt 갱신 |
| Q5 | 같은 회원에 쿨다운 내 재평가 | auto_trigger_runs에 status='cooldown_skip' 기록, 발송 X |
| Q6 | 발송 분석 대시보드 진입 | 핵심 지표·채널별·일별 추이 표시 |
| Q7 | 이메일 추적 — 테스트 발송 후 미리보기 클릭 | 1×1 픽셀 호출됨 → opened_at 갱신, open_count +1 |
| Q8 | 이메일 본문 링크 클릭 | track-click 거쳐 원본 URL로 redirect, click_count +1 |
| Q9 | 발송 상세 → 실패만 재발송 | 새 발송 작업 생성 (이름 자동), 실패 회원만 포함 |
| Q10 | 발송 상세 → 개별 재발송 | 새 발송 작업, 1명만 |
| Q11 | 회원 상세 → 메시지 이력 | 그 회원에게 발송된 모든 작업 표시 |
| Q12 | 사용자 마이페이지 → 받은 메시지 | 본인 발송만 (다른 회원 못 봄) |
| Q13 | 행 클릭 → 본문 미리보기 모달 | rendered_subject·body 표시 |
| Q14 | 트리거 종류 6종 모두 등록 시도 | 각 종류별 조건 입력 → 저장 정상 |
| Q15 | 운영자 정의 필터 종류 → R2 빌더 임베드 | 그룹 조건 선택 → 저장 |
| Q16 | 트리거 삭제 (활성 상태) | confirm → soft delete (is_active=false) 또는 hard delete (논의) |
| Q17 | 추적 토큰 외부 도메인 redirect 시도 | 거부 (오픈 redirect 방지) |
| Q18 | 분석 대시보드 — 0건 기간 | "발송 이력 없음" 메시지 |

### 4.2 회귀 점검

- **R3 발송 흐름** — recipient INSERT에 tracking_token 추가만, 발송 자체 영향 0
- **이메일 발송** — 본문에 open pixel·redirect 자동 삽입 시 기존 이메일 깨짐 0 (HTML 표준 준수)
- **다른 채널** — SMS·카카오·인앱은 추적 안 들어감, 발송 흐름 그대로
- **R1·R2 화면** — 영역 분리, 영향 0
- **사이드바 메뉴** — 운영 그룹에 2줄 추가, 기존 메뉴 깨짐 0
- **회원·후원·재정 등 다른 어드민 화면 3~4개** — schema 회귀 점검

### 4.3 cron 동작 검증

- `cron-auto-trigger-evaluator` (30분 단위) — 활성 트리거 6종 모두 평가, 시간 1분 미만
- `cron-tracking-stats-rollup` (6시간 단위) — recipients 카운터 정합성 보정

### 4.4 성능 점검

- track-open / track-click 응답 시간 — 100ms 미만 (사용자 영향 직접)
- 분석 대시보드 진입 — 2초 미만 (집계 쿼리)
- 회원 메시지 이력 — 1초 미만

### 4.5 보안 점검

- track-click의 `to` 파라미터 — 외부 도메인 redirect 방지 (오픈 redirect 취약점)
- tracking_token — 추측 불가 (nanoid 32자 이상)
- 사용자 메시지 이력 — 본인 회원 ID 격리 (다른 회원 못 봄)

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] **평행 + 단계 머지** (큰 라운드)

A·B 동시 시작. B는 큰 작업이라 **2단계 머지** 권장:
- **B 1차 머지**: 추적·재발송 (영역 A·E·F 백) → 마이그 호출 → schema 활성화
- **B 2차 머지**: AI 트리거·분석 (영역 B·D 백) — 1차 머지 후 곧 진행

A는 한 번에 머지 (5개 페이지).

### 5.2 머지 순서

```
1. B 1차 push (추적+재발송 영역) → 메인 머지 → push
2. Netlify 배포 1~3분
3. 메인이 Swain께 마이그 호출 안내:
   /api/migrate-phase10-r4-tracking-ai?run=1
4. Swain 응답 success → 메인:
   - schema 정의 활성화 (3테이블 + 5컬럼 추가)
   - migrate 파일 삭제
   → push
5. B 2차 push (AI 트리거+분석) → 메인 머지 → push
6. cron schedule 등록 확인 (30분 / 6시간 — Netlify 콘솔)
7. A push → 메인 머지
8. C verify 트리거 → 18개 시나리오 + 회귀 + cron + 성능 + 보안
```

### 5.3 신규 환경변수

`SITE_URL` 활용. open pixel·click redirect URL 생성에 필요. 이미 등록됨 — 추가 없음.

선택적: `TRACKING_DOMAIN_WHITELIST` (콤마 구분 외부 도메인 목록 — track-click redirect 허용 외부 도메인). 운영 시점에 등록.

### 5.4 단계 머지 vs 한 번 머지 결정 기준

- B 1차 머지(추적·재발송)는 마이그 동반 → 무조건 R3 schema 위에 컬럼 추가 후 작업
- B 2차 머지(AI 트리거·분석)는 1차 후 같은 schema 그대로 사용 — 마이그 추가 없음
- 단계 머지가 안전 (1차 검증 후 2차 진행)

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용)

### 6.1 메인 — 본 설계서 (생략)

### 6.2 B 채팅 — 백 구현 (1차 + 2차 통합)

```
[B — Phase 10 R4 백 구현 (추적·AI 트리거·분석·재발송·이력 — 통합 마무리)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치 1: feature/phase10-r4-back-1 (추적·재발송·이력 백)
브랜치 2: feature/phase10-r4-back-2 (AI 트리거·분석 백 — 1차 머지 후)
정독 (필수):
  - docs/milestones/2026-05-11-phase10-r4-tracking-ai-analytics.md §1·§2
  - PARALLEL_GUIDE §1.5(자동)·§1.6(진행률)·§1.7(설계 모호 시 즉시 질문)·§3·§7

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example, netlify.toml(필요시)
금지: public/, assets/

세팅:
  cd ../tbfa-mis-B
  git fetch origin
  git checkout -b feature/phase10-r4-back-1 origin/main

작업 순서 (1차 — 추적·재발송·이력):
  1) lib/communication-tracking.ts (§2.3)
     - generateTrackingToken (nanoid 32자)
     - buildOpenPixelUrl·buildClickRedirectUrl
     - injectTrackingIntoHtml (HTML <a href> 치환 + open pixel 삽입)
  2) netlify/functions/migrate-phase10-r4-tracking-ai.ts
     - 3테이블 + 5컬럼 추가 + 시드 5건
     - requireAdmin + GET ?run=1 + 멱등
  3) db/schema.ts §1.1·§1.2 정의 추가 (주석 상태 — 마이그 후 메인이 활성화)
     ※ Phase 10 R4 본인 섹션 헤더 명시 (append-only)
  4) netlify/functions/track-open.ts (§2.2 PUBLIC GET)
  5) netlify/functions/track-click.ts (§2.2 PUBLIC GET + redirect 보안)
  6) netlify/functions/admin-send-job-retry.ts (개별 재발송)
  7) netlify/functions/admin-send-job-retry-failed.ts (실패만 재발송)
  8) netlify/functions/admin-member-send-history.ts (어드민 이력)
  9) netlify/functions/user-my-send-history.ts (사용자 본인 이력)
  10) R3 cron 1줄 수정: recipient INSERT 시 tracking_token 자동 생성
  11) R3 어댑터 호출 직전 injectTrackingIntoHtml 호출 추가 (이메일만)
  12) `npx tsc --noEmit` 통과 후 push (1차)

→ 메인 머지·마이그 호출·schema 활성화 완료 보고 받으면 2차 시작

작업 순서 (2차 — AI 트리거·분석):
  cd ../tbfa-mis-B
  git checkout main
  git pull origin main
  git checkout -b feature/phase10-r4-back-2 origin/main
  
  13) lib/communication-auto-trigger.ts (§2.3)
      - evaluateTrigger (종류별 후보 추출 + 쿨다운 체크)
      - executeTrigger (send_job 생성 + recipients INSERT)
  14) netlify/functions/admin-auto-triggers-list.ts
  15) netlify/functions/admin-auto-trigger-detail.ts
  16) netlify/functions/admin-auto-trigger-create.ts (검증 §2.2)
  17) netlify/functions/admin-auto-trigger-update.ts
  18) netlify/functions/admin-auto-trigger-delete.ts (soft delete)
  19) netlify/functions/admin-auto-trigger-toggle.ts (활성 토글)
  20) netlify/functions/admin-auto-trigger-runs.ts (실행 이력)
  21) netlify/functions/admin-send-analytics-overview.ts
  22) netlify/functions/admin-send-analytics-job.ts
  23) netlify/functions/admin-send-analytics-channel.ts
  24) netlify/functions/cron-auto-trigger-evaluator.ts (schedule */30 * * * *)
  25) netlify/functions/cron-tracking-stats-rollup.ts (schedule 0 */6 * * *)
  26) `npx tsc --noEmit` 통과 후 push (2차)

머지 전 체크 (CLAUDE.md §6 + §13):
  - export const config 모든 함수
  - requireAdmin 반환 auth.res
  - 응답 키 다중 fallback
  - try/catch step·detail·stack
  - track-click의 외부 도메인 redirect 방지
  - tracking_token UNIQUE 보장 (충돌 시 재생성)
  - cron 안에서 lib/communication-send (R3) 사용

진행률 보고 (PARALLEL_GUIDE §1.6):
  - 1차 절반 (lib + 마이그 + schema + 추적 함수 2개) 완료 시
  - 1차 끝 (재발송·이력 + R3 cron 수정 + tsc) 완료 시
  - 2차 절반 (헬퍼 + 트리거 API 6개) 완료 시
  - 2차 끝 (분석 API 3개 + cron 2개 + tsc) 완료 시
  - 형식: "현재 X% 완료 — {다음 단계}"

push 후 메인 보고 — 1차·2차 각각 별도.
```

### 6.3 A 채팅 — 프론트 구현

```
[A — Phase 10 R4 프론트 구현 (트리거 관리 + 분석 + 재발송 + 이력)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase10-r4-front (베이스 origin/main 최신)
정독 (필수):
  - docs/milestones/2026-05-11-phase10-r4-tracking-ai-analytics.md §3
  - 응답 구조: 같은 설계서 §2.2
  - PARALLEL_GUIDE §1.5·§1.6·§1.7·§3

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, .env.example, netlify.toml

모드: 평행 — B 1차 머지 후 시작 권장 (B의 schema 활성화가 분석 화면 데이터에 영향).
다만 B 1차 push 시점에 시작 가능 (UI 작성 자체는 응답 명세대로).

세팅:
  cd ../tbfa-mis-A
  git fetch origin
  git checkout -b feature/phase10-r4-front origin/main

작업 순서:
  1) public/admin-auto-triggers.html — §3.2 목록
  2) public/js/admin-auto-triggers.js — list·toggle·delete API + 30분 안내 메시지
  3) public/admin-auto-trigger-edit.html — §3.2 편집 (종류별 동적 조건)
  4) public/js/admin-auto-trigger-edit.js
     - 종류 라디오 → 조건 영역 동적 변경 (이탈 위험·신규 환영·기념일·생일·운영자 정의)
     - 운영자 정의 → R2 필터 빌더 임베드 (또는 그룹 선택 드롭다운)
     - 채널별 템플릿 필터 (preflight 활용)
     - 미리보기 — preflight API
     - 저장 → create / update API
  5) public/admin-send-analytics.html — §3.2 대시보드
  6) public/js/admin-send-analytics.js
     - 기간 셀렉트 (최근 30일·90일·1년·custom)
     - overview API → 핵심 지표·채널별·일별 추이
     - Chart.js 라인 차트 (CDN — script src로 로드, 이미 다른 화면 사용 중)
     - Top 작업·AI 트리거 효과 섹션
  7) public/admin-member-send-history.html — §3.2 회원 이력
  8) public/js/admin-member-send-history.js — admin-member-send-history API + 본문 모달
  9) public/my-send-history.html — §3.2 사용자 본인 이력
  10) public/js/my-send-history.js — user-my-send-history API + 본문 모달 (평문)
  11) public/admin-send-job-detail.html (R3 화면 보강) — "실패만 재발송"·"개별 재발송" 버튼 추가
  12) public/js/admin-send-job-detail.js (R3 보강) — retry / retry-failed API 호출
  13) public/admin.html 사이드바:
      - 운영 그룹의 [📤 발송 작업] 다음에 [🤖 AI 자동 발송] + [📊 발송 분석] 2줄 추가
  14) 회원 상세 화면(기존)에 [메시지 이력] 버튼 — admin-member-send-history.html 이동
  15) 사용자 마이페이지(기존)에 [받은 메시지] 메뉴 1개 — my-send-history.html 이동
  16) §3.5 캐시버스터 ?v=1 (모든 신규 + R3 detail.js v2)
  17) 화면 진입·동작·모달 흐름 자체 점검 후 push

머지 전 체크:
  - §3.2 모든 페이지 와이어프레임 일치
  - 종류별 동적 조건 정확
  - Chart.js 정상 표시 (테스트 데이터 0건 대응)
  - public/ 외 변경 0
  - 응답 키 다중 fallback
  - HTTP 에러 detail 토스트

진행률 보고 (PARALLEL_GUIDE §1.6):
  - 트리거 관리(목록+편집) 완료 시 1회
  - 분석 대시보드 + Chart.js 완료 시 1회
  - 회원/사용자 이력 + R3 detail 보강 + 사이드바·진입점 추가 + 캐시버스터 완료 시 1회
  - 형식: "현재 X% 완료 — {다음 단계}"

push 후 메인 보고: 브랜치명·커밋 해시·변경 파일 요약.
※ 라이브 검증·cron 동작은 B 1차+2차 머지 + schema 활성화 + A 머지 후 C가 진행.
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase 10 R4 검증·fix (통합 마무리)]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase10-r4 (베이스 main @ {A 머지 후 커밋})
정독: docs/milestones/2026-05-11-phase10-r4-tracking-ai-analytics.md §4

세팅:
  cd ../tbfa-mis-C
  git fetch origin
  git checkout -b verify/phase10-r4 origin/main

작업 순서:
  1) §4.1 Q1~Q18 라이브 시나리오 (사용자 동작·결과)
  2) §4.2 회귀 점검 — R3 발송·이메일 본문 깨짐 0·R1·R2 영향 0·다른 어드민 3~4개
  3) §4.3 cron 동작 — 30분 트리거 평가·6시간 stats rollup (Netlify 콘솔)
     - 강제 트리거: 어드민 화면에서 "지금 평가" 버튼 또는 Netlify 콘솔 수동 호출
     - 평가 결과 → send_job 생성 → 발송 → tracking_token 작동 확인
  4) §4.4 성능 — track-open·track-click 100ms 미만 / 분석 2초 미만
  5) §4.5 보안 — 외부 도메인 redirect 방지 + tracking_token 추측 불가 + 사용자 본인 격리
  6) bug 발견 시 fix 커밋 → 메인 보고 (cron·보안 bug는 시간 민감)
  7) 보고서 docs/verify/2026-05-11-phase10-r4.md
  8) push → 메인 보고

표현 규칙 (CLAUDE.md §6.14): 함수명·코드 용어 X, 사용자 동작·결과 위주.

진행률 보고 (PARALLEL_GUIDE §1.6):
  - Q1~Q9 완료 시 1회
  - Q10~Q18 + 회귀·cron·성능·보안 완료 시 1회

push 후 메인 보고: Q별 PASS/FAIL·회귀·cron·성능·보안 결과.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B 1차 push 보고 받음 + main 머지
- [ ] Swain 마이그 호출 (`/api/migrate-phase10-r4-tracking-ai?run=1`) 응답 success
- [ ] schema 활성화 + 마이그 파일 삭제 → push
- [ ] B 2차 push 보고 받음 + main 머지
- [ ] cron schedule 등록 확인 (Netlify 콘솔 — `*/30 * * * *`·`0 */6 * * *`)
- [ ] A push 보고 받음 + main 머지
- [ ] 라이브 진입 1차 점검 (사이드바 메뉴 2개·track-open·track-click 응답)
- [ ] C verify 트리거 + 보고 흡수 (Q1~Q18·회귀·cron·성능·보안)
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 Phase 10 R4 ✅ 100% 마감 + Phase 10 전체 ✅ 마감
- [ ] HANDOFF.md 정리 — Phase 10 통합 발송 시스템 완료
- [ ] **Phase 10 마감** — 다음 우선순위 합의 (Phase 11 멘션·구독 또는 Phase 12 신고)

---

## 8. 라운드 후 예고

본 라운드 완료 시 **Phase 10 통합 발송 시스템 100% 마감**. 카탈로그 단계 1~5 모두 완성:
- 1단계 R1 ✅ 템플릿 빌더
- 2단계 R2 ✅ 수신자 그룹
- 3단계 R3 ✅ 발송 큐
- 4단계 R4 추적·분석 (본 라운드)
- 5단계 R4 AI 트리거 (본 라운드)

다음 후보:
- Phase 11 멘션·구독 (게시판·채팅) — 작은 라운드 1~2개
- Phase 12 신고 진행 공개 + 익명 강화 — 큰 라운드 2~3개

---

## 9. 작업량 분배 표 (Swain 정책 — A·B 작업 ↑)

| 채팅 | 영역 | 추정 시간 |
|---|---|---|
| 메인 | 설계 (완료) + 머지 사이클 (B 1차·2차 + A) + C 트리거 | 4h |
| **B (1차)** | 추적 인프라 + 마이그 + 재발송 + 이력 + R3 cron 보강 | **6~7h** |
| **B (2차)** | AI 트리거 헬퍼·API + 분석 API + cron 2개 | **6~7h** |
| **A** | 트리거 관리 + 분석 대시보드 + 이력 화면 2종 + R3 보강 + 사이드바 + 진입점 | **13~15h** |
| C | Q1~Q18 + 회귀 + cron + 성능 + 보안 검증 | 3~4h |

→ B·A 모두 평행 진행 시 13~15h 동안 메인 대기 시간 ↓.
