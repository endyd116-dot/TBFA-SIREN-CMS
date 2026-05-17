// netlify/functions/workspace-holidays.ts
// GET /api/workspace-holidays?year=N  : 한국 공휴일 목록 (date.nager.at 프록시)

import { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, methodNotAllowed, serverError } from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  try {
    if (req.method !== "GET") return methodNotAllowed();

    const url = new URL(req.url);
    const year = Number(url.searchParams.get("year") || new Date().getFullYear());
    if (!year || year < 2000 || year > 2100) return badRequest("year 파라미터 오류 (2000~2100)");

    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`, {
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      return serverError(`공휴일 API 오류: ${res.status}`, null);
    }

    const data: any = await res.json();
    const holidays: string[] = Array.isArray(data)
      ? data.map((h: any) => String(h.date)).filter(Boolean)
      : [];

    return ok({ holidays });
  } catch (err: any) {
    console.error("[workspace-holidays] error:", err);
    return serverError("공휴일 조회 중 오류", err);
  }
};

export const config = { path: "/api/workspace-holidays" };
