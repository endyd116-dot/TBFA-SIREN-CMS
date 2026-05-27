/**
 * admin-martyrdom-export — 유족급여신청서 초안 내보내기 (G1·§P3.2)
 *
 * POST { caseId, outputId?, format }   format: 'pdf' | 'docx' | 'html'
 *   pdf  → pdf-lib + NotoSansKR / docx → docx 라이브러리 / html → 편집가능 HTML
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
import { buildDraftHtml, buildDraftPdf, buildDraftDocx } from "../../lib/martyrdom-export";

export const config = { path: "/api/admin-martyrdom-export" };

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
  /* ★ R41 Q2-054: 내보내기 쓰기 권한 게이트 (미정의 키면 admin 허용 기본) */
  if (!(await canAccess(member.role ?? "", PUB_EXPORT_FEATURE))) return roleForbidden("operator");

  let body: any;
  try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
  const caseId = Number(body.caseId);
  const outputId = body.outputId ? Number(body.outputId) : undefined;
  const format = String(body.format || "pdf").toLowerCase();
  if (!caseId) return badRequest("caseId 필수");
  if (!["pdf", "docx", "html"].includes(format)) return badRequest("format은 pdf|docx|html");

  try {
    /* caseNo (파일명) */
    const cr: any = await db.execute(sql.raw(`SELECT case_no AS "caseNo" FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1`));
    const caseRow = (cr?.rows ?? cr ?? [])[0];
    if (!caseRow) return badRequest("사건을 찾을 수 없습니다");
    const caseNo = String(caseRow.caseNo || `case-${caseId}`);

    let bytes: Uint8Array;
    let mimeType: string;
    let ext: string;
    if (format === "pdf") {
      bytes = await buildDraftPdf(caseId, outputId);
      mimeType = "application/pdf";
      ext = "pdf";
    } else if (format === "docx") {
      bytes = await buildDraftDocx(caseId, outputId);
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      ext = "docx";
    } else {
      const html = await buildDraftHtml(caseId, outputId);
      bytes = new Uint8Array(Buffer.from(html, "utf-8"));
      mimeType = "text/html; charset=utf-8";
      ext = "html";
    }

    const base64 = Buffer.from(bytes).toString("base64");
    const fileName = `유족급여신청서_${caseNo}.${ext}`;

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_export", {
      target: String(caseId), detail: { format },
    });

    return new Response(JSON.stringify({ ok: true, fileName, mimeType, base64 }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return jsonError("export", err);
  }
};
