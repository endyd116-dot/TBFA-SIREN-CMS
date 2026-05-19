/**
 * GET /api/admin-att-members
 * 어드민 화면에서 직원 드롭다운(재택보고서 모니터링·근무형태 관리 탭)용 활성 운영자 목록.
 * 응답: { ok:true, data: { members: [{ id, uid, name, email, role, operatorActive }] } }
 *
 * 슈퍼어드민 전용.
 */
import { db } from "../../db/index";
import { members } from "../../db/schema";
import { and, eq, isNull, asc, inArray } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-members" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "직원 목록 조회 실패", step,
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
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  try {
    // operatorActive=true 또는 role IN ('super_admin','admin','operator')
    const rows = await db
      .select({
        id:             members.id,
        name:           members.name,
        email:          members.email,
        role:           members.role,
        operatorActive: members.operatorActive,
      })
      .from(members)
      .where(and(
        isNull(members.withdrawnAt),
        // (operatorActive=true) OR role 이 운영진
        // drizzle 표현 한계로 분리 — 둘 중 하나라도 충족하면 포함
      ));

    const filtered = rows.filter(m =>
      m.operatorActive === true ||
      (m.role != null && ["super_admin", "admin", "operator"].includes(m.role))
    );

    // 정렬: 슈퍼어드민 → admin → operator → 기타, 그 다음 이름순
    const ROLE_ORDER: Record<string, number> = {
      super_admin: 0, admin: 1, operator: 2,
    };
    filtered.sort((a, b) => {
      const ra = ROLE_ORDER[a.role ?? ""] ?? 99;
      const rb = ROLE_ORDER[b.role ?? ""] ?? 99;
      if (ra !== rb) return ra - rb;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko");
    });

    const data = filtered.map(m => ({
      id:             m.id,
      uid:            String(m.id),       // att_*.member_uid 와 동일한 표현
      name:           m.name,
      email:          m.email,
      role:           m.role,
      operatorActive: m.operatorActive,
    }));

    return jsonOk({ members: data });
  } catch (err) {
    return jsonError("select_members", err);
  }
}
