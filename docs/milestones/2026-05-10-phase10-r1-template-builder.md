# Phase 10 R1 — 통합 발송 시스템: 템플릿 빌더

> **작성**: 2026-05-10 / 메인 채팅 (Opus 4.7)
> **상위 Phase**: Phase 10 통합 발송 시스템 ([카탈로그](2026-05-10-phase10-22-catalog.md) §2 Phase 10)
> **추정**: 메인 설계 1.5h(완료) / B 백 4~6h / A 프론트 4~5h / C 검증 1~2h / 합계 11~14h
> **모드**: **직렬** (B 머지 → A 시작) — 작은 라운드, 화면이 백 응답 구조에 직결

> **참조**: [`PARALLEL_GUIDE.md`](../PARALLEL_GUIDE.md), [`PARALLEL_TEMPLATE.md`](../PARALLEL_TEMPLATE.md)

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블 — `communication_templates`

협회 운영자가 만들고 관리하는 발송 템플릿. Phase 9 카카오 알림톡 템플릿(Aligo 측 외부 심사)과는 **분리된 독립 시스템**. Phase 10 본 테이블은 변수 치환 + 본문 관리에 집중하고, 실제 발송은 Phase 10 R3에서 Phase 8 디스패처를 경유.

```typescript
// db/schema.ts 끝에 추가 — 마이그 호출 후 활성화
export const communicationTemplates = pgTable("communication_templates", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  name:         varchar("name", { length: 100 }).notNull(),       // 운영자가 식별하는 이름
  channel:      text("channel").notNull(),                         // 'email' | 'sms' | 'kakao' | 'inapp'
  category:     text("category").notNull(),                        // 'newsletter' | 'announcement' | 'auto_trigger' | 'campaign' | 'system'
  subject:      text("subject"),                                   // 이메일 제목·인앱 타이틀 (sms·kakao는 NULL)
  bodyTemplate: text("body_template").notNull(),                   // 변수 포함 본문 — mustache 스타일 {{key}}
  variables:    jsonb("variables").default(sql`'[]'::jsonb`).notNull(), // [{key, label, sample}]
  isActive:     boolean("is_active").default(true).notNull(),      // soft delete
  createdBy:    integer("created_by").references(() => members.id, { onDelete: "set null" }),
  updatedBy:    integer("updated_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  channelIdx:  index("comm_templates_channel_idx").on(t.channel),
  categoryIdx: index("comm_templates_category_idx").on(t.category),
  activeIdx:   index("comm_templates_active_idx").on(t.isActive),
}));

export type CommunicationTemplate    = typeof communicationTemplates.$inferSelect;
export type NewCommunicationTemplate = typeof communicationTemplates.$inferInsert;
```

### 1.2 기존 테이블 변경

없음. 본 라운드는 신규 테이블 1개만.

### 1.3 마이그레이션 SQL

```sql
-- IF NOT EXISTS · 멱등 보장
CREATE TABLE IF NOT EXISTS communication_templates (
  id              BIGSERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  channel         TEXT NOT NULL,
  category        TEXT NOT NULL,
  subject         TEXT,
  body_template   TEXT NOT NULL,
  variables       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  updated_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comm_templates_channel_idx  ON communication_templates(channel);
CREATE INDEX IF NOT EXISTS comm_templates_category_idx ON communication_templates(category);
CREATE INDEX IF NOT EXISTS comm_templates_active_idx   ON communication_templates(is_active);

-- 시드 — 시스템 기본 템플릿 3종 (운영자가 즉시 미리보기 학습 가능)
INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, created_by)
VALUES
  ('월간 뉴스레터 기본', 'email', 'newsletter',
   '[교사유가족협의회] {{member_name}}님께 보내는 {{month}}월 소식',
   E'{{member_name}}님, 안녕하세요.\n교사유가족협의회입니다.\n\n{{month}}월 한 달간 협회는 다음과 같이 활동했습니다.\n\n{{summary}}\n\n앞으로도 따뜻한 관심 부탁드립니다.',
   '[{"key":"member_name","label":"회원이름","sample":"홍길동"},{"key":"month","label":"월","sample":"5"},{"key":"summary","label":"이달의 요약","sample":"신규 후원자 12명, 유족 지원 8건"}]'::jsonb,
   NULL),
  ('일회성 공지 기본', 'email', 'announcement',
   '[교사유가족협의회] {{title}}',
   E'{{member_name}}님, 안녕하세요.\n\n{{body}}\n\n자세한 내용은 협회 홈페이지를 참고해 주세요.',
   '[{"key":"member_name","label":"회원이름","sample":"홍길동"},{"key":"title","label":"제목","sample":"정기 총회 안내"},{"key":"body","label":"본문","sample":"6월 15일 정기 총회를 개최합니다."}]'::jsonb,
   NULL),
  ('AI 트리거 — 이탈 위험 재참여', 'inapp', 'auto_trigger',
   '{{member_name}}님, 오랜만이에요',
   E'{{member_name}}님, 그동안 많이 바쁘셨죠?\n협회는 변함없이 {{member_name}}님을 기다리고 있어요.\n잠시 시간이 나실 때 협회 소식을 한번 살펴봐 주시면 감사하겠습니다.',
   '[{"key":"member_name","label":"회원이름","sample":"홍길동"}]'::jsonb,
   NULL)
ON CONFLICT DO NOTHING;
```

### 1.4 schema.ts import 점검

- [x] `bigserial`, `varchar`, `text`, `jsonb`, `boolean`, `integer`, `timestamp`, `index`, `pgTable` 모두 기존 import에 포함됨 (이번 회귀 사고 후 schema 상단 import 검증)
- [ ] DB 적용 전 schema 정의는 **주석 처리** (마이그 후 활성화)

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `netlify/functions/admin-templates-list.ts` | `/api/admin-templates-list` | GET | requireAdmin | 템플릿 목록 (필터·페이지네이션) |
| `netlify/functions/admin-template-detail.ts` | `/api/admin-template-detail` | GET | requireAdmin | 단일 템플릿 상세 |
| `netlify/functions/admin-template-create.ts` | `/api/admin-template-create` | POST | requireAdmin | 신규 템플릿 생성 |
| `netlify/functions/admin-template-update.ts` | `/api/admin-template-update` | POST | requireAdmin | 기존 템플릿 수정 |
| `netlify/functions/admin-template-delete.ts` | `/api/admin-template-delete` | POST | requireAdmin | soft delete (is_active=false) |
| `netlify/functions/admin-template-preview.ts` | `/api/admin-template-preview` | POST | requireAdmin | 변수 치환 결과 반환 (DB 저장 X) |
| `netlify/functions/migrate-phase10-templates.ts` | `/api/migrate-phase10-templates` | GET ?run=1 | requireAdmin | 1회용 마이그 |

### 2.2 함수별 상세

#### `admin-templates-list` (GET)

**쿼리 파라미터** (모두 optional):
- `channel`: `email|sms|kakao|inapp` 필터
- `category`: 카테고리 필터
- `q`: 이름 부분 일치 검색
- `includeInactive`: `1`이면 soft delete 포함 (기본 false)
- `limit`: 기본 50, 최대 200
- `offset`: 기본 0

**응답 (성공)**:
```json
{
  "ok": true,
  "rows": [
    {
      "id": 1,
      "name": "월간 뉴스레터 기본",
      "channel": "email",
      "category": "newsletter",
      "subject": "...",
      "isActive": true,
      "createdAt": "2026-05-10T...",
      "updatedAt": "2026-05-10T..."
    }
  ],
  "total": 12
}
```

#### `admin-template-detail` (GET ?id=X)

**응답**:
```json
{
  "ok": true,
  "template": {
    "id": 1, "name": "...", "channel": "email", "category": "newsletter",
    "subject": "...", "bodyTemplate": "...",
    "variables": [{"key":"member_name","label":"회원이름","sample":"홍길동"}],
    "isActive": true,
    "createdBy": 5, "updatedBy": null,
    "createdAt": "...", "updatedAt": "..."
  }
}
```

#### `admin-template-create` (POST)

**요청**:
```json
{
  "name": "월간 뉴스레터 5월호",
  "channel": "email",
  "category": "newsletter",
  "subject": "{{title}}",
  "bodyTemplate": "{{member_name}}님, ...",
  "variables": [
    {"key":"member_name","label":"회원이름","sample":"홍길동"},
    {"key":"title","label":"제목","sample":"5월 소식"}
  ]
}
```

**검증** (step=`validate`):
- `name`: 1~100자
- `channel`: 4종 enum 외 거부 → 400 `"채널 값이 올바르지 않습니다."`
- `category`: 5종 enum 외 거부
- `bodyTemplate`: 1~10000자
- `subject`: email·inapp는 필수, sms·kakao는 NULL 허용
- `variables`: 배열, 각 요소 `{key, label, sample}` 모두 string
- `bodyTemplate`·`subject`에 등장하는 모든 `{{key}}`가 `variables[].key`에 정의되어 있어야 함 (참조 검증 — 미정의 변수 발견 시 400)

**응답**:
```json
{ "ok": true, "id": 42 }
```

#### `admin-template-update` (POST ?id=X)

요청 body는 create와 동일. 미수정 필드는 클라이언트가 기존 값 그대로 보냄. `updatedBy`·`updatedAt` 자동 갱신.

#### `admin-template-delete` (POST ?id=X)

soft delete: `is_active=false`. 응답 `{ok:true}`.

#### `admin-template-preview` (POST)

**요청**:
```json
{
  "channel": "email",
  "subject": "{{title}}",
  "bodyTemplate": "{{member_name}}님, ...",
  "variables": [{"key":"member_name","sample":"홍길동"},{"key":"title","sample":"5월"}],
  "overrides": { "member_name": "김철수" }
}
```

`overrides`는 sample을 덮어쓰는 옵션 (없으면 sample 그대로 사용).

**응답**:
```json
{
  "ok": true,
  "preview": {
    "subject": "5월",
    "body": "김철수님, ..."
  },
  "warnings": [
    "본문에 정의되지 않은 변수 {{unknown}}이 있습니다."
  ]
}
```

DB 저장 0. 순수 치환 결과만 반환.

### 2.3 `lib/template-render.ts` 헬퍼

```typescript
// lib/template-render.ts
export interface TemplateVariable { key: string; label?: string; sample?: string }
export interface RenderResult { rendered: string; warnings: string[] }

/**
 * mustache 스타일 {{key}} 치환.
 * - data에 키가 없으면 sample 사용, sample도 없으면 빈 문자열 + warning
 * - {{key}} 외 다른 syntax 미지원 (블록·조건문 X)
 * - HTML 이스케이프 X (이메일 HTML 본문에서 의도적 raw 사용)
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariable[],
  data: Record<string, string> = {},
): RenderResult { /* ... */ }

/** 본문에서 사용된 {{key}} 모두 추출 */
export function extractVariableKeys(template: string): string[] { /* ... */ }

/** variables[].key와 본문 사용 키 비교 → 미정의 키 목록 반환 */
export function findUndefinedVariables(
  template: string,
  variables: TemplateVariable[],
): string[] { /* ... */ }
```

### 2.4 회귀 점검 — Phase 9 카카오 알림톡과의 분리

본 시스템 `kakao` 채널 템플릿은 **Aligo 측 심사 통과된 알림톡 템플릿과 별개**.
- Aligo 알림톡: 카카오 심사 통과 후 Aligo 콘솔에 등록되는 템플릿 ID (`ALIGO_TEMPLATE_*` 환경변수)
- 본 시스템 `communication_templates`: 협회가 자체 관리하는 본문 + 변수 정의

Phase 10 R3(발송 예약 큐)에서 두 시스템을 매핑 — 본 라운드 범위 외.

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 페이지 | 경로 | 진입점 | 권한 |
|---|---|---|---|
| `public/admin-templates.html` | `/admin-templates.html` | 어드민 사이드바 → 운영 → 발송 템플릿 | 어드민 |
| `public/admin-template-edit.html` | `/admin-template-edit.html?id={id}` (id 없으면 신규) | 목록 페이지 → 신규/수정 버튼 | 어드민 |

### 3.2 페이지별 와이어프레임

#### `admin-templates.html` (목록)

```
┌─ 발송 템플릿 관리 ────────────────────────────────────────┐
│                                                              │
│  채널: [전체 ▼]  카테고리: [전체 ▼]  검색: [    ]  [+ 신규]  │
│  □ 비활성 포함                                                │
│                                                              │
│  ┌──┬─────────────┬───────┬──────────┬────────┬────────┐    │
│  │ID│ 이름         │ 채널  │ 카테고리 │ 갱신일 │ 동작   │    │
│  ├──┼─────────────┼───────┼──────────┼────────┼────────┤    │
│  │ 1│월간 뉴스레터 │이메일 │뉴스레터  │ 5/10   │[수정]  │    │
│  │  │             │       │          │        │[삭제]  │    │
│  └──┴─────────────┴───────┴──────────┴────────┴────────┘    │
│                                                              │
│  [< 이전]  1 / 3  [다음 >]                                   │
└──────────────────────────────────────────────────────────────┘
```

- 채널 셀렉트: 전체/이메일/SMS/카카오 알림톡/인앱
- 카테고리 셀렉트: 전체/뉴스레터/일회성 공지/AI 트리거/캠페인/시스템
- 검색: 이름 부분 일치
- 비활성 포함 체크박스
- 신규 버튼 → `/admin-template-edit.html` (id 없이)
- 수정 버튼 → `/admin-template-edit.html?id=X`
- 삭제 버튼 → confirm → `admin-template-delete` 호출 → 행 회색 처리

#### `admin-template-edit.html` (신규/수정)

```
┌─ 템플릿 [신규 / 수정 #1] ────────────────────────────────────────┐
│                                                                     │
│  이름:        [                                          ] (*필수)  │
│  채널:        ○ 이메일  ○ SMS  ○ 카카오 알림톡  ○ 인앱              │
│  카테고리:    [뉴스레터 ▼]                                          │
│                                                                     │
│  ┌─ 변수 정의 ─────────────────────────────────────────┐            │
│  │  키          │ 라벨        │ 샘플          │ [삭제]  │            │
│  │  member_name │ 회원이름    │ 홍길동        │  [×]    │            │
│  │  amount      │ 금액        │ 30000         │  [×]    │            │
│  │  [+ 변수 추가]                                       │            │
│  └─────────────────────────────────────────────────────┘            │
│                                                                     │
│  제목 (이메일·인앱):                                                │
│  [{{title}}                                                ]        │
│                                                                     │
│  본문 (변수 사용 가능, {{key}} 형식):                               │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ {{member_name}}님 안녕하세요.                         │           │
│  │ ...                                                   │           │
│  └──────────────────────────────────────────────────────┘           │
│                                                                     │
│  [미리보기] 클릭 → 모달                                              │
│                                                                     │
│  [취소]  [저장]                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─ 미리보기 모달 ───────────────────────────────────────────┐
│  변수 값 입력 (샘플로 자동 채움, 수정 가능):              │
│  member_name: [홍길동      ]                              │
│  amount:      [30000       ]                              │
│                                                            │
│  ┌─ 결과 ─────────────────────────────────────────┐       │
│  │ 제목: 5월 소식                                   │       │
│  │                                                  │       │
│  │ 홍길동님 안녕하세요.                             │       │
│  │ ...                                              │       │
│  └────────────────────────────────────────────────┘       │
│  ⚠ 정의되지 않은 변수: {{unknown}} (있을 시 표시)         │
│                                                            │
│  [닫기]                                                    │
└────────────────────────────────────────────────────────────┘
```

채널별 동적 동작:
- 이메일·인앱 선택 시 제목 입력 칸 노출
- SMS·카카오 알림톡 선택 시 제목 칸 숨김
- SMS 선택 시 본문 하단에 "현재 N자 / SMS 90자 / LMS 2000자" 카운터 (안내만)
- 카카오 선택 시 본문 하단에 "Aligo 알림톡 별도 — 본 본문은 미리보기·기록용" 안내 박스

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 요청 body | 응답 처리 | 에러 토스트 |
|---|---|---|---|---|
| 목록 진입 | `admin-templates-list` GET | (쿼리) | 표 렌더 | "템플릿 목록 조회 실패: {detail}" |
| 신규 버튼 | (없음) | — | 편집 페이지 이동 | — |
| 수정 버튼 | `admin-template-detail` GET | `?id=X` | 편집 페이지 폼 채우기 | "템플릿 조회 실패: {detail}" |
| 삭제 버튼 | `admin-template-delete` POST | `?id=X` | 행 회색 처리·토스트 | "삭제 실패: {detail}" |
| 저장 (신규) | `admin-template-create` POST | 폼 데이터 | 토스트 + 목록 페이지 이동 | "저장 실패: {detail}" |
| 저장 (수정) | `admin-template-update` POST | 폼 데이터 + `?id=X` | 동일 | 동일 |
| 미리보기 버튼 | `admin-template-preview` POST | 폼 데이터 + overrides | 모달에 결과·warning 표시 | "미리보기 실패: {detail}" |

### 3.4 토스트·문구 모음

| 상황 | 문구 |
|---|---|
| 저장 성공 (신규) | "템플릿이 등록되었습니다." |
| 저장 성공 (수정) | "템플릿이 수정되었습니다." |
| 삭제 성공 | "템플릿이 삭제되었습니다." |
| 검증 실패 — 이름 비었음 | "템플릿 이름을 입력해 주세요." |
| 검증 실패 — 본문 비었음 | "본문을 입력해 주세요." |
| 검증 실패 — 미정의 변수 | "본문에 정의되지 않은 변수가 있습니다: {{unknown}}" |
| 미리보기 warning | "정의되지 않은 변수: {{key}} — 변수 정의에 추가하거나 본문에서 제거해 주세요." |
| 서버 에러 (공통) | "{서버 detail 노출}" |

### 3.5 캐시버스터

신규 파일이라 v1로 시작. 변경 시 `?v=2` 식으로 갱신:
- `public/admin-templates.html` → `<script src="js/admin-templates.js?v=1">`
- `public/admin-template-edit.html` → `<script src="js/admin-template-edit.js?v=1">`
- `public/css/admin-templates.css` (필요 시)

`public/admin.html` 사이드바: 운영 그룹 끝에 `[발송 템플릿]` 메뉴 1줄 추가.

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오 (Q1~Q8)

| # | 시나리오 (사용자 동작) | 기대 동작 |
|---|---|---|
| Q1 | 어드민 로그인 → 사이드바 → 발송 템플릿 메뉴 클릭 | 시드 3건이 목록에 표시 (월간 뉴스레터·일회성 공지·AI 트리거) |
| Q2 | 신규 버튼 → 이메일 채널 선택 → 이름·제목·본문 작성·변수 정의 → 저장 | 목록에 새 행 추가, 수정 버튼으로 다시 열어 동일 내용 확인 |
| Q3 | 신규 작성 중 본문에 `{{unknown}}` 변수를 변수 정의 없이 사용 → 저장 | 토스트 "정의되지 않은 변수: {{unknown}}" 표시, DB 저장 안 됨 |
| Q4 | 신규 작성 중 미리보기 버튼 클릭 → 변수 값 수정 → 결과 확인 | 모달에 치환된 제목·본문 표시, 빈 변수는 sample 사용 |
| Q5 | SMS 채널 선택 | 제목 입력 칸 숨김, 글자수 카운터 표시 |
| Q6 | 카카오 알림톡 채널 선택 | 제목 칸 숨김, "Aligo 알림톡 별도" 안내 박스 표시 |
| Q7 | 기존 템플릿 삭제 버튼 클릭 → confirm | soft delete, 비활성 포함 체크 시 회색 행으로 표시 |
| Q8 | 채널·카테고리·검색 필터 동시 적용 | 결과 행이 모든 조건 동시 만족 |

### 4.2 회귀 점검 영역

이번 변경이 깨뜨릴 수 있는 기존 기능:
- **어드민 로그인** — schema 변경(신규 테이블)이라 기존 SELECT 영향 0이 정상이지만 형식적 점검
- **Phase 8 알림 발송** — 디스패처 호출 흐름 변경 0 (본 라운드는 템플릿 CRUD만, 발송 시스템 미연동)
- **Phase 9 카카오 알림톡** — Aligo 어댑터·환경변수 영향 0 (분리 시스템)
- **사이드바 메뉴** — 운영 그룹 끝 1줄 추가만, 기존 메뉴 깨짐 0
- **회원·후원 등 다른 어드민 화면 2~3개** — schema import 회귀 광범위 점검 (`bigserial` 사고 재발 방지)

### 4.3 백필 필요 여부

- [x] 백필 불필요 — 시드 3건만 마이그에서 INSERT, 기존 데이터 변환 X

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] **직렬** (B 머지 → A 시작)
- [ ] 평행
- [ ] 평행 + 단계 머지

사유: 라운드 규모 작음(B 4~6h). A가 mock으로 시작해도 큰 효율 차이 없고, 실 API 응답 구조에 폼·미리보기가 직결되어 mock으로 만들 면적이 큼. B 먼저 머지 후 A는 실 API로 바로 작성.

### 5.2 머지 순서

```
1. B push → 메인이 main 머지 → push
2. Netlify 배포 1~3분 대기
3. 메인이 Swain께 마이그 호출 안내:
   /api/migrate-phase10-templates?run=1
4. Swain 응답 보고 → 메인 또는 C가:
   - schema 정의 활성화 (현재 주석 → 정상 코드)
   - migrate-phase10-templates.ts 삭제
   → push
5. A push → 메인이 main 머지 → push
6. C verify 트리거 → C 검증·fix push → 메인 머지 → 라운드 마감
```

### 5.3 신규 환경변수

없음. 본 라운드는 외부 API·키 사용 0.

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용)

### 6.1 메인 — 본 설계서가 산출물 (생략)

### 6.2 B 채팅 — 백 구현

```
[B — Phase 10 R1 백 구현 (템플릿 빌더)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase10-r1-back (베이스 origin/main 최신)
정독 (필수): docs/milestones/2026-05-10-phase10-r1-template-builder.md §1·§2
참고: docs/PARALLEL_GUIDE.md §3 영역 분담, §7 자체 검증, §10 사고 사례

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example
금지: public/, assets/

세팅:
  cd ../tbfa-mis-B
  git fetch origin
  git checkout -b feature/phase10-r1-back origin/main

작업 순서:
  1) lib/template-render.ts 작성 (§2.3)
     - mustache 스타일 {{key}} 치환
     - extractVariableKeys / findUndefinedVariables 헬퍼
  2) netlify/functions/migrate-phase10-templates.ts 작성 (§1.3 SQL)
     - requireAdmin + GET ?run=1 + 멱등 + 시드 3건
  3) db/schema.ts §1.1 정의 추가 (주석 상태 — 마이그 후 메인이 활성화)
     ※ import 라인에 사용 타입 모두 — 이번 라운드는 기존 import 모두 충분 (검증)
  4) API 함수 7종 (§2.1) — §2.2 명세 그대로
     - admin-templates-list / detail / create / update / delete / preview
     - 권한·검증·응답 구조·에러 step·detail·stack
  5) `npx tsc --noEmit` 통과 후 push

머지 전 체크 (CLAUDE.md §6 + §13):
  - export const config = { path } 7개 누락 0
  - requireAdmin 반환 auth.res
  - 응답 키 다중 fallback
  - try/catch step·detail·stack
  - schema import 회귀 0 (`bigserial` 등)
  - admin-template-create 변수 참조 검증 (정의되지 않은 {{key}} 거부)

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.3 A 채팅 — 프론트 구현

```
[A — Phase 10 R1 프론트 구현 (템플릿 빌더)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase10-r1-front (베이스 main @ {B 머지·schema 활성화 후 커밋})
정독 (필수): docs/milestones/2026-05-10-phase10-r1-template-builder.md §3
참고: docs/PARALLEL_GUIDE.md §3 영역 분담

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, .env.example

모드: 직렬 — B 머지 후 시작. 실 API로 바로 작성.

세팅:
  cd ../tbfa-mis-A
  git fetch origin
  git checkout -b feature/phase10-r1-front origin/main

작업 순서:
  1) public/admin-templates.html — §3.2 목록 와이어프레임
  2) public/js/admin-templates.js — §3.3 매핑 (api() 헬퍼 사용)
  3) public/admin-template-edit.html — §3.2 편집 와이어프레임
  4) public/js/admin-template-edit.js — 폼·미리보기·변수 동적 추가
     - 채널 변경 시 제목 칸 노출/숨김 동적 처리
     - SMS 글자수 카운터
     - 카카오 안내 박스
     - 변수 정의 표 동적 추가/삭제
     - 미리보기 모달 (admin-template-preview API)
  5) public/admin.html 사이드바 운영 그룹 끝에 [발송 템플릿] 메뉴 1줄
  6) §3.5 캐시버스터 ?v=1
  7) 화면 진입·신규 저장·수정·미리보기·삭제 동작 확인 후 push

머지 전 체크:
  - §3.2 모든 필드·버튼 존재
  - §3.4 토스트 문구 정확 일치
  - 채널별 동적 동작 (이메일/SMS/카카오/인앱) 확인
  - public/ 외 파일 변경 0

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase 10 R1 검증·fix (템플릿 빌더)]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase10-r1 (베이스 main @ {A 머지 후 커밋})
정독: docs/milestones/2026-05-10-phase10-r1-template-builder.md §4
참고: docs/PARALLEL_GUIDE.md §7 검증 책임

세팅:
  cd ../tbfa-mis-C
  git fetch origin
  git checkout -b verify/phase10-r1 origin/main

작업 순서:
  1) §4.1 Q1~Q8 라이브 시나리오 (사용자 동작·결과 기록)
  2) §4.2 회귀 점검 — 어드민 로그인·Phase 8·9 흐름·다른 어드민 화면 2~3개
  3) bug 발견 시 fix 커밋 (verify 브랜치 그대로) → 메인 보고
  4) 보고서 docs/verify/2026-05-10-phase10-r1.md
     - Q별 PASS/FAIL + 회귀 결과
     - bug 있으면 원인·수정 내용·검증 결과
  5) push → 메인 보고

표현 규칙 (CLAUDE.md §6.14):
  - 함수명·코드 용어 없이 사용자 동작·결과 위주
  - 예) "신규 버튼 누르고 변수 정의 후 저장 → 목록에 추가됨" (O)
  - 예) "admin-template-create POST 호출 → 200 응답" (X)
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B 머지 + 마이그 호출 + schema 활성화·마이그 파일 삭제 + A 머지
- [ ] C 보고서 push + 라이브 검증 모두 PASS
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가 (Phase 10 R1 100%)
- [ ] PROJECT_STATE §5 Phase 10 행 진행률 갱신 (R1 완료)
- [ ] PROJECT_STATE §8 큐에 Q-신규: "Phase 10 R1 라이브 검증" 추가됨이 아니라 이번 라운드는 C가 직접 검증하므로 큐 추가 불필요
- [ ] Phase 10 R2 (수신자 그룹 선택) 설계 시작 또는 다음 우선순위 조정
