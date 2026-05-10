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
import { evaluateDonorTypeFromContract } from "../../lib/hyosung-merge";

/* ★ Phase 3 D 보강: 통과 시 회원 donor_type 전이 예측
 * - hyosung_contracts: rawData._hyosungContractRow.contractStatus → regular/prospect/none
 * - hyosung_billings: 수납 발생 → regular (계약 active 가정)
 * - ibk: 일시 입금 → 회원이 이미 regular면 유지, 아니면 prospect
 * - hyosung(legacy): regular
 *
 * 분류(category)는 미리보기 카드용 3-버킷:
 *   'auto'    매칭 완료(matched_member_id 있음)
 *   'manual'  수동 매칭 필요(매칭 없음, ibk/billings/legacy)
 *   'new'     신규 회원 생성 후보(hyosung_contracts + 매칭 없음)
 */
function predictTransition(row: any, currentMember: { donorType: string | null } | null) {
  const source = row.source as string;
  const matched = !!row.matched_member_id;
  const currentType = currentMember?.donorType || null;

  let predicted: "regular" | "prospect" | "none" | null = null;
  let category: "auto" | "manual" | "new" = matched ? "auto" : "manual";

  if (source === "hyosung_contracts") {
    let raw: any = row.raw_data || {};
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = {}; } }
    const status = raw?._hyosungContractRow?.contractStatus ?? null;
    const ev = evaluateDonorTypeFromContract(status);
    predicted = ev.donorType;
    if (!matched) category = "new";
  } else if (source === "hyosung_billings") {
    predicted = "regular";
  } else if (source === "ibk") {
    predicted = currentType === "regular" ? "regular" : "prospect";
  } else if (source === "hyosung") {
    predicted = "regular";
  }

  return {
    predictedDonorType: predicted,
    currentDonorType: currentType,
    willChange: predicted !== null && currentType !== predicted,
    category,
  };
}

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
      /* 'hyosung' 필터는 'hyosung'·'hyosung_contracts'·'hyosung_billings' 3종 모두 매칭 */
      if (sourceParam === "hyosung") {
        conds.push(sql`source IN ('hyosung', 'hyosung_contracts', 'hyosung_billings')`);
      } else {
        conds.push(sql`source = ${sourceParam}`);
      }
    }
    if (search) {
      const pattern = `%${search}%`;
      conds.push(sql`(parsed_name ILIKE ${pattern} OR parsed_memo ILIKE ${pattern})`);
    }

    const whereSql = conds.length > 0
      ? sql`WHERE ${sql.join(conds, sql` AND `)}`
      : sql``;

    /* 메인 SELECT — raw_data 포함 (전이 예측에 contractStatus 필요) */
    const rowsRaw: any = await db.execute(sql`
      SELECT
        id, source, source_file_name, source_row_index,
        parsed_name, parsed_amount, parsed_date, parsed_memo, parsed_account_tail4,
        matched_member_id, match_score, match_reason,
        status, confirmed_donation_id, confirmed_at,
        imported_by, confirmed_by, created_at, updated_at,
        raw_data
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

    /* 매칭 회원 정보 합치기 (JS Map) — donor_type/donorChannels도 합쳐 전이 예측 */
    const memberIds = Array.from(new Set(rows.map(r => r.matched_member_id).filter((x: any) => x != null)));
    let memberMap: Record<number, {
      id: number; name: string | null; phone: string | null; email: string | null;
      donorType: string | null; donorChannels: string[] | null;
    }> = {};
    if (memberIds.length > 0) {
      try {
        const ms = await db
          .select({
            id: members.id, name: members.name, phone: members.phone, email: members.email,
            donorType: members.donorType, donorChannels: members.donorChannels,
          })
          .from(members)
          .where(inArray(members.id, memberIds as number[]));
        ms.forEach(m => {
          memberMap[m.id] = {
            ...m,
            donorChannels: Array.isArray(m.donorChannels) ? (m.donorChannels as string[]) : null,
          };
        });
      } catch (e) { console.warn("[pending-list] member fetch failed", e); }
    }

    /* ★ 미리보기 분류 집계 (현재 페이지 기준) */
    const previewBuckets = { auto: 0, manual: 0, new: 0 };

    const enriched = rows.map(r => {
      const matched = r.matched_member_id ? (memberMap[r.matched_member_id] || null) : null;
      const transition = predictTransition(r, matched);
      if (r.status === "pending" || r.status === "matched") {
        previewBuckets[transition.category]++;
      }
      return {
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
        matchedMember: matched
          ? { id: matched.id, name: matched.name, phone: matched.phone, email: matched.email,
              donorType: matched.donorType, donorChannels: matched.donorChannels }
          : null,
        matchScore: r.match_score === null ? null : Number(r.match_score),
        matchReason: r.match_reason,
        status: r.status,
        confirmedDonationId: r.confirmed_donation_id,
        confirmedAt: r.confirmed_at,
        createdAt: r.created_at,
        predictedDonorType: transition.predictedDonorType,
        currentDonorType: transition.currentDonorType,
        willChange: transition.willChange,
        previewCategory: transition.category,
      };
    });

    return ok({
      rows: enriched,
      total,
      summary,
      previewBuckets,
      page: { limit, offset },
    });
  } catch (err: any) {
    console.error("[admin-donation-pending-list]", err);
    return serverError("미확정 후원 목록 조회 실패", err);
  }
};

export const config = { path: "/api/admin-donation-pending-list" };
