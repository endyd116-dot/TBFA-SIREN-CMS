# Phase 26 — 근태관리 시스템 핵심 설계서

> 작성: 2026-05-19 메인
> 명세서 원본: `docs/근태관리시스템_명세서.md`
> 범위: Step 1~8 (핵심 출퇴근·정책·휴가·결재)

---

## §0. 배경 및 범위

| 항목 | 내용 |
|---|---|
| Phase | 26 |
| 목적 | GPS 기반 출퇴근 기록, 근무형태 스케줄, 휴가 신청·결재, 수정 요청 |
| 미포함 (→ Phase 27) | 재택 보고서 AI 초안, Gemini 흐름 파악, 자동 연차 부여, cron 알림, 급여 export |
| 지도 API | Kakao Map REST API (Geocoding) — `KAKAO_REST_API_KEY` 환경변수 |
| 역할 매핑 | `super_admin` = 슈퍼어드민(전체 권한), `admin`/`operator` = 직원(본인만) |
| WBS 연동 | Phase 27에서 재택 출근 시 WBS 카드 자동생성 (첫 번째 보드 첫 컬럼) |

---

## §1. DB 스키마 (10개 신규 테이블)

### §1.1 att_workplaces — 거점

```sql
id          SERIAL PRIMARY KEY
name        VARCHAR(100) NOT NULL            -- 거점명 (예: 본사, 클라이언트 A사)
type        VARCHAR(20)  NOT NULL            -- 'OFFICE' | 'FIELD'
address     TEXT                             -- 주소
lat         NUMERIC(10,7)                    -- 위도
lng         NUMERIC(10,7)                    -- 경도
radius      INTEGER      DEFAULT 50          -- 허용 반경 (미터)
is_active   BOOLEAN      DEFAULT true
created_at  TIMESTAMP    DEFAULT now()
updated_at  TIMESTAMP    DEFAULT now()
```

### §1.2 att_policies — 근무 정책 (1~2개 레코드, is_default=true 1개)

```sql
id                      SERIAL PRIMARY KEY
name                    VARCHAR(100) NOT NULL
check_in_time           TIME         DEFAULT '09:00'
check_out_time          TIME         DEFAULT '18:00'
late_grace_mins         INTEGER      DEFAULT 10      -- 허용 지각 분
early_leave_grace_mins  INTEGER      DEFAULT 10      -- 허용 조퇴 분
daily_hours             NUMERIC(4,2) DEFAULT 8
break_mins              INTEGER      DEFAULT 60
break_threshold_hours   NUMERIC(4,2) DEFAULT 4       -- 휴게 차감 기준 시간
weekly_max_hours        INTEGER      DEFAULT 52
core_start_time         TIME         DEFAULT '10:00'
core_end_time           TIME         DEFAULT '16:00'
flex_enabled            BOOLEAN      DEFAULT false
remote_max_per_month    INTEGER      DEFAULT 10       -- 월 최대 재택 일수
is_default              BOOLEAN      DEFAULT false
created_at              TIMESTAMP    DEFAULT now()
updated_at              TIMESTAMP    DEFAULT now()
```

### §1.3 att_leave_types — 휴가 종류

```sql
id               SERIAL PRIMARY KEY
name             VARCHAR(100) NOT NULL
is_paid          BOOLEAN      DEFAULT true
unit             VARCHAR(10)  DEFAULT 'day'   -- 'day' | 'hour'
requires_approval BOOLEAN     DEFAULT true
default_days     NUMERIC(5,2) DEFAULT 0
is_active        BOOLEAN      DEFAULT true
display_order    INTEGER      DEFAULT 0
created_at       TIMESTAMP    DEFAULT now()
updated_at       TIMESTAMP    DEFAULT now()
```

### §1.4 att_leave_balances — 직원별 휴가 잔여

```sql
id            SERIAL PRIMARY KEY
member_uid    VARCHAR(36)  NOT NULL            -- FK members.uid
leave_type_id INTEGER      NOT NULL            -- FK att_leave_types.id
year          INTEGER      NOT NULL
total_days    NUMERIC(5,2) DEFAULT 0
used_days     NUMERIC(5,2) DEFAULT 0
UNIQUE(member_uid, leave_type_id, year)
```

### §1.5 att_leave_requests — 휴가 신청

```sql
id            SERIAL PRIMARY KEY
member_uid    VARCHAR(36)  NOT NULL
leave_type_id INTEGER      NOT NULL
start_date    DATE         NOT NULL
end_date      DATE         NOT NULL
days          NUMERIC(5,2) NOT NULL
reason        TEXT
status        VARCHAR(20)  DEFAULT 'PENDING'   -- PENDING|APPROVED|REJECTED
reviewed_by   VARCHAR(36)                      -- FK members.uid
review_note   TEXT
created_at    TIMESTAMP    DEFAULT now()
updated_at    TIMESTAMP    DEFAULT now()
```

### §1.6 att_schedules — 직원별 근무형태 (반복 규칙)

```sql
id              SERIAL PRIMARY KEY
member_uid      VARCHAR(36)  NOT NULL
work_mode       VARCHAR(30)  NOT NULL            -- OFFICE|REMOTE|FIELD|BUSINESS_TRIP|HYBRID
recurring_rule  JSONB                            -- { "mon":"REMOTE","tue":"OFFICE",... } HYBRID 전용
start_date      DATE         NOT NULL
end_date        DATE                             -- NULL = 무기한
workplace_id    INTEGER                          -- FK att_workplaces.id (FIELD 시)
note            TEXT
created_by      VARCHAR(36)
created_at      TIMESTAMP    DEFAULT now()
updated_at      TIMESTAMP    DEFAULT now()
```

### §1.7 att_schedule_overrides — 단발성 재정의 (반복 규칙보다 우선)

```sql
id            SERIAL PRIMARY KEY
member_uid    VARCHAR(36)  NOT NULL
date          DATE         NOT NULL
work_mode     VARCHAR(30)  NOT NULL
workplace_id  INTEGER                    -- FK att_workplaces.id
reason        TEXT
created_by    VARCHAR(36)
created_at    TIMESTAMP    DEFAULT now()
UNIQUE(member_uid, date)
```

### §1.8 att_records — 출퇴근 기록 (일별 1건)

```sql
id                   SERIAL PRIMARY KEY
member_uid           VARCHAR(36)  NOT NULL
date                 DATE         NOT NULL
work_mode            VARCHAR(30)
status               VARCHAR(30)  DEFAULT 'NORMAL'  -- NORMAL|LATE|EARLY_LEAVE|ABSENT|LEAVE|HOLIDAY|PARTIAL_LEAVE
check_in_time        TIMESTAMP
check_in_lat         NUMERIC(10,7)
check_in_lng         NUMERIC(10,7)
check_in_ip          VARCHAR(50)                    -- 재택 IP 기록
check_out_time       TIMESTAMP
check_out_lat        NUMERIC(10,7)
check_out_lng        NUMERIC(10,7)
workplace_id         INTEGER                        -- FK att_workplaces.id
working_mins         INTEGER                        -- 실 근무시간 (분)
overtime_mins        INTEGER     DEFAULT 0          -- 야근 시간 (분)
is_manually_adjusted BOOLEAN     DEFAULT false
note                 TEXT
created_at           TIMESTAMP   DEFAULT now()
updated_at           TIMESTAMP   DEFAULT now()
UNIQUE(member_uid, date)
```

### §1.9 att_corrections — 출퇴근 수정 요청

```sql
id                    SERIAL PRIMARY KEY
member_uid            VARCHAR(36)  NOT NULL
target_date           DATE         NOT NULL
correction_type       VARCHAR(20)  NOT NULL  -- 'CHECK_IN'|'CHECK_OUT'|'BOTH'
requested_check_in    TIMESTAMP
requested_check_out   TIMESTAMP
reason                TEXT
evidence_url          TEXT                   -- R2 업로드 증빙
status                VARCHAR(20)  DEFAULT 'PENDING'
reviewed_by           VARCHAR(36)
review_note           TEXT
created_at            TIMESTAMP    DEFAULT now()
updated_at            TIMESTAMP    DEFAULT now()
```

### §1.10 att_holidays — 공휴일·회사 휴무일

```sql
id          SERIAL PRIMARY KEY
date        DATE         NOT NULL UNIQUE
name        VARCHAR(100) NOT NULL
type        VARCHAR(20)  DEFAULT 'PUBLIC'   -- 'PUBLIC'|'COMPANY'
created_at  TIMESTAMP    DEFAULT now()
```

---

## §2. 공용 유틸리티 — `lib/att-utils.ts`

```typescript
// 1. Haversine 거리 계산 (미터)
haversineDistance(lat1, lng1, lat2, lng2): number

// 2. 반경 이내 여부
isWithinRadius(userLat, userLng, placeLat, placeLng, radiusM): boolean

// 3. 오늘 근무형태 결정 (override > schedule > 기본 OFFICE)
getScheduledWorkMode(memberUid, date, db): Promise<WorkModeResult>
// WorkModeResult = { mode, workplaceId?, recurring_rule? }

// 4. 근무시간 계산 (휴게시간 차감)
calcWorkingMins(checkIn: Date, checkOut: Date, policy): number

// 5. 지각·조퇴·결근 판정
determineStatus(checkInTime, checkOutTime, policy, isLeave, isHoliday): AttendanceStatus

// 6. 이번 달 재택 일수 카운트 (월 한도 검증)
countRemoteDaysThisMonth(memberUid, year, month, db): Promise<number>
```

---

## §3. API 목록 (20개)

### 슈퍼어드민 전용 (requireAdmin + super_admin 체크)

| # | 경로 | 메서드 | 기능 |
|---|---|---|---|
| 1 | `/api/admin-att-workplaces` | GET | 거점 목록 |
| 2 | `/api/admin-att-workplaces` | POST | 거점 생성 |
| 3 | `/api/admin-att-workplaces` | PUT | 거점 수정 (?id=) (R29-GAP-P1·M-G5 정합 — 복수형으로 통일) |
| 4 | `/api/admin-att-workplaces` | DELETE | 거점 삭제 (?id=) |
| 5 | `/api/admin-att-policy` | GET | 근무 정책 조회 |
| 6 | `/api/admin-att-policy` | PUT | 근무 정책 수정 |
| 7 | `/api/admin-att-leave-types` | GET/POST/PUT/DELETE | 휴가 종류 CRUD (DELETE는 R34-P2 soft delete — 사용 이력 있을 때 is_active=false) |
| 8 | `/api/admin-att-schedules` | GET/POST/PUT/DELETE | 직원 스케줄 조회·등록·수정·삭제 (R34-P2: PUT·DELETE 추가) |
| 9 | `/api/admin-att-records` | GET | 전체 근태 현황 (?date=&status=) — summary는 status·work_mode 양쪽 집계 (R34-P2) |
| 10 | `/api/admin-att-leave-review` | GET/POST | GET: 대기/처리 목록, POST: 승인/반려 (R34-P2: GET 명시) |
| 11 | `/api/admin-att-correction-review` | GET/POST | GET: 대기/처리 목록, POST: 승인/반려 |
| 12 | `/api/admin-att-holidays` | GET/POST/DELETE | 공휴일 CRUD |
| 13 | `/api/admin-att-leave-balances` | GET/PUT | 직원별 잔여휴가 조회·조정 |

### 직원 (requireActiveUser)

| # | 경로 | 메서드 | 기능 |
|---|---|---|---|
| 14 | `/api/att-schedule-today` | GET | 오늘 근무형태·거점 조회 |
| 15 | `/api/att-checkin` | POST | 출근 (GPS 검증 + 지각 판정) |
| 16 | `/api/att-checkout` | POST | 퇴근 (근무시간 계산 + 조퇴 판정) |
| 17 | `/api/att-my-status` | GET | 오늘 상태 + 이번달 요약 |
| 18 | `/api/att-my-calendar` | GET | 월별 근태 캘린더 (?year=&month=) |
| 19 | `/api/att-my-stats` | GET | 주·월·연 통계 |
| 20 | `/api/att-leave-request` | POST/GET | 휴가 신청 + 본인 신청 내역 |
| 21 | `/api/att-my-leaves` | GET | 잔여 휴가 현황 |
| 22 | `/api/att-correction-request` | POST/GET | 수정 요청 + 내역 |

### 공통 (실제로는 super_admin 전용 — R35-GAP-P2 P-G1 명시)

| # | 경로 | 메서드 | 권한 | 기능 |
|---|---|---|---|---|
| 23 | `/api/att-geocode` | POST | super_admin | 주소 → 위도/경도 (Kakao REST API 프록시, 거점 등록 시 사용) |
| 24 | `/api/att-geocode-search` | GET  | super_admin | 주소 검색 (다중 결과·거점 등록 화면) |

> 총 24개 API (함수 파일은 메서드 통합으로 19개). `att-geocode`·`att-geocode-search` 모두 슈퍼어드민 전용 — 거점 관리 화면이 유일한 호출처.

---

## §4. 프론트엔드 구조

### §4.1 신규 파일

#### `public/workspace-attendance.html` — 직원 근태 메인

탭 구성:
- **[출퇴근]**: 오늘 날짜·근무형태 아이콘, 큰 출근/퇴근 버튼, 이번달 요약 카드
- **[내 캘린더]**: FullCalendar 월별 뷰, 날짜별 색상 (정상🟢/지각🟡/결근🔴/휴가🔵/재택🟣/외근🟠/휴일⬜)
- **[통계]**: 이번 달 근무일수·시간·지각 횟수·재택 일수 Chart.js
- **[휴가]**: 잔여 휴가 현황 + 신청 폼 + 신청 내역
- **[수정 요청]**: 출퇴근 수정 요청 폼 + 내역

#### `public/workspace-attendance.css`
#### `public/js/workspace-attendance.js`

#### `public/admin-workspace-management.html` — 슈퍼어드민 워크스페이스 관리

탭 구성:
- **[근태 현황]**: 오늘 현황 카드 + 미출근 알림 + 대기 요청 목록 + 직원별 요약 테이블
- **[직원 스케줄]**: 직원 선택 → 기본 근무형태 + 하이브리드 반복 규칙 + 단발성 재정의
- **[거점 관리]**: 거점 목록(지도 좌표 표시) + CRUD + Kakao 주소 검색
- **[근무 정책]**: 기준 출퇴근·지각허용·휴게 등 설정 폼
- **[휴가 종류]**: 휴가 종류 테이블 + CRUD
- **[공휴일]**: 연도별 공휴일 목록 + 수동 등록

#### `public/js/admin-workspace-management.js`

### §4.2 수정 파일 — 사이드바 (7개)

`workspace.html`, `workspace-kanban.html`, `workspace-calendar.html`,
`workspace-templates.html`, `workspace-files.html`, `workspace-milestones.html`,
`admin-hub.html`

각 워크스페이스 사이드바에 추가:
```html
<li><a href="/workspace-attendance.html" title="근태관리">
  <span class="ws-nav-icon">🕐</span>
  <span class="ws-nav-text">근태관리</span>
</a></li>
```

`admin-hub.html`에 "워크스페이스 관리" 카드 추가 (super_admin 전용):
```html
<!-- 워크스페이스 관리 섹션 -->
<a href="/admin-workspace-management.html" class="hub-card">
  <span>🏢</span> 워크스페이스 관리
  <small>근태·거점·정책·직원 스케줄</small>
</a>
```

---

## §5. 출근 로직 상세 (GPS 검증)

```
출근 요청
  └─ att-schedule-today API로 오늘 근무형태 조회
  └─ OFFICE 또는 FIELD → GPS 좌표 전송 필수
  └─ REMOTE / BUSINESS_TRIP → GPS 없이 바로 기록
  
OFFICE:
  - att_workplaces WHERE type='OFFICE' 목록 조회
  - 가장 가까운 거점과 haversine 거리 계산
  - radius 이내 → 출근 기록
  - radius 초과 → 400 오류 "사무실 반경 ${d}m 초과"
  
FIELD:
  - 오늘 스케줄의 workplace_id로 거점 좌표 조회
  - 동일 haversine 검증
  
공통 마무리:
  - att_records UPSERT (같은 날 이미 출근 기록 있으면 409)
  - check_in_ip 기록 (X-Forwarded-For 헤더)
  - 기준 출근 시각 + late_grace_mins 초과 → status='LATE'
```

---

## §6. 분담

| 담당 | 작업 |
|---|---|
| **메인** | schema.ts 10테이블, migrate-phase26-attendance.ts, lib/att-utils.ts, 설계서, A·B·C 트리거 |
| **A (프론트)** | workspace-attendance.html + .css + .js, admin-workspace-management.html + .js, 사이드바 7개 수정 |
| **B (백)** | API 18개 파일 (23 엔드포인트), lib/att-utils.ts 완성 |
| **C (검증)** | 15개 시나리오 정적 검증 |

---

## §7. A 트리거

**[Phase 26 — 근태관리 프론트엔드]**

영역: 프론트엔드 전용. DB 스키마·API는 B 담당.

**베이스 브랜치**: `main` @ `bf9a4bb`
**작업 브랜치**: `feature/phase26-att-frontend`
**작업 디렉토리**: `../tbfa-mis-A`

[자율주행 정책]
- push·설계·로직 결정만 묻기. Read·Edit·Write·git add/commit·bash 명령은 자율 진행.
- 금지: force push, hard reset, lib/auth.ts·admin-guard.ts 수정

---

### 체크리스트

- [ ] **§A-1** `workspace-attendance.html` — 직원 근태 메인 페이지 (5탭)
  - 탭: [출퇴근] [내 캘린더] [통계] [휴가] [수정 요청]
  - 출퇴근 탭: 오늘 날짜·근무형태 아이콘(🏢/🏠/🚗/✈️), 큰 버튼(출근중/퇴근중 상태 동적), 이번달 요약 카드
  - 캘린더 탭: FullCalendar 월별 뷰, 날짜별 배경색 (NORMAL=초록, LATE=노랑, ABSENT=빨강, LEAVE=파랑, REMOTE=보라, FIELD=주황, HOLIDAY=회색)
  - 통계 탭: 이번 달 근무일수·총 근무시간·지각 횟수·재택 일수 숫자 카드 + Chart.js 도넛 (근무형태 분포)
  - 휴가 탭: 잔여 휴가 현황 테이블 (종류·부여·사용·잔여) + 신청 폼 + 신청 내역
  - 수정 요청 탭: 출퇴근 누락 수정 폼 + 내역 목록

- [ ] **§A-2** `workspace-attendance.css` — 전용 CSS
  - 큰 출근/퇴근 버튼 스타일 (모바일 우선, 최소 80px 높이)
  - 색상 코드: `--att-normal:#22c55e / --att-late:#f59e0b / --att-absent:#ef4444 / --att-leave:#3b82f6 / --att-remote:#8b5cf6 / --att-field:#f97316 / --att-holiday:#9ca3af`
  - 근무형태 배지 컴포넌트 (.att-mode-badge)
  - 이번달 요약 카드 (.att-summary-grid)

- [ ] **§A-3** `public/js/workspace-attendance.js`
  - `api()` 헬퍼 활용. 응답 키 다중 fallback (`res.data.data || res.data || res`)
  - 오늘 근무형태 조회 → 버튼 텍스트/색상 동적 설정
  - 출근 버튼 클릭 → `navigator.geolocation.getCurrentPosition()` → POST `/api/att-checkin`
    - REMOTE/BUSINESS_TRIP: GPS 없이 바로 요청
    - OFFICE/FIELD: GPS 성공 시 요청, 실패 시 "위치 정보를 허용해주세요" 토스트
  - 퇴근 버튼도 동일 패턴
  - 캘린더: FullCalendar CDN, `dayCellDidMount`로 날짜별 색상 적용
  - 통계: Chart.js 도넛 차트
  - 캐시버스터: `?v=1`

- [ ] **§A-4** `admin-workspace-management.html` — 슈퍼어드민 워크스페이스 관리
  - super_admin 권한 체크 (첫 API 401/403으로 판정, admin.js 패턴)
  - 6탭: [근태 현황] [직원 스케줄] [거점 관리] [근무 정책] [휴가 종류] [공휴일]

- [ ] **§A-5** `public/js/admin-workspace-management.js`
  - 근태 현황 탭: 오늘 날짜 현황 카드(전체/사무실/재택/외근/휴가 수) + 대기 요청 목록(휴가신청·수정요청)
  - 직원 스케줄 탭: 직원 드롭다운 선택 → 근무형태 설정 폼 (기본 모드 + HYBRID일 때 요일별 설정)
  - 거점 관리 탭: 거점 테이블 + CRUD 모달 + 주소 입력 → POST `/api/att-geocode`로 좌표 변환 표시
  - 근무 정책 탭: 숫자 입력폼 (기준 출근 시각, 허용 지각, 유연근무 등)
  - 휴가 종류 탭: 테이블 + 인라인 CRUD
  - 공휴일 탭: 연도 선택 + 목록 + 날짜/이름 입력 등록
  - 캐시버스터: `?v=1`

- [ ] **§A-6** 워크스페이스 사이드바 7개 파일에 "근태관리" 메뉴 추가
  - workspace.html, workspace-kanban.html, workspace-calendar.html, workspace-templates.html, workspace-files.html, workspace-milestones.html
  - 위치: `<li><a href="/workspace-files.html"...>` 다음 줄
  - 아이콘 🕐, 텍스트 "근태관리", href="/workspace-attendance.html"

- [ ] **§A-7** `admin-hub.html`에 "워크스페이스 관리" 카드 추가
  - super_admin만 보이는 카드 (JS에서 role 확인 후 show/hide)
  - 아이콘 🏢, 텍스트 "워크스페이스 관리", href="/admin-workspace-management.html"

**완료 후**: `feature/phase26-att-frontend` 브랜치 push. 메인에 "A 완료, 머지 요청" 메시지.

---

## §8. B 트리거

**[Phase 26 — 근태관리 백엔드]**

영역: 백엔드 전용. 프론트엔드는 A 담당.

**베이스 브랜치**: `main` @ `bf9a4bb`
**작업 브랜치**: `feature/phase26-att-backend`
**작업 디렉토리**: `../tbfa-mis-B`

[자율주행 정책]
- push·설계·로직 결정만 묻기. Read·Edit·Write·git add/commit·bash 명령은 자율 진행.
- 금지: force push, hard reset, lib/auth.ts·admin-guard.ts 수정

---

### 전제사항

- 마이그레이션은 메인이 이미 실행(`migrate-phase26-attendance?run=1` 완료 후 B 시작)
- `lib/att-utils.ts`는 메인이 기본 틀 제공. B가 완성.
- `requireActiveUser`: `lib/auth.ts`에서 import
- `requireAdmin`: `lib/admin-guard.ts`에서 import, 반환 `auth.res` (response 아님)
- super_admin 체크: `auth.member.role !== 'super_admin'` → 403

### 체크리스트

- [ ] **§B-1** `lib/att-utils.ts` 완성
  - `haversineDistance(lat1, lng1, lat2, lng2): number` — 미터 단위
  - `isWithinRadius(userLat, userLng, placeLat, placeLng, radiusM): boolean`
  - `getScheduledWorkMode(memberUid: string, date: string, db): Promise<WorkModeResult>` — override → schedule → 기본 OFFICE
  - `calcWorkingMins(checkIn: Date, checkOut: Date, policy): number` — 휴게시간 차감
  - `determineStatus(checkIn?, checkOut?, policy, isLeave, isHoliday): string` — NORMAL/LATE/EARLY_LEAVE/ABSENT

- [ ] **§B-2** 슈퍼어드민 거점 API
  - `GET/POST /api/admin-att-workplaces` — 목록 조회, 신규 생성
  - `PUT/DELETE /api/admin-att-workplace` — `?id=` 수정, 삭제

- [ ] **§B-3** 슈퍼어드민 근무 정책 API
  - `GET/PUT /api/admin-att-policy` — is_default=true 정책 조회·수정

- [ ] **§B-4** 슈퍼어드민 휴가 종류 API
  - `GET/POST/PUT/DELETE /api/admin-att-leave-types`

- [ ] **§B-5** 슈퍼어드민 직원 스케줄 API
  - `POST /api/admin-att-schedules` — 반복 스케줄 등록 (work_mode, recurring_rule, start_date, end_date)
  - `POST /api/admin-att-schedule-override` — 단발성 재정의
  - `GET /api/admin-att-schedules` — 직원별 스케줄 목록 (`?memberUid=`)

- [ ] **§B-6** 슈퍼어드민 근태 현황 API
  - `GET /api/admin-att-records` — 날짜별 전체 현황 (`?date=YYYY-MM-DD&status=`)
  - 오늘 현황 집계: 출근·재택·외근·미출근·휴가 각 count 포함

- [ ] **§B-7** 슈퍼어드민 결재 API
  - `POST /api/admin-att-leave-review` — `{ requestId, action: 'APPROVED'|'REJECTED', note }`
    - APPROVED 시 att_leave_balances used_days 차감
  - `POST /api/admin-att-correction-review` — `{ requestId, action, note }`
    - APPROVED 시 att_records 해당 필드 업데이트 + is_manually_adjusted=true

- [ ] **§B-8** 슈퍼어드민 공휴일 API
  - `GET/POST/DELETE /api/admin-att-holidays` — 연도별 조회, 등록, 삭제

- [ ] **§B-9** 슈퍼어드민 잔여휴가 API
  - `GET /api/admin-att-leave-balances` — 전체 직원 잔여 목록 (`?year=`)
  - `PUT /api/admin-att-leave-balances` — 수동 조정

- [ ] **§B-10** 직원 오늘 근무형태 API
  - `GET /api/att-schedule-today` — `getScheduledWorkMode()` 호출, 거점 정보 포함 반환

- [ ] **§B-11** 직원 출근 API
  - `POST /api/att-checkin`
  - body: `{ lat?, lng?, workMode? }`
  - OFFICE/FIELD: 거점 조회 → haversine 검증 → 반경 초과 시 400
  - REMOTE/BUSINESS_TRIP: 검증 없이 기록
  - att_records INSERT (UNIQUE 충돌 → 409 "이미 출근 처리됨")
  - check_in_ip: `req.headers.get('x-forwarded-for')` 기록
  - status 판정: 기준 출근 + late_grace_mins 초과 → 'LATE'

- [ ] **§B-12** 직원 퇴근 API
  - `POST /api/att-checkout`
  - body: `{ lat?, lng? }`
  - 출근 기록 없으면 400
  - 위치 정보(lat/lng) 저장만, 별도 거리 검증은 의도된 단순화 (퇴근은 거점 떠난 후 누르는 케이스 정상 — R34-P2 P1 명시)
  - `calcWorkingMins()` → working_mins, overtime_mins 계산
  - 조퇴 판정: 기준 퇴근 - early_leave_grace_mins 미달 → 'EARLY_LEAVE'
  - REMOTE·BUSINESS_TRIP은 coreStartTime 기준 LATE 판정 (R34-P2 M-G7)
  - att_records UPDATE

- [ ] **§B-13** 직원 본인 상태 API
  - `GET /api/att-my-status`
  - 오늘 att_records 레코드 + 이번달 요약 (근무일수, 총 근무시간, 지각 횟수, 재택 일수, 잔여 연차)

- [ ] **§B-14** 직원 캘린더·통계 API
  - `GET /api/att-my-calendar` — `?year=&month=` 월별 att_records 배열
  - `GET /api/att-my-stats` — 월별/주별 집계

- [ ] **§B-15** 직원 휴가 API
  - `POST /api/att-leave-request` — 잔여 검증, 충돌 검사 후 att_leave_requests INSERT
    - **사후 휴가 신청 허용**(R35-GAP-P2 M-G6 정책): startDate < today 신청 허용. 슈퍼어드민 승인 시 R35-GAP-P1 H-G2 fix로 기존 출근 기록 보존 (status='LEAVE'만 변경, check_in_time·working_mins 유지)
  - `GET /api/att-leave-request` — 본인 신청 내역
  - `GET /api/att-my-leaves` — att_leave_balances + att_leave_types JOIN (올해 기준)

- [ ] **§B-16** 직원 수정 요청 API
  - `POST /api/att-correction-request` — att_corrections INSERT
  - `GET /api/att-correction-request` — 본인 수정 요청 내역

- [ ] **§B-17** 지오코딩 프록시 API
  - `POST /api/att-geocode` — body: `{ address: string }`
  - `https://dapi.kakao.com/v2/local/search/address.json?query={address}` 호출
  - 헤더: `Authorization: KakaoAK ${process.env.KAKAO_REST_API_KEY}`
  - 응답: `{ lat, lng, roadAddress, jibunAddress }`
  - KAKAO_REST_API_KEY 없으면 503

**완료 후**: `feature/phase26-att-backend` 브랜치 push. 메인에 "B 완료, 머지 요청" 메시지.

---

## §9. C 검증 트리거

**[Phase 26 — 근태관리 C 검증]**

**검증 브랜치**: `main` (머지 완료 후)
**작업 디렉토리**: `../tbfa-mis-C` (또는 별도 C 환경)

### 검증 항목 (21개)

> Q1~Q15: Phase 26 근태관리 / Q16~Q21: 성과관리 설정 (메인이 별도 구현 완료, 844fbfc)

| # | 항목 | 확인 방법 |
|---|---|---|
| Q1 | API 23개 모두 `export const config = { path }` 존재 | grep `export const config` 전체 |
| Q2 | 슈퍼어드민 API 모두 super_admin role 체크 | grep `super_admin` 각 파일 |
| Q3 | requireActiveUser vs requireAdmin 구분 정확 | 직원 API = requireActiveUser, admin API = requireAdmin |
| Q4 | haversineDistance 공식 정확성 | att-utils.ts 수식 검토 |
| Q5 | 출근 GPS 검증 — OFFICE/FIELD만 적용, REMOTE/BUSINESS_TRIP 면제 | att-checkin.ts 분기 확인 |
| Q6 | att_records UNIQUE(member_uid, date) 중복 방지 | 마이그레이션 SQL 확인 |
| Q7 | 출근 시 지각 판정 로직 (기준시각 + late_grace_mins) | determineStatus 또는 체크인 API |
| Q8 | 퇴근 시 근무시간 계산 — 휴게시간 차감 조건 | calcWorkingMins 로직 |
| Q9 | 휴가 승인 시 leave_balances.used_days 차감 | admin-att-leave-review.ts |
| Q10 | 수정 요청 승인 시 att_records 업데이트 + is_manually_adjusted=true | admin-att-correction-review.ts |
| Q11 | att-geocode API — KAKAO_REST_API_KEY 없으면 503 반환 | att-geocode.ts |
| Q12 | 워크스페이스 사이드바 6개 파일 모두 근태관리 메뉴 존재 | grep `workspace-attendance.html` |
| Q13 | admin-hub.html에 워크스페이스 관리 카드 존재 | admin-hub.html 내 grep |
| Q14 | workspace-attendance.js GPS 분기 (REMOTE는 geolocation 호출 안 함) | JS 코드 확인 |
| Q15 | 캐시버스터 workspace-attendance.js?v=1, admin-workspace-management.js?v=1 | HTML 파일 확인 |
| Q16 | admin-milestone-definitions API — `export const config = { path }` 존재 + super_admin 체크 | admin-milestone-definitions.ts 상단 |
| Q17 | admin-milestone-role-assign API — `export const config = { path }` 존재 + super_admin 체크 | admin-milestone-role-assign.ts 상단 |
| Q18 | 워크스페이스 사이드바 7개 파일 모두 `wsNavMilestoneSettings` id 항목 존재 | grep `wsNavMilestoneSettings` public/workspace*.html |
| Q19 | ws-sidebar-role.js — super_admin일 때만 `wsNavMilestoneSettings` 표시 | public/js/ws-sidebar-role.js 로직 확인 |
| Q20 | admin-milestone-settings.html — 비슈퍼어드민 접근 시 차단 메시지 표시 (리다이렉트 X) | admin-milestone-settings.js 초기화 분기 |
| Q21 | 성과관리 패널 "로딩 중..." 해결 확인 — workspace-milestones.js가 `/api/admin/me?light=1` 호출 | workspace-milestones.js 60번째 줄 |

---

## §10. 환경변수

```bash
KAKAO_REST_API_KEY    # Kakao Map REST API 키 (Geocoding API 용)
                      # developers.kakao.com → 내 애플리케이션 → 앱 키 → REST API 키
                      # 기존 지도 안내용 키와 동일 앱이라면 같은 REST API 키 재사용 가능
```

---

## §11. 마이그레이션

`netlify/functions/migrate-phase26-attendance.ts`

- 테이블 생성 순서: holidays → workplaces → policies → leave_types → leave_balances → leave_requests → schedules → schedule_overrides → records → corrections
- 멱등 보장: `IF NOT EXISTS` + UNIQUE 제약 `IF NOT EXISTS`
- 기본 데이터 INSERT (idempotent):
  - att_policies: 기본 정책 1건 (check_in=09:00, check_out=18:00, is_default=true)
  - att_leave_types: 연차·반차·병가·경조사·공가·무급휴가 6건

---

*다음 세션 시작 시 이 설계서 §6~§9 트리거 본문 Swain 복붙으로 A·B·C 채팅 시작*
