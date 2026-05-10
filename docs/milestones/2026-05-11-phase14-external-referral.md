# Phase 14 — 외부 기관 인계 (External Referral)

> **작성**: 2026-05-11 / 메인 채팅
> **상위 Phase**: Phase 14 외부 기관 인계 ([카탈로그](2026-05-10-phase10-22-catalog.md) §Phase14)
> **추정**: 메인 설계 3h / B 백 6~8h / A 프론트 5~6h / C 검증 2h / 합계 16~19h
> **모드**: 평행 (A·B 동시 시작. A는 mock JSON으로 시작, B 머지 후 실 API 연결)

---

## 0. 요구사항 확정 (Swain 결정 2026-05-11)

| 항목 | 결정 |
|---|---|
| 인계 양식(PDF) 방식 | **기관별 템플릿 편집** — 어드민이 기관별 양식 틀(변수 포함)을 미리 작성, 인계 시 사건 정보가 자동으로 채워져 PDF 생성 |
| 기관 회신 추적 | **어드민 수동 상태 갱신** — 기관에서 전화·이메일 회신 오면 어드민이 직접 상태 변경 + 메모 입력 |
| 인계 대상 신고 유형 | 사건 신고 + 괴롭힘 신고 + 법률 상담 3종 모두 |
| 기관 마스터 관리 | 어드민이 기관명·연락처·담당자·관할 영역 등록·수정·삭제 |
| 양식 변수 치환 | `{{피해자명}}`, `{{신고번호}}`, `{{사건내용}}` 등 중괄호 변수 → 실제 값으로 치환 후 PDF |
| PDF 생성 방식 | 기존 `lib/pdf-receipt.ts` · `lib/pdf-activity-report.ts` 패턴 재사용 (pdf-lib + NotoSansKR) |
| 인계 이력 | 별도 `referralLogs` 테이블에 기록 (멱등·추가 전용) |
| 화면 위치 | admin.html SPA — 🚨 사이렌 관리 그룹 아래 신규 메뉴 2개 (기관 관리 / 인계 이력) |

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블 2개

#### `externalAgencies` (외부 기관 마스터)

```typescript
export const externalAgencies = pgTable("external_agencies", {
  id:           serial("id").primaryKey(),
  name:         varchar("name", { length: 100 }).notNull(),          // 기관명
  agencyType:   varchar("agency_type", { length: 30 }).notNull(),    // 'police'|'education'|'legal'|'other'
  contactName:  varchar("contact_name", { length: 50 }),             // 담당자명
  contactPhone: varchar("contact_phone", { length: 20 }),
  contactEmail: varchar("contact_email", { length: 100 }),
  jurisdiction: varchar("jurisdiction", { length: 100 }),            // 관할 영역 (예: "서울 강남구")
  templateBody: text("template_body"),                               // 양식 본문 (변수 포함 마크다운/텍스트)
  isActive:     boolean("is_active").default(true).notNull(),
  createdBy:    integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});
```

#### `referralLogs` (인계 이력)

```typescript
export const referralLogs = pgTable("referral_logs", {
  id:             serial("id").primaryKey(),
  agencyId:       integer("agency_id").references(() => externalAgencies.id, { onDelete: "set null" }),
  agencyName:     varchar("agency_name", { length: 100 }).notNull(), // 삭제 대비 스냅샷
  sourceType:     varchar("source_type", { length: 20 }).notNull(),  // 'incident'|'harassment'|'legal'
  sourceId:       integer("source_id").notNull(),
  sourceNo:       varchar("source_no", { length: 30 }).notNull(),    // reportNo / consultationNo 스냅샷
  referredBy:     integer("referred_by").references(() => members.id, { onDelete: "set null" }),
  referredAt:     timestamp("referred_at").defaultNow().notNull(),
  pdfStorageKey:  varchar("pdf_storage_key", { length: 300 }),       // R2 저장 키 (선택)
  status:         varchar("status", { length: 20 }).default("sent").notNull(),
                  // 'sent'|'reviewing'|'in_progress'|'completed'|'rejected'
  statusMemo:     text("status_memo"),                               // 어드민 메모
  statusUpdatedBy: integer("status_updated_by").references(() => members.id, { onDelete: "set null" }),
  statusUpdatedAt: timestamp("status_updated_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
});
```

### 1.2 마이그레이션

신규 테이블 2개 — `migrate-phase14-external-referral.ts` 작성 필요.

```sql
-- external_agencies
CREATE TABLE IF NOT EXISTS external_agencies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  agency_type VARCHAR(30) NOT NULL,
  contact_name VARCHAR(50),
  contact_phone VARCHAR(20),
  contact_email VARCHAR(100),
  jurisdiction VARCHAR(100),
  template_body TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- referral_logs
CREATE TABLE IF NOT EXISTS referral_logs (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER REFERENCES external_agencies(id) ON DELETE SET NULL,
  agency_name VARCHAR(100) NOT NULL,
  source_type VARCHAR(20) NOT NULL,
  source_id INTEGER NOT NULL,
  source_no VARCHAR(30) NOT NULL,
  referred_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  referred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  pdf_storage_key VARCHAR(300),
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  status_memo TEXT,
  status_updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  status_updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

> **B 주의**: schema.ts에 컬럼 정의 추가는 Swain 마이그 호출 확인 후 활성화.

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `admin-agency-list.ts` | `/api/admin-agency-list` | GET | requireAdmin | 기관 목록 조회 |
| `admin-agency-upsert.ts` | `/api/admin-agency-upsert` | POST | requireAdmin | 기관 등록·수정 |
| `admin-agency-delete.ts` | `/api/admin-agency-delete` | POST | requireAdmin | 기관 비활성화 (soft delete) |
| `admin-referral-create.ts` | `/api/admin-referral-create` | POST | requireAdmin | 인계 실행 (PDF 생성 + 이력 저장) |
| `admin-referral-list.ts` | `/api/admin-referral-list` | GET | requireAdmin | 인계 이력 목록 |
| `admin-referral-status-update.ts` | `/api/admin-referral-status-update` | POST | requireAdmin | 인계 건 상태·메모 갱신 |
| `admin-referral-pdf.ts` | `/api/admin-referral-pdf` | GET | requireAdmin | 인계 PDF 재다운로드 |

### 2.2 함수 상세

#### `admin-agency-list` (GET)

**쿼리 파라미터**:
```
?agencyType=police|education|legal|other  (선택)
?isActive=true|false                       (선택, 기본: true)
```

**응답**:
```json
{
  "ok": true,
  "agencies": [
    {
      "id": 1,
      "name": "서울강남경찰서",
      "agencyType": "police",
      "contactName": "김철수",
      "contactPhone": "02-1234-5678",
      "contactEmail": "contact@police.go.kr",
      "jurisdiction": "서울 강남구",
      "hasTemplate": true,
      "isActive": true,
      "createdAt": "2026-05-01T00:00:00Z"
    }
  ]
}
```

---

#### `admin-agency-upsert` (POST)

**요청 body**:
```json
{
  "id": 1,              // 없으면 신규 등록, 있으면 수정
  "name": "서울강남경찰서",
  "agencyType": "police",
  "contactName": "김철수",
  "contactPhone": "02-1234-5678",
  "contactEmail": "contact@police.go.kr",
  "jurisdiction": "서울 강남구",
  "templateBody": "수신: {{기관명}}\n발신: (사)교사유가족협의회\n제목: 사건 인계 요청\n\n사건번호: {{신고번호}}\n피해자: {{피해자명}}\n발생일시: {{발생일시}}\n\n사건 내용:\n{{사건내용}}\n\n위 사건을 귀 기관에 인계하오니 검토 부탁드립니다."
}
```

**응답**:
```json
{ "ok": true, "id": 1 }
```

**처리 단계**: `auth` → `validate` (name·agencyType 필수) → `upsert` → 응답

---

#### `admin-referral-create` (POST)

**요청 body**:
```json
{
  "agencyId": 1,
  "sourceType": "incident",
  "sourceId": 42
}
```

**처리 단계**:
1. `auth` — requireAdmin
2. `validate` — agencyId·sourceType·sourceId 필수 검증
3. `select_agency` — agencyId로 기관 조회 (템플릿 포함)
4. `select_source` — sourceType에 따라 incidentReports / harassmentReports / legalConsultations 조회
5. `build_template` — templateBody의 변수 치환 (아래 변수 표 참고)
6. `generate_pdf` — pdf-lib으로 PDF Uint8Array 생성
7. `store_pdf` — R2에 업로드 (`referrals/{sourceType}/{sourceId}/{timestamp}.pdf`)
8. `insert_log` — referralLogs INSERT
9. `download` — PDF를 응답 body로 반환 (`Content-Type: application/pdf`)

**변수 치환 표**:

| 변수 | 치환 값 |
|---|---|
| `{{기관명}}` | agency.name |
| `{{신고번호}}` | report.reportNo 또는 consultation.consultationNo |
| `{{피해자명}}` | isAnonymous=true면 "익명" else reporterName |
| `{{발생일시}}` | occurredAt (포맷: YYYY-MM-DD) |
| `{{사건내용}}` | contentHtml → HTML 태그 제거 후 텍스트 |
| `{{AI요약}}` | aiSummary (없으면 "(AI 분석 없음)") |
| `{{AI심각도}}` | aiSeverity (없으면 "-") |
| `{{인계일시}}` | 현재 시각 (KST) |
| `{{인계담당자}}` | auth.ctx.admin.name |

**응답**: PDF 바이너리 스트림 (Content-Disposition: attachment)

---

#### `admin-referral-list` (GET)

**쿼리 파라미터**:
```
?sourceType=incident|harassment|legal  (선택)
?status=sent|reviewing|in_progress|completed|rejected  (선택)
?agencyId=1                            (선택)
?page=1&limit=20                       (선택, 기본 limit 20)
```

**응답**:
```json
{
  "ok": true,
  "total": 45,
  "logs": [
    {
      "id": 1,
      "agencyName": "서울강남경찰서",
      "sourceType": "incident",
      "sourceNo": "IR-20260501-001",
      "referredAt": "2026-05-01T10:00:00Z",
      "status": "reviewing",
      "statusMemo": "담당자 배정 완료",
      "statusUpdatedAt": "2026-05-03T14:00:00Z"
    }
  ]
}
```

---

#### `admin-referral-status-update` (POST)

**요청 body**:
```json
{
  "referralId": 1,
  "status": "completed",
  "statusMemo": "기관에서 처리 완료 회신받음"
}
```

**응답**: `{ "ok": true }`

**처리 단계**: `auth` → `validate` → `update` (status, statusMemo, statusUpdatedBy, statusUpdatedAt 갱신)

---

#### `admin-referral-pdf` (GET)

**쿼리 파라미터**: `?referralId=1`

R2에서 `pdf_storage_key`로 조회 후 PDF 반환.
R2 키가 없으면 → `referral_logs` 데이터로 PDF 재생성.

---

### 2.3 공통 체크

- [x] 모든 함수 `export const config = { path: "/api/admin-xxx" }`
- [x] requireAdmin 반환 `auth.res`
- [x] 보조 SELECT try/catch + 빈 배열 fallback
- [x] `npx tsc --noEmit` 통과 후 push
- [x] schema.ts import에 `serial`, `varchar`, `text`, `boolean`, `integer`, `timestamp` 누락 없이

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 위치 | 진입점 | 권한 |
|---|---|---|
| `admin.html` SPA 내 `id="adm-agency-mgmt"` | 🚨 사이렌 관리 그룹 > "🏛️ 외부 기관 관리" 메뉴 | 어드민 |
| `admin.html` SPA 내 `id="adm-referral-history"` | 🚨 사이렌 관리 그룹 > "📤 인계 이력" 메뉴 | 어드민 |

사이드바 추가 위치: Phase 13 "📊 신고 통계" 아래.

### 3.2 와이어프레임

#### 섹션 1: `adm-agency-mgmt` (외부 기관 관리)

```
┌─ 외부 기관 관리 ───────────────────────────────────────┐
│  [+ 기관 등록]                                          │
│                                                         │
│  ┌──────┬──────────┬──────┬──────┬──────────┬──────┐   │
│  │ 기관명│ 유형     │ 담당자│ 연락처│ 관할 영역 │ 액션 │   │
│  ├──────┼──────────┼──────┼──────┼──────────┼──────┤   │
│  │서울강│ 경찰     │김철수│02-..│강남구    │[편집]│   │
│  │남경찰│          │      │      │          │[삭제]│   │
│  │서    │          │      │      │          │      │   │
│  └──────┴──────────┴──────┴──────┴──────────┴──────┘   │
└─────────────────────────────────────────────────────────┘

[기관 등록/편집 모달]
┌─ 기관 등록 ────────────────────────────────────────────┐
│ 기관명 *:       [                              ]        │
│ 기관 유형 *:    [경찰 ▼] [교육청 ▼] [법률기관 ▼] [기타] │
│ 담당자명:       [                              ]        │
│ 연락처:         [                              ]        │
│ 이메일:         [                              ]        │
│ 관할 영역:      [                              ]        │
│                                                         │
│ 인계 양식 템플릿:                                        │
│ ┌──────────────────────────────────────────────────┐   │
│ │ 수신: {{기관명}}                                  │   │
│ │ 신고번호: {{신고번호}}                             │   │
│ │ 피해자: {{피해자명}}                               │   │
│ │ ...                                               │   │
│ └──────────────────────────────────────────────────┘   │
│ 사용 가능 변수: {{기관명}} {{신고번호}} {{피해자명}}      │
│                {{발생일시}} {{사건내용}} {{AI요약}}       │
│                {{AI심각도}} {{인계일시}} {{인계담당자}}   │
│                                                         │
│                           [취소] [저장]                 │
└─────────────────────────────────────────────────────────┘
```

#### 섹션 2: `adm-referral-history` (인계 이력)

```
┌─ 인계 이력 ────────────────────────────────────────────┐
│ 신고 유형: [전체 ▼]  상태: [전체 ▼]  [조회]            │
│                                                         │
│ ┌──────┬──────┬──────────┬────────┬──────┬──────────┐  │
│ │신고번호│유형 │기관명    │인계일  │상태  │ 액션     │  │
│ ├──────┼──────┼──────────┼────────┼──────┼──────────┤  │
│ │IR-001│사건  │서울강남  │05-01   │검토중│[상태변경]│  │
│ │      │      │경찰서    │        │      │[PDF재다운]│ │
│ └──────┴──────┴──────────┴────────┴──────┴──────────┘  │
└─────────────────────────────────────────────────────────┘

[상태 변경 모달]
┌─ 인계 상태 변경 ───────────────────────────────────────┐
│ 신고번호: IR-20260501-001                               │
│ 기관: 서울강남경찰서                                     │
│                                                         │
│ 상태:  ○ 발송완료  ● 검토중  ○ 처리중  ○ 완료  ○ 반려  │
│                                                         │
│ 메모:  [기관에서 담당자 배정 완료 회신받음          ]   │
│                                                         │
│                           [취소] [저장]                 │
└─────────────────────────────────────────────────────────┘
```

#### 인계 버튼 — 기존 신고 상세 화면에 추가

기존 `admin-incident-report-detail`, `admin-harassment-report-detail`, `admin-legal-consultation-detail` 화면 하단에 인계 버튼 추가:

```html
<!-- 신고 상세 화면 하단 -->
<button onclick="openReferralModal('incident', reportId)">
  🏛️ 외부 기관 인계
</button>
```

인계 모달:
```
┌─ 외부 기관 인계 ───────────────────────────────────────┐
│ 신고번호: IR-20260501-001                               │
│                                                         │
│ 인계 기관 선택: [서울강남경찰서 ▼]                       │
│                                                         │
│ 양식 미리보기:                                           │
│ ┌──────────────────────────────────────────────────┐   │
│ │ 수신: 서울강남경찰서                               │   │
│ │ 신고번호: IR-20260501-001                         │   │
│ │ 피해자: 홍길동                                     │   │
│ │ ...                                               │   │
│ └──────────────────────────────────────────────────┘   │
│                                                         │
│              [취소] [PDF 생성 및 인계 기록]             │
└─────────────────────────────────────────────────────────┘
```

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 응답 처리 |
|---|---|---|
| 기관 관리 메뉴 진입 | GET `/api/admin-agency-list` | 기관 목록 테이블 렌더 |
| [+ 기관 등록] 클릭 | — | 등록 모달 오픈 |
| 모달 [저장] | POST `/api/admin-agency-upsert` | 성공 시 목록 새로고침 |
| [삭제] 클릭 | POST `/api/admin-agency-delete` | 확인 다이얼로그 후 실행 |
| 신고 상세 [외부 기관 인계] 클릭 | GET `/api/admin-agency-list` | 기관 드롭다운 채움 |
| 기관 선택 시 | 클라이언트 처리 | templateBody 변수 치환 → 미리보기 갱신 |
| [PDF 생성 및 인계 기록] | POST `/api/admin-referral-create` | PDF 다운로드 트리거 + 성공 토스트 |
| 인계 이력 메뉴 진입 | GET `/api/admin-referral-list` | 이력 목록 렌더 |
| [상태변경] 클릭 | — | 상태 변경 모달 오픈 |
| 모달 [저장] | POST `/api/admin-referral-status-update` | 성공 시 목록 새로고침 |
| [PDF 재다운로드] | GET `/api/admin-referral-pdf?referralId=X` | PDF 다운로드 |

### 3.4 JS 파일

| 파일 | 용도 |
|---|---|
| `public/js/admin-agency-mgmt.js` | 신규 — 기관 관리 화면 로직 |
| `public/js/admin-referral.js` | 신규 — 인계 실행·이력 화면 로직 |

admin.html 하단에 추가:
```html
<script src="/js/admin-agency-mgmt.js?v=1"></script>
<script src="/js/admin-referral.js?v=1"></script>
```

### 3.5 토스트 문구

| 상황 | 문구 |
|---|---|
| 기관 등록 성공 | "기관이 등록되었습니다." |
| 기관 수정 성공 | "기관 정보가 수정되었습니다." |
| 기관 삭제 성공 | "기관이 비활성화되었습니다." |
| 인계 성공 | "인계 기록이 저장되었습니다. PDF가 다운로드됩니다." |
| 인계 실패 | "인계 처리에 실패했습니다. {서버 detail}" |
| 상태 변경 성공 | "인계 상태가 갱신되었습니다." |
| 기관 없음 경고 | "등록된 기관이 없습니다. 기관 관리에서 먼저 등록해주세요." |

### 3.6 캐시버스터

| 파일 | 참조 위치 | 버전 |
|---|---|---|
| `public/js/admin-agency-mgmt.js` | admin.html (신규) | `?v=1` |
| `public/js/admin-referral.js` | admin.html (신규) | `?v=1` |

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오 (Q1~Q10)

| # | 시나리오 (사용자 동작) | 기대 동작 |
|---|---|---|
| Q1 | 어드민 로그인 → 🏛️ 외부 기관 관리 메뉴 클릭 | 기관 관리 화면 표시 (처음엔 목록 비어있음) |
| Q2 | [+ 기관 등록] → 기관명·유형·연락처·양식 입력 후 [저장] | 기관 목록에 등록된 기관 표시 |
| Q3 | 등록된 기관 [편집] → 기관명 수정 후 [저장] | 수정된 이름으로 목록 갱신 |
| Q4 | 기존 사건 신고 상세 화면 → [외부 기관 인계] 버튼 클릭 | 인계 모달 열림, 기관 드롭다운에 등록 기관 표시 |
| Q5 | 기관 선택 시 양식 미리보기에 신고번호·피해자명 등이 실제 값으로 치환되어 표시 | {{변수}} 없이 실제 사건 정보로 채워진 미리보기 표시 |
| Q6 | [PDF 생성 및 인계 기록] 클릭 | PDF 다운로드 시작 + "인계 기록이 저장되었습니다" 토스트 |
| Q7 | 📤 인계 이력 메뉴 클릭 | 방금 인계한 건이 목록에 표시 (상태: 발송완료) |
| Q8 | 인계 건 [상태변경] → "검토중" + 메모 입력 후 [저장] | 목록에서 상태·메모 갱신 확인 |
| Q9 | [PDF 재다운로드] 클릭 | 동일 PDF 재다운로드 |
| Q10 | 로그인 없이 `/api/admin-agency-list`, `/api/admin-referral-list` 호출 | 401 응답 |

### 4.2 회귀 점검

- 기존 사건 신고 관리 화면 — 인계 버튼 추가 후 기존 기능(목록·상세·상태변경) 정상 동작 여부
- 기존 괴롭힘 신고 / 법률 상담 화면 — 동일
- admin.html 전체 로드 오류 없음 (JS 추가 후 구문 에러)

### 4.3 백필

- [x] 백필 불필요 — 기관·이력 데이터는 운영 후 자연 누적.

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] 평행 (A는 mock JSON으로 시작, B 머지 후 실 API 연결)

### 5.2 머지 순서

```
1. B push (feature/phase14-back)
   → 메인: migrate-phase14 파일 확인 → Swain 마이그 호출 요청
   → Swain: https://tbfa-siren-cms.netlify.app/api/migrate-phase14-external-referral?run=1
   → 성공 확인 → 메인: schema 활성화 + 마이그 파일 삭제 + B 머지 → push

2. A push (feature/phase14-front)
   → 메인: A 머지 → push
   → A에 "실 API 연결" 신호

3. C 검증 트리거 → C push (verify/phase14) → 메인 머지 → 라운드 마감
```

### 5.3 신규 환경변수

없음.

### 5.4 A mock 응답

```json
{
  "agencies_mock": [
    { "id": 1, "name": "서울강남경찰서", "agencyType": "police", "contactName": "김철수", "contactPhone": "02-1234-5678", "jurisdiction": "서울 강남구", "hasTemplate": true, "isActive": true }
  ],
  "referral_list_mock": {
    "ok": true, "total": 2,
    "logs": [
      { "id": 1, "agencyName": "서울강남경찰서", "sourceType": "incident", "sourceNo": "IR-20260501-001", "referredAt": "2026-05-01T10:00:00Z", "status": "reviewing", "statusMemo": "담당자 배정 완료" }
    ]
  }
}
```

---

## 6. 4채팅 시작 프롬프트

### 6.1 B 채팅 — 백 구현

```
[B — Phase 14 외부 기관 인계 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase14-back (베이스 main 최신 커밋)
정독 (필수): docs/milestones/2026-05-11-phase14-external-referral.md §1·§2
참고: docs/PARALLEL_GUIDE.md §3

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

핵심 정보:
- 신규 테이블 2개: externalAgencies, referralLogs (§1.1 DDL 그대로)
- 마이그레이션 파일 작성 필수: netlify/functions/migrate-phase14-external-referral.ts
- schema.ts 컬럼 정의는 Swain 마이그 호출 확인 후 추가 (먼저 추가 금지)
- PDF 생성: lib/pdf-receipt.ts 패턴 참고 (pdf-lib + NotoSansKR 폰트)
- 변수 치환: templateBody의 {{변수}} → 실제 값 replace (§2.2 변수 치환 표)
- 신규 함수 7개 (§2.1 목록 그대로)
- R2 업로드: lib/r2-server.ts 패턴 참고

작업 순서:
  1) migrate-phase14-external-referral.ts 작성
  2) 신규 함수 7개 작성
  3) npx tsc --noEmit 통과
  4) push → 메인에 보고

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.2 A 채팅 — 프론트 구현

```
[A — Phase 14 외부 기관 인계 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase14-front (베이스 main 최신 커밋)
정독 (필수): docs/milestones/2026-05-11-phase14-external-referral.md §3
참고: docs/PARALLEL_GUIDE.md §3

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

모드: 평행 mock — §5.4 mock 데이터로 먼저 구현. B 머지 후 실 API 연결 신호 받으면 교체.

작업 대상:
  1) public/admin.html
     - 사이드바 "🏛️ 외부 기관 관리" + "📤 인계 이력" 메뉴 추가
       (위치: 🚨 사이렌 관리 그룹, 신고 통계 아래)
     - 섹션 div 2개 추가: adm-agency-mgmt, adm-referral-history
     - 기존 신고 상세 섹션(adm-siren-incident-detail 등)에 [외부 기관 인계] 버튼 추가
  2) public/js/admin-agency-mgmt.js — 신규 (§3.2 기관 관리 화면)
  3) public/js/admin-referral.js — 신규 (§3.2 인계 이력 + 인계 모달)

인계 모달 핵심:
  - 기관 드롭다운 선택 시 templateBody 불러와 {{변수}} 를 실제 신고 데이터로 replace
  - 미리보기 textarea에 치환 결과 표시 (편집 가능)
  - [PDF 생성 및 인계 기록] → POST /api/admin-referral-create → 응답 blob을 <a> 다운로드

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.3 C 채팅 — 검증·fix

```
[C — Phase 14 외부 기관 인계 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase14 (베이스 main @ B+A 머지 후 커밋)
정독: docs/milestones/2026-05-11-phase14-external-referral.md §4

작업 순서:
  1) §4.1 Q1~Q10 라이브 시나리오 순서대로 실행·기록
  2) §4.2 회귀 점검
  3) bug 발견 시 fix 커밋 → 메인 보고
  4) 보고서 docs/verify/2026-05-11-phase14.md 작성
  5) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
금지: PROJECT_STATE.md, docs/HANDOFF.md, docs/ 수정.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] **B push 후 머지 전**: B 응답 키와 A mock 키 1:1 대조 (§2.2 응답 구조 ↔ §5.4 mock JSON 키명 일치 확인)
- [ ] Swain 마이그 호출 성공 확인
- [ ] B `feature/phase14-back` 머지 완료
- [ ] schema.ts externalAgencies·referralLogs 정의 활성화
- [ ] 마이그 파일 삭제 + push
- [ ] A `feature/phase14-front` 머지 완료 (실 API 연결 확인)
- [ ] C `verify/phase14` 머지 완료
- [ ] C 보고서 `docs/verify/2026-05-11-phase14.md` push 완료
- [ ] Q1~Q10 모두 PASS
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 Phase 14 진행률 갱신
- [ ] HANDOFF.md 갱신
