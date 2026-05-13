# AI 에이전트 플랫폼 표준 (SI 사업용)

> **목적**: LLM(예: Google Gemini, OpenAI GPT, Anthropic Claude) 기반 운영자/관리자 AI 비서를 구축하는 SI 프로젝트의 표준 아키텍처·정책·운영 절차.
>
> **적용 범위**: 어드민 페이지에 AI 챗봇 기능을 도입하는 모든 NPO/B2B/SaaS 프로젝트.
>
> **버전**: 1.0 (2026-05-13, SIREN 프로젝트 실증 기반)
>
> **레퍼런스 구현**: `feature/ai-cost-safety` 브랜치, 약 28개 커밋.

---

## 목차

1. [용어 정의](#1-용어-정의)
2. [핵심 아키텍처 — 5층 안전장치](#2-핵심-아키텍처--5층-안전장치)
3. [도구(Tool) 시스템 표준](#3-도구tool-시스템-표준)
4. [비용 절감 정책 (9개)](#4-비용-절감-정책-9개)
5. [차단·한도 정책 (8개)](#5-차단한도-정책-8개)
6. [권한·통제 정책 (5개)](#6-권한통제-정책-5개)
7. [안전·보안 정책 (4개)](#7-안전보안-정책-4개)
8. [가시성·로깅 정책 (6개)](#8-가시성로깅-정책-6개)
9. [AI 기능·UX 표준 (7개)](#9-ai-기능ux-표준-7개)
10. [운영 자동화 (3개)](#10-운영-자동화-3개)
11. [DB 스키마 표준](#11-db-스키마-표준)
12. [API 엔드포인트 표준](#12-api-엔드포인트-표준)
13. [코드 모듈 구조](#13-코드-모듈-구조)
14. [환경변수 표준](#14-환경변수-표준)
15. [운영 절차](#15-운영-절차)
16. [도입 체크리스트](#16-도입-체크리스트)

---

## 1. 용어 정의

| 용어 | 정의 |
|---|---|
| **AI 에이전트** | LLM이 자연어 명령을 받아 사전 정의된 도구를 선택·호출해 작업을 수행하는 자율 시스템 |
| **도구(Tool)** | AI가 호출 가능한 사전 정의 함수 (예: `members_search`, `task_create`) — Function Calling 패턴 |
| **읽기 도구** | DB·외부 시스템 조회 전용. 부작용 없음 |
| **변경 도구(Mutation)** | DB·외부 시스템 변경. 반드시 dry-run + 승인 절차 |
| **feature_key** | AI 호출 기능 식별자 (예: `ai_agent_chat`, `support_priority_analysis`) — 비용·토글 단위 |
| **dry-run** | 변경 도구 호출 시 실제 적용 없이 변경 예정 내용만 미리보기 |
| **rollbackData** | 변경 전 원본 값 — 자동 백업 및 사후 롤백 근거 |
| **동적 도구 로딩** | 사용자 의도 분류 후 관련 도구만 LLM에 전송 (전체 X) |
| **컨텍스트 캐싱** | LLM 제공자의 prompt 캐싱 API 활용 (예: Gemini Context Caching, Anthropic Prompt Caching) |
| **5층 안전장치** | 본 표준의 핵심 — 기능 토글 → Rate Limit → 월 한도 → 도구 결과 캐시 → 컨텍스트 캐시 |

---

## 2. 핵심 아키텍처 — 5층 안전장치

모든 AI 호출은 다음 5층을 순서대로 통과해야 한다. 한 층이라도 차단되면 호출 거부.

```
┌─────────────────────────────────────────────────────────┐
│ [Layer 1] 기능 토글 / 기능별 월 한도                          │
│   → 어드민이 기능 단위로 ON/OFF 또는 한도 설정                │
├─────────────────────────────────────────────────────────┤
│ [Layer 2] 사용자별 Rate Limit (분·시간·일)                  │
│   → 한 사용자의 폭주 차단                                  │
├─────────────────────────────────────────────────────────┤
│ [Layer 3] 전체 월 한도 (예: $100) + 분 단위 급증 cooldown       │
│   → 시스템 전체의 비용 폭증 차단                              │
├─────────────────────────────────────────────────────────┤
│ [Layer 4] 도구 결과 메모리 캐싱 (5분 LRU)                    │
│   → 같은 호출 반복 시 DB·외부 API 우회                       │
├─────────────────────────────────────────────────────────┤
│ [Layer 5] LLM 컨텍스트 캐싱 (대용량 시스템 프롬프트 시)            │
│   → 시스템 프롬프트 토큰 비용 75% 절감 (LLM 제공자별 정책)        │
└─────────────────────────────────────────────────────────┘
                              ↓
                        [LLM API 호출]
                              ↓
                        [응답 후처리]
                  → PII 마스킹 → 비용 기록 → 결과 압축 저장
```

**원칙**:
- 각 층은 **독립적** — 한 층 우회해도 다른 층이 차단
- 비용 차단은 **즉시 효과** (HTTP 429 응답)
- 토글·한도 변경은 **30~60초 내 모든 인스턴스 반영** (메모리 캐시 TTL)

---

## 3. 도구(Tool) 시스템 표준

### 3.1 도구 설계 원칙 (LLM Function Calling 표준 패턴)

| 원칙 | 설명 | 예시 |
|---|---|---|
| **좁은 목적** | 한 도구는 한 가지 일만. 입력·출력 최소 | `members_search(query)` ⭕ vs `members_everything()` ❌ |
| **명확한 description** | 동사로 시작, 40~70자 | "회원 이름·이메일·전화 검색" |
| **enum 명시** | 가능한 값을 description에 | `"todo\|doing\|done\|archived"` |
| **응답 크기 제한** | list 도구는 `limit` 기본 10, 최대 30 | 200건 한 번에 반환 X |
| **핵심 필드만** | `SELECT *` 금지. AI가 쓸 필드만 명시 | content_html 같은 큰 필드 제외 |

### 3.2 도구 카테고리 (참고: SIREN 42개 도구)

| 카테고리 | 개수 | 예시 |
|---|---|---|
| 읽기 — 회원 | 5 | members_search/detail/stats/recent/recent_logins |
| 읽기 — 후원 | 5 | donations_recent/stats/by_member/top/at_risk |
| 읽기 — 신고 | 4 | incidents_list/detail, harassment_list, legal_list |
| 읽기 — 게시판·캠페인 | 3 | board_posts_list, campaigns_list/detail |
| 읽기 — 워크·알림·KPI | 3 | tasks_list, notifications_recent, kpi_summary |
| 읽기 — 콘텐츠·네비 | 2 | content_pages_list, nav_menus_list |
| 읽기 — 감사·발송 | 3 | audit_logs_recent, dispatch_logs_recent, auto_triggers_recent |
| **변경 — 콘텐츠** | 4 | content_pages_update, notice_create/update, campaign_create/update |
| **변경 — 회원** | 3 | members_update, members_block/unblock |
| **변경 — 후원** | 1 | donations_status_update |
| **변경 — 신고** | 3 | incidents/harassment/legal_status_update |
| **변경 — 게시판·작업** | 3 | board_post_delete, task_create/update |
| **변경 — 발송** | 2 | email_send, notification_send |

### 3.3 변경 도구 표준 — dry-run + 승인

```typescript
// 변경 도구는 반드시 다음 패턴
async function tool_xxxUpdate(args, adminId): Promise<ToolResult> {
  // 1. 입력 검증 (필수·enum·길이)
  const id = Number(args?.xxxId);
  if (!id) return { ok: false, error: "xxxId 필수" };

  // 2. 변경 전 값 조회 (rollbackData)
  const before = await loadCurrentValue(id);
  if (!before) return { ok: false, error: "대상 없음" };

  // 3. preview 생성
  const preview = { id, before, changes: patch };

  // 4. dry-run 경로 (기본)
  if (args?.requireApproval !== false) {
    return { ok: true, preview, output: { dry_run: true, message: "승인 대기" } };
  }

  // 5. 실제 적용
  try {
    await db.update(...);
    return {
      ok: true,
      output: { updated: true, id, changes: patch },
      rollbackData: { table: "xxx", id, before }  // ← 자동 백업
    };
  } catch (e) { return { ok: false, error: e.message }; }
}
```

### 3.4 동적 도구 로딩 (의도 분류)

전체 도구 declaration을 매 호출에 보내면 input 토큰 폭증. 의도 분류로 4~8개만 전송.

```typescript
const TOOL_GROUPS = [
  { name: "members", tools: ["members_*"], keywords: ["회원", "가입", "로그인"] },
  { name: "donations", tools: ["donations_*", "donors_*"], keywords: ["후원", "기부", "정기"] },
  { name: "siren", tools: ["incidents_*", "harassment_*", "legal_*"], keywords: ["사건", "신고", "민원"] },
  // ...
];

function selectRelevantTools(userMessage) {
  const matched = TOOL_GROUPS.filter(g => g.keywords.some(k => userMessage.includes(k)));
  if (matched.length === 0 || matched.length >= 4) return null; // 전체 도구
  return matched.flatMap(g => g.tools);
}
```

**규칙**:
- 매칭 0개 (의도 불명) → 전체 도구로 폴백 (안전)
- 매칭 4개 이상 (광범위) → 전체 도구로 폴백
- 첫 사용자 메시지에만 분류, 후속 step은 같은 셋 유지

---

## 4. 비용 절감 정책 (9개)

### A1. 동적 도구 로딩
- **목적**: 도구 declaration이 매 호출의 input 토큰 30~50%를 차지. 의도와 무관한 도구는 안 보내기.
- **동작**: 첫 사용자 메시지 키워드 → 도구 그룹 매칭 → 관련 도구만 LLM에 전송
- **효과**: input 토큰 60~70% ↓
- **트레이드오프**: 분류 부정확 시 도구 누락 → 전체 폴백 안전망 필수

### A2. 도구 결과 압축 저장
- **목적**: 도구가 큰 결과(예: 100명 목록 JSON)를 반환하면, 다음 호출부터 그게 messages에 누적 → 매 호출 토큰 증가
- **동작**: 응답 후 messages 저장 시점에 800자↑ functionResponse를 `[이전 호출 결과: N개 항목 — 필요 시 재호출]`로 대체
- **효과**: 누적 input 토큰 40~70% ↓
- **트레이드오프**: 후속 step에서 raw 데이터 재참조 불가 → 시스템 프롬프트에 "필요 시 도구 재호출" 안내

### A3. 대화 요약
- **목적**: 20턴 대화에서 input 토큰 폭증
- **동작**: 10턴 (20 메시지) 넘으면 앞 절반을 가벼운 LLM(예: gemini-flash-lite)로 200자 요약 후 system 노트로 압축
- **효과**: 누적 input 토큰 80~90% ↓
- **트레이드오프**: 요약 호출 1회 비용 발생 — 그 후 5회 이상 호출이 있으면 이득
- **구현**: 이미 요약된 대화는 새 부분만 누적 요약 (요약본 + 새 메시지 → 새 요약본)

### A4. 응답 토큰 한도
- **목적**: LLM이 길게 답하면 output 토큰 폭증
- **동작**: `maxOutputTokens` 명시 (예: 768)
- **효과**: output 토큰 직접 한도
- **트레이드오프**: 너무 짧으면 응답 잘림 → 사용처별 조정 (분석 4000, 채팅 768 등)

### A5. 도구 description 단축
- **목적**: 매 호출에 모든 도구 declaration이 input에 포함됨
- **동작**: 동사 시작, 40~70자, 자명한 필드는 description 생략
- **효과**: declaration input 토큰 30~40% ↓
- **트레이드오프**: 너무 짧으면 LLM이 도구 의미 못 알아봄 → enum·필수 필드는 유지

### A6. 도구 결과 메모리 캐싱
- **목적**: 같은 호출 5분 내 반복 시 DB 조회·외부 API 우회
- **동작**: 메모리 LRU (최대 200건, TTL 5분). 키: `${toolName}:${stableStringify(args)}`
- **효과**: 응답 속도 ↑ (DB·API 0ms), LLM 비용은 동일
- **트레이드오프**: 데이터 신선도 — 변경 도구 호출 시 관련 캐시 자동 무효화
- **무효화 매핑**: `notice_create` → `board_posts_list` 캐시 청소

### A7. LLM 모델 폴백 체인
- **목적**: 가장 저렴한 모델 우선, 실패 시 상위 모델
- **동작**: 1순위 lite (저렴) → 2순위 flash → 3순위 pro
- **효과**: 평균 모델 비용 50~70% ↓
- **예시 (Gemini)**: `gemini-3.1-flash-lite` ($0.025/M input) → `gemini-2.5-flash` ($0.075/M)
- **트레이드오프**: lite 품질이 낮을 수 있음 → 자동 fallback이 폴리시

### A8. LLM 컨텍스트 캐싱
- **목적**: 큰 시스템 프롬프트가 매 호출 input에 반복 포함됨
- **동작**: LLM 제공자의 prompt cache API 사용 (Gemini Context Caching, Anthropic Prompt Caching)
- **효과**: 캐시된 토큰은 일반의 25~50% 비용
- **제약**: 제공자별 최소 토큰 (Gemini 32k, Anthropic 1k+)
- **인프라 준비**: 32k 미달이어도 향후 자동 작동하도록 코드 인프라 마련

### A9. 시스템 프롬프트 절감 지침
- **목적**: AI 자체가 비용 의식하게
- **동작**: 시스템 프롬프트에 명시
  - "응답은 N자 이내 권장"
  - "raw JSON 출력 금지"
  - "같은 도구 반복 호출 금지"
  - "압축된 이전 결과는 정말 필요할 때만 재호출"
- **효과**: output 토큰 + 불필요한 도구 호출 감소

---

## 5. 차단·한도 정책 (8개)

### B1. 전체 월 한도
- **목적**: 시스템 전체 월 LLM 비용 상한
- **동작**: `ai_cost_summary` 월 누계가 임계 초과 시 모든 AI 호출에 HTTP 429
- **권장 임계**: 운영 규모의 1.2배 (예상 $80 → 한도 $100)
- **환경변수**: `AI_MONTHLY_BUDGET_USD`

### B2. 경고 임계 + 자동 알림
- **목적**: 한도 도달 전 미리 경고
- **동작**: 한도의 80% 도달 시 응답 끝에 안내 + 일일 cron이 이메일 발송
- **환경변수**: `AI_WARN_THRESHOLD_USD`

### B3. 기능별 월 한도
- **목적**: 특정 비싼 기능만 한도 (예: cron 자동 분석 $20, AI 비서 채팅 무제한)
- **동작**: 어드민 화면에서 기능별 monthly_budget_usd 입력
- **효과**: 비싼 기능만 차단, 나머지는 계속 동작

### B4. 사용자별 Rate Limit
- **목적**: 한 사용자의 폭주·악용 차단
- **동작**: 분·시간·일 3중 카운터 (예: 10/50/500)
- **저장**: 메모리 + DB 백업 (multi-instance 안전)
- **환경변수**: `AI_RATE_LIMIT_PER_MINUTE/HOUR/DAY`

### B5. 대화당 input 토큰 한도
- **목적**: 한 대화의 누적 input이 통제 불능으로 커지는 것 차단
- **동작**: 호출 직전 추정 (messages + systemPrompt + tools 길이 / 3.5)
- **권장 임계**: 50,000 토큰 도달 시 새 대화 강제

### B6. 대화당 도구 호출 한도
- **목적**: AI가 한 대화에서 도구를 무한 호출 차단
- **권장 임계**: 10회

### B7. 같은 도구 연속 호출 차단
- **목적**: 무한 루프 방지
- **권장 임계**: 같은 도구 N회 연속 시 fake error 반환 (예: 2회)

### B8. 분 단위 비용 급증 cooldown
- **목적**: 코드 버그·악용으로 5분 안에 비용 폭증 시 즉시 차단
- **동작**: 매 호출 직후 최근 5분 비용 SUM. 임계 (예: $1) 초과 시 5분 cooldown
- **환경변수**: `AI_SURGE_THRESHOLD_USD` (기본 $1)

---

## 6. 권한·통제 정책 (5개)

### C1. 기능 토글
- **단위**: feature_key (예: `ai_agent_chat`, `cron_briefing`)
- **UI**: 어드민 화면 — 토글 스위치 + 한도 입력
- **효과**: 비싼 기능만 즉시 끄기 가능

### C2. 도구 토글
- **단위**: tool_name
- **UI**: 어드민 화면 — 카테고리별 도구 표
- **효과**: 위험·불필요 도구 즉시 비활성

### C3. 도구별 권한
- **레벨**: `null` (모든 어드민) / `admin` / `super_admin`
- **권장**: 변경 도구는 기본 `super_admin`, 읽기는 `null`
- **체크 시점**: 도구 호출 직전

### C4. 시스템 프롬프트 어드민 편집
- **목적**: 운영 중 AI 동작 규칙 조정 (재배포 없이)
- **검증**: 30~8,000자, 슈퍼관리자만 변경 가능
- **반영**: 60초 메모리 캐시 → 모든 인스턴스 반영

### C5. 변경 도구 dry-run 우선
- **표준**: 모든 변경 도구는 `requireApproval` 인자 (기본 true)
- **흐름**: dry-run preview → 사용자 명시 승인 → `requireApproval=false`로 재호출 → 실제 적용
- **UI**: 위젯에 자동 승인 버튼 (preview 받으면 표시)

---

## 7. 안전·보안 정책 (4개)

### D1. PII(개인정보) 자동 마스킹
- **대상 (위험)**: 주민등록번호, 카드번호, 계좌번호
- **제외 (업무 필요)**: 전화번호, 이메일 — 어드민이 봐야 함
- **시점**: LLM 응답 → 사용자 발송 직전
- **표시**: 응답 끝에 "🔒 개인정보 N건 마스킹" 안내
- **환경변수**: `AI_PII_MASK_DISABLED=true`로 테스트 비활성 가능

### D2. rollbackData 자동 기록
- **표준**: 모든 변경 도구는 변경 전 값을 `rollbackData`에 담아 로그 저장
- **저장 위치**: `ai_agent_logs.rollback_data` JSONB
- **활용**: 사후 롤백 도구·감사·분쟁 대응

### D3. 입력 검증
- **표준**: 모든 도구 핸들러는 입력 화이트리스트 검증
- **enum**: Set으로 정의 후 체크 (`if (!ALLOWED.has(value)) return error`)
- **길이**: `.slice(0, N)`로 강제 절단

### D4. 감사 로그 통합
- **모든 AI 호출은 ai_usage_logs에 INSERT**:
  - feature_key, model, admin_id, conversation_id
  - input_tokens, output_tokens, cached_tokens, cost_usd
  - duration_ms, success, error
- **변경 도구는 추가로 ai_agent_logs에 rollback_data**

---

## 8. 가시성·로깅 정책 (6개)

### E1. 통합 호출 로그
- **테이블**: `ai_usage_logs` — 모든 LLM 호출
- **인덱스**: feature_key+created_at DESC, admin_id+created_at DESC

### E2. 기능별 일·월 비용 집계
- **테이블**: `ai_cost_summary`
- **차원**: (period_type, period_key, feature_key)
- **feature_key NULL** = 전체 합계
- **UPSERT 호출당**: 4번 (daily 전체·기능별, monthly 전체·기능별)

### E3. 어드민 비용 대시보드
- **위치**: `/admin-ai-cost.html` (또는 유사)
- **요소**:
  - 상단 카드: 오늘·이번달·한도·사용률
  - 14일 일별 차트
  - 기능 표 (토글·한도·사용량)

### E4. 호출 로그 상세 조회
- **위치**: 같은 대시보드 하단
- **필터**: feature, from, to, minCost, sort(recent|cost)
- **용도**: 비용 폭증 시 "비용 큰 순"으로 원인 호출 즉시 식별

### E5. 자동 임계 알림 (이메일)
- **시각**: 매일 09:00 KST (cron)
- **조건**: 월 한도 80% 도달 또는 100% 초과
- **내용**: 비용·사용률·기능별 사용량 + 대시보드 링크
- **수신**: 환경변수로 설정 (`ADMIN_NOTIFY_EMAIL`)

### E6. 비용 급증 알림
- **조건**: 어제 비용이 직전 7일 평균의 3배 이상
- **시각**: 같은 cron
- **목적**: 의도치 않은 비용 폭증 발견

---

## 9. AI 기능·UX 표준 (7개)

### F1. 도구 시스템 (CRUD 완비)
- **읽기·변경 도구 모두 제공** — AI가 "수정해" 같은 요청 처리 가능
- **변경 도구 부족 시**: AI가 우회 시도 → 비용 낭비 + 사용자 답답함

### F2. 첨부 파일 분석
- **지원**: PDF, JPEG, PNG, WebP
- **한도**: 최대 4개 / 합계 5MB
- **전송 순서**: 파일 먼저 → 텍스트 나중 (LLM 권장 패턴)

### F3. 대화 검색
- **방식**: 제목 + messages 본문 ILIKE
- **UX**: 사이드바 검색 인풋 300ms debounce

### F4. 계획 모드
- **트리거**: "계획", "단계별" 키워드 또는 도구 3개+변경 도구 섞인 복잡 요청
- **흐름**: AI가 `## 실행 계획` 형식 응답 → 사용자 "진행" 답 → AI 단계 실행
- **UI**: 응답에 자동 [▶ 진행] [✏️ 수정 요청] 버튼

### F5. 빠른 명령 칩
- **위치**: 입력란 위 가로 스크롤
- **개수**: 6~8개 (자주 쓰는 조회 위주)
- **동작**: 클릭 즉시 전송

### F6. 마크다운 표 자동 렌더
- **AI 응답에만 적용** (사용자 메시지는 textContent 유지)
- **지원**: 마크다운 표, **굵게**, `코드`, 줄바꿈
- **금지**: 임의 HTML — XSS 방지

### F7. SSE 스트리밍
- **방식**: Server-Sent Events (text/event-stream)
- **효과**: 첫 글자 표시 0.5~1초 (vs 응답 완료 대기 5초)
- **이벤트**: start / text / tool_start / tool_done / approval / done / error
- **첨부 파일 있을 때는 일반 JSON으로 폴백** (stream에서 base64 전송 부담)

---

## 10. 운영 자동화 (3개)

### G1. 임계 알림 cron
- **빈도**: 매일 09:00 KST
- **동작**: 월 한도·경고·급증 체크 + 이메일 (멱등 — 하루 1회만 발송)

### G2. 로그 자동 청소 cron
- **빈도**: 매일 03:00 KST
- **대상**:
  - rate_limit_log: 30일 지난 행
  - usage_logs: 90일 지난 행
  - prompt_cache: 만료된 행

### G3. 빌드 최적화
- **표준**: 큰 정적 파일(폰트·이미지·PDF 템플릿)은 필요한 함수에만 포함
- **Netlify 예**: `included_files`를 전역 X, 함수별로 분리
- **효과**: 빌드 시간 30~50% ↓

---

## 11. DB 스키마 표준

### 11.1 핵심 테이블

```sql
-- 1. 통합 호출 로그
CREATE TABLE ai_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  feature_key VARCHAR(60) NOT NULL,
  model VARCHAR(60),
  admin_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  conversation_id BIGINT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ai_usage_logs_feature_idx ON ai_usage_logs(feature_key, created_at DESC);
CREATE INDEX ai_usage_logs_admin_idx ON ai_usage_logs(admin_id, created_at DESC);

-- 2. 일·월 비용 집계 (기능 차원 포함)
CREATE TABLE ai_cost_summary (
  id BIGSERIAL PRIMARY KEY,
  period_type VARCHAR(10) NOT NULL,    -- 'daily' | 'monthly'
  period_key VARCHAR(20) NOT NULL,     -- '2026-05-13' | '2026-05'
  feature_key VARCHAR(60),             -- NULL = 전체 합계
  total_input_tokens BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  call_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- partial unique (NULL과 NOT NULL 분리)
CREATE UNIQUE INDEX ai_cost_summary_total_uk
  ON ai_cost_summary(period_type, period_key) WHERE feature_key IS NULL;
CREATE UNIQUE INDEX ai_cost_summary_feature_uk
  ON ai_cost_summary(period_type, period_key, feature_key) WHERE feature_key IS NOT NULL;

-- 3. 기능 설정 (메타 + 토글 + 한도)
CREATE TABLE ai_feature_settings (
  feature_key VARCHAR(60) PRIMARY KEY,
  feature_name VARCHAR(120) NOT NULL,
  category VARCHAR(30) NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  monthly_budget_usd NUMERIC(10,2),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 도구 권한
CREATE TABLE ai_tool_permissions (
  tool_name VARCHAR(100) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  required_role VARCHAR(20),           -- NULL | 'admin' | 'super_admin'
  description TEXT,
  is_mutation BOOLEAN NOT NULL DEFAULT FALSE,
  category VARCHAR(30),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. AI 에이전트 대화 (멀티턴 보관)
CREATE TABLE ai_agent_conversations (
  id BIGSERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title VARCHAR(200),
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. 도구 호출·rollback 로그
CREATE TABLE ai_agent_logs (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT REFERENCES ai_agent_conversations(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  tool_name VARCHAR(100),
  input_args JSONB,
  output JSONB,
  status VARCHAR(20),
  rollback_data JSONB,            -- 변경 전 값 보존
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 비용 추적 (선택)
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(10,6),
  model VARCHAR(60)
);

-- 7. Rate Limit 카운터
CREATE TABLE ai_rate_limit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  window_type VARCHAR(10) NOT NULL,    -- 'minute' | 'hour' | 'day'
  call_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(admin_id, window_type, window_start)
);

-- 8. 시스템 프롬프트 등 키-값 설정
CREATE TABLE ai_agent_settings (
  key VARCHAR(60) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER
);

-- 9. (선택) LLM 컨텍스트 캐싱 ID 보관
CREATE TABLE ai_prompt_cache (
  id BIGSERIAL PRIMARY KEY,
  cache_key VARCHAR(120) NOT NULL UNIQUE,
  cache_name TEXT NOT NULL,
  model VARCHAR(60) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 12. API 엔드포인트 표준

| 엔드포인트 | 메서드 | 용도 |
|---|---|---|
| `/api/admin-ai-agent` | POST | 일반 AI 대화 (JSON 응답) |
| `/api/admin-ai-agent-stream` | POST | SSE 스트림 응답 (선택) |
| `/api/admin-ai-features` | GET | 기능 목록·사용량·토글 상태 |
| `/api/admin-ai-features` | POST | 기능 토글 / 한도 변경 |
| `/api/admin-ai-cost-stats[?features=1&infra=1]` | GET | 비용 통계·14일 추이 |
| `/api/admin-ai-config` | GET | 시스템 프롬프트·도구 권한 |
| `/api/admin-ai-config` | POST | 프롬프트·도구 권한 변경 |
| `/api/admin-ai-usage-logs?feature&from&to&minCost&sort` | GET | 호출 로그 상세 |
| `/api/admin-ai-conversations-list?q&limit&offset` | GET | 대화 이력 (검색 지원) |
| `/api/admin-ai-conversation-detail?id` | GET | 단일 대화 + 도구 로그 |
| `/api/migrate-ai-*?run=1` | GET | 1회용 DB 마이그레이션 |

---

## 13. 코드 모듈 구조

```
lib/
├── ai-cost-monitor.ts      # 모델 가격표·토큰 기록·월 한도 체크
├── ai-feature.ts           # 기능 토글·기능별 한도·통합 집계·surge cooldown
├── ai-cache.ts             # 도구 결과 메모리 LRU 캐시
├── ai-rate-limit.ts        # 분·시간·일 카운터 (메모리 + DB)
├── ai-prompt-cache.ts      # LLM 컨텍스트 캐싱 (선택)
├── ai-agent-config.ts      # 시스템 프롬프트·도구 권한 로더 (60초 캐시)
├── ai-agent-tools.ts       # 도구 선언 + 실행 핸들러 (모든 도구)
├── ai-gemini.ts            # LLM API 래퍼 (featureKey 필수, 자동 기록)
├── sse-writer.ts           # SSE 응답 헬퍼
├── gemini-stream.ts        # LLM 스트림 호출 헬퍼
└── pii-mask.ts             # 개인정보 자동 마스킹

netlify/functions/
├── admin-ai-agent.ts                # 일반 AI 대화
├── admin-ai-agent-stream.ts         # SSE 버전
├── admin-ai-features.ts             # 기능 관리 API
├── admin-ai-cost-stats.ts           # 비용 통계
├── admin-ai-config.ts               # 시스템 프롬프트·도구 권한
├── admin-ai-usage-logs.ts           # 호출 로그 상세
├── cron-ai-cost-alert.ts            # 매일 09:00 임계 알림
├── cron-ai-logs-cleanup.ts          # 매일 03:00 로그 청소
└── migrate-ai-*.ts                  # 1회용 마이그

public/
├── admin-ai-cost.html      # 비용 대시보드
├── admin-ai-config.html    # AI 비서 설정
├── admin-ai-assistant.html # AI 비서 채팅 (풀스크린)
└── js/ai-agent-widget.js   # 플로팅 채팅 위젯
```

---

## 14. 환경변수 표준

| 변수 | 기본값 | 용도 |
|---|---|---|
| `{LLM}_API_KEY` | (필수) | LLM 제공자 API 키 |
| `AI_MONTHLY_BUDGET_USD` | 100 | 전체 월 한도 |
| `AI_WARN_THRESHOLD_USD` | 80 | 경고 임계 |
| `AI_RATE_LIMIT_PER_MINUTE` | 10 | 사용자별 분당 한도 |
| `AI_RATE_LIMIT_PER_HOUR` | 50 | 사용자별 시간당 한도 |
| `AI_RATE_LIMIT_PER_DAY` | 500 | 사용자별 일 한도 |
| `AI_SURGE_THRESHOLD_USD` | 1.00 | 분 단위 급증 임계 (5분 누계) |
| `AI_PII_MASK_DISABLED` | (false) | true 시 PII 마스킹 비활성 (테스트용) |
| `ADMIN_NOTIFY_EMAIL` | (필수) | 알림 받을 어드민 이메일 |

---

## 15. 운영 절차

### 15.1 신규 AI 호출 추가 시

1. **featureKey 결정** — 등록된 기능에 매칭하거나 새 키 등록
2. **lib/ai-gemini.ts** (또는 공용 LLM 래퍼) 호출 시 `featureKey` 인자 명시
3. 새 기능이면:
   - `FEATURE_REGISTRY` (lib)에 추가
   - 마이그레이션 함수로 `ai_feature_settings`에 시드 INSERT
4. 1주 운영 후 대시보드에서 사용량 확인 → 필요 시 기능별 한도 설정

### 15.2 신규 도구 추가 시

1. **읽기 vs 변경** 결정 — 변경이면 dry-run·rollbackData 필수
2. **권한 결정** — 변경 도구는 기본 super_admin, 읽기는 NULL
3. **TOOL_DECLARATIONS** (lib)에 선언 — description 40~70자
4. **executeTool switch** case 추가
5. **핸들러 함수** 작성 (변경 도구는 dry-run 패턴 준수)
6. **TOOL_GROUPS** (동적 로딩) 매핑 추가 — 키워드 분류
7. **마이그레이션** 함수로 `ai_tool_permissions` 시드 (enabled, required_role, is_mutation, category)
8. 어드민 화면에서 권한·토글 확인

### 15.3 비용 폭증 발생 시 대응

1. **즉시 차단** — 어드민 화면에서 의심 기능 토글 OFF
2. **원인 분석** — `/admin-ai-usage-logs?sort=cost`로 비싼 호출 식별
3. **패턴 발견** — 같은 도구 반복? 도구 결과 너무 큼? 무한 루프?
4. **단기 조치** — 기능별 한도 설정 또는 도구 비활성
5. **장기 조치** — 코드 수정 (도구 정밀화, 시스템 프롬프트 강화)

### 15.4 분기·반기 점검

- **사용 분포** — 어떤 기능이 비용 많이 쓰는가
- **모델 비용 검증** — 첫 청구서와 cost_usd 합계 대조, 가격표 보정
- **도구 사용 패턴** — 자주 안 쓰이는 도구는 declaration에서 제외 고려
- **시스템 프롬프트 다듬기** — 운영 중 발견된 비효율 패턴 반영

---

## 16. 도입 체크리스트

### 16.1 1단계 — 기반 구축

- [ ] LLM 제공자 결정 + API 키 발급
- [ ] DB 테이블 9개 마이그레이션
- [ ] lib 모듈 6~10개 작성
- [ ] 환경변수 설정 (한도·임계·이메일)
- [ ] 통합 호출 로그 동작 확인

### 16.2 2단계 — 5층 안전장치

- [ ] Layer 1: 기능 토글 + 기능별 한도 (어드민 화면 1)
- [ ] Layer 2: 사용자별 Rate Limit (DB 카운터)
- [ ] Layer 3: 전체 월 한도 + 분 단위 cooldown
- [ ] Layer 4: 도구 결과 메모리 캐싱
- [ ] Layer 5: LLM 컨텍스트 캐싱 (선택 — 인프라만)

### 16.3 3단계 — 도구 시스템

- [ ] 읽기 도구 카테고리별 12~20개
- [ ] 변경 도구 — 모든 도메인 CRUD 완비 (dry-run 표준)
- [ ] 동적 도구 로딩 (의도 분류)
- [ ] 도구 description 단축 (40~70자)

### 16.4 4단계 — 권한·통제

- [ ] 어드민 화면 — 도구 토글·권한 (어드민 화면 2)
- [ ] 어드민 화면 — 시스템 프롬프트 편집
- [ ] 변경 도구 권한 분리 (admin / super_admin)

### 16.5 5단계 — 가시성

- [ ] 비용 대시보드 (오늘·이번달·14일 차트·기능 표)
- [ ] 호출 로그 상세 조회 (비용 큰 순 정렬)
- [ ] 일일 임계 알림 cron (이메일)
- [ ] 일일 로그 청소 cron

### 16.6 6단계 — UX·기능

- [ ] AI 비서 채팅 위젯 (플로팅 + 풀스크린)
- [ ] 첨부 파일 분석
- [ ] 대화 검색 + 이력 복원
- [ ] 계획 모드 (복잡 작업 단계별 승인)
- [ ] 빠른 명령 칩
- [ ] 마크다운 표 자동 렌더
- [ ] SSE 스트리밍 (선택 — 응답 속도 5배)

### 16.7 7단계 — 안전

- [ ] PII 자동 마스킹 (주민번호·카드·계좌)
- [ ] rollbackData 자동 기록
- [ ] 입력 검증 (화이트리스트·enum)
- [ ] 감사 로그 통합

### 16.8 8단계 — 운영

- [ ] 1주 운영 후 사용량 분포 분석
- [ ] 기능별 한도 미세 조정
- [ ] 1개월 운영 후 LLM 청구서와 cost_usd 대조

---

## 부록 A. 모델 가격표 (참고 — 2026-05 추정)

| 모델 | Input ($/1M) | Output ($/1M) | Cached Input |
|---|---|---|---|
| Gemini 3.1 Flash Lite | 0.025 | 0.10 | 0.00625 |
| Gemini 3 Flash | 0.075 | 0.30 | 0.01875 |
| Gemini 2.5 Flash | 0.075 | 0.30 | 0.01875 |
| GPT-4o mini | 0.15 | 0.60 | 0.075 |
| GPT-4o | 2.50 | 10.00 | 1.25 |
| Claude Haiku 4.5 | 1.00 | 5.00 | (참조) |
| Claude Sonnet 4.5 | 3.00 | 15.00 | (참조) |

**모델 선택 원칙**:
- 도구 호출·간단한 분류: 가장 저렴한 모델 (lite·mini·haiku)
- 복잡한 추론·긴 응답: 중급 (flash·sonnet)
- 매우 복잡한 분석 (cron 등 빈도 낮음): 상급 (pro·opus)

---

## 부록 B. 효과 측정 사례 (SIREN 실증)

| 지표 | 시스템 도입 전 추정 | 도입 후 실측·추정 | 절감/개선 |
|---|---|---|---|
| 단순 호출 1회 input 토큰 | ~3,000 | ~1,200 | 60% ↓ |
| 20턴 대화 누적 input | 폭증 (선형) | 거의 일정 | **80~90% ↓** |
| 응답 첫 글자 표시 | 3~5초 후 | 0.5~1초 (SSE) | **5배 빠름** |
| 변경 작업 처리 가능 | 제한적 | 17개 변경 도구 | 3배 ↑ |
| 폭주 위험 | 무제한 → 폭탄 가능 | 5층 차단 | **∞ ↓** |
| 빌드 시간 | 4분 | 2~3분 | 30~50% ↓ |
| 월 LLM 비용 (예상) | $300~500 | $50~100 | **70~80% ↓** |

---

**문서 버전 이력**:
- v1.0 (2026-05-13): SIREN 프로젝트 실증 기반 초안

**참고 코드**: https://github.com/{org}/{repo} `feature/ai-cost-safety` 브랜치 약 28개 커밋
