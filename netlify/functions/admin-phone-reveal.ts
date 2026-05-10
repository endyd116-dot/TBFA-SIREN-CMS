import { eq } from "drizzle-orm";
import { db, members, donations, supportRequests } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAudit, deriveSessionId } from "../../lib/audit";

export const config = { path: "/api/admin-phone-reveal" };

export default async function handler(req: Request): Promise<Response> {
  const authResult = await requireAdmin(req);
  if (!authResult.ok) return (authResult as any).res;
  const auth = authResult.ctx;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  const idStr = url.searchParams.get("id") ?? "";
  const id = parseInt(idStr, 10);

  if (!type || !id || isNaN(id)) {
    return new Response(JSON.stringify({ ok: false, error: "type·id 파라미터가 필요합니다" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let phone: string | null = null;

  try {
    if (type === "member" || type === "chat") {
      // members 테이블에서 직접 조회
      const [row] = await db
        .select({ phone: members.phone })
        .from(members)
        .where(eq(members.id, id))
        .limit(1);
      if (!row) return notFound();
      phone = row.phone ?? null;

    } else if (type === "donor") {
      // donations 테이블에서 donorPhone 조회
      const [row] = await db
        .select({ phone: donations.donorPhone })
        .from(donations)
        .where(eq(donations.id, id))
        .limit(1);
      if (!row) return notFound();
      phone = row.phone ?? null;

    } else if (type === "expert") {
      // expert_profiles는 phone 없음 → members 테이블 조회 (id는 member_id)
      const [row] = await db
        .select({ phone: members.phone })
        .from(members)
        .where(eq(members.id, id))
        .limit(1);
      if (!row) return notFound();
      phone = row.phone ?? null;

    } else if (type === "support") {
      // support_requests.memberId → members.phone
      const [req_row] = await db
        .select({ memberId: supportRequests.memberId })
        .from(supportRequests)
        .where(eq(supportRequests.id, id))
        .limit(1);
      if (!req_row) return notFound();
      const [mRow] = await db
        .select({ phone: members.phone })
        .from(members)
        .where(eq(members.id, req_row.memberId))
        .limit(1);
      phone = mRow?.phone ?? null;

    } else {
      return new Response(JSON.stringify({ ok: false, error: `알 수 없는 type: ${type}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "전화번호 조회 실패",
      step: "select",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // 감사 로그
  try {
    await logAudit({
      req,
      userId: auth.admin.uid,
      userType: "admin",
      userName: auth.member.name,
      action: "phone_reveal",
      target: `${type}:${id}`,
      detail: { type, id },
      success: true,
      riskLevel: "high",
      sessionId: deriveSessionId(req),
    });
  } catch (e) {
    console.warn("[phone-reveal] audit log 실패:", e);
  }

  return new Response(JSON.stringify({
    ok: true,
    phone,
    revealedAt: new Date().toISOString(),
  }), { headers: { "Content-Type": "application/json" } });
}

function notFound(): Response {
  return new Response(JSON.stringify({ ok: false, error: "해당 레코드를 찾을 수 없습니다" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
