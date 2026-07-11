/**
 * POST /api/payroll-my-ack
 *
 * 직원 본인이 급여명세서에 대해
 *   ① 수령 확인 + 이의 없음 동의 (전자서명)   body: { id, action:'acknowledge', signatureType:'DRAW'|'TYPE',
 *                                                    signatureDataUrl?, signedName, consentItems:[{key,text,agreed}] }
 *   ② 이의 제기                                 body: { id, action:'object', reason }
 *
 * 원칙
 *  - 본인만 서명할 수 있다 (관리자도 대신 못 한다)
 *  - 교부된 명세서(발송·지급완료)만 대상
 *  - 서명하면 그 시점의 문서에 서명란을 찍은 '서명본'을 따로 만들어 보관한다
 *    (무엇에 서명했는지가 문서 자체로 남도록)
 *  - 서명 증적(시각·IP·기기·동의항목·문서지문)은 지우지 않는 별도 기록에 쌓는다
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { uploadToR2 } from "../../lib/r2-server";
import { buildSignedPayrollDocument, normalizeSignaturePng } from "../../lib/payroll-document";
import { notifyAllSuperAdmins } from "../../lib/notify";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import { notifyPayrollAcknowledged } from "../../lib/notify-payroll";

export const config = { path: "/api/payroll-my-ack" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;   // 손글씨 PNG 상한 (보통 수십 KB)

function jsonOk(data: unknown, message?: string) {
  return new Response(JSON.stringify({ ok: true, message, data }), { status: 200, headers: JSON_HEADER });
}
function jsonErr(error: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADER });
}
function jsonStepErr(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "수령 확인 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 800),
  }), { status: 500, headers: JSON_HEADER });
}

/** "data:image/png;base64,...." → 바이트 */
function parsePngDataUrl(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || "").trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1].replace(/\s/g, ""), "base64");
    if (buf.length === 0 || buf.length > MAX_SIGNATURE_BYTES) return null;
    // PNG 매직 넘버 확인 (확장자만 바꾼 다른 파일 차단)
    if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) return null;
    return new Uint8Array(buf);
  } catch { return null; }
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") return jsonErr("POST 전용", 405);

  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const me = (auth as any).ctx.member;
  const meUid = String(me.id);

  let body: any;
  try { body = await req.json(); } catch { return jsonErr("JSON 본문 필수"); }

  const id = Number(body?.id || 0);
  const action = String(body?.action || "");
  if (!id) return jsonErr("id 필수");
  if (action !== "acknowledge" && action !== "object") {
    return jsonErr("action은 acknowledge 또는 object");
  }

  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for") ?? null;
  const ua = String(req.headers.get("user-agent") ?? "").slice(0, 500);

  /* 1) 본인 명세서 · 교부된 것만 */
  let slip: any;
  try {
    const r: any = await db.execute(sql`
      SELECT id, member_uid, pay_year, pay_month, status, ack_status,
             document_version, document_r2_key, document_sha256
        FROM payroll_slips
       WHERE id = ${id} AND member_uid = ${meUid} AND status IN ('SENT', 'PAID')
       LIMIT 1
    `);
    slip = ((r as any).rows ?? r ?? [])[0];
    if (!slip) return jsonErr("명세서를 찾을 수 없습니다 (본인에게 교부된 명세서만 처리할 수 있습니다)", 404);
  } catch (err) { return jsonStepErr("select_slip", err); }

  const period = `${slip.pay_year}년 ${String(slip.pay_month).padStart(2, "0")}월`;
  const version = Number(slip.document_version || 1);

  /* ───────────────── 이의 제기 ───────────────── */
  if (action === "object") {
    const reason = String(body?.reason || "").trim();
    if (!reason) return jsonErr("이의 내용을 입력해 주세요");
    if (reason.length > 1000) return jsonErr("이의 내용은 1000자 이내로 입력해 주세요");

    try {
      await db.execute(sql`
        INSERT INTO payroll_objections (slip_id, member_uid, reason, status)
        VALUES (${id}, ${meUid}, ${reason}, 'OPEN')
      `);
      await db.execute(sql`
        INSERT INTO payroll_acknowledgments
          (slip_id, member_uid, document_version, action, objection_reason,
           document_r2_key, document_sha256, ip, user_agent)
        VALUES
          (${id}, ${meUid}, ${version}, 'OBJECTED', ${reason},
           ${slip.document_r2_key ?? null}, ${slip.document_sha256 ?? null}, ${ip}, ${ua})
      `);
      await db.execute(sql`
        UPDATE payroll_slips SET ack_status = 'OBJECTED', updated_at = NOW() WHERE id = ${id}
      `);
    } catch (err) { return jsonStepErr("insert_objection", err); }

    try {
      await notifyAllSuperAdmins({
        category: "system",
        severity: "warning",
        title: `급여명세 이의제기 — ${me.name || "직원"} (${period})`,
        message: reason.slice(0, 400),
        link: "/cms-tbfa.html#payroll",
      });
    } catch (err) { console.warn("[payroll-my-ack] 이의제기 알림 실패:", err); }

    return jsonOk({ id, ackStatus: "OBJECTED" }, "이의가 접수되었습니다. 담당자가 확인 후 회신드립니다.");
  }

  /* ───────────────── 수령 확인 + 전자서명 ───────────────── */
  if (slip.ack_status === "ACKNOWLEDGED") {
    return jsonErr("이미 수령 확인이 완료된 명세서입니다", 409);
  }

  const signedName = String(body?.signedName || "").trim();
  if (!signedName) return jsonErr("서명란에 성명을 입력해 주세요");
  if (signedName.length > 80) return jsonErr("성명이 너무 깁니다");

  const consentItems: any[] = Array.isArray(body?.consentItems) ? body.consentItems : [];
  if (consentItems.length === 0) return jsonErr("동의 항목이 없습니다");
  if (!consentItems.every(c => c && c.agreed === true)) {
    return jsonErr("모든 동의 항목에 체크해야 서명할 수 있습니다");
  }

  const signatureType = body?.signatureType === "DRAW" ? "DRAW" : "TYPE";
  let signatureBytes: Uint8Array | null = null;
  if (signatureType === "DRAW") {
    const raw = parsePngDataUrl(body?.signatureDataUrl);
    if (!raw) {
      return jsonErr("손글씨 서명 이미지를 읽지 못했습니다. 다시 서명하거나 성명 입력 방식을 이용해 주세요");
    }
    /* PDF에 넣기 전에 반드시 정화 — 깨진 PNG는 PDF 생성기를 오류 없이 멈추게 만든다(무한 루프).
       여기서 걸러야 서명 제출이 타임아웃으로 사라지는 일이 없다. 빈 서명도 여기서 거절된다. */
    const clean = await normalizeSignaturePng(raw);
    if (clean.ok !== true) return jsonErr(clean.error);
    signatureBytes = clean.bytes;
  }

  /* 2) 서명 이미지 보관 (손글씨일 때만) */
  let signatureKey: string | null = null;
  if (signatureBytes) {
    try {
      const up = await uploadToR2({
        buffer: signatureBytes,
        originalName: `signature_${slip.pay_year}${String(slip.pay_month).padStart(2, "0")}_${meUid}.png`,
        mimeType: "image/png",
        context: "payroll",
        isPublic: false,
        expiresInDays: null,
      });
      if (!up.ok || !up.blobKey) return jsonErr(up.error || "서명 이미지 저장 실패", 500);
      signatureKey = up.blobKey;
    } catch (err) { return jsonStepErr("upload_signature", err); }
  }

  const signedAt = new Date();

  /* 3) 서명본 문서 생성 — 서명란이 찍힌 PDF를 따로 보관 */
  let signedDocKey: string | null = null;
  let signedDocSha: string | null = null;
  try {
    const built = await buildSignedPayrollDocument(id, {
      imagePng: signatureBytes,
      signedName,
      signedAt,
      consentItems: consentItems.map(c => ({ text: String(c.text || ""), agreed: !!c.agreed })),
      ip,
    });
    if (!built.ok) return jsonErr(built.error || "서명본 생성 실패", 500);
    signedDocKey = built.r2Key ?? null;
    signedDocSha = built.sha256 ?? null;
  } catch (err) { return jsonStepErr("build_signed_document", err); }

  /* 4) 증적 기록 + 명세서 상태 갱신 */
  try {
    await db.execute(sql`
      INSERT INTO payroll_acknowledgments
        (slip_id, member_uid, document_version, action, signature_type, signature_r2_key,
         signed_name, consent_items, document_r2_key, document_sha256, signed_document_r2_key, ip, user_agent)
      VALUES
        (${id}, ${meUid}, ${version}, 'ACKNOWLEDGED', ${signatureType}, ${signatureKey},
         ${signedName}, ${JSON.stringify(consentItems)}::jsonb,
         ${slip.document_r2_key ?? null}, ${slip.document_sha256 ?? null}, ${signedDocKey}, ${ip}, ${ua})
    `);
    /* 이미 서명된 건은 덮지 않는다 — 버튼을 두 번 눌러 요청이 겹쳐도 서명이 뒤바뀌지 않게. */
    await db.execute(sql`
      UPDATE payroll_slips SET
        ack_status = 'ACKNOWLEDGED',
        ack_at = ${signedAt.toISOString()}::timestamp,
        signed_document_r2_key = ${signedDocKey},
        updated_at = NOW()
      WHERE id = ${id} AND ack_status <> 'ACKNOWLEDGED'
    `);
  } catch (err) { return jsonStepErr("record_acknowledgment", err); }

  /* 5) 알림 (실패해도 서명은 이미 유효) */
  const orgName = process.env.ORG_NAME || "(사)교사유가족협의회";

  /* 5-1. 관리자에게 — 수령확인이 끝났음 */
  try {
    await notifyAllSuperAdmins({
      category: "system",
      severity: "info",
      title: `급여명세 수령확인 완료 — ${me.name || "직원"} (${period})`,
      message: `${signedName} 님이 ${period} 급여명세서에 전자서명했습니다 (이의 없음 동의).`,
      link: "/cms-tbfa.html#payroll",
    });
  } catch (err) { console.warn("[payroll-my-ack] 관리자 알림 실패:", err); }

  /* 5-2. 직원 본인에게 — 서명이 정상 접수됐다는 확인 (인앱 + 알림톡/문자).
         '내가 서명한 게 접수됐나?' 하는 불안을 없애고, 본인이 안 한 서명이 있으면 즉시 알아챌 수 있게 한다. */
  try {
    await sendWorkspaceNotification({
      memberId: Number(meUid),
      sourceType: "event" as any,
      sourceId: id,
      notifType: "completed",
      channel: "bell",
      title: `${period} 급여명세서 수령 확인이 완료되었습니다`,
      body: "서명본이 보관되었습니다. 언제든 다시 확인·다운로드할 수 있습니다.",
      actionUrl: `/workspace-attendance.html#payroll-slip=${id}`,
      category: "system",
    });
  } catch (err) { console.warn("[payroll-my-ack] 본인 인앱 알림 실패:", err); }

  try {
    await notifyPayrollAcknowledged({
      memberId: Number(meUid),
      memberName: String(me.name || signedName),
      year: Number(slip.pay_year),
      month: Number(slip.pay_month),
      signedAt,
      orgName,
    });
  } catch (err) { console.warn("[payroll-my-ack] 알림톡·문자 발송 실패:", err); }

  return jsonOk(
    { id, ackStatus: "ACKNOWLEDGED", ackAt: signedAt.toISOString(), signedDocumentSha256: signedDocSha },
    "수령 확인이 완료되었습니다. 서명본이 보관되었습니다."
  );
}
