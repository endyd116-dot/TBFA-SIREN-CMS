/**
 * 관리자 근로계약 API (슈퍼어드민 전용)
 *   GET  /api/admin-contracts            — 목록 (?status= ?memberId=)
 *   GET  /api/admin-contracts?id=N       — 상세 (증적·첨부 포함, 주민번호는 마스킹만)
 *   POST /api/admin-contracts { action } — create | send | reissue | void
 *
 * 워크플로우: create(draft) → send(회사도장 자동날인·직원전달) → [직원 서명/반려] → completed/rejected
 *            completed → reissue(정정·차수↑) / void(무효·소프트)
 * 설계서: docs/active/2026-07-27-employment-contract-design.md
 */
import { jsonKST } from "../../lib/kst";
import { todayKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { fillTemplate, loadContractRow } from "../../lib/contract-document";
import { encryptPII, maskResidentNo, piiKeyAvailable } from "../../lib/crypto-pii";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/admin-contracts" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const ok = (data: any, message?: string) => new Response(jsonKST({ ok: true, message, data }), { status: 200, headers: H });
function fail(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "근로계약 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 800),
  }), { status, headers: H });
}
function bad(msg: string, status = 400) {
  return new Response(jsonKST({ ok: false, error: msg }), { status, headers: H });
}

/** 'YYYY-MM-DD' → 'YYYY년 MM월 DD일' (빈 값이면 오늘) */
function koreanDate(ymd?: string): string {
  const s = ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? ymd.slice(0, 10) : todayKST();
  const [y, m, d] = s.split("-");
  return `${y}년 ${m}월 ${d}일`;
}

const rows = (r: any) => (r?.rows ?? r ?? []);

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    const me = (auth as any).ctx.member;
    if (me.role !== "super_admin") return bad("근로계약 관리는 이사장(슈퍼어드민)만 가능합니다", 403);

    const url = new URL(req.url);

    /* ───────── GET ───────── */
    if (req.method === "GET") {
      /* 계약 생성 모달용 — 직원(운영자) 목록 */
      if (url.searchParams.get("members") === "1") {
        step = "members";
        const m = await db.execute(sql`
          SELECT id, name, position, email FROM members
           WHERE (type = 'admin' OR operator_active = TRUE) AND status = 'active'
           ORDER BY name ASC`);
        return ok({ members: rows(m) });
      }

      const id = url.searchParams.get("id");

      if (id) {
        step = "get_detail";
        const row = await loadContractRow(Number(id));
        if (!row) return bad("계약을 찾을 수 없습니다", 404);
        let fields: any = {};
        try { fields = typeof row.fields === "string" ? JSON.parse(row.fields) : (row.fields || {}); } catch { fields = {}; }

        const ev = await db.execute(sql`
          SELECT actor, action, signature_type, signed_name, ip, user_agent, meta, created_at
            FROM contract_signature_events WHERE contract_id = ${Number(id)} ORDER BY created_at ASC`);
        const att = await db.execute(sql`
          SELECT id, kind, label, file_name, mime_type, size_bytes, uploaded_role, created_at
            FROM contract_attachments WHERE contract_id = ${Number(id)} AND deleted_at IS NULL ORDER BY created_at DESC`);

        return ok({
          id: row.id, status: row.status, title: row.title,
          entityId: row.entity_id, entityName: row.ent_name, entityRepresentative: row.ent_rep,
          entityBizNo: row.ent_bizno, entityAddress: row.ent_address,
          memberId: row.member_id, memberName: row.m_name, memberEmail: row.m_email,
          fields,
          residentNoMask: row.resident_no_mask || null,   // ⚠️ 평문·암호문 절대 노출 금지
          hasResidentNo: !!row.resident_no_enc,
          bodySnapshot: row.body_snapshot,
          documentVersion: row.document_version,
          hasDocument: !!row.document_r2_key,
          companySignedAt: row.company_signed_at, sentAt: row.sent_at,
          employeeSignedName: row.employee_signed_name, employeeSignedAt: row.employee_signed_at,
          employeeSigType: row.employee_sig_type,
          rejectedReason: row.rejected_reason, rejectedAt: row.rejected_at,
          voidedReason: row.voided_reason, voidedAt: row.voided_at,
          createdAt: row.created_at,
          events: rows(ev), attachments: rows(att),
        });
      }

      step = "list";
      const status = url.searchParams.get("status");
      const memberId = url.searchParams.get("memberId");
      const conds: any[] = [];
      if (status) conds.push(sql`c.status = ${status}`);
      if (memberId) conds.push(sql`c.member_id = ${Number(memberId)}`);
      const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
      const list = await db.execute(sql`
        SELECT c.id, c.status, c.title, c.member_id, c.document_version, c.created_at, c.sent_at,
               c.employee_signed_at, c.entity_id,
               e.name AS ent_name, m.name AS m_name
          FROM employment_contracts c
          JOIN contract_business_entities e ON e.id = c.entity_id
          LEFT JOIN members m ON m.id = c.member_id
          ${where}
         ORDER BY c.created_at DESC
         LIMIT 300`);
      return ok({ items: rows(list) });
    }

    /* ───────── POST ───────── */
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = body.action;

      if (action === "create") {
        step = "create";
        const { entityId, templateId, memberId, fields = {}, residentNo } = body;
        if (!entityId || !memberId) return bad("사업자와 직원을 선택하세요");

        const entR = await db.execute(sql`SELECT * FROM contract_business_entities WHERE id = ${Number(entityId)} LIMIT 1`);
        const ent = rows(entR)[0];
        if (!ent) return bad("사업자를 찾을 수 없습니다", 404);

        const tplR = templateId
          ? await db.execute(sql`SELECT * FROM contract_templates WHERE id = ${Number(templateId)} LIMIT 1`)
          : await db.execute(sql`SELECT * FROM contract_templates WHERE entity_id = ${Number(entityId)} AND is_active = TRUE ORDER BY version DESC LIMIT 1`);
        const tpl = rows(tplR)[0];
        if (!tpl) return bad("계약서 양식이 없습니다. 먼저 양식을 등록하세요");

        const memR = await db.execute(sql`SELECT id, name, email FROM members WHERE id = ${Number(memberId)} LIMIT 1`);
        const mem = rows(memR)[0];
        if (!mem) return bad("직원을 찾을 수 없습니다", 404);

        /* 주민번호 암호화 (넣은 경우만) */
        let enc: string | null = null, mask: string | null = null;
        if (residentNo && String(residentNo).replace(/\D/g, "").length >= 7) {
          if (!piiKeyAvailable()) return bad("주민번호 암호화 키(CONTRACT_PII_KEY)가 설정되지 않았습니다. 키를 설정하거나 주민번호 없이 생성하세요", 503);
          enc = encryptPII(String(residentNo));
          mask = maskResidentNo(String(residentNo));
        }

        /* {{치환}} — 주민번호는 본문엔 마스킹만(평문은 최종 PDF 서명란에서 복호 렌더) */
        /* 근로자 인적사항({{생년월일}}{{주소}}{{연락처}}{{주민번호}})은 vars에 넣지 않아 원형으로 남긴다.
           → 직원이 서명할 때 본인이 채운다(그 전까지 PDF엔 밑줄로 표시). 성명만 직원명으로 자동 치환. */
        const vars: Record<string, string> = {
          "회사상호": ent.name || "", "회사대표자": ent.representative || "", "회사사업자번호": ent.biz_no || "", "회사주소": ent.address || "",
          "성명": mem.name || "",
          "계약시작일": koreanDate(fields["계약시작일"]), "연봉": fields["연봉"] || "", "월지급액": fields["월지급액"] || "", "지급일": fields["지급일"] || "",
          "근무장소": fields["근무장소"] || ent.address || "", "담당업무": fields["담당업무"] || "",
          "근무시작시각": fields["근무시작시각"] || "09:00", "근무종료시각": fields["근무종료시각"] || "18:00", "수습개월": fields["수습개월"] || "3",
          "수습임금률": fields["수습임금률"] || "90",
          "계약체결일": koreanDate(),
        };
        const bodySnapshot = fillTemplate(tpl.body, vars);

        const ins = await db.execute(sql`
          INSERT INTO employment_contracts
            (entity_id, template_id, member_id, status, title, fields, body_snapshot, resident_no_enc, resident_no_mask, created_by)
          VALUES (${Number(entityId)}, ${tpl.id}, ${Number(memberId)}, 'draft', ${tpl.title || "근로계약서"},
                  ${JSON.stringify(fields)}::jsonb, ${bodySnapshot}, ${enc}, ${mask}, ${me.id})
          RETURNING id`);
        const newId = rows(ins)[0]?.id;
        await db.execute(sql`INSERT INTO contract_signature_events (contract_id, actor, action) VALUES (${newId}, 'system', 'CREATED')`);
        return ok({ id: newId }, "계약서 초안이 생성되었습니다");
      }

      if (action === "send") {
        step = "send";
        const id = Number(body.id);
        const row = await loadContractRow(id);
        if (!row) return bad("계약을 찾을 수 없습니다", 404);
        if (row.status !== "draft") return bad("초안 상태의 계약만 발송할 수 있습니다");

        /* 회사 도장 스냅샷(발송 시점 사업자 도장 고정) + 회사 날인 확정 */
        await db.execute(sql`
          UPDATE employment_contracts
             SET status = 'sent',
                 company_seal_r2_key = ${row.ent_seal_key || null},
                 company_signed_at = NOW(), company_signed_by = ${me.id},
                 sent_at = NOW(), updated_at = NOW()
           WHERE id = ${id}`);
        await db.execute(sql`INSERT INTO contract_signature_events (contract_id, actor, action) VALUES (${id}, 'company', 'SENT')`);
        try {
          await sendWorkspaceNotification({
            memberId: Number(row.member_id), sourceType: "contract", sourceId: id,
            notifType: "assigned", channel: "bell", category: "system",
            title: "근로계약서가 도착했습니다",
            body: `${row.ent_name || "회사"} 근로계약서를 확인하고 서명해 주세요.`,
            actionUrl: "/workspace-contract.html",
          });
        } catch (e) { console.warn("[contract] 발송 알림 실패", e); }
        return ok({ id }, "직원에게 계약서를 전달했습니다. (직원이 워크스페이스 '내 근로계약'에서 서명)");
      }

      if (action === "reissue") {
        step = "reissue";
        const id = Number(body.id);
        const row = await loadContractRow(id);
        if (!row) return bad("계약을 찾을 수 없습니다", 404);
        if (row.status !== "completed") return bad("완료된 계약만 정정 재발행할 수 있습니다");

        /* 완료본 폐기 + 직원 서명 초기화 + 차수↑ → 재서명 대기(sent). 이전 서명 증적은 events에 보존. */
        await db.execute(sql`
          UPDATE employment_contracts
             SET status = 'sent',
                 document_r2_key = NULL, document_sha256 = NULL,
                 document_version = document_version + 1,
                 employee_sig_r2_key = NULL, employee_sig_type = NULL, employee_signed_name = NULL,
                 employee_signed_at = NULL, employee_sign_ip = NULL, employee_sign_device = NULL,
                 company_signed_at = NOW(), company_signed_by = ${me.id}, sent_at = NOW(), updated_at = NOW()
           WHERE id = ${id}`);
        await db.execute(sql`INSERT INTO contract_signature_events (contract_id, actor, action) VALUES (${id}, 'company', 'REISSUED')`);
        return ok({ id }, "정정 재발행했습니다. 직원의 재서명을 받습니다");
      }

      if (action === "update") {
        step = "update";
        const id = Number(body.id);
        const row = await loadContractRow(id);
        if (!row) return bad("계약을 찾을 수 없습니다", 404);
        if (row.status !== "draft" && row.status !== "rejected") return bad("초안·반려 상태의 계약만 수정할 수 있습니다");
        const entityId = Number(body.entityId || row.entity_id);
        const memberId = Number(body.memberId || row.member_id);
        const fields = body.fields || {};
        const entR = await db.execute(sql`SELECT * FROM contract_business_entities WHERE id = ${entityId} LIMIT 1`);
        const ent = rows(entR)[0];
        if (!ent) return bad("사업자를 찾을 수 없습니다", 404);
        const tplR = await db.execute(sql`SELECT * FROM contract_templates WHERE entity_id = ${entityId} AND is_active = TRUE ORDER BY version DESC LIMIT 1`);
        const tpl = rows(tplR)[0];
        if (!tpl) return bad("계약서 양식이 없습니다");
        const memR = await db.execute(sql`SELECT id, name FROM members WHERE id = ${memberId} LIMIT 1`);
        const mem = rows(memR)[0];
        if (!mem) return bad("직원을 찾을 수 없습니다", 404);
        const vars2: Record<string, string> = {
          "회사상호": ent.name || "", "회사대표자": ent.representative || "", "회사사업자번호": ent.biz_no || "", "회사주소": ent.address || "",
          "성명": mem.name || "",
          "계약시작일": koreanDate(fields["계약시작일"]), "연봉": fields["연봉"] || "", "월지급액": fields["월지급액"] || "", "지급일": fields["지급일"] || "",
          "근무장소": fields["근무장소"] || ent.address || "", "담당업무": fields["담당업무"] || "",
          "근무시작시각": fields["근무시작시각"] || "09:00", "근무종료시각": fields["근무종료시각"] || "18:00", "수습개월": fields["수습개월"] || "3",
          "수습임금률": fields["수습임금률"] || "90", "계약체결일": koreanDate(),
        };
        const bodySnapshot2 = fillTemplate(tpl.body, vars2);
        await db.execute(sql`
          UPDATE employment_contracts
             SET entity_id = ${entityId}, template_id = ${tpl.id}, member_id = ${memberId},
                 fields = ${JSON.stringify(fields)}::jsonb, body_snapshot = ${bodySnapshot2}, title = ${tpl.title || "근로계약서"},
                 status = 'draft', rejected_reason = NULL, rejected_at = NULL, updated_at = NOW()
           WHERE id = ${id}`);
        return ok({ id }, "초안을 수정했습니다");
      }

      if (action === "delete") {
        step = "delete";
        const id = Number(body.id);
        const row = await loadContractRow(id);
        if (!row) return bad("계약을 찾을 수 없습니다", 404);
        if (row.status !== "draft" && row.status !== "rejected") return bad("초안·반려 상태만 삭제할 수 있습니다. 발송된 계약은 무효 처리하세요");
        await db.execute(sql`DELETE FROM contract_signature_events WHERE contract_id = ${id}`);
        await db.execute(sql`DELETE FROM contract_attachments WHERE contract_id = ${id}`);
        await db.execute(sql`DELETE FROM employment_contracts WHERE id = ${id}`);
        return ok({ id }, "계약을 삭제했습니다");
      }

      if (action === "void") {
        step = "void";
        const id = Number(body.id);
        const reason = String(body.reason || "").trim();
        if (reason.length < 5) return bad("무효 사유를 5자 이상 입력하세요");
        const row = await loadContractRow(id);
        if (!row) return bad("계약을 찾을 수 없습니다", 404);
        if (row.status === "voided") return bad("이미 무효 처리된 계약입니다");

        await db.execute(sql`
          UPDATE employment_contracts
             SET status = 'voided', voided_at = NOW(), voided_reason = ${reason}, voided_by = ${me.id}, updated_at = NOW()
           WHERE id = ${id}`);
        await db.execute(sql`
          INSERT INTO contract_signature_events (contract_id, actor, action, meta)
          VALUES (${id}, 'company', 'VOIDED', ${JSON.stringify({ reason })}::jsonb)`);
        return ok({ id }, "계약을 무효 처리했습니다");
      }

      return bad("알 수 없는 action");
    }

    return bad("허용되지 않은 메서드", 405);
  } catch (err) {
    return fail(step, err);
  }
}
