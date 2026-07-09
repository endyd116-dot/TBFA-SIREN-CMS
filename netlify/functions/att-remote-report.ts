import { db } from "../../db/index";
import { attRemoteWorkReports, members } from "../../db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
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
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  const memberId = auth.ctx.member.id;
  // att_remote_work_reports.member_uid 는 R29-ATT-GAP1 부터 varchar(36)
  const memberUidStr = String(memberId);

  // GET: 오늘/특정 날짜 보고서 조회 (list=1이면 내 보고서 히스토리 목록)
  if (req.method === "GET") {
    const url = new URL(req.url);

    // ── 히스토리 목록 ──
    if (url.searchParams.get("list") === "1") {
      try {
        const rows = await db
          .select({
            date: attRemoteWorkReports.date,
            status: attRemoteWorkReports.status,
            content: attRemoteWorkReports.content,
            aiDraft: attRemoteWorkReports.aiDraft,
            submittedAt: attRemoteWorkReports.submittedAt,
            updatedAt: attRemoteWorkReports.updatedAt,
          })
          .from(attRemoteWorkReports)
          .where(eq(attRemoteWorkReports.memberUid, memberUidStr))
          .orderBy(desc(attRemoteWorkReports.date))
          .limit(60);
        return jsonOk({ list: rows });
      } catch (err) {
        return jsonError("list_reports", err);
      }
    }

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
      const report = rows[0] ?? null;
      /* ★ R33-FIX H-G3: wbsCardIds → workspace_tasks title JOIN으로 wbsCards: [{id, title}] 응답 */
      let wbsCards: Array<{ id: number; title: string }> = [];
      if (report && Array.isArray((report as any).wbsCardIds) && (report as any).wbsCardIds.length > 0) {
        try {
          const ids = (report as any).wbsCardIds as number[];
          const cardRows = await db.execute(sql`
            SELECT id, title FROM workspace_tasks WHERE id = ANY(${ids}::int[])
          `);
          wbsCards = ((cardRows as any).rows ?? cardRows ?? []).map((r: any) => ({ id: r.id, title: r.title }));
        } catch { /* JOIN 실패 시 빈 배열 fallback */ }
      }
      return jsonOk(report ? { ...report, wbsCards } : null);
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
    const hasWbs = Array.isArray(body.wbsCardIds);         // 미제공 시 기존 wbsCardIds 보존(AI 초안 유실 방지)
    const wbsCardIds: number[] = hasWbs ? body.wbsCardIds : [];

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
        } as any)
        .onConflictDoUpdate({
          target: [attRemoteWorkReports.memberUid, attRemoteWorkReports.date],
          set: {
            content: content ?? null,
            status: "DRAFT",             // 임시저장은 항상 DRAFT (제출본 재편집 시 초안 복귀)
            submittedAt: null,
            ...(hasWbs ? { wbsCardIds } : {}),   // 미제공 시 기존 wbsCardIds 유지
            updatedAt: new Date(),
          } as any,
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
      /* 제출본 재제출(수정 후 다시 제출) 허용 — CRUD 정책(Swain 2026-07-09).
         내용을 갱신하고 제출시각만 최신화. (이전엔 재제출 409 차단) */
      const now = new Date();
      await db
        .insert(attRemoteWorkReports)
        .values({
          memberUid: memberUidStr,
          date,
          content,
          status: "SUBMITTED",
          submittedAt: now,
        } as any)
        .onConflictDoUpdate({
          target: [attRemoteWorkReports.memberUid, attRemoteWorkReports.date],
          set: {
            content,
            status: "SUBMITTED",
            submittedAt: now,
            updatedAt: now,
          } as any,
        });

      return jsonOk({ message: "제출 완료" });
    } catch (err) {
      return jsonError("submit_report", err);
    }
  }

  // DELETE: 보고서 삭제 (임시저장/작성중만 — 제출본은 차단)
  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") ?? todayKST();
    try {
      const rows = await db
        .select({ id: attRemoteWorkReports.id, status: attRemoteWorkReports.status })
        .from(attRemoteWorkReports)
        .where(and(
          eq(attRemoteWorkReports.memberUid, memberUidStr),
          eq(attRemoteWorkReports.date, date),
        ))
        .limit(1);
      if (!rows.length) return jsonOk({ deleted: false, message: "삭제할 보고서가 없습니다" });
      if (rows[0].status === "SUBMITTED") {
        return new Response(JSON.stringify({ ok: false, error: "제출된 보고서는 삭제할 수 없습니다. 먼저 '수정'으로 되돌린 뒤 삭제하세요.", step: "submitted_lock" }),
          { status: 409, headers: { "Content-Type": "application/json" } });
      }
      await db.delete(attRemoteWorkReports).where(and(
        eq(attRemoteWorkReports.memberUid, memberUidStr),
        eq(attRemoteWorkReports.date, date),
      ));
      return jsonOk({ deleted: true });
    } catch (err) {
      return jsonError("delete_report", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
