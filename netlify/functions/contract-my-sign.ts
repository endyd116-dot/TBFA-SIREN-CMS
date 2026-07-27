/**
 * 직원 근로계약 서명/반려 API (본인 것만)
 *   POST /api/contract-my-sign { id, action:'sign'|'reject', ... }
 *     sign:   signatureType('draw'|'type'|'seal'), signaturePng(dataURL·draw/seal), signedName
 *     reject: reason
 *
 * sign 시: 서명 이미지 정화→R2 저장→status=completed→완료본 PDF 박제(양측 도장·서명).
 * 인증: requireOperator(본인). status=sent 인 본인 계약만.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { uploadToR2 } from "../../lib/r2-server";
import { loadContractRow, normalizeSignaturePng, issueContractDocument, fillTemplate } from "../../lib/contract-document";
import { encryptPII, maskResidentNo, piiKeyAvailable } from "../../lib/crypto-pii";
import { notifyAllSuperAdmins } from "../../lib/notify";

export const config = { path: "/api/contract-my-sign" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const ok = (data: any, message?: string) => new Response(jsonKST({ ok: true, message, data }), { status: 200, headers: H });
const bad = (msg: string, status = 400) => new Response(jsonKST({ ok: false, error: msg }), { status, headers: H });

const MAX_SIGNATURE_BYTES = 2_000_000;
function parsePngDataUrl(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || "").trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1].replace(/\s/g, ""), "base64");
    if (buf.length === 0 || buf.length > MAX_SIGNATURE_BYTES) return null;
    if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) return null;
    return new Uint8Array(buf);
  } catch { return null; }
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  if (req.method !== "POST") return bad("POST 전용", 405);
  try {
    step = "auth";
    const auth = await requireOperator(req);
    if (operatorGuardFailed(auth)) return auth.res;
    const me = auth.ctx.member;

    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    const action = body.action;
    if (!id) return bad("계약 id가 없습니다");

    step = "load";
    const row = await loadContractRow(id);
    if (!row) return bad("계약을 찾을 수 없습니다", 404);
    if (Number(row.member_id) !== Number(me.id)) return bad("본인 계약만 처리할 수 있습니다", 403);
    if (row.status !== "sent") return bad("서명할 수 있는 상태가 아닙니다 (이미 처리되었거나 무효)", 409);

    const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for") ?? null;
    const ua = (req.headers.get("user-agent") || "").slice(0, 300);

    /* ── 반려 ── */
    if (action === "reject") {
      step = "reject";
      const reason = String(body.reason || "").trim();
      if (reason.length < 2) return bad("반려 사유를 입력하세요");
      await db.execute(sql`
        UPDATE employment_contracts
           SET status = 'rejected', rejected_reason = ${reason}, rejected_at = NOW(), updated_at = NOW()
         WHERE id = ${id}`);
      await db.execute(sql`
        INSERT INTO contract_signature_events (contract_id, actor, action, ip, user_agent, meta)
        VALUES (${id}, 'employee', 'REJECTED', ${ip}, ${ua}, ${JSON.stringify({ reason })}::jsonb)`);
      try {
        await notifyAllSuperAdmins({
          category: "system", title: "근로계약 반려",
          message: `${me.name || "직원"}님이 근로계약을 반려했습니다: ${reason.slice(0, 60)}`,
          link: "/cms-tbfa.html#contract", refTable: "employment_contracts", refId: id,
        });
      } catch (e) { console.warn("[contract] 반려 알림 실패", e); }
      return ok({ id }, "계약을 반려했습니다. 담당자에게 전달됩니다");
    }

    /* ── 서명 ── */
    if (action === "sign") {
      step = "sign";
      const sigType = String(body.signatureType || "draw");
      const signedName = String(body.signedName || me.name || "").trim();
      if (!signedName) return bad("서명자 성명을 입력하세요");

      /* 직원이 서명 시 본인 주민번호를 입력하면 암호화 저장(선택). 키 미설정이면 조용히 건너뜀. */
      const rnRaw = String(body.residentNo || "").replace(/\s/g, "");
      let rnEnc: string | null = null, rnMask: string | null = null;
      if (rnRaw && rnRaw.replace(/\D/g, "").length >= 7) {
        if (!piiKeyAvailable()) return bad("주민번호 암호화 키가 아직 설정되지 않았습니다. 담당자에게 알려주시거나, 주민번호는 비우고 서명해 주세요", 503);
        rnEnc = encryptPII(rnRaw);
        rnMask = maskResidentNo(rnRaw);
      }

      /* 직원이 입력한 인적사항을 fields에 병합하고 계약서 본문({{생년월일}} 등)을 채운다. */
      let curFields: Record<string, any> = {};
      try { curFields = typeof row.fields === "string" ? JSON.parse(row.fields) : (row.fields || {}); } catch { curFields = {}; }
      const merged = { ...curFields };
      if (body.birthDate) merged["생년월일"] = String(body.birthDate).trim();
      if (body.address) merged["주소"] = String(body.address).trim();
      if (body.phone) merged["연락처"] = String(body.phone).trim();
      const newBodySnapshot = fillTemplate(row.body_snapshot || "", {
        "생년월일": merged["생년월일"] || "", "주소": merged["주소"] || "", "연락처": merged["연락처"] || "",
      });

      let sigKey: string | null = null;
      if (sigType === "draw" || sigType === "seal") {
        const png = parsePngDataUrl(body.signaturePng);
        if (!png) return bad("서명 이미지를 읽지 못했습니다. 다시 서명해 주세요");
        const norm = await normalizeSignaturePng(png);
        if (norm.ok !== true) return bad(norm.error);
        const up = await uploadToR2({
          buffer: norm.bytes,
          originalName: `contract-sign-${id}.png`,
          mimeType: "image/png",
          context: "contract-sign",
          isPublic: false,
          expiresInDays: null,
        });
        if (!up.ok || !up.blobKey) return bad("서명 저장에 실패했습니다");
        sigKey = up.blobKey;
      } else if (sigType !== "type") {
        return bad("알 수 없는 서명 방식");
      }

      step = "sign_update";
      await db.execute(sql`
        UPDATE employment_contracts
           SET status = 'completed',
               employee_sig_r2_key = ${sigKey},
               employee_sig_type = ${sigType},
               employee_signed_name = ${signedName},
               employee_signed_at = NOW(),
               employee_sign_ip = ${ip},
               employee_sign_device = ${ua},
               resident_no_enc = COALESCE(${rnEnc}, resident_no_enc),
               resident_no_mask = COALESCE(${rnMask}, resident_no_mask),
               fields = ${JSON.stringify(merged)}::jsonb,
               body_snapshot = ${newBodySnapshot},
               updated_at = NOW()
         WHERE id = ${id}`);

      step = "issue_document";
      const iss = await issueContractDocument(id);  // 완료본 박제(양측 도장·서명)
      await db.execute(sql`
        INSERT INTO contract_signature_events (contract_id, actor, action, signature_type, signed_name, document_sha256, ip, user_agent)
        VALUES (${id}, 'employee', 'SIGNED', ${sigType}, ${signedName}, ${iss.ok ? iss.sha256 : null}, ${ip}, ${ua})`);

      try {
        await notifyAllSuperAdmins({
          category: "system", title: "근로계약 서명 완료",
          message: `${signedName}님이 근로계약서에 서명했습니다. 완료된 계약서를 확인할 수 있습니다.`,
          link: "/cms-tbfa.html#contract", refTable: "employment_contracts", refId: id,
        });
      } catch (e) { console.warn("[contract] 서명 알림 실패", e); }

      if (!iss.ok) {
        /* 서명은 기록됐으나 문서 생성 실패 — 상태는 completed 유지, 다운로드 시 즉석 생성으로 복구됨 */
        return ok({ id, documentReady: false }, "서명이 완료되었습니다. (문서 생성은 잠시 후 다시 시도됩니다)");
      }
      return ok({ id, documentReady: true }, "서명이 완료되었습니다. 계약서를 내려받을 수 있습니다");
    }

    return bad("알 수 없는 action");
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "서명 처리 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 800),
    }), { status: 500, headers: H });
  }
}
