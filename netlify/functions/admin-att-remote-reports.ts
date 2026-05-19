import { db } from "../../db/index";
import { attRemoteWorkReports, members, workspaceTasks } from "../../db/schema";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

// R35-GAP-P2 M-G5: wbsCardIds → wbsCards JOIN helper
async function fetchWbsCardsMap(allCardIds: number[]): Promise<Record<number, any>> {
  if (allCardIds.length === 0) return {};
  try {
    const cards = await db
      .select({
        id: workspaceTasks.id,
        title: workspaceTasks.title,
        status: workspaceTasks.status,
        progress: workspaceTasks.progress,
      })
      .from(workspaceTasks)
      .where(inArray(workspaceTasks.id, allCardIds));
    return Object.fromEntries(cards.map(c => [c.id, c]));
  } catch {
    return {};
  }
}
function buildWbsCards(ids: any, cardMap: Record<number, any>): any[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id: any) => cardMap[Number(id)]).filter((c: any) => c != null);
}

export const config = { path: "/api/admin/att/remote-reports" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "보고서 관리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  if (auth.ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용", step: "role_check" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  // GET: 보고서 목록 조회 또는 단건 조회 (?id=)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const idParam = url.searchParams.get("id");
    const memberUid = url.searchParams.get("memberUid");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const status = url.searchParams.get("status"); // DRAFT | SUBMITTED

    // 단건 조회 — ?id=
    if (idParam) {
      const reportId = Number(idParam);
      if (!Number.isFinite(reportId)) {
        return new Response(JSON.stringify({ ok: false, error: "id 형식 오류", step: "validate" }),
          { status: 400, headers: { "Content-Type": "application/json" } });
      }
      try {
        const [r] = await db
          .select()
          .from(attRemoteWorkReports)
          .where(eq(attRemoteWorkReports.id, reportId))
          .limit(1);
        if (!r) {
          return new Response(JSON.stringify({ ok: false, error: "보고서 없음", step: "not_found" }),
            { status: 404, headers: { "Content-Type": "application/json" } });
        }
        // memberName 보강
        let memberName = `멤버 #${r.memberUid}`;
        try {
          const [m] = await db
            .select({ name: members.name })
            .from(members)
            .where(eq(members.id, Number(r.memberUid)))
            .limit(1);
          if (m) memberName = m.name ?? memberName;
        } catch {}
        // R35-GAP-P2 M-G5: wbsCardIds → wbsCards JOIN
        const ids = Array.isArray((r as any).wbsCardIds) ? (r as any).wbsCardIds.map((v: any) => Number(v)).filter((n: any) => Number.isFinite(n)) : [];
        const cardMap = await fetchWbsCardsMap(ids);
        const wbsCards = buildWbsCards(ids, cardMap);
        return jsonOk({ ...r, memberName, wbsCards });
      } catch (err) {
        return jsonError("select_one", err);
      }
    }

    try {
      // 보고서 목록 조회
      const conditions: any[] = [];
      // R29-ATT-GAP1 이후 member_uid 는 varchar(36) — 문자열 비교
      if (memberUid) conditions.push(eq(attRemoteWorkReports.memberUid, String(memberUid)));
      if (startDate) conditions.push(gte(attRemoteWorkReports.date, startDate));
      if (endDate) conditions.push(lte(attRemoteWorkReports.date, endDate));
      if (status) conditions.push(eq(attRemoteWorkReports.status, status));

      const reports = await db
        .select({
          id: attRemoteWorkReports.id,
          memberUid: attRemoteWorkReports.memberUid,
          date: attRemoteWorkReports.date,
          content: attRemoteWorkReports.content,
          qualityScore: attRemoteWorkReports.qualityScore,
          status: attRemoteWorkReports.status,
          isStarred: attRemoteWorkReports.isStarred,
          supervisorNote: attRemoteWorkReports.supervisorNote,
          submittedAt: attRemoteWorkReports.submittedAt,
          wbsCardIds: attRemoteWorkReports.wbsCardIds,
        })
        .from(attRemoteWorkReports)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(attRemoteWorkReports.date))
        .limit(100);

      // memberUid(varchar) → name 매핑
      let memberMap: Record<string, string> = {};
      if (reports.length > 0) {
        try {
          const allMembers = await db
            .select({ id: members.id, name: members.name })
            .from(members);
          memberMap = Object.fromEntries(allMembers.map(m => [String(m.id), m.name]));
        } catch {}
      }

      // R35-GAP-P2 M-G5: wbsCardIds → wbsCards JOIN (목록 전체에서 한번에 카드 조회)
      const allCardIds = Array.from(new Set(
        reports.flatMap(r => Array.isArray((r as any).wbsCardIds) ? (r as any).wbsCardIds.map((v: any) => Number(v)) : [])
              .filter(n => Number.isFinite(n))
      ));
      const cardMap = await fetchWbsCardsMap(allCardIds);

      const data = reports.map(r => {
        const ids = Array.isArray((r as any).wbsCardIds) ? (r as any).wbsCardIds.map((v: any) => Number(v)).filter((n: any) => Number.isFinite(n)) : [];
        return {
          ...r,
          memberName: memberMap[String(r.memberUid)] ?? `멤버 #${r.memberUid}`,
          wbsCards: buildWbsCards(ids, cardMap),
        };
      });

      return jsonOk(data);
    } catch (err) {
      return jsonError("select_reports", err);
    }
  }

  // PUT: 별표·댓글 수정
  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { id, supervisorNote, isStarred } = body;
    if (!id) {
      return new Response(JSON.stringify({ ok: false, error: "id 필수", step: "validate" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (supervisorNote !== undefined) updateData.supervisorNote = supervisorNote;
    if (isStarred !== undefined) updateData.isStarred = Boolean(isStarred);

    try {
      await db
        .update(attRemoteWorkReports)
        .set(updateData)
        .where(eq(attRemoteWorkReports.id, id));
      return jsonOk({ message: "수정 완료" });
    } catch (err) {
      return jsonError("update_report", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
