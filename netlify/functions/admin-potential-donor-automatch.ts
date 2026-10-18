/**
 * POST /api/admin/potential-donor-automatch
 *
 * 미연결 잠재 후원자를 회원과 전화(숫자만)·이메일 일치로 일괄 자동 연결 (2026-10-18)
 * 응답: { ok, data: { scanned, linked, details:[{potentialId, memberId, by}] } }
 *   scanned = 연락처 있는 미연결 잠재 수(실행 전) · linked = 이번에 연결된 수
 * 평소엔 회원 생성·후원 재평가 순간 훅이 즉시 연결하므로, 이 버튼은 과거 데이터 정리·점검용.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { autoLinkAllPotentialDonors } from "../../lib/potential-donor-link";

export const config = { path: "/api/admin/potential-donor-automatch" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  if (req.method !== "POST") return new Response(jsonKST({ ok: false, error: "Method Not Allowed" }), { status: 405, headers: JSON_HEADER });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const admin = (auth as any).ctx?.admin;

  let step = "automatch";
  try {
    const result = await autoLinkAllPotentialDonors();
    step = "audit";
    await logAdminAction(req as any, admin?.uid, admin?.name, "potential_donor_automatch", {
      target: "potential_donors", detail: { scanned: result.scanned, linked: result.linked },
    }).catch(() => {});
    return new Response(jsonKST({
      ok: true,
      message: result.linked ? `${result.linked}명을 회원과 자동 연결했습니다` : "새로 연결할 잠재 후원자가 없습니다",
      data: result,
    }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "자동 매칭 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
};
