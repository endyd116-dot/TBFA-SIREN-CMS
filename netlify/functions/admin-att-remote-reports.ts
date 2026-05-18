import { db } from "../../db/index";
import { attRemoteWorkReports, members } from "../../db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

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

  // GET: 보고서 목록 조회
  if (req.method === "GET") {
    const url = new URL(req.url);
    const memberUid = url.searchParams.get("memberUid");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const status = url.searchParams.get("status"); // DRAFT | SUBMITTED

    try {
      // 보고서 목록 조회
      const conditions: any[] = [];
      if (memberUid) conditions.push(eq(attRemoteWorkReports.memberUid, parseInt(memberUid)));
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

      // memberUid → name 매핑 (separate query)
      const memberIds = [...new Set(reports.map(r => r.memberUid))];
      let memberMap: Record<number, string> = {};
      if (memberIds.length > 0) {
        try {
          const memberRows = await db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(
              memberIds.length === 1
                ? eq(members.id, memberIds[0])
                : eq(members.id, memberIds[0]) // fallback: 인 절 없이
            );
          // 모든 memberIds 처리
          const allMembers = await db
            .select({ id: members.id, name: members.name })
            .from(members);
          memberMap = Object.fromEntries(allMembers.map(m => [m.id, m.name]));
        } catch {}
      }

      const data = reports.map(r => ({
        ...r,
        memberName: memberMap[r.memberUid] ?? `멤버 #${r.memberUid}`,
      }));

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
