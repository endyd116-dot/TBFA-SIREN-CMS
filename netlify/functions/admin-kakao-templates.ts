/**
 * admin-kakao-templates — 카카오 알림톡 템플릿 관리 (운영자 CMS·솔라피 API 자동 CRUD)
 *
 * GET                      → 목록 (templates[])
 * GET ?id=N                → 상세 (template{})
 * GET ?categories=1        → 솔라피 알림톡 카테고리 목록 (등록 폼 드롭다운)
 * POST   {name,content,categoryCode?,emphasizeTitle?,buttons?,eventKey?}
 *                          → 솔라피 등록 + 검수요청 + DB insert (admin+)
 * POST ?id=N&action=refresh → 솔라피에서 검수 상태 즉시 갱신 (admin+)
 * POST ?id=N&action=test    {phone} → 테스트 발송 (승인 템플릿·admin+)
 * PATCH  {id, eventKey?|isActive?} → 시스템 이벤트 매핑·활성 토글 (admin+)
 * DELETE ?id=N             → 솔라피 삭제 + DB 삭제 (admin+)
 *
 * 조회는 운영자 이상, 쓰기는 관리자(admin) 이상.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import { logAdminAction } from "../../lib/audit";
import {
  solapiListChannels, solapiCreateTemplate, solapiRequestInspection,
  solapiGetTemplate, solapiDeleteTemplate, solapiListCategories, solapiSendAlimtalk,
} from "../../lib/solapi-client";

export const config = { path: "/api/admin-kakao-templates" };

function ok(data: object, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...data }), { status, headers: { "Content-Type": "application/json" } });
}
function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

function mapStatus(solapiStatus: string): string {
  const s = String(solapiStatus || "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (s === "INSPECTING") return "inspecting";
  if (s === "PENDING") return "registered";
  return "registered";
}
function extractVariables(content: string): string[] {
  const set = new Set<string>();
  const re = /#\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) set.add(m[1].trim());
  return [...set];
}
function rowToTemplate(r: any) {
  return {
    id: Number(r.id),
    eventKey: r.event_key || null,
    name: String(r.name || ""),
    content: String(r.content || ""),
    variables: r.variables || [],
    categoryCode: r.category_code || null,
    emphasizeTitle: r.emphasize_title || null,
    emphasizeSubtitle: r.emphasize_subtitle || null,
    buttons: r.buttons || [],
    pfId: r.pf_id || null,
    solapiTemplateId: r.solapi_template_id || null,
    status: String(r.status || "draft"),
    solapiStatus: r.solapi_status || null,
    rejectReason: r.reject_reason || null,
    isActive: r.is_active !== false,
    inspectionRequestedAt: r.inspection_requested_at ? new Date(r.inspection_requested_at).toISOString() : null,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  };
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || "0");
  const action = url.searchParams.get("action") || "";

  /* ── GET ── */
  if (req.method === "GET") {
    if (url.searchParams.get("categories")) {
      const res = await solapiListCategories();
      if (!res.ok) return bad(res.error || "카테고리 조회 실패", 502);
      return ok({ categories: res.data || [] });
    }
    if (id) {
      try {
        const r: any = await db.execute(sql`SELECT * FROM kakao_alimtalk_templates WHERE id = ${id} LIMIT 1`);
        const row = (r?.rows ?? r ?? [])[0];
        if (!row) return bad("템플릿을 찾을 수 없습니다", 404);
        return ok({ template: rowToTemplate(row) });
      } catch (e) { return jsonError("select_one", e); }
    }
    try {
      const r: any = await db.execute(sql.raw(`SELECT * FROM kakao_alimtalk_templates ORDER BY event_key NULLS LAST, id ASC`));
      const rows = (r?.rows ?? r ?? []).map(rowToTemplate);
      return ok({ templates: rows });
    } catch (e) { return jsonError("select_list", e); }
  }

  /* ── 쓰기: 관리자 이상 ── */
  if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
    if (!requireRole(member, "admin")) return roleForbidden("admin");
  }

  /* ── POST ── */
  if (req.method === "POST") {
    /* 상태 즉시 갱신 */
    if (id && action === "refresh") {
      try {
        const r: any = await db.execute(sql`SELECT solapi_template_id AS tid, status FROM kakao_alimtalk_templates WHERE id = ${id} LIMIT 1`);
        const row = (r?.rows ?? r ?? [])[0];
        if (!row?.tid) return bad("솔라피 등록 전이거나 템플릿 없음");
        const res = await solapiGetTemplate(String(row.tid));
        if (!res.ok) return bad(res.error || "솔라피 상태 조회 실패", 502);
        const solapiStatus = String(res.data?.status || "");
        const next = mapStatus(solapiStatus);
        const reason = next === "rejected"
          ? String((Array.isArray(res.data?.comments) && res.data.comments.length ? res.data.comments[res.data.comments.length - 1]?.content : "") || "").slice(0, 500)
          : null;
        await db.execute(sql`
          UPDATE kakao_alimtalk_templates
             SET status = ${next}, solapi_status = ${solapiStatus}, reject_reason = ${reason},
                 approved_at = ${next === "approved" ? sql`COALESCE(approved_at, NOW())` : sql`approved_at`}, updated_at = NOW()
           WHERE id = ${id}`);
        return ok({ id, status: next, solapiStatus });
      } catch (e) { return jsonError("refresh", e); }
    }

    /* 테스트 발송 */
    if (id && action === "test") {
      let body: any; try { body = await req.json(); } catch { return bad("본문 파싱 실패"); }
      const phone = String(body?.phone || "").replace(/[^0-9]/g, "");
      if (phone.length < 10) return bad("테스트 수신 휴대폰번호를 입력하세요");
      try {
        const r: any = await db.execute(sql`SELECT * FROM kakao_alimtalk_templates WHERE id = ${id} LIMIT 1`);
        const row = (r?.rows ?? r ?? [])[0];
        if (!row) return bad("템플릿 없음", 404);
        if (row.status !== "approved" || !row.solapi_template_id) return bad("승인된 템플릿만 테스트 발송할 수 있습니다");
        const vars: string[] = Array.isArray(row.variables) ? row.variables : [];
        const variables: Record<string, string> = {};
        let rendered = String(row.content || "");
        for (const v of vars) { variables[`#{${v}}`] = "[테스트]"; rendered = rendered.split(`#{${v}}`).join("[테스트]"); }
        const send = await solapiSendAlimtalk({
          receiver: phone, pfId: String(row.pf_id || ""), templateId: String(row.solapi_template_id),
          variables, disableSms: false, text: rendered,
        });
        await logAdminAction(req, admin.uid, String(member.name || ""), "kakao_template_test", { target: `kakao_alimtalk_templates:${id}`, detail: { phone } });
        if (!send.ok) return bad(send.error || "테스트 발송 실패", 502);
        return ok({ sent: true, msgId: send.msgId });
      } catch (e) { return jsonError("test_send", e); }
    }

    /* 신규 등록 + 검수요청 */
    let body: any; try { body = await req.json(); } catch { return bad("본문 파싱 실패"); }
    const name = String(body?.name || "").trim();
    const content = String(body?.content || "").trim();
    if (!name || name.length > 120) return bad("템플릿 이름(1~120자)을 입력하세요");
    if (content.length < 10) return bad("본문을 입력하세요(10자 이상)");
    const categoryCode = String(body?.categoryCode || "004001");
    const emphasizeTitle = body?.emphasizeTitle ? String(body.emphasizeTitle).slice(0, 50) : "";
    const emphasizeSubtitle = body?.emphasizeSubtitle ? String(body.emphasizeSubtitle).slice(0, 50) : "교사유가족협의회";
    const eventKey = body?.eventKey ? String(body.eventKey) : null;
    const buttons = Array.isArray(body?.buttons) && body.buttons.length
      ? body.buttons
      : [{ buttonType: "WL", buttonName: "교사유가족협의회 홈이동", linkMo: "https://tbfa.co.kr/", linkPc: "https://tbfa.co.kr/" }];
    const variables = extractVariables(content);

    try {
      /* 1) 채널(pfId) 자동 조회 */
      const ch = await solapiListChannels();
      if (!ch.ok) return bad(ch.error || "솔라피 카카오 채널 조회 실패", 502);
      const channel = (ch.data || [])[0];
      const pfId = String(channel?.channelId || channel?.pfId || "");
      if (!pfId) return bad("솔라피에 연동된 카카오 채널이 없습니다. 솔라피 콘솔에서 채널을 먼저 연동하세요.");

      /* 2) 솔라피 템플릿 등록 */
      const created = await solapiCreateTemplate({
        channelId: pfId, name, content, categoryCode,
        emphasizeType: emphasizeTitle ? "TEXT" : "NONE",
        emphasizeTitle, emphasizeSubtitle, buttons,
      });
      if (!created.ok) return bad(created.error || "솔라피 템플릿 등록 실패", 502);
      const tplId = String(created.data?.templateId || created.data?.id || "");
      if (!tplId) return jsonError("create_no_id", new Error(JSON.stringify(created.data).slice(0, 300)));

      /* 3) 검수 요청 */
      let status = "registered";
      let solapiStatus = String(created.data?.status || "PENDING");
      const insp = await solapiRequestInspection(tplId);
      if (insp.ok) { status = "inspecting"; solapiStatus = String(insp.data?.status || "INSPECTING"); }

      /* 4) DB insert */
      const r: any = await db.execute(sql`
        INSERT INTO kakao_alimtalk_templates
          (event_key, name, content, variables, category_code, emphasize_title, emphasize_subtitle,
           buttons, pf_id, solapi_template_id, status, solapi_status, inspection_requested_at, created_by, created_at, updated_at)
        VALUES (${eventKey}, ${name}, ${content}, ${JSON.stringify(variables)}::jsonb, ${categoryCode},
           ${emphasizeTitle || null}, ${emphasizeSubtitle}, ${JSON.stringify(buttons)}::jsonb, ${pfId}, ${tplId},
           ${status}, ${solapiStatus}, ${insp.ok ? sql`NOW()` : null}, ${admin.uid}, NOW(), NOW())
        RETURNING id`);
      const newId = Number((r?.rows ?? r ?? [])[0]?.id || 0);
      await logAdminAction(req, admin.uid, String(member.name || ""), "kakao_template_create", { target: `kakao_alimtalk_templates:${newId}`, detail: { name, tplId } });
      return ok({ id: newId, solapiTemplateId: tplId, status }, 201);
    } catch (e) { return jsonError("create", e); }
  }

  /* ── PATCH (이벤트 매핑·활성 토글) ── */
  if (req.method === "PATCH") {
    let body: any; try { body = await req.json(); } catch { return bad("본문 파싱 실패"); }
    const pid = Number(body?.id || id || 0);
    if (!pid) return bad("id 필수");
    const sets: any[] = [];
    if ("eventKey" in body) sets.push(sql`event_key = ${body.eventKey ? String(body.eventKey) : null}`);
    if (typeof body?.isActive === "boolean") sets.push(sql`is_active = ${body.isActive}`);
    if (!sets.length) return bad("수정할 항목이 없습니다");
    try {
      await db.execute(sql`UPDATE kakao_alimtalk_templates SET ${sql.join(sets, sql`, `)}, updated_at = NOW() WHERE id = ${pid}`);
      await logAdminAction(req, admin.uid, String(member.name || ""), "kakao_template_update", { target: `kakao_alimtalk_templates:${pid}`, detail: body });
      return ok({ id: pid });
    } catch (e) { return jsonError("patch", e); }
  }

  /* ── DELETE (솔라피 삭제 + DB 삭제) ── */
  if (req.method === "DELETE") {
    if (!id) return bad("id 필수 (?id=N)");
    try {
      const r: any = await db.execute(sql`SELECT solapi_template_id AS tid FROM kakao_alimtalk_templates WHERE id = ${id} LIMIT 1`);
      const row = (r?.rows ?? r ?? [])[0];
      if (!row) return bad("템플릿 없음", 404);
      let solapiDeleted = true;
      if (row.tid) {
        const del = await solapiDeleteTemplate(String(row.tid));
        solapiDeleted = del.ok;  // 솔라피 삭제 실패해도 DB는 정리(고아 방지)·결과 보고
      }
      await db.execute(sql`DELETE FROM kakao_alimtalk_templates WHERE id = ${id}`);
      await logAdminAction(req, admin.uid, String(member.name || ""), "kakao_template_delete", { target: `kakao_alimtalk_templates:${id}` });
      return ok({ id, solapiDeleted });
    } catch (e) { return jsonError("delete", e); }
  }

  return bad("허용되지 않은 메서드", 405);
};
