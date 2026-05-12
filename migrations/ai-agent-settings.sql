-- ============================================================
-- Phase B AI 비서 설정 — Neon SQL Editor 직접 실행용
-- 배포 안 기다리고 console.neon.tech의 SQL Editor에 통째로 붙여넣기
-- 멱등 (IF NOT EXISTS + ON CONFLICT DO NOTHING)
-- ============================================================

-- 1) 설정 테이블 (key/value)
CREATE TABLE IF NOT EXISTS ai_agent_settings (
  key VARCHAR(60) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER
);

-- 2) 도구 권한 테이블
CREATE TABLE IF NOT EXISTS ai_tool_permissions (
  tool_name VARCHAR(100) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  required_role VARCHAR(20),
  description TEXT,
  is_mutation BOOLEAN NOT NULL DEFAULT FALSE,
  category VARCHAR(30),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) 기본 시스템 프롬프트 시드
INSERT INTO ai_agent_settings (key, value) VALUES
('system_prompt', '당신은 (사)교사유가족협의회 SIREN의 AI 비서입니다. 관리자 명령을 받아 적절한 도구를 호출하세요.

## 핵심 규칙
1. 변경 작업(*_update, *_create)은 dry-run(requireApproval=true) 우선 → 사용자 승인 후 requireApproval=false로 재호출.
2. 의도 모호하면 도구 호출 전 한국어로 다시 묻기.
3. 결과는 한국어 자연어 + 핵심 숫자만 (raw JSON 금지).
4. 한 번에 필요한 도구만 호출 (불필요한 반복 금지).
5. 같은 도구를 반복 호출하지 마세요 — 결과가 같으면 그대로 사용.

답변: 존댓말, 간결, 이모지 절제.')
ON CONFLICT (key) DO NOTHING;

-- 4) 22개 도구 시드
INSERT INTO ai_tool_permissions (tool_name, enabled, required_role, description, is_mutation, category) VALUES
-- 콘텐츠·관리 (5) — 변경 도구 3개는 super_admin
('content_pages_list',       TRUE, NULL,          '콘텐츠 페이지 본문 조회',                FALSE, 'content'),
('content_pages_update',     TRUE, 'super_admin', '콘텐츠 페이지 본문 수정 (변경 도구)',    TRUE,  'content'),
('notice_create',            TRUE, 'super_admin', '공지사항 새로 등록 (변경 도구)',          TRUE,  'content'),
('campaign_create',          TRUE, 'super_admin', '후원 캠페인 새로 등록 (변경 도구)',      TRUE,  'content'),
('nav_menus_list',           TRUE, NULL,          '네비게이션 메뉴 조회',                    FALSE, 'nav'),
-- 회원 (4)
('members_search',           TRUE, NULL,          '회원 검색',                                FALSE, 'members'),
('members_detail',           TRUE, NULL,          '회원 상세',                                FALSE, 'members'),
('members_stats',            TRUE, NULL,          '회원 통계',                                FALSE, 'members'),
('members_recent',           TRUE, NULL,          '최근 회원',                                FALSE, 'members'),
-- 후원 (3)
('donations_recent',         TRUE, NULL,          '최근 후원',                                FALSE, 'donations'),
('donations_stats',          TRUE, NULL,          '후원 통계',                                FALSE, 'donations'),
('donations_by_member',      TRUE, NULL,          '회원별 후원 내역',                        FALSE, 'donations'),
-- 신고 (4)
('incidents_list',           TRUE, NULL,          '사건 제보 목록',                          FALSE, 'siren'),
('incidents_detail',         TRUE, NULL,          '사건 제보 상세',                          FALSE, 'siren'),
('harassment_reports_list',  TRUE, NULL,          '악성민원 신고 목록',                      FALSE, 'siren'),
('legal_consultations_list', TRUE, NULL,          '법률 상담 목록',                          FALSE, 'siren'),
-- 게시판·캠페인 (3)
('board_posts_list',         TRUE, NULL,          '게시판 글 목록',                          FALSE, 'board'),
('campaigns_list',           TRUE, NULL,          '캠페인 목록',                              FALSE, 'content'),
('campaigns_detail',         TRUE, NULL,          '캠페인 상세',                              FALSE, 'content'),
-- 워크스페이스·KPI (3)
('tasks_list',               TRUE, NULL,          '작업 목록',                                FALSE, 'workspace'),
('notifications_recent',     TRUE, NULL,          '최근 알림',                                FALSE, 'workspace'),
('kpi_summary',              TRUE, NULL,          'KPI 요약',                                  FALSE, 'kpi')
ON CONFLICT (tool_name) DO NOTHING;

-- 검증
SELECT 'settings 행수:' AS metric, COUNT(*)::text AS value FROM ai_agent_settings
UNION ALL
SELECT 'permissions 행수:', COUNT(*)::text FROM ai_tool_permissions
UNION ALL
SELECT '변경 도구 수:', COUNT(*)::text FROM ai_tool_permissions WHERE is_mutation = TRUE;
