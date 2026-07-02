/**
 * GET /api/test-operator-alimtalk            — 진단(운영자 대상·번호·템플릿 상태 미리보기)
 * GET /api/test-operator-alimtalk?run=1       — 실발송(super_admin): 운영자 전원에게 테스트 알림톡
 *   옵션: &event=donation|siren|support (기본 donation)  &phone=01012345678 (지정 시 그 번호에만)
 *
 * 운영자 카카오 알림톡 승인 후 실발송 확인용 1회용 테스트.
 * - 실행 전 해당 템플릿 상태를 솔라피에서 즉시 갱신(inspecting→approved)
 * - 전화번호 등록된 활성 운영자 전원(또는 지정 번호)에게 발송, 결과 리포트
 * 확인 후 이 파일 삭제 (§6.8 1회용).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { solapiGetTemplate, solapiSendAlimtalk } from "../../lib/solapi-client";

export const config = { path: "/api/test-operator-alimtalk" };
const JH = { "Content-Type": "application/json; charset=utf-8" };

const EVENTS: Record<string, { key: string; vars: Record<string, string> }> = {
  donation: { key: "operator.donation",       vars: { "#{이름}": "테스트", "#{금액}": "1,000" } },
  siren:    { key: "operator.siren_report",    vars: { "#{유형}": "테스트 신고", "#{제목}": "테스트 발송 확인" } },
  support:  { key: "operator.support_signup",  vars: { "#{이름}": "테스트", "#{구분}": "테스트 지원신청" } },
};

function mask(p: any): string {
  const s = String(p || "").replace(/[^0-9]/g, "");
  return s.length >= 4 ? "***-****-" + s.slice(-4) : (s || "(없음)");
}
async function rows(q: any): Promise<any[]> { const r: any = await q; return r?.rows ?? r ?? []; }

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";
    const eventKeyParam = (url.searchParams.get("event") || "donation").toLowerCase();
    const onlyPhone = (url.searchParams.get("phone") || "").replace(/[^0-9]/g, "");
    const ev = EVENTS[eventKeyParam] || EVENTS.donation;

    step = "load_operators";
    const ops = await rows(db.execute(sql`
      SELECT id, name, phone FROM members
       WHERE type = 'admin' AND operator_active = TRUE AND status = 'active' AND phone IS NOT NULL`));
    const opPhones = ops.map((o: any) => ({ name: o.name, phone: mask(o.phone), raw: String(o.phone || "").replace(/[^0-9]/g, "") }))
                        .filter((o: any) => o.raw.length >= 10);

    step = "load_templates";
    const tpls = await rows(db.execute(sql`
      SELECT event_key, name, status, solapi_template_id AS tid, pf_id AS "pfId", content
        FROM kakao_alimtalk_templates
       WHERE event_key IN ('operator.donation','operator.siren_report','operator.support_signup')`));

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        operatorsWithPhone: opPhones.length,
        operators: opPhones.map((o: any) => ({ name: o.name, phone: o.phone })),
        templates: tpls.map((t: any) => ({ eventKey: t.event_key, name: t.name, status: t.status, hasSolapiId: !!t.tid })),
        willSendEvent: ev.key,
        hint: "?run=1 로 실발송(super_admin). &event=donation|siren|support 로 템플릿 선택, &phone=01012345678 로 특정 번호만.",
      }, null, 2), { headers: JH });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;
    if (auth.ctx.member.role !== "super_admin") {
      return new Response(JSON.stringify({ ok: false, error: "super_admin 권한이 필요합니다" }), { status: 403, headers: JH });
    }

    const tpl: any = tpls.find((t: any) => t.event_key === ev.key);
    if (!tpl || !tpl.tid) {
      return new Response(JSON.stringify({ ok: false, error: `템플릿 없음/솔라피 미등록: ${ev.key}` }), { status: 400, headers: JH });
    }

    /* 승인 상태 즉시 갱신 (크론 안 기다리고 솔라피에서 직접 확인) */
    step = "refresh_status";
    let status = String(tpl.status || "");
    try {
      const g = await solapiGetTemplate(String(tpl.tid));
      const s = String(g.data?.status || "").toUpperCase();
      if (g.ok && s === "APPROVED") {
        status = "approved";
        await db.execute(sql`
          UPDATE kakao_alimtalk_templates
             SET status = 'approved', solapi_status = ${s}, approved_at = COALESCE(approved_at, NOW()), updated_at = NOW()
           WHERE event_key = ${ev.key}`);
      } else if (g.ok && s) {
        status = s.toLowerCase();
      }
    } catch (e: any) { /* 갱신 실패해도 기존 status로 진행 */ }

    if (status !== "approved") {
      return new Response(JSON.stringify({ ok: false, error: `템플릿이 아직 승인 상태가 아닙니다 (현재: ${status})`, eventKey: ev.key }), { status: 409, headers: JH });
    }

    /* 렌더 텍스트(대체용) */
    let text = String(tpl.content || "");
    for (const [k, v] of Object.entries(ev.vars)) text = text.split(k).join(v);

    /* 수신 대상 */
    const targets = onlyPhone
      ? [{ name: "(지정)", phone: mask(onlyPhone), raw: onlyPhone }]
      : opPhones;
    if (!targets.length) {
      return new Response(JSON.stringify({ ok: false, error: "발송 대상(전화번호 등록 운영자)이 없습니다" }), { status: 400, headers: JH });
    }

    step = "send";
    const results: any[] = [];
    for (const t of targets) {
      try {
        const send = await solapiSendAlimtalk({
          receiver: t.raw, pfId: String(tpl.pfId || process.env.SOLAPI_KAKAO_PFID || ""),
          templateId: String(tpl.tid), variables: ev.vars, disableSms: true, text,
        });
        results.push({ name: t.name, phone: t.phone, ok: send.ok, msgId: send.msgId || null, error: send.ok ? null : (send.error || send.message || "?") });
      } catch (e: any) {
        results.push({ name: t.name, phone: t.phone, ok: false, error: String(e?.message || e).slice(0, 200) });
      }
    }
    const sent = results.filter(r => r.ok).length;

    return new Response(JSON.stringify({
      ok: true, mode: "executed", eventKey: ev.key, templateStatus: status,
      targeted: targets.length, sent, failed: results.length - sent,
      results,
      hint: sent > 0
        ? "발송 완료. 운영자 카톡 도착 확인 후 이 파일 삭제 요청."
        : "발송 0건 — 실패 사유 확인(번호 형식·발신프로필·승인 상태). 파일 유지하고 원인 알려주세요.",
    }, null, 2), { headers: JH });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "테스트 발송 실패", step,
      detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JH });
  }
}
