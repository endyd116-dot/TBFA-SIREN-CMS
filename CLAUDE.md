# CLAUDE.md — SIREN 프로젝트 가이드

> 새 대화 시작 시 자동으로 컨텍스트에 로드됩니다.
> Claude Code(또는 Claude Agent)가 이 프로젝트를 작업할 때 따라야 하는 정책·구조·관습입니다.
> 상세 인수인계서는 [`docs/handover/v20.md`](docs/handover/v20.md) 참고.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 프로젝트명 | **SIREN (싸이렌)** — 교사유가족협의회 통합 NPO 플랫폼 |
| 운영 주체 | (사)교사유가족협의회 (사업자번호 1188271215) |
| 라이브 URL | https://tbfa.co.kr (공식 메인 — Netlify 매핑 완료) / https://tbfa-siren-cms.netlify.app (Netlify 기본) |
| 호스팅 | Netlify Pro ($20/월) + Functions + Blobs + Scheduled |
| DB | Neon PostgreSQL + Drizzle ORM + postgres-js (56+ 테이블) |
| 저장소 | Cloudflare R2 (Pre-signed URL + base64 인라인) |
| 결제 | 토스페이먼츠 + 효성 CMS+ + 토스 빌링 자동청구 |
| 이메일 | Resend (redirect 모드) |
| AI | Google Gemini 3-flash (cron 자동 호출) |
| 도메인 보유 | tbfa.co.kr (메인 운영 중 — 2026-05-14 확인) |

**서비스 영역**: 후원(정기·일시·CMS·계좌이체) / 회원관리 / 유가족 지원(심리상담·법률·장학) / SIREN 신고(사건·괴롭힘·법률) / 게시판 / 채팅 / 워크스페이스(칸반·캘린더·파일함·템플릿) / AI 비서

**폼 종류 경계** (혼동 방지):
| 폼 | 위치 | 용도 |
|---|---|---|
| 후원 폼 | `donate.html` | 일시·정기 후원 결제 (토스/효성/계좌이체) |
| 캠페인 폼 | `campaign.html` | 캠페인별 참여·서명·모금 |
| 응답폼·신청폼 빌더 | `admin-forms.html` / `form.html` | 행사 신청·설문·이벤트 — 운영자가 코드 없이 생성 |
| SIREN 신고폼 | `report-*.html` | 사건·괴롭힘·법률 상담 신고 (익명 지원) |

---

## 2. 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (No framework) |
| Editor | Toast UI Editor v3.2.2 (3-tier CDN fallback) |
| Backend | Netlify Functions v2 (Node.js 20) |
| Auth | JWT (사용자/관리자 분리) + bcryptjs + httpOnly 쿠키 |
| 결제 PG | 토스페이먼츠 (테스트/라이브) + 효성 CMS+ |
| Cron | Netlify Scheduled Functions |
| Charts | Chart.js 4.4 |
| Calendar | FullCalendar 6 (CDN) |
| Excel | SheetJS 0.18.5 (클라이언트 변환) |
| ZIP | JSZip 3.10.1 |
| Drag&Drop | SortableJS 1.15.2 |
| PDF (영수증) | pdf-lib + @pdf-lib/fontkit (NotoSansKR 6MB) |
| PDF (보고서) | window.print + print CSS |

---

## 3. 폴더 구조

```
tbfa-mis/
├── CLAUDE.md                       ← 본 문서
├── README.md
├── package.json
├── netlify.toml
├── drizzle.config.ts
├── tsconfig.json
│
├── public/                         ← 정적 프론트
│   ├── *.html (40+ 페이지)
│   ├── partials/ (header/footer/modals)
│   ├── css/ (23+ 파일)
│   └── js/ (46+ 파일)
│
├── netlify/functions/              ← API 함수 (170+ 개)
│   ├── auth-*.ts
│   ├── admin-*.ts
│   ├── support-*, incident-*, harassment-*, legal-*
│   ├── workspace-*, admin-workspace-*
│   ├── chat-*, donate-*, billing-*
│   ├── cron-*.ts                   ← Scheduled Functions
│   ├── ai-task-*-background.ts     ← Background Functions
│   └── migrate-*.ts                ← 1회용 마이그레이션 (호출 후 삭제)
│
├── lib/                            ← 공용 라이브러리
│   ├── auth.ts                     ← JWT + requireActiveUser (블랙 차단)
│   ├── admin-guard.ts              ← requireAdmin (반환 필드 'res')
│   ├── ai-gemini.ts, ai-task.ts    ← AI 호출 (3-tier 모델 폴백)
│   ├── workspace-logger.ts         ← 활동 로그 + 알림 통합
│   ├── r2-client.ts, r2-server.ts, r2-delete.ts
│   ├── csv-export.ts, site-settings.ts
│   ├── audit.ts, validation.ts, response.ts
│   └── ...
│
├── db/
│   ├── index.ts
│   └── schema.ts                   ← 56+ 테이블 (~1,800줄)
│
├── drizzle/                        ← 마이그레이션 SQL
├── assets/fonts/NotoSansKR-Regular.ttf (6MB)
└── docs/handover/                  ← 인수인계서 영구 archive
    └── v20.md (통합 최종본)
```

---

## 4. 자주 쓰는 명령어

### 개발
```bash
npm run dev           # netlify dev (Functions 포함, http://localhost:8888)
```

### DB
```bash
npm run db:push       # drizzle-kit push (schema → DB 직접 적용)
npm run db:generate   # drizzle-kit generate (마이그레이션 SQL 생성)
npm run db:migrate    # drizzle-kit migrate (SQL 적용)
npm run db:studio     # drizzle-kit studio (DB 시각화)
```

### 빌드·배포
```bash
npm run build         # 정적 사이트 — 별도 빌드 없음
npm run deploy        # netlify deploy --prod (수동 배포 — 보통 git push로 자동)
git push origin main  # 자동 배포 트리거 (Netlify가 빌드)
```

### 마이그레이션 (1회용)
어드민 로그인된 상태에서 주소창에 (★ **항상 공식 도메인 tbfa.co.kr 사용**, Netlify 기본 도메인 금지):
```
https://tbfa.co.kr/api/migrate-{이름}?run=1
```
- GET ?run=1 : 어드민 인증 후 실행
- GET 만 : 진단 (인증 불필요)
- 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙)

---

## 5. 환경변수 (Netlify)

```bash
# DB / JWT
NETLIFY_DATABASE_URL          # Neon PostgreSQL
JWT_SECRET, JWT_EXPIRES_IN=7d
ADMIN_JWT_SECRET, ADMIN_JWT_EXPIRES_IN=2h
BCRYPT_ROUNDS=10

# 이메일
RESEND_API_KEY, RESEND_TEST_RECIPIENT
EMAIL_FROM, SITE_URL, ADMIN_NOTIFY_EMAIL

# 토스
TOSS_TEST_CLIENT_KEY, TOSS_TEST_SECRET_KEY
TOSS_MODE=test (운영 시 'live')

# AI
GEMINI_API_KEY
GEMINI_MODEL_PRO=gemini-3-flash
GEMINI_MODEL_FLASH=gemini-3-flash

# Cloudflare R2
R2_ACCOUNT_ID, R2_BUCKET=siren-uploads
R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

# 협회 정보
ORG_NAME, ORG_REGISTRATION_NO, ORG_REPRESENTATIVE, ORG_ADDRESS, ORG_PHONE
```

---

## 6. 코딩 컨벤션·규칙 (필수 준수)

### 6.1 작동 보장 후 고도화 (최우선 원칙)

신규 기능 작성 시 **사전 점검 5원칙** 적용:

1. **필드명·타입 일치**: 클라이언트 body와 서버 검증 필드, DB 컬럼 제약 동기 점검
2. **응답 키 다중 fallback**: `res.data.data.X || res.data.X || res.X`
3. **DB 컬럼 제약**: NOT NULL/DEFAULT/UNIQUE/FK 코드 충돌 사전 검증
4. **캐시버스터(?v=N)**: 변경된 JS·CSS의 모든 참조 페이지에서 갱신
5. **회귀 영역**: schema 변경 → 마이그레이션 적용 후 schema 정의 활성화 (DB-schema 동기화)

### 6.2 API 응답 패턴 (검증된 표준)

```typescript
// 단계별 try/catch + step 라벨 + detail + stack
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "...실패",
    step,                                          // 'auth' | 'select_X' | 'map' 등
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

// 보조 SELECT는 실패해도 빈 배열로 계속 (메인 데이터로만 응답)
let auxRows = [];
try { auxRows = await db.select()...; } catch (err) { console.warn(...); }
```

### 6.3 DB 쿼리 패턴

- **drizzle 다중 leftJoin 체인 금지** → separate query + JS Map 매칭
- 필수 SELECT만 명시적 컬럼 선언 (schema 변경 영향 최소화)
- inArray로 IN 절 사용 시 ID 배열 dedup
- 페이지네이션 limit 명시 (안전 상한)

### 6.4 클라이언트 패턴

- `api()` 헬퍼는 `opts.body`를 자동 `JSON.stringify` 처리 → 호출부에서 객체 그대로 전달 (이중 stringify 금지)
- 응답 검증: `if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status)`
- 토스트 에러 메시지에 서버 detail 노출

### 6.5 인증·권한

- **httpOnly 쿠키** 환경 — `document.cookie` 토큰 체크 금지, 첫 API 401로만 인증 판정
- `lib/admin-guard.ts requireAdmin` 반환 필드는 **`res`** (`response` 아님)
  ```typescript
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;   // ✅ 'res'
  ```
- `lib/auth.ts requireActiveUser` (블랙 차단 통합)
  - 차단된 사용자 → 403 + `{ error: "귀하의 서비스가 차단되었습니다.", blacklisted: true, reason }`
  - SIREN 3개·유족지원·채팅·후원 등 사용자 진입 API에 적용

### 6.6 라우팅·캐시

- `/api/*` 경로 함수는 반드시:
  ```typescript
  export const config = { path: "/api/admin-xxx" };
  ```
  누락 시 `/api/xxx?...` → 404
- HTML 외부 링크(SPA 외부 이동)는 onclick 우회:
  ```html
  <a href="/page.html" onclick="window.location.href='/page.html';return false;">
  ```

### 6.7 schema.ts

- import에 `bigint`, `numeric` 등 사용한 타입 빠짐없이
- DB 적용 전(마이그레이션 전) schema 컬럼 정의 추가 금지 — 즉시 운영 깨짐
  - 정상 흐름: 마이그레이션 함수 작성 → 사용자 호출 → 적용 확인 → schema 정의 추가 → 푸시

### 6.8 마이그레이션 호출 표준

신규 마이그레이션은 **어드민 세션 GET ?run=1** 패턴:
```typescript
// netlify/functions/migrate-xxx.ts
import { requireAdmin } from "../../lib/admin-guard";
// GET ?run=1 : requireAdmin 후 실제 실행
// GET (기본) : 진단 모드 (인증 불필요)
```
- 환경변수 키 검증 폐기 (특수문자 문제·재배포 부담 해결)
- 어드민이 주소창에 한 번 입력 → 즉시 실행
- 멱등 보장 (`IF NOT EXISTS`, 중복 INSERT 방지)
- 호출 성공 후 즉시 파일 삭제 + 커밋·푸시

### 6.9 자율 권한 (Claude 측)

사용자가 명시한 자율 권한:
- **자동 진행**: 코드 수정, git add/commit/push, Netlify 자동 배포, npm 명령, 옵션 추천 진행, 메모리 갱신
- **확인 필요**: ① 설계·로직 결정 ② 마이그레이션 호출 (사용자 직접) ③ 진정 위험·비가역 작업 (force push, hard reset, DB DROP, 운영 결제 전환 등)
- 그 외 묻지 말고 자율 진행

### 6.10 자율성 원칙 (구체 카탈로그)

§6.9의 거시 정책을 작업 단위로 풀어둔 체크리스트. 헷갈릴 때 이 카탈로그가 우선.

**혼자 결정하고 진행할 것**
- 함수/변수 네이밍 (지역 범위)
- 코드 스타일, 포맷팅, 리팩토링
- 주석, 문서화
- 단순 버그 수정
- 테스트 코드 작성
- 구현 디테일 (설계가 명확할 때)
- 에러 핸들링 패턴

**반드시 Swain(사용자)한테 물어볼 것 — 작업 중단 후 질문**
- DB 스키마 변경, 마이그레이션
- 새 라이브러리/패키지 추가
- API 명세 변경 (엔드포인트, 요청/응답 구조)
- 폴더 구조나 모듈 구조 변경
- 외부 서비스 연동 (유료/무료 무관)
- 보안 관련 결정 (인증, 권한)
- 주요 엔티티 네이밍 (테이블명, 핵심 컴포넌트명)
- 비즈니스 로직 해석이 모호할 때

**한 번 확인 후 진행할 것**
- 상태 관리 패턴 선택
- 컴포넌트 구조 결정
- 테스트 전략

### 6.11 질문 방식 규칙

- 질문은 **모아서** 한 번에 (한 작업 중 5번 질문 ❌)
- 선택지를 제시 (1번/2번/3번 형식 — `AskUserQuestion` 사용 시 자연스럽게 충족)
- "어떻게 할까요?" ❌ → "A안: ~, B안: ~, 추천은 A입니다" ⭕
- 추천안과 그 이유 함께 제시

### 6.12 진행 보고 방식

- 각 단계 끝날 때 1-2줄로 요약
- 막히면 즉시 보고 (혼자 30분 이상 헤매지 말 것)
- 완료 시 변경 파일 리스트와 핵심 변경점만

### 6.13 답변 언어

- **모든 답변·헤더·옵션 라벨·도구 description**: 한국어
- 영어 단어 섞기 금지 (코드·식별자·기술용어 API/JWT/cron 등은 원형)

### 6.14 검증·설명 표현 — 로직·기능 위주 (Swain 절대명제)

검증 시나리오·기능 설명·작업 보고 시 **함수명·변수명·코드 용어 대신 로직·기능·사용자 시나리오 위주**로 표현. 사용자가 코드 모르고도 무엇을 확인하는지 즉시 이해할 수 있어야 함.

**나쁜 예 (함수 위주, 금지)**
- `USE_MOCK = false로 변경 + __MOCK_ADMIN_MEMBERS__ 상수 삭제`
- `ok() 헬퍼로 wrap된 응답을 unwrap해서 res.data.data.data로 접근`
- `requireAdmin 가드 통과 후 auth.res 패턴 적용`
- `DEMO_* 제거 + cms-tbfa.js fetch 전환`

**좋은 예 (기능·로직 위주)**
- "가짜 데이터로 화면 그리던 부분을 끄고 실제 백엔드와 연결"
- "서버가 응답을 한 번 더 감싸서 보내니 한 단계 풀어서 사용"
- "관리자 권한 확인 후 실패 시 서버가 만든 거절 응답 그대로 돌려보냄"
- "옛날 가짜 회원 7명 사라지고 진짜 회원 명단 표시"

**적용 범위**:
- 사용자 대상 설명·검증 시나리오·작업 보고
- 채팅 간 교신(B 채팅과의 기술 토론 등)도 가능한 한 적용 — 단 코드 작성·디버깅 시점에는 정확성 우선
- 함수명·변수명은 정말 필요할 때만 괄호로 보조 표기 (예: "회원 명단 화면(`cms-tbfa.js`)")

**Why**: Swain은 비즈니스 결정자이지 코드 작성자가 아님. 함수·변수 용어로 설명받으면 무엇을 검증해야 하는지 한 번 더 번역해야 함 → 비효율·오해 위험.

### 6.15 진행 중 채팅 알림 의무 (2026-05-12 Swain 추가)

메인이 main에 commit·push할 때마다 진행 중인 A·B·C 채팅에 영향이 있으면 **알림 메시지(Swain 복붙용)를 응답에 포함**:

- **알림 대상**: 해당 fix·정책이 A·B·C 영역과 관련된 모든 채팅
- **알림 내용**: 커밋 해시·변경 영역·각 채팅 액션(fetch + merge origin/main / 회귀 영향 / 작업 계속)
- **타이밍**: push 직후 같은 응답에 메시지 박아서 Swain이 즉시 복붙 가능하게
- **예외**: 메인 자체 docs 갱신(PROJECT_STATE·HANDOFF)으로 A·B·C 코드 영향 0이면 생략 가능

**Why**: 메인이 main에 fix push해도 A·B·C는 자기 worktree·브랜치에서 작업 중이라 main 갱신 모름 → push 시점에 잘못된 베이스로 충돌·회귀. C는 이미 fix된 BUG를 다시 보고할 위험. 2026-05-12 R&R 권한 fix(0dcb5e4) 사건이 계기.

### 6.16 진행률 % 보고 의무 (2026-05-14 Swain 추가)

A·B·C·메인 모두 작업 도중 **현재 진행률(100% 기준)을 가끔 한 줄로 보고**.

- **빈도**: 큰 단계(체크박스 1개) 완료마다 + 30분 이상 작업 시 중간 1회 이상. 매 응답마다 ❌
- **형식**: `📊 진행률 35% (3/9 항목 완료) — 다음: ...` 한 줄
- **분모**: 트리거의 체크박스 항목 수 (예: API 9개 + 도구 6개 = 15개)
- **분자**: 완료된 체크박스 수
- **메인**: 라운드 4단계(설계·머지·검증·문서) 중 진행 단계 기준

**Why**: 큰 작업이 묶음으로 가면 Swain이 중간 상태(막혔는지·진행 중인지) 파악 불가 → 잘못된 시점에 개입. 진행률 보고로 해결.

### 6.17 A·B·C 채팅 자율주행 (2026-05-14 Swain 추가)

A·B·C 서브 채팅은 **push와 애매한 로직만 묻고 나머지는 자율 진행**.

- **묻기 (ask)**: `git push`, 설계·로직 결정, package.json/lock 수정, npm uninstall/update, netlify/curl
- **자율 (allow)**: Read·Edit·Write 모든 파일, git status/log/diff/fetch/add/commit/rebase, bash·PowerShell 일반 명령, npm install/run
- **금지 (deny)**: force push, hard reset, rm -rf, lib/auth.ts·admin-guard.ts·hyosung-parser.ts 수정, public/js/auth.js·admin-mypage-cancellation.js·admin-eligibility.js 수정

정책 위치: `.claude/settings.json` (메인+A+B+C 워크트리 4곳 동일 배포) + 트리거 본문 `[자율주행 정책]` 조항

**Why**: 매 Edit/Read마다 허락 묻기 → 작업 흐름 끊김. A·B 효율 급감. 2026-05-14 Swain "허락 맡지마" 명시 지시.

---

## 7. AI 호출 정책

### 7.1 사용 모델
- Gemini 3-flash (Pro/Flash 모두 동일 모델)
- 폴백 chain: `gemini-3-flash` → `gemini-3.0-flash` → `gemini-3.1-flash-lite-preview`

### 7.2 호출 시점 (안 2 자동화 중분간)
- **AI-1 작업 요약**: 카드 생성 + description 100자+ 자동 (`ai-task-summary-background`)
- **AI-2 리스크 점수**: 매일 KST 06:30 cron (`cron-task-risk`)
- **AI-3 완료 보고서 초안**: done 이동 시 자동 (`ai-task-completion-background`)
- 모두 **수동 재생성** 가능 (`/api/admin-task-ai-regenerate?type=summary|risk|completion`)

### 7.3 안전장치
- 폴백 텍스트 (AI 실패 시 휴리스틱·데이터 기반 자동 생성)
- description 짧으면(<30자) 호출 스킵 (비용 통제)
- 호출 실패 throw 안 함 (fire-and-forget 안전)

---

## 8. Cron 함수 (모두 운영 중)

| 함수 | 시간 (UTC / KST) | 동작 |
|---|---|---|
| `cron-workspace-trash-cleanup.ts` | 18:00 / 03:00 | 휴지통 30일 경과 영구삭제 |
| `cron-agent-8.ts` | 21:00 / 06:00 | 일일 브리핑 생성 (admin별) |
| `cron-task-risk.ts` | 21:30 / 06:30 | 작업 리스크 점수 갱신 |
| `cron-billing-monthly.ts` | 운영중 | 토스 빌링 월간 청구 |
| `cron-billing-card-expiry.ts` | 운영중 | 카드 만료 알림 |
| `cron-toss-billing.ts` | 운영중 | 토스 빌링 처리 |
| `cron-grade-recalc.ts` | 운영중 | 회원 등급 재계산 |
| `cron-cleanup-audit-logs.ts` | 운영중 | 감사 로그 1년 정리 |
| `cron-churn-predictor.ts` | 운영중 | 이탈 예측 |
| `cron-anniversary-check.ts` | 운영중 | 기념일 체크 |
| `cron-campaign-slump-check.ts` | 운영중 | 캠페인 부진 체크 |

---

## 9. 작업 시 주의사항 (Critical, 필독)

### 9.1 회귀 위험 영역
1. **schema.ts 컬럼 추가**: drizzle SELECT가 schema 기준이므로 DB 적용 전 추가 금지 (즉시 운영 깨짐 — 어드민 로그인 등 SELECT 실패)
2. **마이그레이션 함수**: 1회용. 호출 후 즉시 삭제 (보안 + 코드 청결성)
3. **차단 미들웨어**: `requireActiveUser` 적용 시 영향 범위 사전 점검 (지금은 핵심 CREATE 6개만 적용)
4. **API 응답 키**: 클라이언트에서 다중 fallback 사용 (`data.data.X || data.X`)
5. **드리즐 leftJoin 체인**: 안정성 위험 → separate query + Map 매칭
6. **schema.ts append-only 원칙 (병렬 작업 핵심)**: 여러 작업이 schema.ts를 동시에 수정 시 다른 작업 영역을 덮어쓰지 말 것. 본인 섹션은 반드시 파일 끝에 헤더 명시 후 추가 (`/* === 작업 X === */`). 2026-05-09 사고 사례: 작업 C가 schema 영역에 자기 정의를 적으면서 작업 A의 정의(eligibilityType + eligibilityChangeRequests)를 함께 삭제 → 머지 후 회귀 발견 → fix 커밋(b45d0fa)으로 복구
7. **병렬 작업은 worktree 필수**: 같은 working directory를 두 채팅이 공유하면 git checkout이 다른 채팅의 워킹 트리에 영향. `git worktree add ../tbfa-mis-{식별자} feature/{브랜치}`로 폴더 분리 (사고 사례: 2026-05-09 b5167bf → 0453071 cherry-pick 정리)
8. **헬퍼 함수 도입 직후 모든 사용처 1회 검증**: 5순위 #1에서 도입한 `requireActiveUser`가 `user.id` (실제 필드명은 `uid`) 참조 → 1회용 검증 누락으로 9개 API 동작 불능 잠재. 2026-05-09 검증 단계에서 발견 (#BUG-1 — `docs/issues/2026-05-09-requireActiveUser-uid-bug.md`)
9. **메인 설계 §1·§2 작성 전 사전 정독 의무화** (2026-05-12 R2+R3·R4 격차 사고 패턴 — 메인이 `adminUsers`/`assigneeUid`/`linkUrl` 등 일반 가정으로 설계 → B가 schema 정독 후 적응 보고): 새 라운드 설계서 작성 전 ① `db/schema.ts` 영향 테이블 전후 정독 + 명명 후보 키 grep(`assigneeUid` vs `assignedTo` 등 둘 다 검색) ② `lib/auth.ts`·`lib/admin-guard.ts`로 사용자/관리자 모델 확정 (이 프로젝트는 `admin_users` 없이 `members.role`+`operatorActive`로 운영자 식별) ③ 영향 받는 4종 서비스 API 본문 단편 정독으로 기존 FK 패턴 확인 ④ `drizzle/` 폴더 ls로 컬럼 진화 추적 ⑤ `docs/issues/` 최근 3건 정독으로 회귀 패턴 학습. 누락 시 B가 schema 격차 적응 보고로 메인 결정 폭증 + 머지 후 키 정정 코드 변경 폭증.

### 9.2 마이그레이션 호출 흐름 (사용자 액션)
```
1. AI가 schema.ts 정의 추가 → 마이그레이션 함수 작성 → 푸시
2. 사용자가 admin.html 로그인
3. 주소창: https://tbfa.co.kr/api/migrate-xxx?run=1 (★ 공식 도메인 tbfa.co.kr 통일)
4. 응답 success 확인 → AI에게 알림
5. AI가 schema 정의 활성화 (마이그레이션이 schema보다 먼저 추가된 경우) + 마이그레이션 파일 삭제 + 푸시
```

### 9.3 점진 푸시
- 큰 작업은 1차로 핵심 동작 → 사용자 검증 → 다음 단계
- 한 번에 너무 많은 변경 X
- 사용자 확인 받은 후 고도화·UI 개선 추가

### 9.4 컨텍스트 한계 알림 (Claude 측 자동)
- **80% 도달**: "💡 컨텍스트 사용량 80%" 한 줄 알림 + 작업 계속
- **90% 초과**: "🚨 컨텍스트 90% 초과 — 새 채팅 권장" 강력 경고 + 인수인계 절차 안내
- 자동 압축 발생 전 사용자가 적절한 시점에 인수인계 가능하도록

---

## 10. Phase·작업 진행 상황

진행률·완료 현황·미해결 이슈는 [PROJECT_STATE.md](PROJECT_STATE.md) §5(마일스톤) + §6(미해결 이슈) 단일 출처로 관리. 본 문서에는 누적하지 않음.

---

## 11. 페이지 진입점

[docs/PAGES.md](docs/PAGES.md) — 사용자·어드민·워크스페이스 진입점 카탈로그.

---

## 12. 참고 문서

| 문서 | 역할 | 갱신 빈도 |
|---|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **자동 로드** — 코딩 컨벤션·권한·자율성 원칙 | 정책 변경 시 |
| [`PROJECT_STATE.md`](PROJECT_STATE.md) | 휘발성 상태(진행률·worktree·이슈) | 매 세션 |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | 단일 최신 인수인계 (한 화면) | 항상 단일 최신 |
| [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) | 병렬 작업·머지·충돌 회피 가이드 | 정책 변경 시 |
| [`docs/PAGES.md`](docs/PAGES.md) | 페이지 진입점 카탈로그 | 페이지 추가 시 |
| [`docs/REMAINING_WORK.md`](docs/REMAINING_WORK.md) | 잔여 작업 인벤토리 | 우선순위 합의 시 |
| [`docs/CONTEXT_OPTIMIZATION.md`](docs/CONTEXT_OPTIMIZATION.md) | 컨텍스트 다이어트 진단·결정 | 다이어트 정책 변경 시 |
| [`docs/issues-archive.md`](docs/issues-archive.md) | 해결된 이슈 archive (옛 issues/ 압축) | 이슈 해결 후 |
| [`docs/verify-archive.md`](docs/verify-archive.md) | 완료 Phase 검증 보고서 archive (옛 verify/ 압축) | 검증 완료 후 |
| [`docs/milestones-archive.md`](docs/milestones-archive.md) | 완료 Phase 설계서 archive (옛 milestones/ 압축) | 마일스톤 마감 후 |
| [`docs/milestones/`](docs/milestones/) | 진행 중인 마일스톤 설계서 (현재 22-A·22-C만) | 마일스톤 신설 시 |
| [`docs/handover/v*.md`](docs/handover/) | 영구 스냅샷 (자발적 안 읽음, 역사) | 마일스톤 완료 시 |
| [`.claude/settings.json`](.claude/settings.json) | 권한 정책 — main 폴더 자동 적용 | 정책 변경 시 |
| 메모리 | `~/.claude/projects/c--Users-Administrator-Desktop----dev-tbfa-mis/memory/` | 학습 시 |

---

## 13. Claude(AI) 작업 수행 시 핵심 체크리스트

새 작업 시작할 때마다 이 체크리스트를 마음속으로 점검:

- [ ] 사용자가 정한 자율 권한 범위 안인가? (확인 필요한 영역만 묻기)
- [ ] 한국어 답변·도구 description 사용?
- [ ] 신규 API라면 단계별 try/catch + step·detail·stack 응답?
- [ ] 응답 키 다중 fallback?
- [ ] 캐시버스터 일괄 갱신?
- [ ] schema 변경 시 마이그레이션 함수 동시 작성? (append-only + 본인 섹션 헤더)
- [ ] requireAdmin 반환은 `auth.res` (response 아님)?
- [ ] `/api/*` 함수에 `export const config = { path }`?
- [ ] 병렬 작업이면 worktree 폴더에서 시작? (같은 working directory 공유 금지)
- [ ] 헬퍼 함수 도입 직후 모든 사용처 1회 검증? (#BUG-1 사례 — §9.1.8)
- [ ] **메인 설계 시작 전 schema·lib·기존 API 본문 사전 정독 완료?** (§9.1.9 — `adminUsers`/`assigneeUid`/`linkUrl` 같은 일반 가정 금지)
- [ ] **A·B 시작 프롬프트는 체크박스 패턴으로 작성?** (PARALLEL_TEMPLATE §6.2·§6.3 양식 — 설계서 §N 항목을 1:1 체크박스로 매핑. Sonnet 4.6은 일반 지시보다 체크박스에 훨씬 충실)
- [ ] PROJECT_STATE.md §2 갱신 + §4.X 진행률 갱신 후 push?
- [ ] 컨텍스트 80%·90% 알림 체크?
- [ ] 푸시 후 사용자에게 검증 권장 + 다음 단계 안내?

---

## 14. 컨텍스트 관리 정책 (다이어트보다 효과 큰 행동 변화)

세션 컨텍스트가 빠르게 차오르는 진짜 원인은 자동 로드(전체의 3~5%)가 아니라 **누적 도구 호출 결과**와 **중복 정독**. 다음 3가지 행동 변화를 우선 적용한다.

### 14.1 정독 정책 (메인 채팅 시작 시)

| 문서 | 정독 여부 |
|---|---|
| `CLAUDE.md` | 자동 로드 (다시 Read 금지 — 컨텍스트 이중 부담) |
| `PROJECT_STATE.md` | **정독** (§1~§7) |
| `MEMORY.md` 인덱스 | 자동 로드 — 인덱스에서 본인 작업과 관련된 메모는 **본문도 정독** (특히 `feedback_*.md`·`project_critical_*.md`) |
| `memory/feedback_design_routine.md` | **새 라운드 설계 시작 시 정독 필수** — 트리거 작성 규칙·체크박스 패턴·mock 임베드 정책. 인덱스만 보면 패턴 빠뜨림(2026-05-12 사고 사례) |
| `docs/HANDOFF.md` | **§3·§5·§7만 발췌** (limit/offset 사용, 전체 정독 X) |
| `docs/PARALLEL_GUIDE.md` | **새 병렬 작업 분배 시에만** |
| `docs/PARALLEL_TEMPLATE.md` | 새 라운드 설계 시 정독 |
| `docs/PAGES.md` | 페이지 위치 헷갈릴 때만 |
| `docs/handover/v*.md` | **자발적 안 읽음** (영구 archive) |

### 14.2 Subagent 활용

큰 문서 정독·다중 파일 조사·코드베이스 검색은 Subagent에 위임하고 메인은 결과 요약만 받는다. 메인 컨텍스트에 원본 텍스트가 누적되지 않음.

- **Explore agent**: 코드베이스 검색 ("X 정의 위치", "Y 사용처"), 큰 문서 정독 (200~400자 요약 요청)
- **Plan agent**: 구현 전 설계 — 메인은 결정만 받음
- 메인이 직접 Read 하기 전에 "Subagent에 위임해서 요약 받으면 충분한가?" 자문

### 14.3 Read 정책

- 큰 파일은 `limit`/`offset` 발췌. 전체 Read는 마지막 수단
- 같은 파일 두 번 Read 금지 — 한 번 읽으면 컨텍스트에 남아있으니 재독 불필요
- Edit 후 결과 확인을 위한 Read 금지 (Edit 실패 시 자체 에러)
- 검색은 `Glob`(파일명) → `Grep`(내용) 우선, Read는 최종 단계

### 14.4 세션 분할

- 한 작업 단위(머지·검증·설계·디버깅 등 하나)가 끝나면 새 채팅 시작
- 1M 컨텍스트 80% 도달 전에 능동적으로 인수인계
- 인수인계는 [`docs/HANDOFF.md`](docs/HANDOFF.md) 갱신 후 새 채팅 시작 메시지로 위치 안내

### 14.5 다이어트 결과 요약

본 정책 도입 시점(2026-05-10) 자동 로드 약 28% 절감. 자세한 진단·결정 [docs/CONTEXT_OPTIMIZATION.md](docs/CONTEXT_OPTIMIZATION.md).

---

**마지막 업데이트**: 2026-05-12 (§9.1.9 사전 정독 + §13 체크리스트 2개 + §14.1 memory 정독 + §6.15 진행 중 채팅 알림 의무 — schema 격차·체크박스·mock 임베드·main fix 알림 4종 메타 정책 정착)
