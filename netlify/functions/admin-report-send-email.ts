// netlify/functions/admin-report-send-email.ts
/**
 * POST /api/admin-report-send-email
 *
 * 저장된 보고서 스냅샷을 관리자 이메일로 재발송합니다.
 *
 * body: { reportId: number }
 * 응답: { ok: true, data: { sentCount, sentTo } }
 */
import { jsonKST } from "../../lib/kst";
import { eq } from "drizzle-orm";
import { db, reportSnapshots, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { sendEmail } from "../../lib/email";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  methodNotAllowed,
  corsPreflight,
} from "../../lib/response";

export const config = { path: "/api/admin-report-send-email" };

/* ─────────────────────── 이메일 HTML 빌더 ─────────────────────── */
function buildEmailHtml(
  stats: any,
  aiSummary: string,
  aiAlerts: any[],
  label: string
): string {
  const alerts = (aiAlerts ?? [])
    .map((a: any) => {
      const color =
        a.severity === "high"
          ? "#e53e3e"
          : a.severity === "medium"
          ? "#dd6b20"
          : "#718096";
      return `<li style="color:${color};margin-bottom:6px;">[${a.type}] ${a.message}</li>`;
    })
    .join("");

  const s = stats ?? {};
  const mem = s.members ?? {};
  const don = s.donations ?? {};
  const sir = s.siren ?? {};
  const inc = sir.incident ?? {};
  const har = sir.harassment ?? {};
  const leg = sir.legal ?? {};
  const exp = s.expertMatches ?? {};
  const sup = s.support ?? {};
  const byCat = sup.byCategory ?? {};

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#2d3748;max-width:640px;margin:auto;padding:24px;">
<h2 style="color:#2b6cb0;">[SIREN 주간 보고] ${label}</h2>
<hr/>
<h3>AI 핵심 요약</h3>
<div style="background:#ebf8ff;padding:16px;border-radius:8px;white-space:pre-wrap;">${aiSummary || "(AI 요약 없음)"}</div>
${alerts ? `<h3>위험경보</h3><ul>${alerts}</ul>` : ""}
<h3>주요 통계</h3>
<table style="border-collapse:collapse;width:100%;">
  <tr style="background:#edf2f7;"><td style="padding:8px;font-weight:bold;">회원</td><td style="padding:8px;">신규 ${mem.newThisPeriod ?? 0}명 / 활성 전체 ${mem.totalActive ?? 0}명</td></tr>
  <tr><td style="padding:8px;font-weight:bold;">후원</td><td style="padding:8px;">${don.count ?? 0}건 / ${(don.totalAmount ?? 0).toLocaleString()}원 | 정기후원자 ${don.regularActive ?? 0}명</td></tr>
  <tr style="background:#edf2f7;"><td style="padding:8px;font-weight:bold;">사건신고</td><td style="padding:8px;">신규 ${inc.newThisPeriod ?? 0}건 (미처리 ${inc.totalOpen ?? 0}건)</td></tr>
  <tr><td style="padding:8px;font-weight:bold;">괴롭힘신고</td><td style="padding:8px;">신규 ${har.newThisPeriod ?? 0}건 (미처리 ${har.totalOpen ?? 0}건)</td></tr>
  <tr style="background:#edf2f7;"><td style="padding:8px;font-weight:bold;">법률신고</td><td style="padding:8px;">신규 ${leg.newThisPeriod ?? 0}건 (미처리 ${leg.totalOpen ?? 0}건)</td></tr>
  <tr><td style="padding:8px;font-weight:bold;">전문가매칭</td><td style="padding:8px;">신규 ${exp.newThisPeriod ?? 0}건 / 진행중 ${exp.active ?? 0}건</td></tr>
  <tr style="background:#edf2f7;"><td style="padding:8px;font-weight:bold;">유족지원</td><td style="padding:8px;">신규 ${sup.newThisPeriod ?? 0}건 (상담${byCat.counseling ?? 0}/법률${byCat.legal ?? 0}/장학${byCat.scholarship ?? 0})</td></tr>
</table>
<p style="color:#a0aec0;font-size:12px;margin-top:24px;">이 메일은 SIREN 플랫폼 관리자가 수동 재발송했습니다.</p>
</body></html>`;
}

/* ─────────────────────── 핸들러 ─────────────────────── */
export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 1. 관리자 인증 */
  let guard: any;
  try {
    guard = await requireAdmin(req);
  } catch (err: any) {
    return serverError("인증 확인 중 오류가 발생했습니다", {
      step: "auth",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    });
  }
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  /* 2. body 파싱 */
  let reportId: number;
  try {
    const body = await req.json();
    reportId = Number(body?.reportId);
    if (!reportId || isNaN(reportId) || reportId <= 0) {
      return badRequest("reportId가 유효하지 않습니다");
    }
  } catch (err: any) {
    return badRequest("요청 본문을 파싱할 수 없습니다");
  }

  /* 3. 보고서 스냅샷 조회 */
  let snapshot: any;
  try {
    const rows = await db
      .select()
      .from(reportSnapshots)
      .where(eq(reportSnapshots.id, reportId))
      .limit(1);
    snapshot = rows[0];
  } catch (err: any) {
    return serverError("보고서 조회 중 오류가 발생했습니다", {
      step: "select_snapshot",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    });
  }

  if (!snapshot) return notFound("해당 보고서를 찾을 수 없습니다");

  /* 4. 수신자 목록 구성 (ADMIN_NOTIFY_EMAIL + super_admin) */
  const toList: Array<{ email: string; name: string }> = [];

  const notifyEmail = (process.env.ADMIN_NOTIFY_EMAIL || "").trim();
  if (notifyEmail) toList.push({ email: notifyEmail, name: "SIREN 관리자" });

  try {
    const superAdmins = await db
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      .where(eq(members.memberSubtype, "super_admin"))
      .limit(10);

    for (const a of superAdmins) {
      if (a.email && !toList.find((t) => t.email === a.email)) {
        toList.push({ email: a.email, name: a.name ?? "관리자" });
      }
    }
  } catch (err: any) {
    console.warn("[admin-report-send-email] super_admin 조회 실패 (계속 진행)", err);
  }

  if (toList.length === 0) {
    return badRequest(
      "수신자가 없습니다. ADMIN_NOTIFY_EMAIL 환경변수 또는 super_admin 계정을 확인해주세요"
    );
  }

  /* 5. 기간 레이블 생성 */
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  const periodLabel =
    snapshot.periodStart && snapshot.periodEnd
      ? `${fmt(new Date(snapshot.periodStart))} ~ ${fmt(new Date(snapshot.periodEnd))}`
      : `보고서 #${snapshot.id}`;

  /* 6. 이메일 HTML 생성 */
  const emailHtml = buildEmailHtml(
    snapshot.stats,
    snapshot.aiSummary ?? "",
    (snapshot.aiAlerts as any[]) ?? [],
    periodLabel
  );
  const subject = `[SIREN 주간 보고] ${periodLabel}`;

  /* 7. 이메일 발송 — R41 Q2-033: 수신자별 발송 실패 집계 */
  const sentTo: Array<{ email: string; name: string }> = [];
  const failedTo: Array<{ email: string; error: string }> = [];
  try {
    for (const to of toList) {
      try {
        const r = await sendEmail({ to: to.email, subject, html: emailHtml });
        if (r.ok) {
          sentTo.push(to);
        } else {
          failedTo.push({ email: to.email, error: String(r.error || "알 수 없는 오류").slice(0, 200) });
          console.warn("[admin-report-send-email] 발송 실패", to.email, r.error);
        }
      } catch (err: any) {
        failedTo.push({ email: to.email, error: String(err?.message || err).slice(0, 200) });
        console.warn("[admin-report-send-email] 발송 예외", to.email, err);
      }
    }
  } catch (err: any) {
    return serverError("이메일 발송 중 오류가 발생했습니다", {
      step: "send_email",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    });
  }

  /* 8. sentEmailAt + sentTo DB 갱신 */
  if (sentTo.length > 0) {
    try {
      await db
        .update(reportSnapshots)
        .set({
          sentEmailAt: new Date(),
          sentTo: sentTo as any,
        } as any)
        .where(eq(reportSnapshots.id, reportId));
    } catch (err: any) {
      console.warn("[admin-report-send-email] sentEmail 갱신 실패 (응답은 정상)", err);
    }
  }

  console.log(
    `[admin-report-send-email] 완료 — reportId=${reportId}, 발송=${sentTo.length}건, 실패=${failedTo.length}건`
  );

  const attempted = toList.length;
  const sentCount = sentTo.length;
  const failedCount = failedTo.length;

  // R41 Q2-033: 전체 실패(0건 발송)는 ok 대신 명시적 경고 응답으로 가시화
  // serverError는 본문에 집계를 싣지 못하므로 직접 Response 구성(프론트가 sentCount=0 인지)
  if (sentCount === 0) {
    return new Response(jsonKST({
      ok: false,
      error: "이메일을 한 건도 발송하지 못했습니다",
      step: "send_email_all_failed",
      attempted,
      sentCount,
      failedCount,
      failedTo,
    }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  // 부분 실패는 ok 응답에 실패 건수를 함께 노출
  return ok({
    sentCount,
    failedCount,
    attempted,
    sentTo,
    failedTo,
  }, failedCount > 0
    ? `${sentCount}건 발송 완료 (${failedCount}건 실패)`
    : `${sentCount}건 발송 완료`);
};
