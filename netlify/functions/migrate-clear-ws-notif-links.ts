/* =========================================================
   migrate-clear-ws-notif-links.ts — 1회용 마이그레이션
   기존 워크스페이스 알림(workspace_notifications)의 action_url을 전부 NULL로.

   배경: 근태 관리자 알림 링크가 사이드바 없는 별도 페이지(/admin-workspace-management.html)로
   튕기던 버그(5500463에서 신규 알림은 /cms-tbfa.html#att-ops로 수정). Swain 지시로
   기존에 쌓인 알림 링크는 정정 대신 전부 삭제(클릭해도 이동 없이 읽음만).

   호출(★ 공식 도메인 tbfa.co.kr):
   - GET                : 진단 (인증 불필요) — 링크 보유 알림 수
   - GET ?run=1         : 어드민 인증 후 실제 실행 (action_url = NULL)
   호출 성공 후 즉시 파일 삭제 + 커밋.
   ========================================================= */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const run = new URL(req.url).searchParams.get("run") === "1";

  try {
    /* 진단 — 링크(action_url) 보유 알림 수 */
    const cntR: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM workspace_notifications WHERE action_url IS NOT NULL
    `);
    const withLink = (cntR?.rows ?? cntR ?? [])[0]?.n ?? 0;

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnostic",
        linksToClear: withLink,
        hint: "실행하려면 어드민 로그인 후 ?run=1 (action_url 전부 NULL)",
      }), { headers: JSON_HEADER });
    }

    /* 실행 — 어드민 인증 필요 */
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    const upd: any = await db.execute(sql`
      UPDATE workspace_notifications SET action_url = NULL WHERE action_url IS NOT NULL
    `);
    const cleared = upd?.rowCount ?? upd?.count ?? withLink;

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      cleared,
      message: `기존 알림 링크 ${cleared}건 삭제(NULL) 완료. 신규 알림은 정상 링크로 생성됩니다.`,
    }), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그레이션 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};

export const config = { path: "/api/migrate-clear-ws-notif-links" };
