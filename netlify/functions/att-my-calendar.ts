import { db } from "../../db/index";
import { attRecords } from "../../db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/att-my-calendar" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "캘린더 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const now = new Date();
  const year  = Number(url.searchParams.get("year")  ?? now.getFullYear());
  const month = Number(url.searchParams.get("month") ?? now.getMonth() + 1);

  const memberUid: string = String(auth.ctx.member.id);

  const padM = String(month).padStart(2, "0");
  const from = `${year}-${padM}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${padM}-${String(lastDay).padStart(2, "0")}`;

  try {
    const records = await db
      .select()
      .from(attRecords)
      .where(
        and(
          eq(attRecords.memberUid, memberUid),
          gte(attRecords.date, from),
          lte(attRecords.date, to)
        )
      )
      .orderBy(attRecords.date);

    return jsonOk({ year, month, records });
  } catch (err) {
    return jsonError("select_calendar", err);
  }
}
