# SIREN 통합 메뉴얼

> **대상**: 운영자(어드민) / 회원 / SIREN AI 비서(학습용)
> **갱신**: 2026-05-20 — 1차(골격 + 핵심 5영역 + AI 비서 학습 데이터)
> **운영 주체**: (사)교사유가족협의회 / 라이브 https://tbfa.co.kr

---

## 0. 이 메뉴얼의 구조

메뉴얼은 두 가지 용도로 동시에 사용됩니다.

1. **사람용 — 어드민·회원 사용 가이드**
   영역별 마크다운 문서. "어디서 → 뭘 누르면 → 무슨 일이 일어나는가" 흐름 위주.
2. **AI 비서 학습용 — 시스템 프롬프트 부록 + Q&A JSONL**
   현재 SIREN AI 비서(`/admin-ai-assistant.html`)는 **Gemini Function Calling** 방식으로 84개 도구를 호출합니다. RAG·임베딩이 없으므로, 비서가 "어떤 메뉴·어떤 도구를 안내해야 하는지" 학습시키려면 두 층으로 데이터를 넣습니다.
   - **층1**: [`ai-assistant-knowledge.md`](ai-assistant-knowledge.md) → 어드민 화면에서 시스템 프롬프트(`ai_agent_settings.system_prompt`)에 통째로 붙여넣기. 비서가 매 호출마다 참조.
   - **층2**: [`ai-training.jsonl`](ai-training.jsonl) → 100문항 Q&A. 향후 few-shot 또는 RAG 도입 시 즉시 인덱싱. 지금 당장은 사람용 FAQ로도 사용 가능.

---

## 1. 영역별 메뉴얼 (1차 핵심 5영역)

| # | 영역 | 파일 | 대상 | 페이지 수 |
|---|---|---|---|---|
| A | 홈페이지(공개) | [`homepage.md`](homepage.md) | 일반 방문자 | 약 20 |
| B | 회원 마이페이지 | [`member-mypage.md`](member-mypage.md) | 로그인 회원 | 약 10 |
| C | SIREN 신고(3종) | [`siren-report.md`](siren-report.md) | 신고자·피해자·유족 | 신고 3종 + 내 신고 |
| D | 워크스페이스(협업) | [`workspace.md`](workspace.md) | 내부 운영자·간사 | 약 8 |
| E | 통합 CMS 어드민 — 후원·결제 운영 | [`admin-donation.md`](admin-donation.md) | 최고관리자·후원 담당 | 후원/빌링/계약 |

**2차에서 추가 예정** (이번 세션 범위 외):
- E-회원관리(블랙·등급·포인트·배지)
- E-SIREN 운영(신고 심사·익명 식별·감사 로그)
- E-워크스페이스 운영(역할정책·근태·급여·성과관리)
- E-콘텐츠(공지·캠페인·게시판·자료실·팝업·메뉴·사이트 빌더)
- E-발송(이메일 배치·템플릿·수신자 그룹·자동 트리거)
- E-AI 운영(비서 설정·비용 관리·도구 권한)
- 응답폼·신청폼 빌더

---

## 2. AI 비서 학습 자료

**층1 — 시스템 프롬프트 부록**
| 파일 | 글자수 | 적용 |
|---|---|---|
| [`ai-assistant-knowledge.md`](ai-assistant-knowledge.md) | 약 7,900자 (목표 5,000~8,000 내) | `/admin-ai-config.html` → 시스템 프롬프트 끝에 `# [부록]` ~ `# [부록 끝]` 통째 복사·붙여넣기 |

**층2 — Q&A 300문항 4분할 JSONL**
| 파일 | 문항 | 분야 |
|---|---|---|
| [`ai-training-siren-user.jsonl`](ai-training-siren-user.jsonl) | 60 | 회원·후원자·신고자 (홈페이지·마이페이지·신고 회원 관점) |
| [`ai-training-siren-admin.jsonl`](ai-training-siren-admin.jsonl) | 60 | 신고 운영·익명 식별·감사 로그·AI 회신·유족 지원 |
| [`ai-training-cms-1.jsonl`](ai-training-cms-1.jsonl) | 75 | 회원·후원/결제·재정·발송·자동 트리거·통계·콘텐츠 |
| [`ai-training-cms-2.jsonl`](ai-training-cms-2.jsonl) | 75 | 워크스페이스·근태(R37/R38/R39)·성과·급여·권한·폼·채팅·운영 |
| [`ai-training-ai-assistant.jsonl`](ai-training-ai-assistant.jsonl) | 30 | AI 비서 사용법·dry-run·시스템 프롬프트·비용·로그 |

**총 300문항** · 포맷 `{question, answer, page_path, tool_hint, tags}` 통일 · 향후 RAG 도입 시 그대로 인덱싱 가능.

**옛 100문항 단일 파일** → [`docs/history/ai-training-v1-100문항.jsonl`](../history/ai-training-v1-100문항.jsonl)로 archive (참조용 보존).

---

## 3. 표기 규약

- **메뉴 경로**: `어드민 > 회원 > 회원 목록` 처럼 `>` 구분
- **버튼·탭**: `[저장]`, `[승인]`처럼 대괄호
- **페이지 링크**: 모든 경로는 `/page.html` 절대 경로
- **API**: 학습 데이터에서만 노출, 사람용 본문에서는 가능한 한 기능명으로 표현(§6.14 정책)
- **권한**: 🛡️ 최고관리자 / 👤 운영자 / 🤝 간사 / 👥 회원 / 🌐 비회원

---

## 4. 시스템 한눈에 (참고)

- **공개 페이지**: 약 20개 (홈/소개/활동/캠페인/게시판/소식/자료실/신고 진입/약관)
- **회원 영역**: 마이페이지·포인트·구독·알림 설정·결제(빌링) 약 10개
- **신고 3종**: 사건(`incidents`) / 괴롭힘(`harassment`) / 법률 상담(`legal-consultation`) — 모두 익명 지원, 운영자 승인 시 공식 접수
- **워크스페이스**: 칸반·캘린더·파일함·템플릿·성과·근태·알림 + AI 에이전트
- **어드민**: 59개 페이지, 약 500개 API. 13개 도메인(인증/후원/회원/신고/유족지원/게시판·캠페인/워크스페이스/채팅/AI/Cron/폼/어드민기타/마이그레이션)
- **AI 비서**: Gemini 3-flash + Function Calling, 84개 도구, dry-run 승인 패턴, 월 예산·도구별 권한 제어

---

**다음 갱신**: 2차 작성 시 §1 표의 "2차에서 추가 예정" 항목을 본문 링크로 전환.
