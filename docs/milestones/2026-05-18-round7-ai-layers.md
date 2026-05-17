# 라운드 7 — AI 에이전트 구조 확장 (Layer 1~4)

> **생성**: 2026-05-18 / **설계자**: 메인 채팅
> **목표**: AI 비서가 "일괄 처리·조건 기반 액션·자동 제안·스케줄" 명령을 처리하게 구조 확장
> **베이스**: main @ `0a31dc7` (AI 도구 116개 운영 중)

---

## §0. 전체 개요

```
Phase 1 (동시): Layer 1 + Layer 2
  A 워크트리 → feature/layer1-batch   → Layer 1 배치 도구 4개
  B 워크트리 → feature/layer2-pipeline → Layer 2 파이프라인 도구 2개

Phase 2 (동시, Phase 1 머지 후):
  A 워크트리 → feature/layer3-hints    → Layer 3 힌트 시스템
  B 워크트리 → feature/layer4-schedule → Layer 4 스케줄 도구

Phase 3 (Phase 2 머지 후):
  C 워크트리 → verify/round7 → Phase 1+2 전체 검증 (Q1~Q6)

D 워크트리: 사용 안 함 (표준 메인·A·B·C 3채팅 구조 유지)
```

---

## §1. Layer 1 — 배치 실행 도구 (A 워크트리)

### 구현 도구 4개

| 도구 | 설명 | 핵심 파라미터 |
|---|---|---|
| `legal_reply_batch` | 법률 상담 여러 건 일괄 답변 | `ids[]`, `responseMode`, `tone`, `fixedResponse` |
| `harassment_reply_batch` | 악성민원 여러 건 일괄 답변 | 동일 패턴 |
| `chat_message_broadcast` | 여러 채팅방에 동일/개별 메시지 | `roomIds[]` or `filter`, `content` |
| `notification_batch` | 여러 회원에게 일괄 사이트 알림 | `memberIds[]`, `title`, `body` (기존 notification_send 배치화) |

### responseMode 설계

```typescript
responseMode: "fixed"        // fixedResponse 텍스트를 모든 건에 동일 적용
responseMode: "ai_generate"  // AI가 각 건의 내용을 읽고 개별 작성 (tone 힌트 사용)
```

`ai_generate` 모드에서 각 건의 본문(description/content)을 SELECT 후 인라인으로 응답 생성.

### 승인 번들링

기존: N건 × 개별 requireApproval
개선: 전체 미리보기 한 번에 반환 → `requireApproval=false` 재호출 시 일괄 실행

```typescript
// dry-run 응답 예시
{
  dry_run: true,
  total: 7,
  previews: [
    { id: 1, title: "...", draftResponse: "안녕하세요..." },
    { id: 2, title: "...", draftResponse: "..." },
    ...
  ],
  message: "7건 미리보기. requireApproval=false로 재호출 시 전부 처리."
}
```

### 작업 체크리스트 (A 담당)

- [ ] TOOL_DECLARATIONS 끝에 `/* === Layer 1 배치 도구 === */` 섹션 추가
- [ ] `legal_reply_batch` 선언 + 핸들러 (`tool_legalReplyBatch`)
- [ ] `harassment_reply_batch` 선언 + 핸들러 (`tool_harassmentReplyBatch`)
- [ ] `chat_message_broadcast` 선언 + 핸들러 (`tool_chatMessageBroadcast`)
- [ ] `notification_batch` 선언 + 핸들러 (`tool_notificationBatch`)
- [ ] dispatch switch 4개 등록
- [ ] push → 메인에 알림

### 파일 작업 범위

```
lib/ai-agent-tools.ts   ← TOOL_DECLARATIONS 끝 + 핸들러 함수 끝에 추가
                           (기존 코드 수정 절대 금지 — append-only)
```

---

## §2. Layer 2 — 필터 + 액션 파이프라인 도구 (B 워크트리)

### 구현 도구 2개

| 도구 | 설명 |
|---|---|
| `email_send_by_filter` | 회원 조건 필터링 후 맞춤 이메일 일괄 발송 |
| `bulk_pipeline` | 범용 source+filter+action 파이프라인 |

### email_send_by_filter 설계

```typescript
email_send_by_filter({
  memberFilter: {
    donationMonths: { gte: 24 },   // 24개월 이상 정기 후원자
    type: "regular",
    churnRiskLevel: "high",        // 이탈 위험 높음
    agreeEmail: true               // 이메일 수신 동의자만
  },
  subject: "감사합니다, {{name}}님",
  bodyMode: "ai_generate",         // "fixed" | "ai_generate"
  bodyTemplate: "...",             // bodyMode=fixed 시 사용
  tone: "따뜻하고 격식있게",
  wrapWithLayout: true,
  layout: "editorial",
  requireApproval: true
})
```

**memberFilter 지원 조건**:
| 필드 | 타입 | 설명 |
|---|---|---|
| type | string | regular\|family\|volunteer |
| donationMonths | `{gte/lte: N}` | 후원 기간 (개월) |
| churnRiskLevel | string | high\|critical\|medium |
| lastDonationDays | `{gte/lte: N}` | 마지막 후원 경과 일수 |
| agreeEmail | boolean | 이메일 수신 동의 |
| joinedDays | `{gte/lte: N}` | 가입 경과 일수 |

### bulk_pipeline 설계

```typescript
bulk_pipeline({
  source: "legal_consultations",   // members|legal_consultations|harassment_reports|chat_rooms
  filter: { status: "submitted" },
  action: "legal_reply",
  actionParams: {
    status: "responded",
    responseMode: "ai_generate",
    tone: "정중한 거절"
  },
  requireApproval: true
})
```

**지원 source + 가능 action 매핑**:
| source | 가능 action |
|---|---|
| `members` | `email_send`, `notification_send`, `members_block` |
| `legal_consultations` | `legal_reply`, `legal_status_update` |
| `harassment_reports` | `harassment_reply`, `harassment_status_update` |
| `chat_rooms` | `chat_message_send`, `chat_room_close` |

### 작업 체크리스트 (B 담당)

- [ ] TOOL_DECLARATIONS 끝에 `/* === Layer 2 파이프라인 === */` 섹션 추가
- [ ] `email_send_by_filter` 선언 + 핸들러 (`tool_emailSendByFilter`)
  - memberFilter SQL 빌더 구현 (안전한 whitelist 기반)
  - bodyMode=ai_generate 시 이름·후원기간 컨텍스트 주입
- [ ] `bulk_pipeline` 선언 + 핸들러 (`tool_bulkPipeline`)
  - source별 SELECT + action 디스패치
- [ ] dispatch switch 2개 등록
- [ ] push → 메인에 알림

### 파일 작업 범위

```
lib/ai-agent-tools.ts   ← TOOL_DECLARATIONS 끝 + 핸들러 함수 끝에 추가
                           (기존 코드 수정 절대 금지 — append-only)
```

---

## §3. Layer 3 — 연쇄 작업 힌트 시스템 (A 워크트리 Phase 2)

> **시작 조건**: Phase 1 (A+B) 머지 완료 후

### 설계

모든 ToolResult에 선택적 `suggestedNextSteps` 필드 추가:

```typescript
interface ToolResult {
  ok: boolean;
  output?: any;
  preview?: any;
  rollbackData?: any;
  error?: string;
  suggestedNextSteps?: Array<{    // ← NEW
    tool: string;
    reason: string;
    params?: Record<string, any>;
  }>;
}
```

### 힌트를 추가할 핸들러 15개

| 핸들러 완료 시 | 제안할 다음 액션 |
|---|---|
| `legal_reply` / `legal_reply_batch` | email_send (답변 메일), chat_message_send (채팅방 알림) |
| `harassment_reply` / `harassment_reply_batch` | 관련 채팅방 확인 |
| `email_send` | notification_send (인앱 알림 동시 발송), task_create (발송 후속 작업) |
| `chat_message_send` | chat_room_close (답변 완료 시 종료) |
| `members_block` | notification_send (당사자 알림), audit_logs_recent (이력 확인) |
| `campaign_create` | email_send (캠페인 공지), notice_create (공지 등록) |
| `email_template_create` | email_send (즉시 테스트 발송 제안) |
| `bulk_pipeline` | email_send (결과 요약 메일), task_create (후속 작업) |
| `recipient_group_create` | email_send_by_filter (그룹 즉시 활용) |
| `task_create` | event_create (마감일 캘린더 등록) |

### 작업 체크리스트 (A 담당 — Phase 2)

- [ ] `ToolResult` 인터페이스에 `suggestedNextSteps` 필드 추가
- [ ] `buildNextSteps(toolName, result, context)` 헬퍼 함수 작성 (파일 끝)
- [ ] 위 15개 핸들러 반환값에 `suggestedNextSteps` 주입
- [ ] push → 메인에 알림

### 파일 작업 범위

```
lib/ai-agent-tools.ts   ← ToolResult 인터페이스 수정 + 15개 핸들러 수정
                           (기존 핸들러 반환 부분만 수정, 로직 변경 금지)
```

---

## §4. Layer 4 — 스케줄 명령 도구 (B 워크트리 Phase 2)

> **시작 조건**: Phase 1 (A+B) 머지 완료 후

### DB 마이그레이션

새 테이블 `ai_scheduled_commands`:

```sql
CREATE TABLE ai_scheduled_commands (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  cron_expr   VARCHAR(50) NOT NULL,    -- "0 9 * * 1" (매주 월요일 9시)
  command     TEXT NOT NULL,           -- AI에게 보낼 자연어 명령
  admin_id    INTEGER REFERENCES members(id),
  is_active   BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  last_result TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
```

→ `netlify/functions/migrate-ai-schedule.ts` 작성 후 마이그레이션 호출

### 구현 도구 3개

| 도구 | 설명 |
|---|---|
| `schedule_command` | 명령을 cron 일정으로 등록 |
| `scheduled_commands_list` | 등록된 스케줄 목록 |
| `schedule_cancel` | 스케줄 비활성화 |

```typescript
schedule_command({
  name: "주간 이탈 위험 후원자 리포트",
  cronExpr: "0 9 * * 1",           // 매주 월요일 09:00 KST
  command: "이탈 위험 후원자 목록 조회해서 관리자에게 요약 메일 보내줘",
  requireApproval: true
})
```

### Cron 실행 함수

`netlify/functions/cron-ai-schedule-runner.ts`:
- 10분 주기 실행
- `next_run_at <= NOW() AND is_active = true` 인 명령 조회
- 해당 `command` 텍스트를 AI 에이전트 내부 실행 함수로 호출
- 결과 → `last_result` 저장, `next_run_at` 갱신

### 작업 체크리스트 (B 담당 — Phase 2)

- [ ] `migrate-ai-schedule.ts` 마이그레이션 함수 작성
- [ ] TOOL_DECLARATIONS 끝에 `/* === Layer 4 스케줄 === */` 섹션 추가
- [ ] `schedule_command` 선언 + 핸들러
- [ ] `scheduled_commands_list` 선언 + 핸들러
- [ ] `schedule_cancel` 선언 + 핸들러
- [ ] `cron-ai-schedule-runner.ts` 작성
- [ ] `netlify.toml`에 cron 스케줄 추가 (`*/10 * * * *`)
- [ ] dispatch switch 3개 등록
- [ ] push → 메인에 알림 (마이그 호출 필요 명시)

### 파일 작업 범위

```
netlify/functions/migrate-ai-schedule.ts   ← 신규 (1회용 마이그레이션)
netlify/functions/cron-ai-schedule-runner.ts ← 신규 cron
lib/ai-agent-tools.ts                      ← 끝에 3개 추가
netlify.toml                               ← cron 1줄 추가
```

---

## §5. 머지 순서

```
Phase 1 완료 후:
  git merge feature/layer1-batch    (A)
  git merge feature/layer2-pipeline (B)
  → 충돌 예상 위치: TOOL_DECLARATIONS 끝, dispatch switch 끝
  → 충돌 해결: 두 섹션 모두 유지 (append-only)
  → C에게 검증 트리거 발사 (Q1~Q6 Phase 1 시나리오)
  → 동시에 A(Layer 3)·B(Layer 4) Phase 2 트리거 발사

Phase 2 완료 후:
  git merge feature/layer3-hints    (A)
  git merge feature/layer4-schedule (B)
  → Layer 3: ToolResult 인터페이스 + 핸들러 수정 (일부 충돌 가능 — 두 변경 모두 유지)
  → Layer 4: 신규 파일 위주라 충돌 적음
  → C에게 Phase 2 추가 검증 요청
```

---

## §6. 검증 시나리오 (Phase 1 머지 후 C가 검증)

| # | 명령 | 기대 동작 |
|---|---|---|
| Q1 | "법률 상담 전부 정중한 거절 답변 보내줘" | `legal_reply_batch` 호출, 건수 확인 후 일괄 처리 |
| Q2 | "미답변 채팅방에 잠깐 기다려달라고 전부 보내줘" | `chat_message_broadcast` filter=unreadOnly |
| Q3 | "후원 2년 이상 회원들한테 감사 메일 보내줘" | `email_send_by_filter` donationMonths≥24 |
| Q4 | "이탈 위험 후원자들 수신자 그룹 만들고 재참여 이메일 보내줘" | `recipient_group_create` + `email_send_by_filter` 2단계 |
| Q5 | "이번 달 들어온 악성민원 전부 검토 중으로 상태 바꿔줘" | `bulk_pipeline` source=harassment_reports, action=status_update |
| Q6 | 배치 미리보기 7건 한 번에 확인 후 승인 | dry-run 번들 응답 확인 |

---

## §7. 브랜치 정보

| 채팅 | Phase | Layer | 브랜치 | 워크트리 |
|---|---|---|---|---|
| A | Phase 1 | Layer 1 배치 도구 | `feature/layer1-batch` | `../tbfa-mis-A` |
| B | Phase 1 | Layer 2 파이프라인 | `feature/layer2-pipeline` | `../tbfa-mis-B` |
| A | Phase 2 | Layer 3 힌트 시스템 | `feature/layer3-hints` | `../tbfa-mis-A` |
| B | Phase 2 | Layer 4 스케줄 도구 | `feature/layer4-schedule` | `../tbfa-mis-B` |
| C | Phase 3 | 검증 (Q1~Q6) | `verify/round7` | `../tbfa-mis-C` |

> D 워크트리 사용 안 함 — 표준 메인·A·B·C 3채팅 구조 유지
