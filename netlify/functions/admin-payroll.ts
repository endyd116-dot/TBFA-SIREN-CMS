/**
 * /api/admin-payroll
 *   GET  /api/admin-payroll?year=&month=                  월별 명세서 일람
 *   GET  /api/admin-payroll?id=N                          명세서 상세
 *   PATCH /api/admin-payroll?id=N    body { reviewNote?, status? }   수정
 *   POST /api/admin-payroll?id=N&action=approve           승인 (APPROVED)
 *   POST /api/admin-payroll?id=N&action=hold              보류 (HOLD)
 *   POST /api/admin-payroll?action=recalculate&year=&month=   월별 수동 재집계 (3일차에서 구현)
 *
 * 권한: super_admin 전용 (member.role === 'super_admin')
 * R37 1일차 — API 골격. 자동 집계·발송은 후속 일차에서 구현.
 */
import { db } from "../../db/index";
import { payrollSlips, members } from "../../db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-payroll" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "급여 명세서 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBadRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  const admin = (auth as any).ctx.member;

  const url = new URL(req.url);
  const method = req.method;
  const idParam = url.searchParams.get("id");
  const idNum = idParam ? Number(idParam) : null;

  // GET
  if (method === "GET") {
    // 상세
    if (idNum) {
      try {
        const [slip] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
        if (!slip) return jsonBadRequest("명세서를 찾을 수 없습니다");
        // 회원 이름 부가 정보
        let memberInfo: any = null;
        try {
          const [m] = await db.select({
            id: members.id, name: members.name, email: members.email,
            role: members.role, milestoneRole: members.milestoneRole,
          }).from(members).where(eq(members.id, Number(slip.memberUid))).limit(1);
          memberInfo = m ?? null;
        } catch (err) {
          console.warn("[admin-payroll] member lookup failed:", err);
        }
        return jsonOk({ slip, member: memberInfo });
      } catch (err) { return jsonError("select_slip_detail", err); }
    }

    // 일람
    try {
      const year = Number(url.searchParams.get("year") || 0);
      const month = Number(url.searchParams.get("month") || 0);
      if (!year || !month) return jsonBadRequest("year·month 필수");

      const rows = await db.select()
        .from(payrollSlips)
        .where(and(eq(payrollSlips.payYear, year), eq(payrollSlips.payMonth, month)))
        .orderBy(desc(payrollSlips.grossPay));

      // 회원 정보 separate query + Map (drizzle leftJoin 체인 금지 §6.3)
      const memberIds = Array.from(new Set(rows.map(r => Number(r.memberUid)).filter(n => !isNaN(n))));
      let memberMap = new Map<number, any>();
      if (memberIds.length > 0) {
        try {
          const ms = await db.select({
            id: members.id, name: members.name, email: members.email,
            role: members.role, milestoneRole: members.milestoneRole,
          }).from(members).where(inArray(members.id, memberIds));
          memberMap = new Map(ms.map(m => [m.id, m]));
        } catch (err) {
          console.warn("[admin-payroll] member batch lookup failed:", err);
        }
      }

      const enriched = rows.map(r => ({
        ...r,
        memberName: memberMap.get(Number(r.memberUid))?.name ?? null,
        memberEmail: memberMap.get(Number(r.memberUid))?.email ?? null,
        memberMilestoneRole: memberMap.get(Number(r.memberUid))?.milestoneRole ?? null,
      }));

      // 통계 카드용 카운트
      const counts = {
        DRAFT: 0, REVIEWED: 0, APPROVED: 0, SENT: 0, HOLD: 0,
      };
      for (const r of rows) {
        if (r.status in counts) counts[r.status as keyof typeof counts]++;
      }

      return jsonOk({ rows: enriched, counts, total: rows.length });
    } catch (err) { return jsonError("select_slips", err); }
  }

  // PATCH — review_note·status 수정
  if (method === "PATCH") {
    if (!idNum) return jsonBadRequest("id 필수");
    let body: any;
    try { body = await req.json(); } catch { return jsonBadRequest("JSON 본문 필수"); }

    try {
      const update: any = { updatedAt: new Date() };
      if (typeof body.reviewNote === "string") update.reviewNote = body.reviewNote;
      if (typeof body.status === "string") {
        const allowed = ["DRAFT", "REVIEWED", "APPROVED", "SENT", "HOLD"];
        if (!allowed.includes(body.status)) return jsonBadRequest("status 값 부적합");
        update.status = body.status;
        if (body.status === "REVIEWED") {
          update.reviewedBy = String(admin.id);
          update.reviewedAt = new Date();
        }
      }
      const [updated] = await db.update(payrollSlips).set(update)
        .where(eq(payrollSlips.id, idNum))
        .returning();
      if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");
      return jsonOk(updated);
    } catch (err) { return jsonError("update_slip", err); }
  }

  // POST — action 분기
  if (method === "POST") {
    const action = url.searchParams.get("action") || "";

    // 승인
    if (action === "approve") {
      if (!idNum) return jsonBadRequest("id 필수");
      try {
        const update: any = {
          status: "APPROVED",
          approvedBy: String(admin.id),
          approvedAt: new Date(),
          updatedAt: new Date(),
        };
        const [updated] = await db.update(payrollSlips).set(update)
          .where(eq(payrollSlips.id, idNum)).returning();
        if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");
        return jsonOk(updated);
      } catch (err) { return jsonError("approve_slip", err); }
    }

    // 보류
    if (action === "hold") {
      if (!idNum) return jsonBadRequest("id 필수");
      let body: any = {};
      try { body = await req.json(); } catch { /* 본문 없어도 허용 */ }
      try {
        const update: any = { status: "HOLD", updatedAt: new Date() };
        if (typeof body.reviewNote === "string") update.reviewNote = body.reviewNote;
        const [updated] = await db.update(payrollSlips).set(update)
          .where(eq(payrollSlips.id, idNum)).returning();
        if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");
        return jsonOk(updated);
      } catch (err) { return jsonError("hold_slip", err); }
    }

    // 월별 수동 재집계 — 2일차 cron 로직 완성 후 활성화
    if (action === "recalculate") {
      return new Response(JSON.stringify({
        ok: false,
        error: "월별 수동 재집계는 2일차 자동 집계 로직 완성 후 활성화됩니다",
        step: "recalculate_not_ready",
      }), { status: 501, headers: { "Content-Type": "application/json" } });
    }

    return jsonBadRequest("action 값 부적합 (approve|hold|recalculate)");
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
