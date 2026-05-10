# Phase 17 — 보안·감사 강화 (Security & Audit Hardening)

> **작성**: 2026-05-11 / 메인 채팅
> **상위 Phase**: Phase 17 보안·감사 강화 ([카탈로그](2026-05-10-phase10-22-catalog.md) §Phase17)
> **추정**: 메인 설계 2h / B 백 5~6h / A 프론트 3~4h / C 검증 2h / 합계 12~14h
> **모드**: 평행 (A·B 동시 시작. A는 mock JSON으로 시작, B 머지 후 실 API 연결)

---

## 0. 요구사항 확정 (Swain 결정 2026-05-11)

| 항목 | 결정 |
|---|---|
| 세션 자동 만료 | **1안** — 현행 JWT 2시간 유지 + 비활성 30분 시 경고 팝업 → 미응답 시 강제 로그아웃 |
| 민감정보 마스킹 | **1안** — 어드민 화면 표시 마스킹만 (주민번호·전화번호 일부 * 처리) |
| 감사 로그 강화 | 세션 ID 추가·로그인 실패 추적·중요 작업(승인·삭제·환불) 별도 알림 |
| 권한 변경 알림 | 관리자 권한 변경·블랙 처리·환불 승인 시 어드민 이메일 알림 |
| 마스킹 적용 범위 | 전화번호 뒷 4자리 (010-****-1234 → 010-****-****), 주민번호 뒤 7자리 |

---

## 1. DB 설계 (B용)

### 1.1 기존 테이블 컬럼 추가 (마이그레이션 필요)

#### `audit_logs` 테이블에 컬럼 2개 추가

```sql
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20);
  -- risk_level: 'low'|'medium'|'high'|'critical'
```

> **기존 컬럼 유지**: id·userId·userType·userName·action·target·detail·ipAddress·userAgent·success·errorMessage·createdAt

#### `members` 테이블에 컬럼 1개 추가

```sql
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS login_fail_streak INTEGER NOT NULL DEFAULT 0;
  -- 연속 로그인 실패 횟수 (기존 login_fail_count는 누적, 이건 연속)
```

### 1.2 신규 테이블: 없음

### 1.3 마이그레이션

`migrate-phase17-security.ts` 작성 필요.

```sql
-- audit_logs 컬럼 추가
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20);

-- members 컬럼 추가
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS login_fail_streak INTEGER NOT NULL DEFAULT 0;
```

> **B 주의**: schema.ts에 컬럼 정의 추가는 Swain 마이그 호출 확인 후 활성화.

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `admin-audit-list.ts` | `/api/admin-audit-list` | GET | requireAdmin | 감사 로그 목록 (필터·페이지네이션) |
| `admin-audit-stats.ts` | `/api/admin-audit-stats` | GET | requireAdmin | 감사 로그 통계 (액션 분포·위험 등급) |
| `admin-security-alert.ts` | `/api/admin-security-alert` | POST | requireAdmin | 중요 작업 완료 후 이메일 알림 트리거 |

> `lib/audit.ts` 수정: `sessionId`·`riskLevel` 파라미터 추가 (기존 호출부는 영향 없도록 optional)
> `lib/masking.ts` 신규: 전화번호·주민번호 마스킹 헬퍼

### 2.2 함수 상세

#### `admin-audit-list` (GET)

**쿼리 파라미터**: `?action=login|donate|...&riskLevel=high|critical&userId=&page=1&limit=50`

**응답 구조**:
```json
{
  "ok": true,
  "total": 1240,
  "page": 1,
  "logs": [
    {
      "id": 891,
      "userName": "관리자1",
      "userType": "admin",
      "action": "member_blacklist",
      "target": "M-08423",
      "detail": "블랙 처리: 규정 위반",
      "ipAddress": "1.2.3.4",
      "riskLevel": "high",
      "success": true,
      "createdAt": "2026-05-11T10:30:00Z"
    }
  ]
}
```

#### `admin-audit-stats` (GET)

**쿼리 파라미터**: `?period=7d|30d|90d`

**응답 구조**:
```json
{
  "ok": true,
  "period": "30d",
  "byAction": [
    { "action": "login", "count": 450 },
    { "action": "member_blacklist", "count": 3 }
  ],
  "byRiskLevel": [
    { "level": "critical", "count": 2 },
    { "level": "high", "count": 18 },
    { "level": "medium", "count": 95 },
    { "level": "low", "count": 1125 }
  ],
  "failedLogins": 12,
  "uniqueIps": 8
}
```

#### `admin-security-alert` (POST)

**요청 body**:
```json
{
  "alertType": "blacklist"|"refund"|"permission_change"|"bulk_delete",
  "targetDesc": "회원 M-08423 블랙 처리",
  "performedBy": "관리자1"
}
```

**응답**:
```json
{ "ok": true, "sent": true }
```

### 2.3 lib/masking.ts (신규)

```typescript
// 전화번호: 010-1234-5678 → 010-****-5678
export function maskPhone(phone: string): string

// 주민번호: 900101-1234567 → 900101-*******
export function maskRrn(rrn: string): string

// 이메일: user@example.com → u***@example.com
export function maskEmail(email: string): string
```

### 2.4 lib/audit.ts 수정 (기존 파일)

`AuditLogParams` 인터페이스에 필드 추가 (optional — 기존 호출부 영향 없음):
```typescript
sessionId?: string | null;   // 브라우저 세션 식별자 (어드민 로그인 시 생성)
riskLevel?: "low" | "medium" | "high" | "critical";  // 기본 "low"
```

**riskLevel 기준**:
| level | 해당 action |
|---|---|
| critical | member_blacklist, donation_refund, admin_permission_change |
| high | member_delete, bulk_operation, login_fail×5 |
| medium | member_update, donation_update, report_status_change |
| low | 나머지 모든 조회·로그인 성공 |

---

## 3. 화면 설계 (A용)

### 3.1 admin.html 변경

```
사이드바 추가 (⚙️ 설정 그룹 또는 하단):
  🔒 보안·감사 로그   → id="adm-security-audit"
```

### 3.2 신규·수정 JS 파일

| 파일 | 역할 |
|---|---|
| `public/js/admin-security-audit.js` | 감사 로그 목록·통계·필터 화면 |
| `public/js/admin-idle-guard.js` | 비활성 30분 경고 팝업 + 강제 로그아웃 타이머 |

### 3.3 화면 구성

#### 감사 로그 화면 (admin-security-audit.js)

```
┌─────────────────────────────────────────────┐
│ 기간: [7일] [30일] [90일]                    │
│ 위험등급 필터: [전체] [critical] [high]       │
│ 액션 검색: ________________                  │
├──────────┬──────────┬──────────┬────────────┤
│ 전체로그  │ 위험등급  │ 실패로그인│ 접속IP 수  │ ← 통계 카드
├─────────────────────────────────────────────┤
│ 위험 등급별 분포 (도넛 차트)                  │
├─────────────────────────────────────────────┤
│ 로그 목록 테이블                              │
│ 시각 | 관리자 | 액션 | 대상 | IP | 등급       │
└─────────────────────────────────────────────┘
```

#### 비활성 경고 (admin-idle-guard.js)

- admin.html 로드 시 자동 활성
- 마우스 이동·키 입력 시 타이머 리셋
- 28분 경과 시: "2분 후 자동 로그아웃됩니다" 팝업
- 30분 경과 or 팝업 미응답 시: `/api/auth-admin-logout` 호출 → 로그인 페이지 이동

#### 어드민 목록·회원 상세 화면 마스킹 (기존 파일 수정)

- 전화번호 표시 시 `maskPhone()` 적용 (어드민 화면 전용)
- 주민번호 입력 필드는 표시 시 뒷자리 * 처리

### 3.4 어드민 로그인 화면 (admin.html / admin-login.js)

로그인 성공 시 `sessionId` 생성 후 sessionStorage 저장:
```javascript
const sessionId = crypto.randomUUID();
sessionStorage.setItem('adminSessionId', sessionId);
```
이후 중요 API 요청 header에 `X-Session-Id: {sessionId}` 포함.

---

## 4. 검증 시나리오 (C용)

### 4.1 Q1~Q10 라이브 시나리오

| Q | 시나리오 |
|---|---|
| Q1 | 어드민 로그인 → 보안·감사 로그 메뉴 클릭 → 로그 목록 표시 |
| Q2 | [30일] 필터 → 통계 카드(전체·위험등급·실패로그인·접속IP) 숫자 확인 |
| Q3 | [critical] 등급 필터 → 목록이 critical 항목만 표시 |
| Q4 | 회원 블랙 처리 실행 → 로그에 riskLevel=critical 항목 생성 확인 |
| Q5 | 어드민 화면 회원 목록 → 전화번호 뒷 4자리 * 마스킹 확인 |
| Q6 | 비활성 28분 경과 시뮬레이션 → 경고 팝업 노출 확인 |
| Q7 | 경고 팝업 [계속 사용] 클릭 → 팝업 닫히고 타이머 리셋 |
| Q8 | 경고 팝업 무응답 2분 → 강제 로그아웃 + 로그인 페이지 이동 |
| Q9 | 로그인 실패 3회 → 감사 로그에 failedLogin 항목 누적 확인 |
| Q10 | 기존 어드민 기능(회원·후원·신고 등) 회귀 없음 확인 |

### 4.2 회귀 점검

- admin-audit-list / admin-audit-stats 호출 시 기존 audit_logs 조회 정상
- 마스킹 함수 적용 후 다른 화면 레이아웃 깨짐 없음
- idle-guard.js 충돌 없음 (SPA 내 페이지 전환 시 타이머 유지)

---

## 5. mock 데이터 (A용 — B 머지 전 사용)

```javascript
// 감사 로그 목록 mock (GET /api/admin-audit-list)
const MOCK_AUDIT_LIST = {
  ok: true, total: 1240, page: 1,
  logs: [
    { id:891, userName:"관리자1", userType:"admin", action:"member_blacklist",
      target:"M-08423", detail:"블랙 처리: 규정 위반", ipAddress:"1.2.3.4",
      riskLevel:"high", success:true, createdAt:"2026-05-11T10:30:00Z" },
    { id:890, userName:"관리자1", userType:"admin", action:"login",
      target:null, detail:null, ipAddress:"1.2.3.4",
      riskLevel:"low", success:true, createdAt:"2026-05-11T09:00:00Z" }
  ]
};

// 감사 통계 mock (GET /api/admin-audit-stats)
const MOCK_AUDIT_STATS = {
  ok: true, period: "30d",
  byAction: [
    { action:"login", count:450 },
    { action:"member_update", count:38 },
    { action:"member_blacklist", count:3 }
  ],
  byRiskLevel: [
    { level:"critical", count:2 },
    { level:"high", count:18 },
    { level:"medium", count:95 },
    { level:"low", count:1125 }
  ],
  failedLogins: 12,
  uniqueIps: 8
};
```

---

## 6. 4채팅 시작 프롬프트

### 6.1 B 채팅 — 백 구현

```
[B — Phase 17 보안·감사 강화 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase17-back ← 반드시 새로 생성 (git checkout -b feature/phase17-back origin/main)
설계서: docs/milestones/2026-05-11-phase17-security-audit.md

영역: netlify/functions/, lib/, db/schema.ts, drizzle/
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━ DB 변경: 컬럼 추가 2건 ━━━
① audit_logs: session_id VARCHAR(64), risk_level VARCHAR(20)
② members: login_fail_streak INTEGER NOT NULL DEFAULT 0
→ 마이그레이션 파일 필수: netlify/functions/migrate-phase17-security.ts
→ schema.ts 정의는 Swain 마이그 호출 확인 후 추가 (먼저 추가 금지)

━━━ 신규 함수 3개 ━━━
admin-audit-list.ts     → GET  /api/admin-audit-list?action=&riskLevel=&userId=&page=&limit=
admin-audit-stats.ts    → GET  /api/admin-audit-stats?period=7d|30d|90d
admin-security-alert.ts → POST /api/admin-security-alert

━━━ 기존 파일 수정 2개 ━━━
lib/audit.ts: AuditLogParams에 sessionId?·riskLevel? 추가 (기존 호출부 영향 없는 optional)
lib/masking.ts: 신규 파일 — maskPhone(phone)·maskRrn(rrn)·maskEmail(email) 3개 함수

━━━ 응답 구조 (키명 임의 변경 금지 — A mock이 이 구조로 작성됨) ━━━

GET /api/admin-audit-list 응답:
{
  "ok": true, "total": 1240, "page": 1,
  "logs": [
    { "id": 891, "userName": "관리자1", "userType": "admin",
      "action": "member_blacklist", "target": "M-08423",
      "detail": "블랙 처리: 규정 위반", "ipAddress": "1.2.3.4",
      "riskLevel": "high", "success": true, "createdAt": "2026-05-11T10:30:00Z" }
  ]
}

GET /api/admin-audit-stats 응답:
{
  "ok": true, "period": "30d",
  "byAction": [{ "action": "login", "count": 450 }],
  "byRiskLevel": [{ "level": "critical", "count": 2 }, { "level": "high", "count": 18 },
                  { "level": "medium", "count": 95 }, { "level": "low", "count": 1125 }],
  "failedLogins": 12,
  "uniqueIps": 8
}

POST /api/admin-security-alert 응답:
{ "ok": true, "sent": true }

━━━ riskLevel 기준 (audit.ts에 상수로 정의) ━━━
critical: member_blacklist·donation_refund·admin_permission_change
high:     member_delete·bulk_operation·login_fail(5회+)
medium:   member_update·donation_update·report_status_change
low:      나머지 (기본값)

━━━ push 전 체크 (이것만 틀려도 머지 불가) ━━━
  □ 브랜치명: feature/phase17-back (새로 생성했는가?)
  □ 로그 목록 키: logs (log·items 아님)
  □ 통계 키: byAction[]·byRiskLevel[]·failedLogins·uniqueIps
  □ 위험등급 값: critical|high|medium|low (대소문자 정확히)
  □ lib/masking.ts export: maskPhone·maskRrn·maskEmail
  □ lib/audit.ts 기존 호출부 인터페이스 깨짐 없음 (optional 필드만 추가)
  □ export const config = { path: "/api/admin-xxx" } 3개 전부
  □ requireAdmin 반환 auth.res (auth.response 아님)
  □ npx tsc --noEmit 통과

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.2 A 채팅 — 프론트 구현

```
[A — Phase 17 보안·감사 강화 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase17-front ← 반드시 새로 생성 (git checkout -b feature/phase17-front origin/main)
설계서: docs/milestones/2026-05-11-phase17-security-audit.md §3

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

모드: 평행 mock — 아래 mock 데이터로 먼저 구현. B 머지 후 메인이 "실 API 연결" 신호 주면 교체.

━━━ mock 데이터 (B 머지 전 사용) ━━━
const MOCK_AUDIT_LIST = { ok:true, total:1240, page:1,
  logs:[
    { id:891, userName:"관리자1", userType:"admin", action:"member_blacklist",
      target:"M-08423", detail:"블랙 처리: 규정 위반", ipAddress:"1.2.3.4",
      riskLevel:"high", success:true, createdAt:"2026-05-11T10:30:00Z" },
    { id:890, userName:"관리자1", userType:"admin", action:"login",
      target:null, detail:null, ipAddress:"1.2.3.4",
      riskLevel:"low", success:true, createdAt:"2026-05-11T09:00:00Z" }
  ]
};
const MOCK_AUDIT_STATS = { ok:true, period:"30d",
  byAction:[{ action:"login", count:450 }, { action:"member_update", count:38 }],
  byRiskLevel:[{ level:"critical", count:2 }, { level:"high", count:18 },
               { level:"medium", count:95 }, { level:"low", count:1125 }],
  failedLogins:12, uniqueIps:8
};

━━━ 작업 대상 ━━━
1) public/admin.html
   - 사이드바 "🔒 보안·감사 로그" 메뉴 추가 (⚙️ 설정 그룹 하단)
   - 섹션 div 추가: id="adm-security-audit"
2) public/js/admin-security-audit.js — 신규
   - 통계 카드 4개 (전체·위험등급·실패로그인·접속IP)
   - 위험등급 도넛 차트 (Chart.js)
   - 필터 (기간·등급·액션 검색)
   - 로그 목록 테이블: 시각|관리자|액션|대상|IP|등급 (등급별 색상 구분)
3) public/js/admin-idle-guard.js — 신규
   - 어드민 로그인 후 자동 활성화
   - 비활성 28분 → 경고 팝업 ("2분 후 자동 로그아웃")
   - 30분 → /api/auth-admin-logout POST → login-admin.html 이동
   - [계속 사용] 클릭 → 타이머 리셋
4) admin.html 하단:
   <script src="/js/admin-security-audit.js?v=1">
   <script src="/js/admin-idle-guard.js?v=1">

전화번호 마스킹 (인라인 함수, lib/masking.ts 없이 프론트에서 자체 구현):
  function maskPhone(p) { return p ? p.replace(/(\d{3})-?(\d{3,4})-?(\d{4})/, '$1-****-****') : ''; }

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/phase17-front (새로 생성했는가?)
  □ mock 키: logs[]·byAction[]·byRiskLevel[]·failedLogins·uniqueIps
  □ riskLevel 색상: critical=빨강·high=주황·medium=노랑·low=초록
  □ idle-guard: 28분 경고·30분 로그아웃 타이머 정상 동작
  □ <script> 캐시버스터 ?v=1 포함

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.3 C 채팅 — 검증·fix

```
[C — Phase 17 보안·감사 강화 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase17 (베이스 main @ B+A 머지 후 커밋)
정독: docs/milestones/2026-05-11-phase17-security-audit.md §4

작업 순서:
  1) §4.1 Q1~Q10 라이브 시나리오 순서대로 실행·기록
  2) §4.2 회귀 점검
  3) bug 발견 시 fix 커밋 → 메인 보고
  4) 보고서 docs/verify/2026-05-11-phase17.md 작성
  5) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
금지: PROJECT_STATE.md, docs/HANDOFF.md, docs/ 수정.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] **B push 후 머지 전**: B 응답 키와 A mock 키 1:1 대조 (logs[] / byAction[] / byRiskLevel[] / failedLogins·uniqueIps)
- [ ] Swain 마이그 호출 성공 확인 (audit_logs 2컬럼 + members 1컬럼)
- [ ] B `feature/phase17-back` 머지 완료
- [ ] schema.ts `auditLogs`에 sessionId·riskLevel 컬럼 정의 활성화
- [ ] schema.ts `members`에 loginFailStreak 컬럼 정의 활성화
- [ ] 마이그 파일 삭제 + push
- [ ] A `feature/phase17-front` 머지 완료 (실 API 연결 확인)
- [ ] C `verify/phase17` 머지 완료
- [ ] Q1~Q10 모두 PASS
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 Phase 17 진행률 갱신
- [ ] HANDOFF.md 갱신
