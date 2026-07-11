/**
 * admin-martyrdom-package — 사건 패키지 zip 내보내기 (G4·§P3.2)
 *
 * POST { caseId }
 *   자료 원문 + 분석 산출물 + 보고서 초안을 한 묶음 zip (변호사·노무사 전달·종결 archive).
 *
 * 응답: { ok, fileName, mimeType, base64 }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { roleForbidden } from "../../lib/admin-role";
import { canAccess } from "../../lib/role-permission-check";
import { logAdminAction } from "../../lib/audit";
import { buildCasePackageZip } from "../../lib/martyrdom-export";

export const config = { path: "/api/admin-martyrdom-package" };

/* 발간물 내보내기 쓰기 권한 — 권한 정책 관리에서 토글 (operator 허용 기본·메인 시드) */
const PUB_EXPORT_FEATURE = "martyrdom_pub_export";

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;
  /* R41 Q2-054: 내보내기 쓰기 권한 게이트 (미정의 키면 admin 허용 기본) */
  if (!(await canAccess(member.role ?? "", PUB_EXPORT_FEATURE))) return roleForbidden("operator");

  let body: any;
  try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
  const caseId = Number(body.caseId);
  if (!caseId) return badRequest("caseId 필수");

  try {
    const cr: any = await db.execute(sql.raw(`SELECT case_no AS "caseNo" FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1`));
    const caseRow = (cr?.rows ?? cr ?? [])[0];
    if (!caseRow) return badRequest("사건을 찾을 수 없습니다");
    const caseNo = String(caseRow.caseNo || `case-${caseId}`);

    const zipBytes = await buildCasePackageZip(caseId);
    const base64 = Buffer.from(zipBytes).toString("base64");
    const fileName = `사건패키지_${caseNo}.zip`;

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_package", {
      target: String(caseId), detail: { bytes: zipBytes.length },
    });

    return new Response(JSON.stringify({ ok: true, fileName, mimeType: "application/zip", base64 }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return jsonError("package", err);
  }
};
