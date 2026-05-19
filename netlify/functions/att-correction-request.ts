import { db } from "../../db/index";
import { attCorrections } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { requireOperator } from "../../lib/operator-guard";

export const config = { path: "/api/att-correction-request" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "수정 요청 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (!auth.ok) return auth.res;

  const method = req.method;

  const memberUid: string = String(auth.ctx.member.id);

  // GET — 본인 수정 요청 내역
  if (method === "GET") {
    try {
      const rows = await db
        .select()
        .from(attCorrections)
        .where(eq(attCorrections.memberUid, memberUid))
        .orderBy(sql`created_at DESC`)
        .limit(100);
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_corrections", err);
    }
  }

  // POST — 수정 요청 등록
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { targetDate, correctionType, requestedCheckIn, requestedCheckOut, reason, evidenceUrl } = body;
    if (!targetDate || !correctionType) {
      return jsonError("validate", new Error("targetDate, correctionType 필수"), 400);
    }
    if (!["CHECK_IN", "CHECK_OUT", "BOTH"].includes(correctionType)) {
      return jsonError("validate_type", new Error("correctionType은 CHECK_IN|CHECK_OUT|BOTH"), 400);
    }

    try {
      const [row] = await db.insert(attCorrections).values({
        memberUid,
        targetDate,
        correctionType,
        requestedCheckIn:  requestedCheckIn  ? new Date(requestedCheckIn)  : null,
        requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
        reason:       reason       ?? null,
        evidenceUrl:  evidenceUrl  ?? null,
        status: "PENDING",
      }).returning();
      return jsonOk(row, 201);
    } catch (err) {
      return jsonError("insert_correction", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
