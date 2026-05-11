/**
 * 진단 전용 — Bug-A1 (가입 회원 관리 멈춤) + Bug-A4 (정적 페이지)
 * GET  /api/migrate-diagnose-a1           — 인증 불필요 (진단만)
 * GET  /api/migrate-diagnose-a1?run=1     — requireAdmin 후 signup_sources 시드 실행
 *
 * 1회용 — 호출 후 즉시 삭제
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-diagnose-a1" };

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 (인증 불필요) ── */
  if (!run) {
    try {
      /* signup_sources 현황 */
      const sources: any[] = await db.execute(sql`
        SELECT id, code, label, is_active FROM signup_sources ORDER BY id
      `);

      /* site_settings page.* 현황 */
      const pageSettings: any[] = await db.execute(sql`
        SELECT id, scope, key, description, value_type
        FROM site_settings
        WHERE scope LIKE 'page.%'
        ORDER BY scope, key
      `);

      /* members 총 수 + signup_source 분포 */
      const memberStats: any[] = await db.execute(sql`
        SELECT
          ss.code,
          ss.label,
          COUNT(m.id)::int AS member_count
        FROM signup_sources ss
        LEFT JOIN members m ON m.signup_source_id = ss.id
        GROUP BY ss.id, ss.code, ss.label
        ORDER BY ss.id
      `);

      /* signup_source 없는 회원 수 */
      const [{ no_source_count }]: any[] = await db.execute(sql`
        SELECT COUNT(*)::int AS no_source_count FROM members WHERE signup_source_id IS NULL
      `);

      return new Response(JSON.stringify({
        ok: true,
        mode: "diagnose",
        signup_sources: sources,
        page_settings_count: pageSettings.length,
        page_settings: pageSettings,
        member_by_source: memberStats,
        members_without_source: no_source_count,
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false,
        error: String(err?.message || err),
        stack: String(err?.stack || "").slice(0, 1000),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  /* ── 실행 모드 (?run=1) ── */
  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    /* 1. signup_sources 5종 시드 (멱등) */
    await db.execute(sql`
      INSERT INTO signup_sources (code, label, is_active) VALUES
        ('website',      '싸이렌 홈페이지',  TRUE),
        ('hyosung_csv',  '효성',             TRUE),
        ('admin',        '수기등록',          TRUE),
        ('event',        '이벤트',           TRUE),
        ('etc',          '기타',             TRUE)
      ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, is_active = TRUE
    `);

    /* 2. site_settings page.* 시드 (멱등) */
    await db.execute(sql`
      INSERT INTO site_settings (scope, key, description, value_type, value_text) VALUES
        ('page.terms',   'body', '이용약관 본문',            'html',
         '<h2>이용약관</h2><p>본 약관은 교사유가족협의회(이하 "협회")가 운영하는 싸이렌 플랫폼의 이용 조건을 정합니다.</p><p>내용을 이 화면에서 자유롭게 수정하세요.</p>'),
        ('page.privacy', 'body', '개인정보처리방침 본문',      'html',
         '<h2>개인정보처리방침</h2><p>협회는 이용자의 개인정보를 소중히 처리합니다.</p><p>내용을 이 화면에서 자유롭게 수정하세요.</p>'),
        ('page.faq',     'body', 'FAQ 본문',                 'html',
         '<h2>자주 묻는 질문</h2><p>내용을 이 화면에서 자유롭게 수정하세요.</p>')
      ON CONFLICT (scope, key) DO NOTHING
    `);

    /* 결과 확인 */
    const sources: any[] = await db.execute(sql`
      SELECT id, code, label, is_active FROM signup_sources ORDER BY id
    `);
    const pageSettings: any[] = await db.execute(sql`
      SELECT id, scope, key FROM site_settings WHERE scope LIKE 'page.%' ORDER BY scope, key
    `);

    return new Response(JSON.stringify({
      ok: true,
      mode: "run",
      message: "signup_sources 5종 + site_settings page.* 3종 시드 완료",
      signup_sources: sources,
      page_settings: pageSettings,
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(err?.message || err),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
