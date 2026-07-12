/**
 * /api/admin-att-correction-file?correctionId=N&fileId=M
 *   근태 정정 요청에 첨부된 증빙 자료를 결재자가 내려받는다.
 *
 * 왜 별도 함수인가:
 *   증빙 파일은 직원 본인의 파일함에 있다. 결재자가 파일함을 통째로 열람하면 그 직원의
 *   다른 사적 파일까지 볼 수 있게 된다. 그래서 **이 정정 요청에 실제로 첨부된 파일**만
 *   내려받을 수 있게 좁혀 놓는다 — 요청에 적힌 첨부 목록에 없는 파일 번호는 거절한다.
 *
 * 권한: 관리자 (requireAdmin)
 * 응답: { url, name }  — 5분 유효한 내려받기 주소
 */
import { db } from "../../db/index";
import { attCorrections } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { evidenceListOf, evidenceDownloadUrl } from "../../lib/att-evidence";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-att-correction-file" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "증빙 자료 열람 실패", step,
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
  const admin = (auth as any).ctx.member;

  const url = new URL(req.url);
  const correctionId = Number(url.searchParams.get("correctionId"));
  const fileId = Number(url.searchParams.get("fileId"));
  if (!Number.isFinite(correctionId) || !Number.isFinite(fileId)) {
    return jsonBadRequest("correctionId·fileId 필수");
  }

  try {
    const [row] = await db.select()
      .from(attCorrections)
      .where(eq(attCorrections.id, correctionId))
      .limit(1);
    if (!row) return jsonBadRequest("정정 요청을 찾을 수 없습니다");

    /* 이 요청에 실제로 첨부된 파일인지 확인 — 아니면 열람 불가 */
    const attached = evidenceListOf(row).find((f) => f.fileId === fileId);
    if (!attached) return jsonBadRequest("이 요청에 첨부된 파일이 아닙니다");

    const signed = await evidenceDownloadUrl(fileId);
    if (!signed) return jsonBadRequest("파일을 찾을 수 없습니다 (삭제되었을 수 있습니다)");

    /* 남의 서류를 열어본 기록은 남긴다 */
    try {
      await logAdminAction(req, Number(admin.id), String(admin.name), "att_correction_evidence_view", {
        target: `ATT-CORRECTION-${correctionId}`,
        detail: { fileId, fileName: attached.name, memberUid: row.memberUid, targetDate: row.targetDate },
      });
    } catch (err) { console.warn("[admin-att-correction-file] 감사 로그 실패:", err); }

    return jsonOk(signed);
  } catch (err) { return jsonError("evidence_download", err); }
}
