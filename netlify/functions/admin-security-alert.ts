import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-security-alert" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "보안 알림 전송 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), { status: 405 });
  }

  let auth: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;
  } catch (err) {
    return jsonError("auth", err);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패" }), { status: 400 });
  }

  const { alertType, targetUserId, message, riskLevel } = body;

  if (!alertType || !message) {
    return new Response(JSON.stringify({ ok: false, error: "alertType과 message는 필수입니다" }), { status: 400 });
  }

  try {
    await logAdminAction(req, auth.ctx.admin.uid, auth.ctx.member.name, "security_alert", {
      target: targetUserId ? `U-${targetUserId}` : undefined,
      detail: { alertType, message, riskLevel: riskLevel ?? "high" },
      success: true,
    });
  } catch (err) {
    return jsonError("log_audit", err);
  }

  // 실제 알림 발송 로직 (이메일·슬랙 등)은 추후 연동
  // 현재는 감사 로그 기록 후 sent: true 응답

  return new Response(JSON.stringify({
    ok: true,
    sent: true,
  }), { headers: { "Content-Type": "application/json" } });
}
