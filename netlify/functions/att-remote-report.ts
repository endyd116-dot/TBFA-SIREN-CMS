import { jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attRemoteWorkReports, members } from "../../db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { todayKST } from "../../lib/att-utils";
import {
  REMOTE_REPORT_REQUIRED_FROM, REMOTE_REPORT_DEADLINE_DAYS, REMOTE_REPORT_NOTICE,
  todayKstDate, reportDeadline, daysLeftToDeadline, isReportClosed, deadlineBadge,
} from "../../lib/att-remote-policy";

export const config = { path: "/api/att/remote-report" };

function jsonOk(data: unknown, status = 200) {
  return new Response(jsonKST({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "보고서 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

/** 제출 기한(재택일 +3일)이 지난 날짜는 저장·제출을 막는다. 예외는 관리자 인정으로만. */
function closedResponse(date: string) {
  return new Response(jsonKST({
    ok: false,
    error: `제출 기한이 지났습니다 (${date} 재택 → ${reportDeadline(date)} 자정 마감). ` +
      `그 날은 근무로 인정되지 않습니다. 사정이 있으면 관리자에게 예외 인정을 요청하세요.`,
    step: "deadline",
    closed: true,
    date,
    deadline: reportDeadline(date),
  }), { status: 403, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  const memberId = auth.ctx.member.id;
  // att_remote_work_reports.member_uid 는 R29-ATT-GAP1 부터 varchar(36)
  const memberUidStr = String(memberId);

  // GET: 오늘/특정 날짜 보고서 조회 (list=1 히스토리 · pending=1 미제출 재택일)
  if (req.method === "GET") {
    const url = new URL(req.url);

    /* ── 아직 보고서를 내지 않은 재택근무일 ──
       기존 화면은 '오늘 보고서'만 보여줘서, 재택했는데 아직 안 낸 날이 있는지 알 방법이 없었다.
       마감(재택일 +3일)을 두려면 직원이 '무엇을 언제까지 내야 하는지'부터 보여야 한다. */
    if (url.searchParams.get("pending") === "1") {
      try {
        const today = todayKstDate();
        const rows: any = await db.execute(sql`
          SELECT ar.date::text AS date, ar.status, ar.work_mode,
                 rep.status AS report_status
            FROM att_records ar
            LEFT JOIN att_remote_work_reports rep
              ON rep.member_uid = ar.member_uid AND rep.date = ar.date
           WHERE ar.member_uid = ${memberUidStr}
             AND ar.work_mode = 'REMOTE'
             AND ar.status IN ('NORMAL','LATE','EARLY_LEAVE')
             AND ar.date >= ${REMOTE_REPORT_REQUIRED_FROM}::date
             AND ar.date >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - INTERVAL '60 days')
             AND (rep.status IS NULL OR rep.status NOT IN ('SUBMITTED','EXEMPTED'))
           ORDER BY ar.date DESC
           LIMIT 60
        `);
        const list = ((rows as any).rows ?? rows ?? []).map((r: any) => {
          const d = String(r.date).slice(0, 10);
          const badge = deadlineBadge(d, today);
          return {
            date: d,
            hasDraft: r.report_status === "DRAFT",
            deadline: reportDeadline(d),
            daysLeft: daysLeftToDeadline(d, today),
            closed: isReportClosed(d, today),
            badgeText: badge.text,
            badgeTone: badge.tone,
          };
        });
        return jsonOk({
          list,
          openCount: list.filter((x: any) => !x.closed).length,
          closedCount: list.filter((x: any) => x.closed).length,
          deadlineDays: REMOTE_REPORT_DEADLINE_DAYS,
          notice: REMOTE_REPORT_NOTICE,
        });
      } catch (err) {
        return jsonError("pending_reports", err);
      }
    }

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
      /* R33-FIX H-G3: wbsCardIds → workspace_tasks title JOIN으로 wbsCards: [{id, title}] 응답 */
      let wbsCards: Array<{ id: number; title: string }> = [];
      if (report && Array.isArray((report as any).wbsCardIds) && (report as any).wbsCardIds.length > 0) {
        try {
          /* JS 배열을 그대로 ANY(...)에 넘기면 드라이버가 직렬화하지 못하고 예외가 난다.
             여기서는 catch가 삼켜서 '작업 카드가 조용히 안 뜨는' 상태였다 (2026-07-12 fix). */
          const ids = ((report as any).wbsCardIds as any[])
            .map(Number).filter((n: number) => Number.isFinite(n));
          if (ids.length > 0) {
            const cardRows = await db.execute(sql`
              SELECT id, title FROM workspace_tasks
               WHERE id = ANY(ARRAY[${sql.raw(ids.join(","))}]::int[])
            `);
            wbsCards = ((cardRows as any).rows ?? cardRows ?? []).map((r: any) => ({ id: r.id, title: r.title }));
          }
        } catch (err) {
          console.warn("[att-remote-report] 작업 카드 조회 실패:", err);
        }
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
    if (isReportClosed(date)) return closedResponse(date);
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
    if (isReportClosed(date)) return closedResponse(date);
    const content: string = body.content ?? "";

    if (!content.trim()) {
      return new Response(jsonKST({ ok: false, error: "보고서 내용을 입력해 주세요", step: "validate" }),
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
        return new Response(jsonKST({ ok: false, error: "제출된 보고서는 삭제할 수 없습니다. 먼저 '수정'으로 되돌린 뒤 삭제하세요.", step: "submitted_lock" }),
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
