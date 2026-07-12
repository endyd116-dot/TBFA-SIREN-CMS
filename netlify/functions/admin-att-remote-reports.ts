import { db } from "../../db/index";
import { attRemoteWorkReports, members, workspaceTasks } from "../../db/schema";
import { eq, and, gte, lte, desc, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import {
  REMOTE_REPORT_REQUIRED_FROM, REMOTE_REPORT_DEADLINE_DAYS,
  todayKstDate, reportDeadline, daysLeftToDeadline, isReportClosed, deadlineBadge,
} from "../../lib/att-remote-policy";

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
  // R45 §4-1: 재택보고서 확인은 운영자 허용(att_manage)
  if (!(await canAccess(auth.ctx.member.role ?? "", "att_manage"))) {
    return new Response(JSON.stringify({ ok: false, error: "근태 관리 권한이 없습니다", step: "role_check" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  /* POST ?action=exempt — 기한을 놓친 재택일을 관리자가 '예외 인정'한다.
     사유를 남기고 근무를 인정한다(급여 산정에 다시 포함). 직원에게 알림도 나간다.
     body: { memberUid, date, reason } */
  if (req.method === "POST") {
    const url = new URL(req.url);
    if (url.searchParams.get("action") !== "exempt") {
      return jsonError("action", new Error("action=exempt 만 지원합니다"), 400);
    }
    let body: any = {};
    try { body = await req.json(); } catch { /* 본문 없으면 아래 검증에서 걸림 */ }

    const memberUid = String(body?.memberUid ?? "").trim();
    const date = String(body?.date ?? "").slice(0, 10);
    const reason = String(body?.reason ?? "").trim();
    if (!memberUid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonError("validate", new Error("memberUid·date(YYYY-MM-DD) 필수"), 400);
    }
    if (!reason) {
      return jsonError("validate", new Error("예외 인정 사유는 필수입니다 (기록에 남습니다)"), 400);
    }

    try {
      /* 그 날 재택 기록이 실제로 있는지 확인 (없는 날을 인정해줄 순 없다) */
      const chk: any = await db.execute(sql`
        SELECT 1 FROM att_records
         WHERE member_uid = ${memberUid} AND date = ${date}::date
           AND work_mode = 'REMOTE' AND status IN ('NORMAL','LATE','EARLY_LEAVE')
         LIMIT 1
      `);
      if (((chk as any).rows ?? chk ?? []).length === 0) {
        return jsonError("not_found", new Error("그 날짜에 재택근무 기록이 없습니다"), 404);
      }

      /* 예외 인정 = 보고서를 '인정됨(EXEMPTED)'으로 기록.
         급여 집계는 SUBMITTED·EXEMPTED를 모두 '냈다'로 보므로 그 날은 다시 근무로 인정된다. */
      const note = `[관리자 예외 인정] ${reason} (처리: ${auth.ctx.member.name ?? auth.ctx.member.id})`;
      await db.execute(sql`
        INSERT INTO att_remote_work_reports (member_uid, date, status, content, supervisor_note, submitted_at)
        VALUES (${memberUid}, ${date}::date, 'EXEMPTED', ${note}, ${note}, NOW())
        ON CONFLICT (member_uid, date) DO UPDATE
          SET status = 'EXEMPTED',
              supervisor_note = ${note},
              submitted_at = COALESCE(att_remote_work_reports.submitted_at, NOW()),
              updated_at = NOW()
      `);

      try {
        const mid = Number(memberUid);
        if (Number.isFinite(mid)) {
          await sendWorkspaceNotification({
            memberId: mid,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "approved",
            channel: "bell",
            title: `${date} 재택근무가 예외 인정되었습니다`,
            body: `보고서 미제출이었지만 관리자가 근무를 인정했습니다. 사유: ${reason.slice(0, 100)}`,
            actionUrl: "/workspace-attendance.html",
            category: "system",
          });
        }
      } catch (err) { console.warn("[admin-att-remote-reports] 예외 인정 알림 실패:", err); }

      return jsonOk({
        memberUid, date, status: "EXEMPTED",
        message: "예외 인정 완료 — 급여 재집계 시 근무일에 다시 포함됩니다",
      });
    } catch (err) {
      return jsonError("exempt", err);
    }
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

    /* ── 미제출 현황 (2026-07-12) ──
       재택했는데 보고서를 안 낸 날 목록. 기한(재택일 +3일)까지 남은 일수와
       이미 근무 불인정으로 확정된 건을 함께 준다. 관리자는 여기서 예외 인정을 할 수 있다. */
    if (url.searchParams.get("pending") === "1") {
      try {
        const today = todayKstDate();
        const rows: any = await db.execute(sql`
          SELECT ar.member_uid, ar.date::text AS date, ar.status,
                 rep.status AS report_status,
                 m.name AS member_name
            FROM att_records ar
            LEFT JOIN att_remote_work_reports rep
              ON rep.member_uid = ar.member_uid AND rep.date = ar.date
            LEFT JOIN members m ON m.id = NULLIF(ar.member_uid,'')::int
           WHERE ar.work_mode = 'REMOTE'
             AND ar.status IN ('NORMAL','LATE','EARLY_LEAVE')
             AND ar.date >= ${REMOTE_REPORT_REQUIRED_FROM}::date
             AND ar.date >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - INTERVAL '90 days')
             AND (rep.status IS NULL OR rep.status NOT IN ('SUBMITTED','EXEMPTED'))
           ORDER BY ar.date DESC, m.name
           LIMIT 200
        `);
        const list = ((rows as any).rows ?? rows ?? []).map((r: any) => {
          const d = String(r.date).slice(0, 10);
          const badge = deadlineBadge(d, today);
          return {
            memberUid: String(r.member_uid),
            memberName: r.member_name ?? `회원 ${r.member_uid}`,
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
          unrecognizedCount: list.filter((x: any) => x.closed).length,
          deadlineDays: REMOTE_REPORT_DEADLINE_DAYS,
        });
      } catch (err) {
        return jsonError("pending_reports", err);
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
