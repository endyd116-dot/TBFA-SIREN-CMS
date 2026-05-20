# D. 워크스페이스(협업) 메뉴얼

> **대상**: 내부 운영자·간사·기여자 (운영자 권한 또는 워크스페이스 멤버 자격)
> **진입**: `/workspace.html` — 어드민 로그인 또는 운영자 권한 회원

---

## D-0. 페이지 한눈에

| 페이지 | 경로 | 무엇을 |
|---|---|---|
| 워크스페이스 메인 | `/workspace.html` | 내 업무·일정·알림 요약 |
| WBS(칸반) | `/workspace-kanban.html` | 업무 칸반 보드 (할 일·진행·완료) |
| 캘린더 | `/workspace-calendar.html` | 일정·이벤트·마감 |
| 파일함 | `/workspace-files.html` | 폴더·파일 (R2) |
| 템플릿 | `/workspace-templates.html` | 업무 템플릿 |
| 성과 관리 | `/workspace-milestones.html` | 마일스톤·KPI |
| 근태 관리 | `/workspace-attendance.html` | 출근·재택·연차·본인 명세서 |
| 알림 | `/workspace-notifications.html` | 워크스페이스 알림 인박스 |
| AI 에이전트 소개 | `/ai-agent-pitch.html` | SIREN AI 에이전트 안내 |

---

## D-1. 메인 (`/workspace.html`)

- **내 업무 위젯**: 오늘 마감·이번 주 마감·지연·대기
- **알림 위젯**: 멘션·할당·코멘트
- **일정 위젯**: 오늘·내일 일정
- **AI 비서 진입** (어드민 권한): `/admin-ai-assistant.html`로 점프

---

## D-2. WBS 칸반 (`/workspace-kanban.html`)

### 보드 구조
- 컬럼: `대기 / 진행 / 검토 / 완료` (커스터마이즈 가능)
- 카드: 제목·담당자·마감일·우선순위·태그·체크리스트·첨부·코멘트
- 드래그&드롭(SortableJS)으로 컬럼 이동

### 카드 생성
1. 컬럼 상단 [+ 추가]
2. 제목 입력 → 자동 저장
3. 카드 클릭 → 상세 모달:
   - 설명(Toast UI 에디터)
   - 담당자(다중)·감시자(watcher)
   - 마감일·시작일·예상 소요
   - 체크리스트(소업무)
   - 첨부(R2 업로드)
   - 코멘트(멘션 알림)
   - **AI 자동 요약**: description 100자 이상이면 백그라운드로 1줄 요약 생성 (`ai-task-summary-background`)
   - **AI 리스크 점수**: 매일 06:30 KST 갱신 (`cron-task-risk`) — 마감 지연 위험·우선순위 점수
   - **AI 완료 보고서**: 카드를 [완료]로 이동 시 초안 자동 생성 (`ai-task-completion-background`)

### 반복 업무
- 카드 상세 > [반복 설정] → 매일/매주/매월
- 마감 도래 시 자동으로 새 카드 복제 + 담당자 알림

### 업무 템플릿
- `/workspace-templates.html`에서 미리 정의
- 카드 생성 시 [템플릿에서 시작] → 제목·체크리스트·첨부·태그 그대로 복제

### 검색·필터
- `admin-workspace-task-search`로 제목·내용·담당자·태그·기간 검색
- 저장된 필터(My View) 지원

---

## D-3. 캘린더 (`/workspace-calendar.html`)

- FullCalendar 6 기반 — 월/주/일/리스트 뷰
- **이벤트 종류**: 업무 마감 / 회의 / 출장 / 휴가 / 캠페인 / 협의회 일정
- **RSVP**: 이벤트 클릭 → 참석/불참/미정 응답 (`workspace-event-rsvp`)
- 일정 생성 권한은 어드민 > 워크스페이스 관리에서 역할별 제어

---

## D-4. 파일함 (`/workspace-files.html`)

### 구조
- 폴더 트리(좌측) + 파일 리스트(우측)
- 폴더·파일 모두 권한 상속 (공개 / 워크스페이스 / 특정 역할 / 비공개)

### 업로드
1. 폴더 진입 → [업로드]
2. 파일 선택 → **Pre-signed URL 발급**(`admin-workspace-file-presign`)
3. 클라이언트가 R2에 직접 업로드 (서버 부하 최소)
4. 완료 처리(`admin-workspace-file-confirm`) → DB 등록

### 다운로드·공유
- 다운로드는 만료 URL 발급 (`admin-workspace-file-download`)
- **외부 공유 링크**(`admin-workspace-file-share` / `workspace-file-share`):
  - 만료일 설정
  - 비밀번호 보호
  - 다운로드 횟수 제한

### 삭제
- 휴지통 30일 보관 (`cron-workspace-trash-cleanup`이 30일 경과분 영구 삭제)
- 영구 삭제는 별도 [완전 삭제] 권한 필요

---

## D-5. 성과 관리 (`/workspace-milestones.html`)

### 마일스톤
- 분기·반기·연간 단위 목표
- 하위에 업무 카드 매핑 → 진행률 자동 집계
- **AI 자동 분류**(`ms-ai-classify`): 새 카드 생성 시 적합 마일스톤 추천
- **AI 코칭**(`ms-ai-coaching`): 마일스톤 지연·정체 시 행동 제안
- **AI 인사이트**(`ai-milestone-insight`): 분기 종료 시 회고 초안

### KPI
- 어드민 > 성과관리 설정(`admin-milestone-settings`)에서 지표 정의
- 마일스톤별·담당자별 진행률·달성도

---

## D-6. 근태 관리 (`/workspace-attendance.html`)

### 출근·재택
- 매일 출근 시 [출근] 클릭 → 위치/IP 기록 (정책에 따라)
- 재택 / 출장 / 외근 / 연차 / 반차 선택
- 어드민 > 재택·근무형태 설정(`admin-attendance-settings`)에서 정책 정의

### 휴가
- 휴가 신청 → 결재 라인 → 승인 후 캘린더 자동 반영
- 연차 잔여 자동 계산

### 본인 명세서 (R37 추가)
- `/workspace-attendance.html`의 **명세서** 탭
- 본인 급여 명세서 (PDF 다운로드)
- 어드민 > 급여관리(`admin-payroll`)에서 발급된 분량만 표시

---

## D-7. 알림 (`/workspace-notifications.html`)

- 워크스페이스 활동(할당·멘션·코멘트·승인 요청·마감 임박) 통합 인박스
- 채널: 웹·이메일·푸시
- `cron-workspace-due-reminder` / `cron-workspace-task-reminder`가 마감 임박 자동 발송
- 알림 통합은 `workspace-logger`가 활동 로그 + 알림 동시 기록

---

## D-8. SIREN AI 에이전트(비서)

워크스페이스에서 직접 호출하는 AI 비서(`/admin-ai-assistant.html` — 어드민 권한 필요).

### 사용 방법
1. 우측 사이드바 또는 상단 [AI 비서] 진입
2. 자연어로 질문/명령:
   - "이번 주 마감 업무 보여줘"
   - "김간사 담당 카드 통계"
   - "지난달 후원 총액"
   - "○○님에게 안내 메시지 보내줘"
3. 비서가 **84개 도구** 중 적합한 것 자동 선택 → 실행
4. **변경 작업**(생성·수정·삭제·발송)은 **dry-run 승인** 요구 → 운영자가 [승인] 또는 [거절]

### AI 비서가 할 수 있는 일 (요약)
- 회원·후원·신고·캠페인 조회·통계
- 업무 카드 생성·수정·완료 처리
- 공지·발송 작성 초안
- 유사 사건·유사 회원 매칭
- AI 회신 초안 생성

자세한 카탈로그·도구 목록은 [`ai-assistant-knowledge.md`](ai-assistant-knowledge.md) 참고.

---

## D-9. 자주 묻는 질문

| 질문 | 답 |
|---|---|
| 칸반 카드를 다른 사람에게 넘기려면? | 카드 상세 > 담당자 변경 또는 [담당자 이전](`admin-workspace-task-transfer`). |
| 첨부파일이 안 올라간다 | 파일 100MB 초과·확장자 차단·R2 권한 문제. 콘솔 에러 + 운영자 알림. |
| 마감 알림이 안 와요 | 알림 수신 설정(`workspace-notifications`)에서 채널 ON 여부 확인. |
| 휴가 신청이 결재 안 됨 | 결재자 부재. 어드민 > 권한 정책에서 대리 결재자 지정. |
| AI 비서가 잘못된 답을 한다 | 시스템 프롬프트(`/admin-ai-config.html`)를 다듬거나 도구 권한(`ai_tool_permissions`)을 점검. |
