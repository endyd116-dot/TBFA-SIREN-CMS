/**
 * /api/admin-payroll-evidence — 급여명세 증빙 보관함 (슈퍼어드민)
 *
 * GET  ?slipId=N                        서명 증적 상세 (열람·서명·이의 전체 이력)
 * GET  ?slipId=N&download=1[&signed=1]  문서 내려받기 (원본 / 서명본)
 * GET  ?memberUid=N[&year=]             직원별 문서함 — 그 직원의 명세서 전체 + 수령확인 상태
 * GET  ?memberUid=N&zip=1[&year=]       직원 문서 일괄 ZIP
 * GET  ?year=&month=&zip=1              그 달 전체 직원 문서 일괄 ZIP
 * POST ?action=remind                   미서명자 독촉  body { year, month } 또는 { slipIds:[] }
 * POST ?action=reissue                  정정 재발행    body { slipId, reason }
 *                                       — 문서 차수를 올리고 새 문서를 발행한다.
 *                                         이전 서명은 이 문서에 대한 것이 아니므로 수령확인을 다시 받는다.
 *                                         (이전 서명 증적은 지우지 않고 그대로 남는다)
 */
import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { zipSync } from "fflate";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { fetchPayrollDocument, issuePayrollDocument } from "../../lib/payroll-document";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/admin-payroll-evidence" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const ZIP_MAX = 200;   // 안전 상한 (한 번에 묶는 문서 수)

function jsonOk(data: unknown, message?: string) {
  return new Response(jsonKST({ ok: true, message, data }), { status: 200, headers: JSON_HEADER });
}
function jsonErr(error: string, status = 400) {
  return new Response(jsonKST({ ok: false, error }), { status, headers: JSON_HEADER });
}
function jsonStepErr(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "증빙 보관함 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 800),
  }), { status: 500, headers: JSON_HEADER });
}
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

function pdfResponse(bytes: Uint8Array, filename: string) {
  const encoded = encodeURIComponent(filename);
  return new Response(Buffer.from(bytes) as any, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}

/** 여러 명세서 문서를 하나의 ZIP으로 (증빙 일괄 보관) */
async function buildZip(slipIds: number[], zipName: string) {
  const files: Record<string, Uint8Array> = {};
  const skipped: string[] = [];

  for (const id of slipIds.slice(0, ZIP_MAX)) {
    /* 서명본이 있으면 서명본을 우선 담는다 (증빙 가치가 더 크다) */
    let doc = await fetchPayrollDocument(id, { signed: true });
    if (!doc.ok || !doc.bytes) doc = await fetchPayrollDocument(id, { signed: false });
    if (!doc.ok || !doc.bytes) { skipped.push(String(id)); continue; }

    let name = doc.filename || `급여명세서_${id}.pdf`;
    if (files[name]) name = name.replace(/\.pdf$/i, `_${id}.pdf`);   // 이름 충돌 방지
    files[name] = doc.bytes;
  }

  if (Object.keys(files).length === 0) return null;

  const zipped = zipSync(files, { level: 6 });
  const encoded = encodeURIComponent(zipName);
  return new Response(Buffer.from(zipped) as any, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
      "Content-Length": String(zipped.length),
      "Cache-Control": "private, no-store",
      ...(skipped.length ? { "X-Skipped-Slips": skipped.join(",") } : {}),
    },
  });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") return jsonErr("슈퍼어드민 전용", 403);
  const admin = (auth as any).ctx.member;

  const url = new URL(req.url);

  /* ═════════════ POST ═════════════ */
  if (req.method === "POST") {
    const action = url.searchParams.get("action") || "";
    let body: any = {};
    try { body = await req.json(); } catch { /* 본문 없어도 허용 */ }

    /* ── 미서명 독촉 ── */
    if (action === "remind") {
      let targets: any[] = [];
      try {
        if (Array.isArray(body?.slipIds) && body.slipIds.length > 0) {
          /* JS 배열을 그대로 = ANY(...) 에 넘기면 드라이버가 직렬화하지 못하고 터진다.
             (2026-07-11 라이브 장애 원인 — 숫자 배열은 ARRAY[...] 로 펼쳐서 넘긴다) */
          const ids = body.slipIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
          if (ids.length === 0) return jsonErr("slipIds가 비어 있습니다");
          const r: any = await db.execute(sql`
            SELECT id, member_uid, pay_year, pay_month FROM payroll_slips
             WHERE id = ANY(ARRAY[${sql.raw(ids.join(","))}]::int[])
               AND status IN ('SENT','PAID') AND ack_status = 'PENDING'
          `);
          targets = rows(r);
        } else {
          const y = Number(body?.year || 0), m = Number(body?.month || 0);
          if (!y || !m) return jsonErr("year·month 또는 slipIds 필수");
          const r: any = await db.execute(sql`
            SELECT id, member_uid, pay_year, pay_month FROM payroll_slips
             WHERE pay_year = ${y} AND pay_month = ${m}
               AND status IN ('SENT','PAID') AND ack_status = 'PENDING'
          `);
          targets = rows(r);
        }
      } catch (err) { return jsonStepErr("select_remind_targets", err); }

      if (targets.length === 0) {
        return jsonOk({ reminded: 0 }, "수령 확인이 필요한 직원이 없습니다 (모두 서명 완료)");
      }

      let sent = 0;
      for (const t of targets) {
        const memberId = Number(t.member_uid);
        if (!Number.isFinite(memberId)) continue;
        try {
          await sendWorkspaceNotification({
            memberId,
            sourceType: "event" as any,
            sourceId: t.id,
            notifType: "assigned",
            channel: "bell",
            title: `[안내] ${t.pay_year}년 ${String(t.pay_month).padStart(2, "0")}월 급여명세서 수령 확인이 필요합니다`,
            body: "명세서를 열어 내용을 확인하고 전자서명해 주세요.",
            actionUrl: `/workspace-attendance.html#payroll-slip=${t.id}`,
            category: "system",
          });
          await db.execute(sql`
            UPDATE payroll_slips
               SET reminder_sent_at = NOW(), reminder_count = reminder_count + 1, updated_at = NOW()
             WHERE id = ${Number(t.id)}
          `);
          sent++;
        } catch (err) {
          console.warn(`[admin-payroll-evidence] 독촉 실패 (slip=${t.id}):`, err);
        }
      }
      return jsonOk({ reminded: sent, total: targets.length },
        `미서명 ${targets.length}명 중 ${sent}명에게 수령 확인 요청을 보냈습니다`);
    }

    /* ── 정정 재발행 ── */
    if (action === "reissue") {
      const slipId = Number(body?.slipId || 0);
      const reason = String(body?.reason || "").trim();
      if (!slipId) return jsonErr("slipId 필수");
      if (!reason) return jsonErr("정정 사유는 필수입니다 (증빙 추적용)");

      let before: any;
      try {
        const r: any = await db.execute(sql`
          SELECT id, member_uid, pay_year, pay_month, status, document_version, ack_status
            FROM payroll_slips WHERE id = ${slipId} LIMIT 1
        `);
        before = rows(r)[0];
        if (!before) return jsonErr("명세서를 찾을 수 없습니다", 404);
        if (before.status !== "SENT" && before.status !== "PAID") {
          return jsonErr("교부된 명세서만 정정 재발행할 수 있습니다 (아직 발송 전이면 그냥 수정 후 발송하세요)");
        }
      } catch (err) { return jsonStepErr("select_slip", err); }

      const issued = await issuePayrollDocument(slipId, { bumpVersion: true, issuedAt: new Date() });
      if (!issued.ok) return jsonErr(issued.error || "정정 재발행 실패", 500);

      try {
        await db.execute(sql`
          INSERT INTO payroll_audit (slip_id, changed_by, field, old_value, new_value, reason)
          VALUES (${slipId}, ${String(admin.id)}, 'document_version',
                  ${String(before.document_version ?? 1)}, ${String(issued.version)}, ${"[정정 재발행] " + reason})
        `);
      } catch (err) { console.warn("[admin-payroll-evidence] 정정 이력 적재 실패:", err); }

      try {
        const memberId = Number(before.member_uid);
        if (Number.isFinite(memberId)) {
          await sendWorkspaceNotification({
            memberId,
            sourceType: "event" as any,
            sourceId: slipId,
            notifType: "status_changed",
            channel: "bell",
            title: `${before.pay_year}년 ${String(before.pay_month).padStart(2, "0")}월 급여명세서가 정정되었습니다`,
            body: `${reason.slice(0, 100)} — 정정된 명세서를 확인하고 다시 수령 확인해 주세요.`,
            actionUrl: `/workspace-attendance.html#payroll-slip=${slipId}`,
            category: "system",
          });
        }
      } catch (err) { console.warn("[admin-payroll-evidence] 정정 알림 실패:", err); }

      return jsonOk(
        { slipId, documentVersion: issued.version, ackStatus: "PENDING" },
        `정정 ${issued.version}차 문서를 발행했습니다. 직원에게 재서명 요청이 전달되었습니다.`
      );
    }

    return jsonErr("action 값 부적합 (remind|reissue)");
  }

  if (req.method !== "GET") return jsonErr("지원하지 않는 메서드입니다", 405);

  const slipId = Number(url.searchParams.get("slipId") || 0);
  const memberUid = url.searchParams.get("memberUid");
  const year = Number(url.searchParams.get("year") || 0);
  const month = Number(url.searchParams.get("month") || 0);
  const wantZip = url.searchParams.get("zip") === "1";
  const wantDownload = url.searchParams.get("download") === "1";
  const wantSigned = url.searchParams.get("signed") === "1";

  /* ═════════════ 문서 내려받기 (1건) ═════════════ */
  if (slipId && wantDownload) {
    try {
      const doc = await fetchPayrollDocument(slipId, { signed: wantSigned });
      if (!doc.ok || !doc.bytes) return jsonErr(doc.error || "문서를 가져오지 못했습니다", 404);
      return pdfResponse(doc.bytes, doc.filename || "급여명세서.pdf");
    } catch (err) { return jsonStepErr("download", err); }
  }

  /* ═════════════ 서명 증적 상세 ═════════════ */
  if (slipId) {
    let slip: any;
    try {
      const r: any = await db.execute(sql`
        SELECT s.id, s.member_uid, s.pay_year, s.pay_month, s.status,
               s.document_version, s.document_sha256, s.issued_at, s.first_viewed_at,
               s.ack_status, s.ack_at, s.reminder_count, s.reminder_sent_at,
               (s.document_r2_key IS NOT NULL)        AS has_document,
               (s.signed_document_r2_key IS NOT NULL) AS has_signed_document,
               m.name AS member_name, m.email AS member_email
          FROM payroll_slips s
          LEFT JOIN members m ON m.id = NULLIF(s.member_uid,'')::int
         WHERE s.id = ${slipId} LIMIT 1
      `);
      slip = rows(r)[0];
      if (!slip) return jsonErr("명세서를 찾을 수 없습니다", 404);
    } catch (err) { return jsonStepErr("select_slip", err); }

    let history: any[] = [];
    try {
      const r: any = await db.execute(sql`
        SELECT id, action, document_version, signature_type, signed_name, consent_items,
               objection_reason, document_sha256, ip, user_agent, created_at
          FROM payroll_acknowledgments
         WHERE slip_id = ${slipId}
         ORDER BY created_at DESC
         LIMIT 100
      `);
      history = rows(r).map((h: any) => ({
        id: h.id, action: h.action, documentVersion: h.document_version,
        signatureType: h.signature_type, signedName: h.signed_name,
        consentItems: h.consent_items ?? [], objectionReason: h.objection_reason,
        documentSha256: h.document_sha256, ip: h.ip, userAgent: h.user_agent,
        createdAt: isoUTC(h.created_at),
      }));
    } catch (err) { console.warn("[admin-payroll-evidence] 증적 조회 실패:", err); }

    let objections: any[] = [];
    try {
      const r: any = await db.execute(sql`
        SELECT id, reason, status, resolution_note, resolved_by, resolved_at, created_at
          FROM payroll_objections WHERE slip_id = ${slipId} ORDER BY created_at DESC LIMIT 20
      `);
      objections = rows(r).map((o: any) => ({
        id: o.id, reason: o.reason, status: o.status,
        resolutionNote: o.resolution_note, resolvedAt: isoUTC(o.resolved_at), createdAt: isoUTC(o.created_at),
      }));
    } catch (err) { console.warn("[admin-payroll-evidence] 이의 조회 실패:", err); }

    return jsonOk({
      slip: {
        id: slip.id, memberUid: slip.member_uid,
        memberName: slip.member_name, memberEmail: slip.member_email,
        payYear: slip.pay_year, payMonth: slip.pay_month, status: slip.status,
        documentVersion: Number(slip.document_version || 1),
        documentSha256: slip.document_sha256,
        issuedAt: isoUTC(slip.issued_at), firstViewedAt: isoUTC(slip.first_viewed_at),
        ackStatus: slip.ack_status, ackAt: isoUTC(slip.ack_at),
        reminderCount: Number(slip.reminder_count || 0), reminderSentAt: isoUTC(slip.reminder_sent_at),
        hasDocument: !!slip.has_document, hasSignedDocument: !!slip.has_signed_document,
      },
      history,
      objections,
    });
  }

  /* ═════════════ 직원별 문서함 ═════════════ */
  if (memberUid) {
    const uid = String(memberUid);
    let list: any[] = [];
    try {
      const yearCond = year ? sql` AND pay_year = ${year}` : sql``;
      const r: any = await db.execute(sql`
        SELECT id, pay_year, pay_month, status, gross_pay, total_deduction, net_pay,
               document_version, issued_at, first_viewed_at, ack_status, ack_at,
               (document_r2_key IS NOT NULL)        AS has_document,
               (signed_document_r2_key IS NOT NULL) AS has_signed_document
          FROM payroll_slips
         WHERE member_uid = ${uid} AND status IN ('SENT','PAID') ${yearCond}
         ORDER BY pay_year DESC, pay_month DESC
         LIMIT 200
      `);
      list = rows(r);
    } catch (err) { return jsonStepErr("select_member_docs", err); }

    if (wantZip) {
      if (list.length === 0) return jsonErr("내려받을 문서가 없습니다", 404);
      let name = "직원";
      try {
        const r: any = await db.execute(sql`SELECT name FROM members WHERE id = ${Number(uid)} LIMIT 1`);
        name = rows(r)[0]?.name ?? name;
      } catch { /* 이름 없으면 기본값 */ }
      const zipName = `급여명세_증빙_${name}${year ? `_${year}년` : ""}.zip`;
      try {
        const res = await buildZip(list.map((s: any) => Number(s.id)), zipName);
        if (!res) return jsonErr("문서를 하나도 읽지 못했습니다", 500);
        return res;
      } catch (err) { return jsonStepErr("zip_member", err); }
    }

    let member: any = null;
    try {
      const r: any = await db.execute(sql`
        SELECT id, name, email, role, milestone_role FROM members WHERE id = ${Number(uid)} LIMIT 1
      `);
      const m = rows(r)[0];
      if (m) member = { id: m.id, name: m.name, email: m.email, role: m.milestone_role || m.role };
    } catch { /* 보조 조회 */ }

    return jsonOk({
      member,
      rows: list.map((s: any) => ({
        id: s.id, payYear: s.pay_year, payMonth: s.pay_month, status: s.status,
        grossPay: s.gross_pay, totalDeduction: s.total_deduction, netPay: s.net_pay,
        documentVersion: Number(s.document_version || 1),
        issuedAt: isoUTC(s.issued_at), firstViewedAt: isoUTC(s.first_viewed_at),
        ackStatus: s.ack_status, ackAt: isoUTC(s.ack_at),
        hasDocument: !!s.has_document, hasSignedDocument: !!s.has_signed_document,
      })),
      total: list.length,
    });
  }

  /* ═════════════ 월별 전체 ZIP ═════════════ */
  if (year && month && wantZip) {
    let ids: number[] = [];
    try {
      const r: any = await db.execute(sql`
        SELECT id FROM payroll_slips
         WHERE pay_year = ${year} AND pay_month = ${month} AND status IN ('SENT','PAID')
         ORDER BY id
      `);
      ids = rows(r).map((s: any) => Number(s.id));
    } catch (err) { return jsonStepErr("select_month_docs", err); }

    if (ids.length === 0) return jsonErr("그 달에 교부된 명세서가 없습니다", 404);
    try {
      const res = await buildZip(ids, `급여명세_증빙_${year}년${String(month).padStart(2, "0")}월.zip`);
      if (!res) return jsonErr("문서를 하나도 읽지 못했습니다", 500);
      return res;
    } catch (err) { return jsonStepErr("zip_month", err); }
  }

  return jsonErr("slipId 또는 memberUid, 또는 year·month·zip=1 중 하나가 필요합니다");
}
