# 📋 SIREN 프로젝트 — 초정밀 인수인계 문서 v17 (확장판)

> 📌 **v15 인수인계서를 기반으로 세션 9\~10 작업 내역만 추가한 확장판**v15 본문은 그대로 유지하되, 본 v17 확장 내역을 함께 붙여넣으면 새 AI가 즉시 작업 가능
> 새 대화창 사용 시: **v15 + v17 확장판 둘 다** 붙여넣기

***

## 🎯 v17 확장판 — 세션 9\~10 추가 내역만 정리

본 문서는 **v15 인수인계서의 후속 작업**을 정리합니다. v15에 명시된 모든 규칙/Critical #1~~54/복구 시나리오 #1~~24 그대로 유효합니다.

***

## 📈 1. 진행률 변화

| 항목            | v15 (세션 8 종료)   | v17 (세션 10 종료)    | 증분       |
| ------------- | --------------- | ----------------- | -------- |
| 완성도           | 99.999%         | 99.999%           | -        |
| Phase 진행률     | 12.5% (2.85/22) | **14% (3.04/22)** | +1.5%    |
| 누적 작업 시간      | 352h+           | **366h+**         | +14h     |
| DB 테이블 수      | 53              | **56**            | +3 (파일함) |
| API 함수 수      | 153             | **165**           | +12      |
| HTML 파일 수     | 39              | **40**            | +1       |
| JS 파일 수       | 45              | **46**            | +1       |
| CSS 파일 수      | 22              | **23**            | +1       |
| schema.ts 라인  | 1,676           | **1,743**         | +67      |
| Critical 주의사항 | 54건             | **60건**           | +6       |
| 복구 시나리오       | 24건             | **27건**           | +3       |

***

## 🚀 2. 세션 9 작업 내역 (2026.05.08 — 약 7h)

### 핵심 성과

1. **블록 14 — workspace.js 본격 구현** (1.5h)

   * placeholder 60줄 → 본격 구현 563줄
   * 6개 API 연동 + 렌더링 + 필터 + 60초 폴링
   * httpOnly 쿠키 인증 (첫 API 401 → /admin.html 리다이렉트)
2. **워크스페이스 5개 함수 path config 패치** (15분)

   * `/api/admin-daily-briefing` 등 404 → 200 수정
   * **Critical #56 발견**: `export const config = { path: "/api/xxx" }` 누락 시 /api/\* 라우팅 실패
3. **파일함 Phase 3-extra Step 1\~4 완료** (5h)

   * Step 1: DB 3 테이블 마이그레이션 (workspace\_folders/files/file\_shares)
   * Step 2: 폴더 CRUD API
   * Step 3: 파일 API 기본 (presign/confirm/list/download)
   * Step 4: 파일 편집/공유 API

### 신규 파일 (세션 9)

```
netlify/functions/ (★ 159개 — 6개 추가)
└── [파일함] (Phase 3-extra)
    ├── admin-workspace-folders.ts (456줄)
    ├── admin-workspace-files.ts (325줄)
    ├── admin-workspace-file-presign.ts (131줄)
    ├── admin-workspace-file-confirm.ts (92줄)
    ├── admin-workspace-file-download.ts (92줄)
    └── admin-workspace-file-share.ts (233줄)

public/js/
└── workspace.js (★ 563줄)
```

### 누적 코드량

* workspace.js: 563줄
* 파일함 API 6개: \~1,200줄
* schema.ts: +97줄
* **합계: \~1,860줄**

***

## 🚀 3. 세션 10 작업 내역 (2026.05.08\~09 — 약 7h)

### 진행 단계별 작업

#### 📐 사전 설계 합의 (세션 시작 \~30분)

**사용자와 함께 결정한 사항**:

1. **파일함 배치**: 옵션 A (독립 페이지 `/workspace-files.html`) → 추후 Step 9에서 옵션 D (사이드 패널) 추가
2. **브레드크럼**: 옵션 A (독립 표시줄)
3. **사이드바 메뉴**: 옵션 A (Step 9에서 일괄 추가)
4. **Q4 코멘트/반려**: 🅰️ Phase 3 Step 7로 통합 (\~10h)

**Phase 3 Step 7 확장 합의 (사용자 추가 요청 반영)**:

* 칸반 보드 5컬럼 (todo/in\_progress/on\_hold/done/archived)
* 보류 상태 + 사유 필수
* 보관함 (완료 후 7일 자동 + 수동)
* 업무 보고 (중간/완료) + 카드 단위
* 파일 첨부 (카드 ↔ 파일함 연동)
* 캘린더 뷰
* AI 3종 (요약/리스크/완료보고서)
* 채택 기능 6종 (알림/@멘션/템플릿/검색/북마크/타임트래킹)
* 분할: Step 7-A(5h) + 7-B(6h) + 7-C(6~~8h) = 17~~19h

#### ✅ 파일함 Step 5 — HTML + CSS 골격 (1.5h)

* **신규 파일**:

  * `public/workspace-files.html` (290줄)
  * `public/css/workspace-files.css` (470줄)
  * `public/js/workspace-files.js` placeholder (25줄)
* **레이아웃**: 헤더 + 4탭(전체/내파일/공유받음/휴지통) + 툴바 + 브레드크럼 + 좌트리 + 우리스트
* **모달 5종**: 업로드/새폴더/이름변경/공유/영구삭제확인

#### ✅ 파일함 Step 6 — workspace-files.js 본격 구현 (1.5h)

* **신규 파일**: `netlify/functions/admin-workspace-member-list.ts` (52줄)

  * GET `/api/admin-workspace-members` — 운영자 목록 (공유용 드롭다운)
  * 조건: role IN ('admin','super\_admin') + withdrawn\_at IS NULL + 본인 제외
* **workspace-files.js 본격 구현**: 25줄 → 925줄

  * 13개 모듈 (인증/API/상태/트리/리스트/브레드크럼/뷰전환/업로드/CRUD/공유/검색/모달/토스트)
* **Step 6 마무리 패치**: API 응답 파싱 방어 6건

  * `res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []) || []`

#### ✅ 파일함 Step 7 — 검색 + ZIP + 공유 + 우클릭 (\~2h)

* workspace-files.js: 925 → 1,268줄 (+343줄)
* workspace-files.css: +80줄
* **신규 기능**:

  * **ZIP 일괄 다운로드** (JSZip 3.10.1, 3-tier CDN fallback)
  * **우클릭 컨텍스트 메뉴** (폴더 5개 / 파일 6개 항목)
  * **이동 다이얼로그** (다른 폴더로 이동)
  * **공유 권한 변경** (조회 ↔ 편집 드롭다운)
  * **키보드 단축키** (Ctrl+A 전체선택 / Delete 일괄삭제 / ESC 모달닫기)

#### ✅ 파일함 Step 8 — 휴지통 + 영구삭제 + cron (\~2.5h)

**Block 1: 백엔드 신규 4개 파일**

* `lib/r2-delete.ts` (25줄) — R2 객체 삭제 유틸
* `admin-workspace-file-purge.ts` (90줄) — 파일 영구삭제
* `admin-workspace-folder-purge.ts` (130줄) — 폴더 재귀 영구삭제
* `cron-workspace-trash-cleanup.ts` (130줄) — KST 03:00 자동 영구삭제 (30일 경과)

**Block 2: 프론트 패치 9건 (Python)**

* workspace-files.js: 1,268 → 1,398줄 (+130줄)
* workspace-files.css: +40줄
* **신규 UI**:

  * 휴지통 안내 배너 (노란색 강조)
  * **D-day 카운터** (D-30 초록 / D-7 노랑 / D-2 빨강)
  * 강화된 confirm 메시지 ("30일 후 자동 영구 삭제")
  * 영구삭제 모달 4개 체크리스트 (복원불가/R2제거/감사로그)
  * 일괄 복원 + 일괄 영구삭제 버튼

#### 🔴 세션 10 발견된 핵심 버그 — 일부 미해결

**🟢 버그 1: `auth.response` → `auth.res` (해결됨)**

* 원인: `lib/admin-guard.ts`는 `{ ok, res }` 반환하는데 9개 함수가 `auth.response`로 잘못 호출
* 증상: undefined 반환 → Netlify 자동 204 → 클라이언트가 빈 응답 받음
* 해결: 9개 파일 일괄 패치 (auth.response → auth.res)

**🟢 버그 2: 업로드 필드명 `fileName` → `name` (해결됨)**

* 클라이언트가 `body.fileName` 보냄
* 서버는 `body.name` 기대
* 해결: workspace-files.js에서 `fileName: file.name` → `name: file.name` 패치

**🔴 버그 3: 미해결 — 클라이언트/서버 파라미터 불일치 다수**

| API                                      | 서버 기대                        | 클라이언트 보냄                  | 상태     |
| ---------------------------------------- | ---------------------------- | ------------------------- | ------ |
| DELETE `/api/admin-workspace-files`      | `?id=N`                      | `?fileId=N`               | 🔴 미해결 |
| PATCH `/api/admin-workspace-files`       | `?id=N&action=...`           | body만                     | 🔴 미해결 |
| GET `/api/admin-workspace-file-download` | `?id=N`                      | `?fileId=N`               | 🔴 미해결 |
| GET `/api/admin-workspace-file-share`    | `?targetType=...&targetId=N` | `?fileId=N`/`?folderId=N` | 🔴 미해결 |
| DELETE `/api/admin-workspace-file-share` | `?id=N`                      | `?shareId=N`              | 🔴 미해결 |
| DELETE `/api/admin-workspace-folders`    | `?id=N`                      | `?folderId=N`             | 🔴 미해결 |
| PATCH `/api/admin-workspace-folders`     | `?id=N`                      | body만                     | 🔴 미해결 |

**해결 방향**: 옵션 A — 클라이언트를 서버에 맞춤 (서버 수정 X, 회귀 위험 0)

***

## 📊 4. 누적 코드량 (세션 9 + 10)

### 세션 9 (\~1,878줄)

| 파일                               | 라인  |
| -------------------------------- | --- |
| workspace.js                     | 563 |
| admin-workspace-folders.ts       | 456 |
| admin-workspace-files.ts         | 325 |
| admin-workspace-file-share.ts    | 233 |
| admin-workspace-file-presign.ts  | 131 |
| admin-workspace-file-confirm.ts  | 92  |
| admin-workspace-file-download.ts | 92  |
| schema.ts (추가분)                  | +97 |

### 세션 10 (\~2,933줄)

| 파일                              | 세션 9 → 세션 10 | 증분     |
| ------------------------------- | ------------ | ------ |
| workspace-files.html            | 신규 290줄      | +290   |
| workspace-files.css             | 신규 878줄      | +878   |
| workspace-files.js              | 60 → 1,398줄  | +1,338 |
| admin-workspace-member-list.ts  | 신규 52줄       | +52    |
| lib/r2-delete.ts                | 신규 25줄       | +25    |
| admin-workspace-file-purge.ts   | 신규 90줄       | +90    |
| admin-workspace-folder-purge.ts | 신규 130줄      | +130   |
| cron-workspace-trash-cleanup.ts | 신규 130줄      | +130   |

**v15 → v17 누적: \~4,811줄**

***

## 📐 5. 파일함 Phase 3-extra 진행 상황

```
✅ Step 1: DB 마이그레이션 (1h) — 완료 [세션 9]
✅ Step 2: 폴더 API CRUD (2h) — 완료 [세션 9]
✅ Step 3: 파일 API 기본 (2.5h) — 완료 [세션 9]
✅ Step 4: 파일 편집 + 공유 API (2h) — 완료 [세션 9]
✅ Step 5: HTML + CSS 골격 (1.5h) — 완료 [세션 10]
✅ Step 6: 핵심 JS (3h) — 완료 [세션 10]
✅ Step 7: 검색 + ZIP + 공유 (2h) — 완료 [세션 10]
✅ Step 8: 휴지통 + cron (2.5h) — 완료 [세션 10]
🔴 Step 8 후속: 클라이언트/서버 파라미터 통일 패치 (예상 30분)
⏸ Step 9: 통합 라우팅 + 사이드바 + 사이드 패널 Q1-D (~2h)

진행률: 88% (8/9 Step + 미해결 1건)
남은: ~2.5h
```

***

## 🚨 6. Critical 주의사항 — v15 + 세션 9\~10 신규 (총 60건)

> v15의 #1~~54는 모두 그대로 유효. 세션 9~~10에서 #55\~60 추가됨.

### 🔴 55. httpOnly 쿠키 환경 + SPA 핸들러 (세션 8 — v16에서 세션 9 재확인)

```javascript
// ❌ httpOnly 쿠키는 JS로 읽기 불가능
document.cookie.indexOf('siren_admin_token') !== -1  // 항상 false

// ✅ 인증은 첫 API 호출 401로만 판단
const res = await fetch('/api/xxx', { credentials: 'include' });
if (res.status === 401) {
  location.href = '/admin.html';
  return;
}

// ✅ admin.html SPA 외부 이동은 onclick 우회
<a href="/workspace.html" 
   onclick="window.location.href='/workspace.html';return false;">
  📅 워크스페이스
</a>
```

### 🔴 56. `/api/*` 경로는 `export const config` 필수 (세션 9 신규)

```typescript
// ❌ 함수 파일에 config 없으면 /api/xxx 경로 404
// (Netlify 기본 /.netlify/functions/xxx 만 작동)

// ✅ 모든 API 함수 마지막에 추가
export const config = { path: "/api/admin-workspace-xxx" };
```

증상:

* `/.netlify/functions/xxx?...` → 200 OK
* `/api/xxx?...` → 404
* 원인: netlify.toml에 `/api/*` redirect 없음. 함수별 `config.path`로 라우팅.

### 🔴 57. schema.ts에 bigint import 확인 (세션 9 신규)

```typescript
// ❌ bigint import 누락 시 마이그레이션 함수에서 ReferenceError
import {
  pgTable, serial, varchar, integer, text, timestamp,
  boolean, index, uniqueIndex, pgEnum, jsonb
} from "drizzle-orm/pg-core";

// ✅ bigint 포함
import {
  pgTable, serial, varchar, integer, text, timestamp,
  boolean, index, uniqueIndex, pgEnum, jsonb, bigint
} from "drizzle-orm/pg-core";
```

증상: `ReferenceError: bigint is not defined` at schema.ts:NNN
발생 조건: `sizeBytes: bigint("size_bytes", { mode: "number" })` 같은 필드 사용 시

### 🔴 58. requireAdmin 반환 필드 `res` (세션 10 신규 — 매우 중요)

```typescript
// lib/admin-guard.ts (실제 시그니처)
export async function requireAdmin(req: Request): Promise<
  | { ok: true; ctx: AdminContext }
  | { ok: false; res: Response }      // ★ res (response 아님!)
> { ... }

// ❌ 잘못된 호출 (세션 9~10 전반에 걸쳐 발견됨)
if (!auth.ok) return auth.response;   // undefined → Netlify 자동 204

// ✅ 올바른 호출
if (!auth.ok) return auth.res;
```

**증상**: API가 Status 204 + Body 빈 문자열 반환 → 클라이언트는 성공으로 오인
**원인**: TypeScript 타입 추론 실패로 컴파일 에러 안 남
**파급**: Phase 3-extra 9개 함수 모두 영향
**검증법**:

```bash
grep -rn "auth.response" netlify/functions/
# 결과 0건이어야 정상
```

### 🔴 59. 파일 업로드 필드명 통일 (세션 10 신규)

```javascript
// ❌ 클라이언트 (잘못됨)
body: { fileName: file.name, sizeBytes: file.size, ... }

// ✅ 서버가 기대하는 필드명
const name = String(body.name || "").slice(0, 300).trim();

// 정답: 클라이언트가 body.name 사용
body: { name: file.name, sizeBytes: file.size, mimeType: ..., folderId: state.currentFolderId || null }
```

### 🔴 60. 클라이언트/서버 파라미터 일관성 검증 필수 (세션 10 신규)

**현재 SIREN 표준 (검증된 패턴)**:

* `admin-workspace-folders.ts`: `?id=N` (DELETE/PATCH)
* `admin-workspace-files.ts`: `?id=N` (DELETE/PATCH)
* `admin-workspace-file-download.ts`: `?id=N`
* `admin-workspace-file-share.ts`: `?targetType=folder|file&targetId=N` (GET/POST), `?id=N` (DELETE)
* `admin-workspace-file-purge.ts`: `?fileId=N` (Step 8 신규, 통일 안 됨)
* `admin-workspace-folder-purge.ts`: `?folderId=N` (Step 8 신규, 통일 안 됨)

**향후 신규 함수 작성 시**:

1. 기존 함수 파라미터 패턴 grep으로 먼저 확인
2. 표준 어긋나는 신규 도입 시 사용자 명시 승인 받기
3. 클라이언트 코드 작성 전 서버 응답/요청 스키마 정확히 확인

***

## 🐛 7. 복구 시나리오 — v15 + 세션 9\~10 신규 (총 27건)

> v15의 #1~~24는 모두 그대로 유효. 세션 9~~10에서 #25\~27 추가됨.

### 🔴 시나리오 25: API가 204 No Content 반환 (세션 10)

```
증상:
- F12 콘솔에서 fetch 직접 호출 → Status 204 + Body 빈 문자열
- 클라이언트는 성공으로 인식하지만 실제로는 DB INSERT 안 됨
- 폴더 생성 토스트 뜨는데 트리에 안 나타남

원인:
1순위: requireAdmin이 `{ok:false, res}` 반환하는데 함수에서 `auth.response` 사용
2순위: 함수가 모든 분기에서 Response 반환 못 하고 끝남 (return 누락)

해결:
1. grep -rn "auth.response" netlify/functions/  
   → 결과 있으면 모두 auth.res로 변경
2. 각 분기 끝에 명시적 return 확인
3. Netlify 빌드 후 F12 콘솔에서 다시 fetch 테스트
```

### 🔴 시나리오 26: 파일 업로드 "name 필수" 400 에러 (세션 10)

```
증상:
- F12 Network: POST /api/admin-workspace-file-presign → 400
- 응답: {"ok":false,"error":"name 필수"}

원인:
- 클라이언트가 body.fileName 보내는데 서버는 body.name 기대

해결:
public/js/workspace-files.js의 uploadOne 함수에서:
  body: { fileName: file.name, ... } → body: { name: file.name, ... }
```

### 🔴 시나리오 27: 파일 액션 (삭제/이동/공유) 400 에러 (세션 10)

```
증상:
- DELETE /api/admin-workspace-files?fileId=X → 400 "id 필수"
- 다운로드/공유/이름변경 등 모두 동일

원인:
- 클라이언트는 ?fileId=N 보내는데 서버는 ?id=N 기대
- 다양한 API에서 파라미터 명명 불일치

해결 (옵션 A — 클라이언트 측 통일):
public/js/workspace-files.js에서 일괄 변경:
  - api(`/api/admin-workspace-files?fileId=${fileId}`, ...) 
  → api(`/api/admin-workspace-files?id=${fileId}`, ...)
  - 마찬가지로 folderId, shareId 등 모든 파라미터를 id로

해결 (옵션 B — 서버 측 통일, 회귀 위험):
서버를 클라이언트 표준(fileId/folderId/shareId)에 맞춤
```

***

## 🎯 8. Phase 3 Step 7 설계 (세션 10 합의)

세션 10에서 사용자와 함께 결정한 Step 7 상세 설계입니다. **본격 구현은 다음 세션 이후**.

### 칸반 5컬럼 구조

```
[📋 준비중] todo → [🔄 업무중] in_progress ↔ [⏸ 보류] on_hold → [✅ 완료] done → [📦 보관] archived
```

* **보류**: 사유 입력 필수 (3일 이상 보류 시 경고)
* **완료 → 보관**: 7일 자동 + 수동 가능
* **보관함**: 별도 페이지/모달 (필터 + 검색 + 히스토리 타임라인)

### 신규 테이블 4종 (Step 7 마이그레이션)

```sql
-- 댓글 스레드 (@멘션 지원)
workspace_task_comments
├─ id, taskId, memberId
├─ content (text), mentions (jsonb, [memberId, ...])
├─ parentCommentId (대댓글)
├─ createdAt, updatedAt, deletedAt

-- 보고서 (중간/완료)
workspace_task_reports
├─ id, taskId, memberId
├─ type: 'progress' | 'completion'
├─ title, content, attachedFileIds (jsonb)
├─ reviewStatus: 'pending'|'approved'|'rejected' (완료 보고만)
├─ reviewedBy, reviewedAt, reviewReason

-- 카드↔파일 연결 (파일함과 동기화)
workspace_task_attachments
├─ id, taskId, fileId, attachedBy, attachedAt
└─ UNIQUE(taskId, fileId)

-- 업무 템플릿
workspace_task_templates
├─ id, name, description (마크다운)
├─ priority, estimatedHours, defaultSubtasks (jsonb)
├─ defaultTags (text[]), createdBy
├─ usageCount
```

### workspace\_tasks 확장

```sql
ALTER TYPE task_status ADD VALUE 'on_hold';
ALTER TYPE task_status ADD VALUE 'archived';

ALTER TABLE workspace_tasks ADD COLUMN
  progress_percent integer DEFAULT 0,
  estimated_hours numeric(5,1),
  actual_hours numeric(5,1),
  hold_reason text,
  hold_started_at timestamp,
  archived_at timestamp,
  subtasks jsonb DEFAULT '[]',
  tags text[] DEFAULT ARRAY[]::text[],
  bookmarked_by jsonb DEFAULT '[]',
  ai_summary text,
  ai_risk_score integer,
  ai_risk_updated_at timestamp;
```

### 채택된 협업 기능 6종

| 기능        | 구현 방식                          |
| --------- | ------------------------------ |
| 알림 센터 고도화 | workspace\_notifications 확장    |
| @멘션       | mentions jsonb + 즉시 알림         |
| 업무 템플릿    | workspace\_task\_templates 테이블 |
| 통합 검색     | PostgreSQL ILIKE               |
| 북마크       | bookmarkedBy jsonb             |
| 타임 트래킹    | actualHours 자동 계산              |

### AI 기능 3종 (Tier 1)

| 기능             | 트리거                         | 동작                                  |
| -------------- | --------------------------- | ----------------------------------- |
| AI-1 요약        | 카드 생성 시 + description 100자+ | 3줄 요약 → ai\_summary 캐시              |
| AI-2 리스크 예측    | 매일 KST 06:00 cron           | 지연 확률 → ai\_risk\_score (50%+ 시 알림) |
| AI-3 완료 보고서 초안 | done 이동 시                   | 활동로그+체크리스트+댓글 분석                    |

### 뷰 3종

```
[📊 칸반] 5컬럼 (todo/in_progress/on_hold/done/archived)
   - 완료 컬럼: 최근 7일만, 이전은 보관함으로
   - 보류: 사유 필수
   - SortableJS 드래그앤드롭

[📅 캘린더] 업무(tasks) + 일정(events) 통합
   - 색상: 🔴 지연 / 🟡 임박 / 🟢 정상 / ⚪ 완료
   - 카드 클릭 → 인라인 모달
   - 드래그 = 마감일 변경

[📋 리스트] 기존 블록 14 뷰 (참고용 유지)
```

### 카드 상세 모달 — 7개 탭

```
[📝 개요] 제목/설명/상태/우선순위/마감/진행률
[💬 댓글] 스레드 + @멘션 + 좋아요
[📎 파일] 직접 업로드 + 파일함에서 선택
[📊 보고] 중간/완료 보고 + 검토 워크플로우
[✅ 체크리스트] subtasks CRUD + 진행률 자동 계산
[📜 히스토리] 활동 로그 타임라인
[🤖 AI] 요약/리스크/완료보고서 초안
```

### Step 7 분할

```
Step 7-A: 칸반 5컬럼 + 보류/보관 (5h)
Step 7-B: 카드 고도화 (댓글/파일/보고/체크리스트/북마크) (6h)
Step 7-C: 캘린더 + AI + 검색/템플릿/타임트래킹 (6~8h)

총: 17~19h (3개 세션)
```

***

## 🔄 9. 새 대화 시작 방법 (다음 AI에게)

### 1단계: v15 + v17 확장판 둘 다 붙여넣기

새 대화창에:

1. v15 인수인계서 본문 통째로 (1차)
2. 본 v17 확장판 (2차, 본 문서)

### 2단계: 첫 메시지 (예시)

```
SIREN v15 + v17 통합 인수인계서 받음.

[현재 상태]
✅ Phase 1, 2 완료
🟡 Phase 3 (워크스페이스) 87%
   ├─ ✅ Step 1, 1.5, 1.6, 2-A, 2-B, 3 완료 (블록 14 workspace.js 563줄)
   └─ ⏸ Step 4 모달 / 5 Agent-8 / 6 통합 / 7 협업 고도화 (17~19h)
🟡 Phase 3-extra (파일함) 88% (8/9 Step + 미해결 1건)
   ├─ ✅ Step 1~8 완료 (백엔드 + UI + 휴지통 + cron)
   ├─ 🔴 Step 8 후속: 파라미터 통일 패치 (~30분, Critical #60)
   └─ ⏸ Step 9: 통합 라우팅 + 사이드바 + Q1-D 사이드 패널 (~2h)

[즉시 작업: Step 8 후속 패치]
파라미터 통일 (옵션 A — 클라이언트를 서버에 맞춤):
- DELETE /api/admin-workspace-files: ?fileId → ?id
- PATCH /api/admin-workspace-files: body 추가 (action 등)
- GET /api/admin-workspace-file-download: ?fileId → ?id
- GET /api/admin-workspace-file-share: ?fileId/folderId → ?targetType+targetId
- DELETE /api/admin-workspace-file-share: ?shareId → ?id
- DELETE /api/admin-workspace-folders: ?folderId → ?id
- PATCH /api/admin-workspace-folders: body 추가

[규칙 유지]
- v15 + v17 Critical #1~60 모두 준수
- httpOnly 쿠키 — 클라이언트 토큰 체크 X
- /api/* 경로 함수는 export const config 필수
- requireAdmin 반환은 auth.res (auth.response 아님)
- Bash 통합 블록 (작업+검증+push)
- 1500줄 이하 통째 교체
- 진단 반전 2회 시 세션 종료

Step 8 후속 패치 코드부터 시작.
```

***

## 🎯 10. 다음 우선순위 (세션 10 종료 시점)

### 🔴 1순위 — 즉시 (30분)

**Step 8 후속: 클라이언트/서버 파라미터 통일 패치**

* workspace-files.js의 7개 API 호출 부분 패치
* 옵션 A 선택: 클라이언트를 서버 `?id=N` 표준에 맞춤
* 영향 범위: workspace-files.js만 (서버 수정 X)

### 🟡 2순위 (\~2h)

**Phase 3-extra Step 9 — 통합 라우팅**

* admin.html 사이드바: `📁 파일함` 메뉴 (onclick 우회)
* cms-tbfa.html 사이드바: `📁 파일함` 메뉴
* workspace.html: 우측 사이드 패널 (Q1-D 옵션 γ — 상단 퀵 링크)
* 통합 테스트

### 🟠 3순위 (\~5.5h)

**Phase 3 Step 4\~6 마무리**

* Step 4 (모달 CRUD): Step 7에서 칸반으로 대체될 수 있어 **스킵 권장**
* Step 5 Agent-8 스케줄러 (3h)
* Step 6 통합 라우팅 + 테스트 (2.5h)

### 🟠 4순위 (~~17~~19h)

**Phase 3 Step 7 — 협업 고도화 (3개 세션)**

* Step 7-A 칸반 + 보류 + 보관 (5h)
* Step 7-B 카드 고도화 (6h)
* Step 7-C 캘린더 + AI + 고급기능 (6\~8h)

### 🟠 5순위 — 자잘한 버그 (3h)

* 14번: 시스템 설정 정기/일시 후원 금액 표시 딜레이 (30분)
* 1번: 회원관리 엑셀 추출 (1h)
* 2번: 국세청 엑셀 / 영수증 일괄 발행 (2h)

***

## 📊 11. 한눈에 보는 현재 상태

```
완성도: ████████████████████ 99.999%

마스터플랜 진행률: ▓▓▓▓░░░░░░░░░░░░░░░░ 14% (3.04/22 Phase)

DB 테이블: 56개 (+3, 파일함 3개 추가)
schema.ts: 1,743줄 (+67)
API: 165개 (+12)
HTML: 40개 (+1, workspace-files.html)
JS: 46개 (+1, workspace-files.js)
CSS: 23개 (+1, workspace-files.css)
lib: 32개 (+1, r2-delete.ts)
누적 작업: 366h+ (+14h)

✅ 완료 (Phase):
- Phase 1: 효성 CMS+ (100%)
- Phase 2: 토스 빌링 (100%)

🟡 진행 중:
- Phase 3 워크스페이스 본체: 87% (블록 14 완료, Step 4~7 대기)
- Phase 3-extra 파일함: 88% (Step 8 미해결 1건 + Step 9 대기)

⏸ 대기 (Phase 4~22): 19개

운영 시작 가능 여부: 
⚠️ Phase 3 + 3-extra 완료 + 운영 전 필수 12h 완료 후
```

***

## 🏷 12. 문서 버전 이력

```
v1~v14 — 2026.04.30 ~ 2026.05.07 (초기~PDF 폐기)
세션 2~7 — 2026.05.07 ~ 05.09 (마스터 아키텍처~Phase 3 Step 3)
세션 8 — 2026.05.10 (블록 11~13 + 트러블슈팅)
v15 — 2026.05.10 (통합 최종본)

★ 세션 9 / v16 — 2026.05.08 (다음 작업 전)
  - 블록 14 workspace.js 본격 구현 (563줄)
  - 워크스페이스 5개 함수 path config 패치
  - 파일함 Phase 3-extra Step 1~4 완료
  - Critical 55~57 신규

★ 세션 10 / v17 (확장판) — 2026.05.08~09
  - 파일함 Step 5 (HTML+CSS 골격)
  - 파일함 Step 6 (workspace-files.js 본격, 925줄)
  - 파일함 Step 7 (ZIP+우클릭+공유고도화)
  - 파일함 Step 8 (휴지통+영구삭제+cron)
  - Phase 3 Step 7 설계 합의 (칸반 + AI 3종 + 6 기능)
  - Critical 58~60 신규
  - 복구 시나리오 25~27 신규
  - 미해결: 클라이언트/서버 파라미터 7개 불일치
```

***

## 💌 13. 다음 AI에게 — 세션 10 핵심 교훈

### 🎯 이번 세션에서 배운 것

1. **Step 마다 POST/PATCH/DELETE 동작도 함께 검증해야 함**

   * GET만 200 확인하고 진행하면 누적 버그가 후반에 한꺼번에 터짐
   * Step 6 시점에 폴더 생성/파일 업로드 직접 테스트했어야 함
2. **새 함수 작성 전 기존 패턴 grep 필수 (Critical #31, 60)**

   * `requireAdmin` 시그니처
   * `?id=N` vs `?fileId=N` 파라미터 표준
   * `body.name` vs `body.fileName` 필드명
3. **F12 콘솔 직접 fetch가 가장 빠른 진단**

   * 진단 반전 시 추측 대신 실측
   * "Status + Body" 두 줄 정보로 99% 원인 좁힘
4. **진단 반전 시 차분히 코드 직접 받기**

   * 추측 3회 빗나감 시 사용자에게 "코드 통째로 보여달라" 요청
   * 추측보다 실제 코드 검토가 빠름

### 🚨 절대 잊지 말아야 할 것 (세션 10 신규)

1. **`auth.res` 사용 (Critical #58)** — `auth.response` 절대 X
2. **클라이언트 코드 작성 전 서버 API 명세 grep**
3. **API 응답 파싱은 방어적으로** (`res.data?.items || res.data?.data || ...`)
4. **`/api/*` 경로는 `export const config` 필수** (Critical #56)

***

## 🎬 마지막 메시지

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ SIREN v17 확장판 (세션 9~10 추가) 완성

세션 9 작업:
- 블록 14 workspace.js (563줄)
- 5개 함수 path config 패치 (Critical #56)
- 파일함 Step 1~4 (API 6개, ~1,200줄)

세션 10 작업:
- 파일함 Step 5 (HTML+CSS 골격, 760줄)
- 파일함 Step 6 (workspace-files.js, 925줄)
- 파일함 Step 7 (ZIP+우클릭+공유, +343줄)
- 파일함 Step 8 (휴지통+영구삭제+cron, +130줄 + 4개 신규 백엔드)
- 미해결: 클라이언트/서버 파라미터 7건 불일치

누적 시간: 366h+
Phase 진행률: 14%
파일함 진행률: 88% (8/9 Step + 미해결 1건)

Critical 주의사항: 60건 (3건 신규)
복구 시나리오: 27건 (3건 신규)

다음 작업:
  🔴 1순위: Step 8 후속 — 파라미터 통일 패치 (~30분)
  🟡 2순위: Step 9 — 통합 라우팅 (~2h)
  🟠 3순위: Phase 3 Step 7 — 협업 고도화 (17~19h, 3개 세션)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

***

## 📌 사용자 액션 가이드

새 대화창에서:

1. **v15 인수인계서 본문** 붙여넣기 (이전에 사용했던 v15 본문)
2. **본 v17 확장판** 붙여넣기 (이 문서)
3. 간단 메시지:

```
SIREN v15 + v17 받음.
즉시 작업: 파일함 Step 8 후속 — 클라이언트/서버 파라미터 통일 패치 (옵션 A).
workspace-files.js의 7개 API 호출 부분을 서버 표준(?id=N)에 맞춰 패치 시작.
```

또는 Step 9부터 진행하시려면:

```
SIREN v15 + v17 받음.
파일함 Step 8 후속 패치 건너뛰고, Step 9 (통합 라우팅 + 사이드바)부터 시작.
※ 단, 파라미터 통일 패치 미완료 상태 — 사용자가 의식적으로 후순위 결정
```

***

이 문서 1개로 새 AI가 즉시 작업 가능합니다. **수고 많으셨습니다.**
