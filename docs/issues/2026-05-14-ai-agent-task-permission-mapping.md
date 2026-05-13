# BUG-AI-AGENT-PHASE1-04 — task_create / task_update 권한 매핑 오류

**발견일**: 2026-05-14 (V4 라운드)
**검증자**: C 채팅 (curl, admin 계정 super_admin 로그인)
**심각도**: High (검증 차단·실사용 차단)

## 재현

```bash
# admin 계정 (role=super_admin) 로그인 후
printf '{"userMessage":"%s","conversationId":null}' "Phase 1 검증용 더미 작업 만들어줘" > req.json
curl -b cookies.txt -H "Content-Type: application/json; charset=utf-8" --data-binary @req.json https://tbfa-siren-cms.netlify.app/api/admin-ai-agent
```

**기대**: task_create 도구 호출 → dry-run preview.
**실제**: result.ok=false, error="'워크스페이스 작업 카드 생성 (변경 도구)' 도구는 관리자 권한이 필요합니다."

T2 회피 시도(task_update)도 동일 권한 거부:
- "'워크 작업 카드 수정 (상태·진행률·담당자)' 도구는 관리자 권한이 필요합니다."

## 대조군

- SC-1 `members_stats`: admin으로 정상 작동 (PASS)
- T2 회피 `task_comment_add`: admin으로 정상 작동 (PASS, comment_id=1 추가)
- F1 `files_list`: admin으로 정상 작동 (PASS)

→ **task_create·task_update만 거부**. 도구별 권한 매핑 BUG.

## 원인 추정 (C 추정 — fix 권장)

`ai_tool_permissions` 테이블에서 task_create·task_update의 required_role이 `admin`인데:
- 로그인 admin 계정의 `role`은 응답에서 `"role":"super_admin"`
- 권한 체크 로직이 `role === required_role` (정확 일치)일 가능성 — super_admin은 admin 권한 포함이라야 정상
- 즉 권한 비교 로직이 super_admin > admin 위계를 인정 안 함

또는 task_create·task_update 시드(마이그)가 required_role 값을 잘못 박았을 수 있음.

## 영향

- Phase 1 T1·T4 검증 진행 불가
- 실사용에서도 어드민(super_admin)이 AI 비서로 작업 카드 생성·수정 못함

## 메인 채팅 fix 권장

1. `ai_tool_permissions` 테이블에서 task_create·task_update의 required_role 확인 (admin인지 null인지)
2. 권한 체크 로직(lib/ai-agent-tools.ts or admin-ai-agent.ts)에서 super_admin이 admin 권한 상위 호환 처리
3. fix 후 C 재검증 라운드에서 T1·T4 PASS 확인
