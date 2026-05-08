/**
 * GET /api/admin-donation-pending-list
 *
 * ★ 6순위 #15: pending_donations 목록 (필터 + 페이징 + 매칭 회원 정보 합치기)
 *
 * 쿼리 파라미터:
 *   status    : 'pending' | 'matched' | 'confirmed' | 'ignored' | 'all' (기본 'pending,matched')
 *   source    : 'hyosung' | 'ibk' | 'all' (기본 'all')
 *   search    : 이름·메모 검색
 *   limit     : 기본 50, 최대 200
 *   offset    : 기본 0
 *
 * 응답:
 *   { rows[], total, summary: { pending, matched, confirmed, ignored } }
 */
import type { Context } from "@netlify/functions";
import { sql, inArray, eq } from "drizzle-orm";
import { db, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, serverError, methodNotAllowed, corsPreflight } from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const url = new URL(req.url);
    const statusParam = (url.searchParams.get("status") || "pending,matched").trim();
    const sourceParam = (url.searchParams.get("source") || "all").trim();
    const search = (url.searchParams.get("search") || "").trim();
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);

    /* WHERE 절 빌드 (raw SQL 안전 변수화) */
    const conds: any[] = [];
    if (statusParam !== "all") {
      const statuses = statusParam.split(",").map(s => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        conds.push(sql`status IN (${sql.join(statuses.map(s => sql`${s}`), sql`,`)})`);
      }
    }
    if (sourceParam !== "all") {
      conds.push(sql`source = ${sourceParam}`);
    }
    if (search) {
      const pattern = `%${search}%`;
      conds.push(sql`(parsed_name ILIKE ${pattern} OR parsed_memo ILIKE ${pattern})`);
    }

    const whereSql = conds.length > 0
      ? sql`WHERE ${sql.join(conds, sql` AND `)}`
      : sql``;

    /* 메인 SELECT */
    const rowsRaw: any = await db.execute(sql`
      SELECT
        id, source, source_file_name, source_row_index,
        parsed_name, parsed_amount, parsed_date, parsed_memo, parsed_account_tail4,
        matched_member_id, match_score, match_reason,
        status, confirmed_donation_id, confirmed_at,
        imported_by, confirmed_by, created_at, updated_at
      FROM pending_donations
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = (Array.isArray(rowsRaw) ? rowsRaw : (rowsRaw as any).rows || []) as any[];

    /* total count */
    const totalRaw: any = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM pending_donations ${whereSql}
    `);
    const total = (Array.isArray(totalRaw) ? totalRaw : (totalRaw as any).rows || [])[0]?.c ?? 0;

    /* status 별 summary (필터와 무관한 전체 집계) */
    const sumRaw: any = await db.execute(sql`
      SELECT status, COUNT(*)::int AS c
      FROM pending_donations
      GROUP BY status
    `);
    const sumList = (Array.isArray(sumRaw) ? sumRaw : (sumRaw as any).rows || []) as Array<{ status: string; c: number }>;
    const summary: Record<string, number> = {
      pending: 0, matched: 0, confirmed: 0, ignored: 0,
    };
    sumList.forEach(s => { summary[s.status] = s.c; });

    /* 매칭 회원 정보 합치기 (JS Map) */
    const memberIds = Array.from(new Set(rows.map(r => r.matched_member_id).filter((x: any) => x != null)));
    let memberMap: Record<number, { id: number; name: string | null; phone: string | null; email: string | null }> = {};
    if (memberIds.length > 0) {
      try {
        const ms = await db
          .select({ id: members.id, name: members.name, phone: members.phone, email: members.email })
          .from(members)
          .where(inArray(members.id, memberIds as number[]));
        ms.forEach(m => { memberMap[m.id] = m; });
      } catch (e) { console.warn("[pending-list] member fetch failed", e); }
    }

    const enriched = rows.map(r => ({
      id: r.id,
      source: r.source,
      sourceFileName: r.source_file_name,
      sourceRowIndex: r.source_row_index,
      parsedName: r.parsed_name,
      parsedAmount: r.parsed_amount,
      parsedDate: r.parsed_date,
      parsedMemo: r.parsed_memo,
      parsedAccountTail4: r.parsed_account_tail4,
      matchedMemberId: r.matched_member_id,
      matchedMember: r.matched_member_id ? (memberMap[r.matched_member_id] || null) : null,
      matchScore: r.match_score === null ? null : Number(r.match_score),
      matchReason: r.match_reason,
      status: r.status,
      confirmedDonationId: r.confirmed_donation_id,
      confirmedAt: r.confirmed_at,
      createdAt: r.created_at,
    }));

    return ok({
      rows: enriched,
      total,
      summary,
      page: { limit, offset },
    });
  } catch (err: any) {
    console.error("[admin-donation-pending-list]", err);
    return serverError("미확정 후원 목록 조회 실패", err);
  }
};

export const config = { path: "/api/admin-donation-pending-list" };
