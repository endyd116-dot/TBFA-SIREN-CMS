/**
 * netlify/functions/memorial-report.ts — 추모관 «함께 알려 주세요» 접수 (★ 2026-11-16 Swain 지시)
 *
 * GET  /api/memorial-report   — { open } 접수를 받을 수 있는지(저장소 준비 여부)
 * POST /api/memorial-report   — 접수. 로그인 없이 받는다(편지와 같은 원칙).
 *   body: { kind: death|family|enshrine, teacherName, schoolRegion, deathDateText, content,
 *           familyName, familyRelation, familyPhone, reporterName, reporterRelation, reporterPhone,
 *           reporterEmail, consent: true, website(자동 입력 차단 칸 — 비어 있어야 함) }
 *   → 201 { reportNo }
 *
 * 안전장치: 자동 입력 차단 칸 · 로그인하지 않은 기기 60초 간격·하루 5건 · 차단된 회원은 접수 불가.
 * 적어 주신 내용은 공개되지 않는다. 운영자 알림에는 개인정보를 담지 않는다(접수번호·종류만).
 */
import type { Context } from "@netlify/functions";
import { ok, created, badRequest, tooManyRequests, serverError, methodNotAllowed, corsPreflight } from "../../lib/response";
import { jsonKST } from "../../lib/kst";
import { requireActiveUser, extractToken } from "../../lib/auth";
import { clientIpHash } from "../../lib/client-ip";
import { notifyAllOperators } from "../../lib/notify";
import {
  reportsReady, validateReportInput, anonLimitHit, insertReport,
  KIND_LABEL, ANON_COOLDOWN_SECONDS, DAILY_LIMIT_PER_DEVICE,
} from "../../lib/memorial-reports";

export const config = { path: "/api/memorial-report" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return corsPreflight();

  if (req.method === "GET") {
    let open = false;
    try { open = await reportsReady(); } catch { open = false; }
    return ok({ open });
  }
  if (req.method !== "POST") return methodNotAllowed();

  let step = "start";
  try {
    step = "ready";
    if (!(await reportsReady())) {
      return new Response(jsonKST({ ok: false, error: "접수 준비가 아직 끝나지 않았습니다. 잠시 뒤 다시 시도해 주세요." }), {
        status: 503, headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    step = "body";
    let body: any = null;
    try { body = await req.json(); } catch { body = null; }
    if (!body || typeof body !== "object") return badRequest("보내 주신 내용을 읽지 못했습니다");

    /* 자동 입력 차단 칸 — 사람에게는 보이지 않는 칸이 채워져 오면 기계 입력으로 보고 조용히 넘긴다 */
    step = "honeypot";
    if (String(body.website || "").trim()) return created({ reportNo: null }, "접수되었습니다");

    /* 로그인 흔적이 있으면 회원으로 받는다. 토큰이 만료된 것뿐이면 비회원으로, 차단된 분은 받지 않는다. */
    step = "auth";
    let memberId: number | null = null;
    if (extractToken(req)) {
      const guard = await requireActiveUser(req);
      if (guard.ok) {
        memberId = (guard as { ok: true; user: import("../../lib/auth").UserPayload }).user.uid;
      } else {
        const blocked = (guard as { ok: false; res: Response }).res;
        if (blocked && blocked.status === 403) return blocked;
      }
    }

    step = "validate";
    const checked = validateReportInput(body);
    if (checked.ok === false) return badRequest((checked as { ok: false; error: string }).error);
    const v = checked.value;

    step = "limit";
    const ipHash = clientIpHash(req);
    if (!memberId) {
      const hit = await anonLimitHit(ipHash);
      if (hit === "cooldown") return tooManyRequests(`조금 전에 접수하셨습니다. ${ANON_COOLDOWN_SECONDS}초 뒤에 다시 보내 주세요.`, ANON_COOLDOWN_SECONDS);
      if (hit === "daily") return tooManyRequests(`같은 기기에서는 하루 ${DAILY_LIMIT_PER_DEVICE}건까지 접수할 수 있습니다. 급한 일이면 협의회로 전화 주세요.`);
    }

    step = "insert";
    const row = await insertReport(v, { memberId, ipHash });

    /* 운영자 알림 — 실패해도 접수는 끝난 것이다. 개인정보(성함·연락처)는 넣지 않는다. */
    step = "notify";
    try {
      await notifyAllOperators({
        category: "support",
        severity: v.kind === "death" ? "critical" : "warning",
        title: `추모관에 «${KIND_LABEL[v.kind]}» 접수가 들어왔습니다`,
        message:
          `접수번호 ${row.reportNo}. 통합 CMS › 온라인 추모관 › 제보·신청 탭에서 내용을 확인하고 연락해 주세요. ` +
          `(알림에는 개인정보를 담지 않습니다)`,
        link: `/cms-tbfa.html#memorial`,
        refTable: "memorial_reports",
        refId: row.id,
      });
    } catch (err) {
      console.warn("[memorial-report] 운영자 알림 실패", err);
    }

    return created({ reportNo: row.reportNo }, "접수되었습니다");
  } catch (err: any) {
    return serverError("접수하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", err, step);
  }
}
