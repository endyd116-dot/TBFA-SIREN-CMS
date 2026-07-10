import { db } from "../../db/index";
import { attHolidays } from "../../db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin-att-holidays" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "공휴일 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // P2-39 fix: 조회(GET)는 근태 설정 권한(att_config) 국장 허용, 변경(POST/PUT/DELETE)은 이사장(super_admin) 전용.
  //            (권한정책 카탈로그 att_config adminDefault·설정 라벨 '저장은 이사장 전용'과 일치)
  const _role = (auth as any).ctx.member.role ?? "";
  if (req.method === "GET"
        ? !(_role === "super_admin" || await canAccess(_role, "att_config"))
        : _role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: req.method === "GET" ? "근태 설정 조회 권한이 없습니다" : "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const method = req.method;
  const url = new URL(req.url);

  // GET — 연도별 목록 (?year=)
  if (method === "GET") {
    const year = url.searchParams.get("year") ?? new Date().getFullYear().toString();
    try {
      const rows = await db.execute(sql`
        SELECT * FROM att_holidays
        WHERE EXTRACT(YEAR FROM date) = ${Number(year)}
        ORDER BY date
      `);
      return jsonOk((rows as any).rows ?? rows);
    } catch (err) {
      return jsonError("select_holidays", err);
    }
  }

  // POST — 등록
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { date, name, type } = body;
    if (!date || !name) {
      return jsonError("validate", new Error("date, name 필수"), 400);
    }

    try {
      const [row] = await db.insert(attHolidays).values({
        date,
        name,
        type: type ?? "PUBLIC",
      } as any).returning();
      return jsonOk(row, 201);
    } catch (err) {
      if (String(err).includes("unique")) {
        return jsonError("duplicate", new Error("해당 날짜에 이미 공휴일 등록됨"), 409);
      }
      return jsonError("insert_holiday", err);
    }
  }

  // DELETE — 삭제 (?id=)
  if (method === "DELETE") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    try {
      await db.delete(attHolidays).where(eq(attHolidays.id, id));
      return jsonOk({ deleted: id });
    } catch (err) {
      return jsonError("delete_holiday", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
