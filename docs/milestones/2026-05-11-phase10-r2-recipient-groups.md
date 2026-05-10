# Phase 10 R2 — 통합 발송 시스템: 수신자 그룹 선택

> **작성**: 2026-05-11 / 메인 채팅 (Opus 4.7)
> **상위 Phase**: Phase 10 통합 발송 시스템 ([카탈로그](2026-05-10-phase10-22-catalog.md) §2 Phase 10)
> **선행**: Phase 10 R1 템플릿 빌더 (✅ 코드 100% 머지 완료)
> **추정**: 메인 설계 1.5h(완료) / B 백 5~7h / A 프론트 5~6h / C 검증 1~2h / 합계 13~16h
> **모드**: **평행** (PARALLEL_GUIDE §2 정책 — 모든 라운드 평행 전제)

> **참조**: [`PARALLEL_GUIDE.md`](../PARALLEL_GUIDE.md), [`PARALLEL_TEMPLATE.md`](../PARALLEL_TEMPLATE.md)

---

## 0. 라운드 목적

발송 대상이 되는 회원 묶음을 **재사용 가능한 그룹**으로 정의·저장. 그룹은 두 가지 방식 — **필터 조건 기반(동적)** 과 **수동 명단(고정)**. R3(발송 예약 큐)에서 R1 템플릿 + R2 그룹 결합으로 발송. 본 라운드는 그룹 CRUD + 미리보기 + 회원 목록만, 실제 발송은 R3 범위.

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블 — `recipient_groups`

```typescript
// db/schema.ts 끝에 추가 — 마이그 호출 후 활성화
export const recipientGroups = pgTable("recipient_groups", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  name:        varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  // criteria 구조:
  //   { "type": "filter", "filters": [{field, op, value/values}, ...], "logic": "and"|"or" }
  //   { "type": "manual", "memberIds": [1,2,3,...] }
  criteria:    jsonb("criteria").notNull(),
  isActive:    boolean("is_active").default(true).notNull(),       // soft delete
  createdBy:   integer("created_by").references(() => members.id, { onDelete: "set null" }),
  updatedBy:   integer("updated_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  activeIdx: index("recipient_groups_active_idx").on(t.isActive),
  nameIdx:   index("recipient_groups_name_idx").on(t.name),
}));

export type RecipientGroup    = typeof recipientGroups.$inferSelect;
export type NewRecipientGroup = typeof recipientGroups.$inferInsert;
```

### 1.2 기존 테이블 변경

없음. 본 라운드는 신규 테이블 1개만.

### 1.3 마이그레이션 SQL

```sql
-- IF NOT EXISTS · 멱등 보장
CREATE TABLE IF NOT EXISTS recipient_groups (
  id           BIGSERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  criteria     JSONB NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  updated_by   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recipient_groups_active_idx ON recipient_groups(is_active);
CREATE INDEX IF NOT EXISTS recipient_groups_name_idx   ON recipient_groups(name);

-- 시드 — 운영자가 즉시 학습 가능한 기본 그룹 5종
INSERT INTO recipient_groups (name, description, criteria, created_by) VALUES
  ('전체 활성 회원', '회원 상태가 활성인 모든 회원',
   '{"type":"filter","logic":"and","filters":[{"field":"status","op":"eq","value":"active"}]}'::jsonb, NULL),
  ('정기 후원자', '활성 정기 후원이 있는 회원',
   '{"type":"filter","logic":"and","filters":[{"field":"hasActiveRegularDonation","op":"eq","value":true}]}'::jsonb, NULL),
  ('일시 후원자 (최근 90일)', '최근 90일 안에 일시 후원 이력이 있는 회원',
   '{"type":"filter","logic":"and","filters":[{"field":"hadOneTimeDonationDays","op":"lte","value":90}]}'::jsonb, NULL),
  ('회원 등급 — 명예회원 이상', '회원 등급이 명예 이상',
   '{"type":"filter","logic":"and","filters":[{"field":"gradeCode","op":"in","values":["honor","lifetime"]}]}'::jsonb, NULL),
  ('운영자', '회원 유형이 admin/staff',
   '{"type":"filter","logic":"and","filters":[{"field":"type","op":"in","values":["admin","staff"]}]}'::jsonb, NULL)
ON CONFLICT DO NOTHING;
```

> **시드 주의**: `gradeCode` 필드 값(`honor`, `lifetime`)은 운영 DB의 `member_grades.code` 실제 값과 다를 수 있음. B는 마이그 작성 시 본 SQL 실행 전 `member_grades` 테이블의 실제 code 한 번 SELECT 점검 후 시드 값 보정. 어긋나면 시드 4번 행 일시 제외.

### 1.4 schema.ts import 점검

- [x] `bigserial`, `varchar`, `text`, `jsonb`, `boolean`, `integer`, `timestamp`, `index`, `pgTable`, `sql` 모두 기존 import에 포함됨
- [ ] DB 적용 전 schema 정의는 **주석 처리** (마이그 후 활성화)

---

## 2. API 명세 (B용)

### 2.1 함수 목록 (총 8개 — R1보다 1개 많음, members API)

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `netlify/functions/admin-recipient-groups-list.ts` | `/api/admin-recipient-groups-list` | GET | requireAdmin | 그룹 목록 (필터·페이지네이션) |
| `netlify/functions/admin-recipient-group-detail.ts` | `/api/admin-recipient-group-detail` | GET | requireAdmin | 단일 그룹 상세 |
| `netlify/functions/admin-recipient-group-create.ts` | `/api/admin-recipient-group-create` | POST | requireAdmin | 신규 그룹 생성 |
| `netlify/functions/admin-recipient-group-update.ts` | `/api/admin-recipient-group-update` | POST | requireAdmin | 기존 그룹 수정 |
| `netlify/functions/admin-recipient-group-delete.ts` | `/api/admin-recipient-group-delete` | POST | requireAdmin | soft delete (is_active=false) |
| `netlify/functions/admin-recipient-group-preview.ts` | `/api/admin-recipient-group-preview` | POST | requireAdmin | criteria 받아 N명·샘플 5명 반환 (DB 저장 X) |
| `netlify/functions/admin-recipient-group-members.ts` | `/api/admin-recipient-group-members` | GET | requireAdmin | 저장된 그룹의 현재 시점 회원 목록 (페이지네이션) |
| `netlify/functions/migrate-phase10-recipient-groups.ts` | `/api/migrate-phase10-recipient-groups` | GET ?run=1 | requireAdmin | 1회용 마이그 (테이블+인덱스+시드 5종) |

### 2.2 함수별 상세

#### `admin-recipient-groups-list` (GET)

**쿼리 파라미터** (모두 optional):
- `q`: 이름·설명 부분 일치
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
      "name": "전체 활성 회원",
      "description": "...",
      "criteriaSummary": "필터: 상태=활성",
      "memberCount": 1250,
      "isActive": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 5
}
```

`criteriaSummary`는 사람이 읽기 쉬운 한 줄 요약. `memberCount`는 list 응답 시점에 동적 계산 — 비용 우려 시 5건 단위로 N+1 SELECT 가능 (작은 운영 규모).

#### `admin-recipient-group-detail` (GET ?id=X)

**응답**:
```json
{
  "ok": true,
  "group": {
    "id": 1,
    "name": "정기 후원자",
    "description": "...",
    "criteria": {
      "type": "filter",
      "logic": "and",
      "filters": [
        {"field":"hasActiveRegularDonation","op":"eq","value":true}
      ]
    },
    "isActive": true,
    "memberCount": 320,
    "sampleMembers": [
      {"id":1,"name":"홍길동","email":"..."},
      {"id":2,"name":"김철수","email":"..."}
    ],
    "createdBy": 5, "updatedBy": null,
    "createdAt": "...", "updatedAt": "..."
  }
}
```

`sampleMembers`는 5명. 회원 정보 일부만 (id·name·email).

#### `admin-recipient-group-create` (POST)

**요청**:
```json
{
  "name": "5월 캠페인 대상자",
  "description": "5월 캠페인에 후원한 회원",
  "criteria": {
    "type": "filter",
    "logic": "and",
    "filters": [
      {"field":"campaignId","op":"eq","value":42},
      {"field":"donationStatus","op":"in","values":["completed","active"]}
    ]
  }
}
```

또는 수동 명단:
```json
{
  "name": "5월 행사 초청자",
  "criteria": {
    "type": "manual",
    "memberIds": [1, 5, 12, 28, 43]
  }
}
```

**검증** (step=`validate`):
- `name`: 1~100자, 중복 시 400 (`is_active=true` 그룹 안에서)
- `criteria.type`: `filter` 또는 `manual` 아니면 400
- `filter` 분기:
  - `criteria.logic`: `and`|`or` (기본 `and`)
  - `criteria.filters`: 배열, 1개 이상
  - 각 필터 `{field, op, value 또는 values}` — 허용된 field·op 조합인지 화이트리스트 점검 (§2.4)
- `manual` 분기:
  - `criteria.memberIds`: 정수 배열, 1개 이상 1000개 이하
  - 존재하지 않는 회원 ID 발견 시 400 (검증 응답에 누락 ID 목록 반환)

**응답**:
```json
{ "ok": true, "id": 42 }
```

#### `admin-recipient-group-update` (POST ?id=X)

요청 body는 create와 동일. 미수정 필드는 클라이언트가 기존 값 그대로 전송. `updatedBy`·`updatedAt` 자동 갱신.

#### `admin-recipient-group-delete` (POST ?id=X)

soft delete: `is_active=false`. 응답 `{ok:true}`.

#### `admin-recipient-group-preview` (POST)

**요청** (저장 안 된 criteria로 미리보기):
```json
{
  "criteria": { "type": "filter", "logic": "and", "filters": [...] }
}
```

**응답**:
```json
{
  "ok": true,
  "preview": {
    "memberCount": 320,
    "sampleMembers": [
      {"id":1,"name":"홍길동","email":"..."},
      {"id":2,"name":"김철수","email":"..."},
      {"id":3,"name":"이영희","email":"..."},
      {"id":4,"name":"박지민","email":"..."},
      {"id":5,"name":"정수진","email":"..."}
    ],
    "criteriaSummary": "필터: 캠페인=42 AND 후원상태=완료/활성"
  },
  "warnings": []
}
```

**비용 통제**:
- `memberCount` SELECT는 항상 실행
- `sampleMembers`는 5건 limit
- 결과 0명이면 `warnings: ["조건에 맞는 회원이 0명입니다."]` 추가

#### `admin-recipient-group-members` (GET ?id=X&limit=50&offset=0)

저장된 그룹의 현재 시점 회원 목록. 페이지네이션.

**응답**:
```json
{
  "ok": true,
  "members": [
    {"id":1,"name":"홍길동","email":"...","type":"regular","status":"active"}
  ],
  "total": 320
}
```

> **주의**: 동적 그룹은 응답 시점 SELECT — 회원 변동(블랙 처리·탈퇴 등) 자동 반영. R3에서 발송 시점에 스냅샷 저장 별도 처리.

### 2.3 `lib/recipient-resolve.ts` 헬퍼

```typescript
// lib/recipient-resolve.ts
export type FilterField =
  | "type" | "status" | "gradeCode" | "gradeId"
  | "hasActiveRegularDonation" | "hadOneTimeDonationDays"
  | "campaignId" | "donationStatus"
  | "blacklisted";

export type FilterOp = "eq" | "ne" | "in" | "notIn" | "lte" | "gte";

export interface FilterClause {
  field: FilterField;
  op: FilterOp;
  value?: any;
  values?: any[];
}

export interface FilterCriteria {
  type: "filter";
  logic: "and" | "or";
  filters: FilterClause[];
}

export interface ManualCriteria {
  type: "manual";
  memberIds: number[];
}

export type RecipientCriteria = FilterCriteria | ManualCriteria;

export interface ResolveOptions {
  limit?: number;        // 미리보기는 5, 실제 발송은 unlimited
  offset?: number;
  countOnly?: boolean;   // true면 회원 ID 배열 대신 총 개수만
}

export interface ResolveResult {
  count: number;
  memberIds?: number[];   // countOnly=false일 때만
  members?: Array<{ id: number; name: string; email: string; type: string; status: string }>;
}

/**
 * criteria → 실제 회원 ID 또는 회원 정보 배열
 * - filter: drizzle 동적 WHERE 조립 (eq·ne·in·notIn·lte·gte)
 * - manual: memberIds로 IN 절
 * - hasActiveRegularDonation·hadOneTimeDonationDays는 EXISTS 서브쿼리
 * - blacklisted=true는 status='suspended' AND blacklist_reason IS NOT NULL
 */
export async function resolveRecipients(
  criteria: RecipientCriteria,
  opts?: ResolveOptions,
): Promise<ResolveResult> { /* ... */ }

/** criteria → 사람이 읽기 쉬운 한 줄 요약 ("필터: 상태=활성 AND 등급=명예/평생") */
export function summarizeCriteria(criteria: RecipientCriteria): string { /* ... */ }

/** filter 화이트리스트 검증 */
export function validateCriteria(criteria: any): { ok: true } | { ok: false; error: string } { /* ... */ }
```

### 2.4 필터 field·op 화이트리스트

| field | 허용 op | 값 형식 | 의미 |
|---|---|---|---|
| `type` | eq, in | `regular`/`honor`/`lifetime`/`admin`/`staff`/... (memberType enum) | 회원 유형 |
| `status` | eq, in | `active`/`suspended`/`withdrawn`/`pending` | 회원 상태 |
| `gradeId` | eq, in | 정수 또는 정수 배열 | 등급 ID 직접 지정 |
| `gradeCode` | eq, in | 등급 code 문자열 | 등급 코드 (member_grades.code) |
| `hasActiveRegularDonation` | eq | `true` 또는 `false` | 활성 정기 후원 보유 여부 (EXISTS donations WHERE status='active' AND type='regular') |
| `hadOneTimeDonationDays` | lte, gte | 정수 (일) | 최근 N일 안에 일시 후원 이력 (EXISTS donations WHERE type='one_time' AND created_at >= NOW() - INTERVAL 'N days') |
| `campaignId` | eq, in | 정수 또는 정수 배열 | 특정 캠페인에 후원한 회원 (EXISTS donations WHERE campaign_id IN (...)) |
| `donationStatus` | eq, in | `completed`/`active`/`pending`/... (donationStatusEnum) | 후원 상태 |
| `blacklisted` | eq | `true` 또는 `false` | 블랙 처리 여부 |

화이트리스트 외 field·op 조합은 400 거부 (`step=validate`).

### 2.5 회귀 점검 — 기존 회원 SELECT 영향

- 본 라운드는 신규 테이블만 추가, members 테이블에 컬럼 추가·변경 0
- preview·members API는 members 테이블을 SELECT하지만 기존 인덱스 활용 (status·type·gradeId 모두 인덱스 있음)
- 다만 EXISTS 서브쿼리(donations 조인) 비용 — 1만 회원 규모 OK, 그 이상은 R3에서 캐시 검토

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 페이지 | 경로 | 진입점 | 권한 |
|---|---|---|---|
| `public/admin-recipient-groups.html` | `/admin-recipient-groups.html` | 어드민 사이드바 → 운영 → 수신자 그룹 | 어드민 |
| `public/admin-recipient-group-edit.html` | `/admin-recipient-group-edit.html?id={id}` (id 없으면 신규) | 목록 페이지 → 신규/수정 | 어드민 |

### 3.2 페이지별 와이어프레임

#### `admin-recipient-groups.html` (목록)

```
┌─ 수신자 그룹 관리 ───────────────────────────────────────────┐
│                                                                  │
│  검색: [          ]  □ 비활성 포함         [+ 신규 그룹]          │
│                                                                  │
│  ┌──┬──────────────────┬──────────────────┬──────┬───────┐      │
│  │ID│ 이름              │ 조건 요약         │ 인원 │ 동작  │      │
│  ├──┼──────────────────┼──────────────────┼──────┼───────┤      │
│  │ 1│전체 활성 회원      │상태=활성          │ 1250 │[수정] │      │
│  │  │                   │                   │      │[삭제] │      │
│  │ 2│정기 후원자         │활성 정기 후원 보유 │  320 │[수정] │      │
│  │  │                   │                   │      │[삭제] │      │
│  │ 3│일시 후원자(90일)   │최근 90일 일시 후원 │  185 │[수정] │      │
│  └──┴──────────────────┴──────────────────┴──────┴───────┘      │
│                                                                  │
│  [< 이전]  1 / 1  [다음 >]                                       │
└──────────────────────────────────────────────────────────────────┘
```

- 검색: 이름·설명 부분 일치
- 비활성 포함 체크박스
- 신규 버튼 → `/admin-recipient-group-edit.html`
- 수정 버튼 → `/admin-recipient-group-edit.html?id=X`
- 삭제 버튼 → confirm → `admin-recipient-group-delete` 호출 → 행 회색
- 인원 수 옆에 [회원 보기] 버튼(작게) → 모달로 회원 목록 (members API)

#### `admin-recipient-group-edit.html` (신규/수정)

```
┌─ 수신자 그룹 [신규 / 수정 #1] ──────────────────────────────────┐
│                                                                  │
│  이름:       [                                          ] (*)    │
│  설명:       [                                          ]        │
│                                                                  │
│  방식:       ○ 필터 조건  ○ 수동 명단                             │
│                                                                  │
│  ┌─ 필터 조건 (방식=필터일 때) ──────────────────────────┐        │
│  │  결합:  ○ 모두 만족(AND)  ○ 하나라도(OR)               │        │
│  │                                                        │        │
│  │  ┌──────────────┬──────┬────────────────┬─────┐       │        │
│  │  │ 필드          │ 비교 │ 값              │ 삭제│       │        │
│  │  ├──────────────┼──────┼────────────────┼─────┤       │        │
│  │  │[회원 상태  ▼]│[같음▼]│[활성        ▼] │ [×] │       │        │
│  │  │[등급        ▼]│[포함▼]│[명예,평생    ▼] │ [×] │       │        │
│  │  │[+ 조건 추가]                                   │       │        │
│  │  └──────────────┴──────┴────────────────┴─────┘       │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                  │
│  ┌─ 수동 명단 (방식=수동일 때) ──────────────────────────┐        │
│  │  회원 검색: [홍길동             ] [회원 추가]          │        │
│  │                                                        │        │
│  │  추가된 회원:                                          │        │
│  │  • 홍길동 (회원번호 1) [×]                             │        │
│  │  • 김철수 (회원번호 5) [×]                             │        │
│  │  ...                                                  │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                  │
│  [미리보기] 클릭 → 모달                                          │
│                                                                  │
│  [취소]  [저장]                                                  │
└──────────────────────────────────────────────────────────────────┘

┌─ 미리보기 모달 ───────────────────────────────────────────┐
│  조건 요약: 상태=활성 AND 등급=명예/평생                  │
│                                                            │
│  대상 회원: 320명                                          │
│                                                            │
│  샘플 5명:                                                 │
│   • 홍길동 (hong@...)                                      │
│   • 김철수 (kim@...)                                       │
│   • 이영희 (lee@...)                                       │
│   • 박지민 (park@...)                                      │
│   • 정수진 (jung@...)                                      │
│                                                            │
│  ⚠ 경고 (있을 시): 조건에 맞는 회원이 0명입니다.          │
│                                                            │
│  [닫기]                                                    │
└────────────────────────────────────────────────────────────┘
```

방식별 동적 동작:
- 필터 선택 시 필터 빌더 박스 노출, 수동 명단 박스 숨김
- 수동 선택 시 반대
- 필드 선택 시 비교(op) 옵션이 §2.4 화이트리스트에 따라 동적 변경
  - 예) `회원 상태`(`status`) 선택 → op는 `같음`(eq)·`포함`(in)만
  - 예) `최근 일시 후원 일수`(`hadOneTimeDonationDays`) 선택 → op는 `이내`(lte)·`이상`(gte)
- 값 입력 칸도 op·field에 따라 셀렉트 또는 텍스트 또는 숫자

수동 명단 회원 검색:
- 텍스트 입력 시 `/api/admin-members-search` 호출 (이미 운영 중인 API 활용 — 없으면 B가 추가)
- 결과 5건 표시 → 클릭 시 추가
- 추가된 회원은 ID 배열로 폼 상태 보관

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 요청 body | 응답 처리 | 에러 토스트 |
|---|---|---|---|---|
| 목록 진입 | `admin-recipient-groups-list` GET | (쿼리) | 표 렌더 + 인원 수 | "그룹 목록 조회 실패: {detail}" |
| 신규 버튼 | (없음) | — | 편집 페이지 이동 | — |
| 수정 버튼 | `admin-recipient-group-detail` GET | `?id=X` | 폼 채우기 | "그룹 조회 실패: {detail}" |
| 삭제 버튼 | `admin-recipient-group-delete` POST | `?id=X` | 행 회색·토스트 | "삭제 실패: {detail}" |
| 회원 보기 버튼 | `admin-recipient-group-members` GET | `?id=X&limit=50&offset=0` | 모달에 회원 목록 표시 | "회원 목록 조회 실패: {detail}" |
| 저장 (신규) | `admin-recipient-group-create` POST | 폼 데이터 | 토스트 + 목록 페이지 이동 | "저장 실패: {detail}" |
| 저장 (수정) | `admin-recipient-group-update` POST | 폼 데이터 + `?id=X` | 동일 | 동일 |
| 미리보기 버튼 | `admin-recipient-group-preview` POST | 폼 데이터 | 모달 결과·warning 표시 | "미리보기 실패: {detail}" |
| 회원 검색 (수동) | `/api/admin-members-search` GET | `?q=홍길동` | 검색 결과 5건 표시 | "회원 검색 실패: {detail}" |

### 3.4 토스트·문구 모음

| 상황 | 문구 |
|---|---|
| 저장 성공 (신규) | "수신자 그룹이 등록되었습니다." |
| 저장 성공 (수정) | "수신자 그룹이 수정되었습니다." |
| 삭제 성공 | "수신자 그룹이 삭제되었습니다." |
| 검증 실패 — 이름 비었음 | "그룹 이름을 입력해 주세요." |
| 검증 실패 — 필터 0개 | "최소 1개 이상의 조건을 추가해 주세요." |
| 검증 실패 — 수동 명단 0명 | "최소 1명 이상의 회원을 추가해 주세요." |
| 미리보기 — 결과 0명 | "조건에 맞는 회원이 0명입니다. 조건을 다시 확인해 주세요." |
| 서버 에러 (공통) | "{서버 detail 노출}" |

### 3.5 캐시버스터

신규 파일이라 v1로 시작:
- `public/admin-recipient-groups.html` → `<script src="js/admin-recipient-groups.js?v=1">`
- `public/admin-recipient-group-edit.html` → `<script src="js/admin-recipient-group-edit.js?v=1">`

`public/admin.html` 사이드바: 운영 그룹 안 [📝 발송 템플릿] 메뉴 다음에 `[👥 수신자 그룹]` 1줄 추가.

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오 (Q1~Q9)

| # | 시나리오 (사용자 동작) | 기대 동작 |
|---|---|---|
| Q1 | 어드민 로그인 → 사이드바 → 수신자 그룹 메뉴 클릭 | 시드 5건이 목록에 표시 (전체 활성·정기 후원자·일시 90일·등급 명예 이상·운영자) |
| Q2 | 신규 → 필터 방식 → 회원 상태=활성 + 회원 유형=정기 추가 → 미리보기 | 모달에 인원 수 표시, 샘플 5명 표시 |
| Q3 | 신규 → 수동 명단 → 회원 검색 "홍길동" → 결과에서 클릭 → 추가됨 → 저장 | 목록에 새 행 추가, 인원 수 = 추가된 회원 수 |
| Q4 | 기존 그룹 수정 → 조건 1개 삭제 → 미리보기 → 저장 → 다시 열기 | 변경 반영됨, 인원 수 갱신 |
| Q5 | 신규 → 필터 1개도 없이 저장 시도 | 토스트 "최소 1개 이상의 조건을 추가해 주세요." (저장 안 됨) |
| Q6 | 신규 → 회원 상태=존재안하는값(`unknownXX`) 직접 API로 시도 | 400 "조건 값이 올바르지 않습니다." (화이트리스트 외) |
| Q7 | 회원 보기 버튼 → 모달에 그룹의 현재 회원 목록 표시 | 페이지네이션 동작, 50명 단위 |
| Q8 | 그룹 삭제 → confirm | soft delete, 비활성 포함 시 회색 행으로 표시 |
| Q9 | 정기 후원자 그룹 미리보기 → 비활성 회원 1명 임시로 활성으로 변경 후 다시 미리보기 | 인원 수 1 증가 (동적 그룹의 현재 시점 반영 확인) |

### 4.2 회귀 점검 영역

본 라운드 변경이 깨뜨릴 수 있는 기존 기능:

- **어드민 로그인** — 신규 테이블만 추가, members SELECT 영향 0이 정상
- **회원 목록 화면** — members SELECT 변경 0
- **Phase 10 R1 템플릿 빌더** — 영역 분리, 영향 0
- **Phase 8·9 발송 인프라** — 디스패처 호출 흐름 변경 0 (R2는 그룹 정의만, 발송은 R3)
- **사이드바 메뉴** — 운영 그룹에 1줄 추가만, 기존 메뉴 영향 0
- **회원·후원·캠페인 등 어드민 화면 2~3개** — schema import 회귀 광범위 점검 (`bigserial` 사고 재발 방지)
- **donations·members 인덱스 활용** — preview·members API의 EXISTS 서브쿼리가 인덱스 안 타면 광범위 느려짐 (운영 규모 확인)

### 4.3 백필 필요 여부

- [x] 백필 불필요 — 시드 5건만 마이그에서 INSERT, 기존 데이터 변환 X

### 4.4 성능 점검 (C 추가)

- preview API 응답 시간 — 1만 회원 규모에서 1초 미만이어야 정상
- list API 응답 시간 — `memberCount` 동적 계산이라 그룹 5개 기준 0.5초 미만
- 어느 한 항목이라도 3초 넘으면 보고서에 명시 + R3 머지 전 인덱스·캐시 보강 검토

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] **평행** (PARALLEL_GUIDE §2 — 모든 라운드 평행 전제)

A·B 동시 시작. A는 §2.2 응답 구조 + §2.4 필터 화이트리스트 + §3.2 와이어프레임 명세 그대로 작성. B 머지 전엔 라이브 동작 검증 불가, 화면 구조·이벤트 핸들러까지 작성.

### 5.2 머지 순서

```
1. B push + A push (평행, 어느 쪽이 먼저 와도 OK)
2. B 머지 → main push
3. Netlify 배포 1~3분
4. 메인이 Swain께 마이그 호출 안내:
   /api/migrate-phase10-recipient-groups?run=1
5. Swain 응답 success 보고 → 메인이:
   - schema 정의 활성화 (현재 주석 → 정상 코드)
   - migrate-phase10-recipient-groups.ts 삭제
   → push
6. A 머지 → main push
7. C verify 트리거 → C 검증·fix push → 메인 머지 → 라운드 마감
```

### 5.3 신규 환경변수

없음. 본 라운드는 외부 API·키 사용 0.

### 5.4 R1과 동시 진행 시 충돌 가능 영역

- `db/schema.ts` — R1과 R2가 같이 진행되지 않음(R1 코드 100% 머지 완료) → 충돌 0
- `public/admin.html` — 사이드바 메뉴 추가 — R1이 이미 [📝 발송 템플릿] 추가, R2는 그 다음 줄에 [👥 수신자 그룹] 추가 → 같은 영역 변경이라 A는 origin/main 최신 fetch 후 작업 권장

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용)

### 6.1 메인 — 본 설계서가 산출물 (생략)

### 6.2 B 채팅 — 백 구현

```
[B — Phase 10 R2 백 구현 (수신자 그룹 선택)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase10-r2-back (베이스 origin/main 최신)
정독 (필수):
  - docs/milestones/2026-05-11-phase10-r2-recipient-groups.md §1·§2
  - PARALLEL_GUIDE §1.5(자동 진행)·§1.6(진행률 보고)·§3(영역)·§7(자체 검증)·§10(사고)

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example
금지: public/, assets/

세팅:
  cd ../tbfa-mis-B
  git fetch origin
  git checkout -b feature/phase10-r2-back origin/main

작업 순서:
  1) lib/recipient-resolve.ts (§2.3·§2.4)
     - resolveRecipients: criteria → 회원 ID/정보 (filter·manual 분기, EXISTS 서브쿼리)
     - summarizeCriteria: 사람이 읽기 쉬운 한 줄 요약
     - validateCriteria: 화이트리스트 검증
  2) netlify/functions/migrate-phase10-recipient-groups.ts (§1.3 SQL)
     - requireAdmin + GET ?run=1 + 멱등 + 시드 5종
     - ※ 시드 4번(gradeCode honor/lifetime) 실행 전 member_grades.code 한 번 SELECT 점검 → 어긋나면 시드 4번 일시 제외
  3) db/schema.ts §1.1 정의 추가 (주석 상태 — 마이그 후 메인이 활성화)
     ※ import 라인 사용 타입 모두 — 기존 import에 모두 포함됨 (검증)
  4) API 함수 7종 (§2.1, migrate 제외) — §2.2 명세 그대로
     - admin-recipient-groups-list / detail / create / update / delete / preview / members
     - 권한·검증·응답 구조·에러 step·detail·stack
     - 화이트리스트 외 필터 거부 (validate step)
  5) `npx tsc --noEmit` 통과 후 push
     ※ 누적 타입 에러 149건은 기존, 신규 코드만 0이면 OK

머지 전 체크 (CLAUDE.md §6 + §13):
  - export const config = { path } 8개 누락 0
  - requireAdmin 반환 auth.res 패턴
  - 응답 키 다중 fallback
  - try/catch step·detail·stack
  - schema import 회귀 0
  - filter·manual 분기 모두 검증

진행률 보고 (PARALLEL_GUIDE §1.6):
  - lib/recipient-resolve.ts 완료 시 1회
  - 마이그 함수 + schema 완료 시 1회
  - API 7종 완료 + tsc 통과 시 1회
  - 형식: "현재 X% 완료 — {다음 단계}"

push 후 메인 보고: 브랜치명·커밋 해시·변경 파일 요약·tsc 결과.
```

### 6.3 A 채팅 — 프론트 구현

```
[A — Phase 10 R2 프론트 구현 (수신자 그룹 선택)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase10-r2-front (베이스 origin/main 최신)
정독 (필수):
  - docs/milestones/2026-05-11-phase10-r2-recipient-groups.md §3
  - 응답 구조: 같은 설계서 §2.2
  - 화이트리스트(필드별 op·값): 같은 설계서 §2.4
  - PARALLEL_GUIDE §1.5(자동 진행)·§1.6(진행률 보고)·§3(영역)

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, .env.example

모드: 평행 — B와 동시 진행. 실 API 명세대로 작성, mock 사용 X.
주의: B 미머지 상태라 라이브 동작 검증은 머지 후. 화면 구조·폼·이벤트 핸들러까지 모두 작성 후 push.

세팅:
  cd ../tbfa-mis-A
  git fetch origin
  git checkout -b feature/phase10-r2-front origin/main

작업 순서:
  1) public/admin-recipient-groups.html — §3.2 목록 와이어프레임
  2) public/js/admin-recipient-groups.js — §3.3 매핑
     - list·delete·members(모달) API 호출
     - 응답 키 다중 fallback (res.data?.data ?? res.data)
  3) public/admin-recipient-group-edit.html — §3.2 편집 와이어프레임 + 미리보기 모달
  4) public/js/admin-recipient-group-edit.js — 핵심 동작
     - 방식(필터/수동) 라디오 → 빌더 박스 토글
     - 필터 빌더: 필드 선택 → op 옵션 동적 변경(§2.4 화이트리스트 그대로) → 값 입력 칸 동적 변경(셀렉트/텍스트/숫자)
     - 조건 추가/삭제
     - 수동 명단: 회원 검색(`/api/admin-members-search` GET ?q=...) → 결과 클릭 → 추가, 추가된 회원 ID 배열 폼 상태
     - 미리보기 모달: preview API → 인원 수·샘플 5명·warnings 표시
     - 저장: create / update API
  5) public/admin.html 사이드바 운영 그룹의 [📝 발송 템플릿] 다음 줄에
     [👥 수신자 그룹] 메뉴 1줄 추가 (onclick 우회 패턴)
     ※ origin/main 최신 fetch 후 작업 — admin.html은 R1에서 이미 [📝 발송 템플릿] 추가됨
  6) §3.5 캐시버스터 ?v=1
  7) 화면 진입·신규 저장·수정·미리보기·삭제·회원 보기 흐름 자체 점검 후 push

머지 전 체크:
  - §3.2 모든 필드·버튼·라디오 존재
  - §3.4 토스트 문구 정확 일치
  - 방식별 동적 동작(필터 빌더/수동 명단)
  - §2.4 필드별 op·값 동적 변경
  - public/ 외 변경 0
  - 응답 키 다중 fallback
  - HTTP 에러 시 detail 토스트

진행률 보고 (PARALLEL_GUIDE §1.6):
  - 목록 페이지 완료 시 1회
  - 편집 페이지 (필터 빌더 + 수동 명단 토글) 완료 시 1회
  - 미리보기 모달 + 사이드바 + 캐시버스터 완료 시 1회
  - 형식: "현재 X% 완료 — {다음 단계}"

push 후 메인 보고: 브랜치명·커밋 해시·변경 파일 요약.
※ 라이브 검증은 B 머지 + schema 활성화 + A 머지 후 C가 진행하므로 A는 콘솔 에러 0·폼 흐름만 자체 확인.
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase 10 R2 검증·fix (수신자 그룹 선택)]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase10-r2 (베이스 main @ {A 머지 후 커밋})
정독: docs/milestones/2026-05-11-phase10-r2-recipient-groups.md §4
참고: docs/PARALLEL_GUIDE.md §7 검증 책임

세팅:
  cd ../tbfa-mis-C
  git fetch origin
  git checkout -b verify/phase10-r2 origin/main

작업 순서:
  1) §4.1 Q1~Q9 라이브 시나리오 (사용자 동작·결과 기록)
  2) §4.2 회귀 점검 — 어드민 로그인·R1 템플릿 빌더·Phase 8·9 흐름·다른 어드민 화면 2~3개
  3) §4.4 성능 점검 — preview·list 응답 시간
  4) bug 발견 시 fix 커밋 (verify 브랜치) → 메인 보고
  5) 보고서 docs/verify/2026-05-11-phase10-r2.md
     - Q별 PASS/FAIL + 회귀 결과 + 성능 측정값
     - bug 있으면 원인·수정·검증 결과
  6) push → 메인 보고

표현 규칙 (CLAUDE.md §6.14):
  - 함수명·코드 용어 없이 사용자 동작·결과 위주
  - 예) "회원 상태=활성 조건 추가하고 미리보기 → 1250명 표시" (O)
  - 예) "admin-recipient-group-preview POST → memberCount 1250" (X)

진행률 보고 (PARALLEL_GUIDE §1.6):
  - Q1~Q4 완료 시 1회
  - Q5~Q9 + 회귀 점검 완료 시 1회
  - 형식: "현재 X% 완료 — {다음 단계}"

push 후 메인 보고: 브랜치명·커밋 해시·Q1~Q9 PASS/FAIL·회귀·성능 결과.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B push 보고 받음 + A push 보고 받음
- [ ] B 머지 → push → Netlify 배포
- [ ] Swain 마이그 호출 (`/api/migrate-phase10-recipient-groups?run=1`) 응답 success 확인
- [ ] schema 활성화 + 마이그 파일 삭제 → push
- [ ] A 머지 → push
- [ ] 라이브 진입 1차 점검 (페이지 200, 사이드바 메뉴 클릭 가능)
- [ ] C verify 트리거 + 보고 흡수 (Q1~Q9 PASS·회귀 0·성능 OK)
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 Phase 10 R2 진행률 갱신
- [ ] PROJECT_STATE §8 큐에 Q-신규 추가 X (C가 직접 검증하므로)
- [ ] R3 (발송 예약 큐) 설계 시작
