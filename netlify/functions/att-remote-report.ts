import { db } from "../../db/index";
import { attRemoteWorkReports, members } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { todayKST } from "../../lib/att-utils";

export const config = { path: "/api/att/remote-report" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "보고서 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const memberId = auth.ctx.member.id;
  // att_remote_work_reports.member_uid 는 R29-ATT-GAP1 부터 varchar(36)
  const memberUidStr = String(memberId);

  // GET: 오늘 또는 특정 날짜 보고서 조회
  if (req.method === "GET") {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") ?? todayKST();

    try {
      const rows = await db
        .select()
        .from(attRemoteWorkReports)
        .where(and(
          eq(attRemoteWorkReports.memberUid, memberUidStr),
          eq(attRemoteWorkReports.date, date),
        ))
        .limit(1);
      return jsonOk(rows[0] ?? null);
    } catch (err) {
      return jsonError("select_report", err);
    }
  }

  // POST: DRAFT 저장 (없으면 INSERT, 있으면 UPDATE)
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const date: string = body.date ?? todayKST();
    const content: string | undefined = body.content;
    const wbsCardIds: number[] = Array.isArray(body.wbsCardIds) ? body.wbsCardIds : [];

    try {
      // upsert: ON CONFLICT DO UPDATE
      const [row] = await db
        .insert(attRemoteWorkReports)
        .values({
          memberUid: memberUidStr,
          date,
          content: content ?? null,
          wbsCardIds,
          status: "DRAFT",
        })
        .onConflictDoUpdate({
          target: [attRemoteWorkReports.memberUid, attRemoteWorkReports.date],
          set: {
            content: content ?? null,
            wbsCardIds,
            updatedAt: new Date(),
          },
        })
        .returning({ id: attRemoteWorkReports.id });
      return jsonOk({ id: row.id }, 201);
    } catch (err) {
      return jsonError("upsert_draft", err);
    }
  }

  // PUT: SUBMITTED 제출
  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const date: string = body.date ?? todayKST();
    const content: string = body.content ?? "";

    if (!content.trim()) {
      return new Response(JSON.stringify({ ok: false, error: "보고서 내용을 입력해 주세요", step: "validate" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    try {
      const existing = await db
        .select({ id: attRemoteWorkReports.id, status: attRemoteWorkReports.status })
        .from(attRemoteWorkReports)
        .where(and(
          eq(attRemoteWorkReports.memberUid, memberUidStr),
          eq(attRemoteWorkReports.date, date),
        ))
        .limit(1);

      if (existing.length > 0 && existing[0].status === "SUBMITTED") {
        return new Response(JSON.stringify({ ok: false, error: "이미 제출된 보고서입니다", step: "already_submitted" }),
          { status: 409, headers: { "Content-Type": "application/json" } });
      }

      const now = new Date();
      await db
        .insert(attRemoteWorkReports)
        .values({
          memberUid: memberUidStr,
          date,
          content,
          status: "SUBMITTED",
          submittedAt: now,
        })
        .onConflictDoUpdate({
          target: [attRemoteWorkReports.memberUid, attRemoteWorkReports.date],
          set: {
            content,
            status: "SUBMITTED",
            submittedAt: now,
            updatedAt: now,
          },
        });

      return jsonOk({ message: "제출 완료" });
    } catch (err) {
      return jsonError("submit_report", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
