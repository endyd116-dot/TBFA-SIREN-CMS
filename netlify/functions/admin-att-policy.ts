import { jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attPolicies } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { getFlexRangeMins } from "../../lib/att-utils";

export const config = { path: "/api/admin-att-policy" };

function jsonOk(data: unknown) {
  return new Response(jsonKST({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "정책 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // P2-39 fix: 조회(GET)는 근태 설정 권한(att_config) 국장 허용, 변경은 이사장(super_admin) 전용
  const _role = (auth as any).ctx.member.role ?? "";
  if (req.method === "GET"
        ? !(_role === "super_admin" || await canAccess(_role, "att_config"))
        : _role !== "super_admin") {
    return new Response(jsonKST({ ok: false, error: req.method === "GET" ? "근태 설정 조회 권한이 없습니다" : "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  // GET — is_default=true 정책 조회
  if (req.method === "GET") {
    try {
      const rows = await db
        .select()
        .from(attPolicies)
        .where(eq(attPolicies.isDefault, true))
        .limit(1);
      if (!rows[0]) return jsonOk(null);
      // flex_range_mins는 schema 정의 밖(raw SQL 격리) → 별도 병합
      const flexRangeMins = await getFlexRangeMins();
      return jsonOk({ ...rows[0], flexRangeMins });
    } catch (err) {
      return jsonError("select_policy", err);
    }
  }

  // PUT — 정책 수정 (is_default=true 레코드 업데이트)
  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      // is_default=true 레코드 확인
      const existing = await db
        .select()
        .from(attPolicies)
        .where(eq(attPolicies.isDefault, true))
        .limit(1);

      if (existing.length === 0) {
        return jsonError("not_found", new Error("기본 정책 없음"), 404);
      }

      const [row] = await db
        .update(attPolicies)
        .set({
          name:                 body.name               ?? existing[0].name,
          checkInTime:          body.checkInTime        ?? existing[0].checkInTime,
          checkOutTime:         body.checkOutTime       ?? existing[0].checkOutTime,
          lateGraceMins:        body.lateGraceMins      ?? existing[0].lateGraceMins,
          earlyLeaveGraceMins:  body.earlyLeaveGraceMins ?? existing[0].earlyLeaveGraceMins,
          dailyHours:           body.dailyHours != null  ? String(body.dailyHours) : existing[0].dailyHours,
          breakMins:            body.breakMins           ?? existing[0].breakMins,
          breakThresholdHours:  body.breakThresholdHours != null ? String(body.breakThresholdHours) : existing[0].breakThresholdHours,
          weeklyMaxHours:       body.weeklyMaxHours     ?? existing[0].weeklyMaxHours,
          coreStartTime:        body.coreStartTime      ?? existing[0].coreStartTime,
          coreEndTime:          body.coreEndTime        ?? existing[0].coreEndTime,
          flexEnabled:          body.flexEnabled        ?? existing[0].flexEnabled,
          remoteMaxPerMonth:    body.remoteMaxPerMonth  ?? existing[0].remoteMaxPerMonth,
          updatedAt:            new Date(),
        } as any)
        .where(eq(attPolicies.id, existing[0].id))
        .returning();

      // 유연 허용범위(±X분) — schema 정의 밖이라 raw SQL UPDATE (마이그 전이면 무시)
      let flexRangeMins: number | undefined;
      if (body.flexRangeMins != null) {
        const v = Math.max(0, Math.min(360, Math.round(Number(body.flexRangeMins)) || 0));
        try {
          await db.execute(sql`UPDATE att_policies SET flex_range_mins = ${v} WHERE id = ${existing[0].id}`);
          flexRangeMins = v;
        } catch (e) { console.warn("[admin-att-policy] flex_range_mins 저장 실패(마이그 전?):", e); }
      }
      if (flexRangeMins == null) { try { flexRangeMins = await getFlexRangeMins(); } catch {} }
      return jsonOk({ ...row, flexRangeMins });
    } catch (err) {
      return jsonError("update_policy", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
