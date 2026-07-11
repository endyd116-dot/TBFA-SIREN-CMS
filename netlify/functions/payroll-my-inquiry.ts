/**
 * POST /api/payroll-my-inquiry  (OP-028)
 *
 * 운영자(본인)가 급여 명세·분기 결산에 대한 이의제기/문의를 접수하는 채널.
 * body: { payYear?, payMonth?, message }
 *
 * 기존엔 본인 명세(payroll-my)가 조회·PDF만 가능하고 정정 요청·문의 경로가 없어
 * 운영자가 명세 오류를 발견해도 시스템 밖(외부 연락)으로 가야 했다(R45 OP-028).
 *
 * 별도 테이블 없이 기존 알림 시스템 재사용 — super_admin 전원에게 알림 생성(notifications에 기록).
 * super_admin이 알림 확인 후 admin-payroll 검토메모(reviewNote)로 회신.
 */
import type { Context } from "@netlify/functions";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { notifyAllSuperAdmins } from "../../lib/notify";
import { ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/payroll-my-inquiry" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const guard = await requireOperator(req);
  if (operatorGuardFailed(guard)) return guard.res;
  const me = guard.ctx.member;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const payYear = Number(body.payYear) || null;
    const payMonth = Number(body.payMonth) || null;
    const message = String(body.message || "").trim();
    if (!message) return badRequest("문의 내용을 입력해 주세요");
    if (message.length > 1000) return badRequest("문의 내용은 1000자 이내로 입력해 주세요");

    const periodText = payYear && payMonth ? `${payYear}년 ${payMonth}월` : "급여";
    await notifyAllSuperAdmins({
      category: "system",
      severity: "info",
      title: `급여 명세 문의/이의제기 — ${me.name || "직원"}`,
      message: `[${periodText}] ${message.slice(0, 400)}`,
      link: "/cms-tbfa.html#payroll",
    });

    return ok({ submitted: true }, "문의가 접수되었습니다. 담당자가 확인 후 회신드립니다.");
  } catch (err) {
    return serverError("문의 접수 중 오류", err);
  }
};
