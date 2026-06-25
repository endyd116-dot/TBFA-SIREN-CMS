/**
 * /api/admin-nurture — 후원자 너처링 어드민 (통합 핸들러)
 *
 * GET                : 전체 상태(여정·단계·영구규칙·템플릿목록·KPI)
 * POST {action}      : toggleJourney | saveStep | deleteStep | saveEvergreen | deleteEvergreen | preview | testSend
 *
 * 인증: requireAdmin (admin+). 발송 자체는 엔진/디스패처가 수행.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { runNurture } from "../../lib/nurture-engine";
import { renderTemplate } from "../../lib/template-render";
import { sendEmail } from "../../lib/email";

export const config = { path: "/api/admin-nurture" };
const H = { "Content-Type": "application/json; charset=utf-8" };

function err(step: string, e: any, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: "너처링 처리 실패", step, detail: String(e?.message || e).slice(0, 500) }), { status, headers: H });
}
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }

/* ★ A검증 #1 fix: SQL 주입 차단 — 채널·주기는 반드시 화이트리스트만 저장 (엔진이 sql.raw에 인터폴레이션). */
const VALID_CHANNELS = ["email", "sms", "kakao", "inapp"];
const VALID_CADENCES = ["monthly", "quarterly", "anniversary", "yearend"];

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminId = (auth as any).ctx?.admin?.uid ?? null;

  /* ───────── GET: 전체 상태 ───────── */
  if (req.method === "GET") {
    try {
      const journeys = rows(await db.execute(sql`SELECT id, segment, name, is_active AS "isActive", entry_basis AS "entryBasis" FROM nurture_journeys ORDER BY id`));
      const steps = rows(await db.execute(sql`SELECT id, journey_id AS "journeyId", day_offset AS "dayOffset", channel, template_id AS "templateId", email_template_id AS "emailTemplateId", label, conditions, sort_order AS "sortOrder", is_active AS "isActive" FROM nurture_steps ORDER BY journey_id, day_offset`));
      const evergreen = rows(await db.execute(sql`SELECT id, journey_id AS "journeyId", cadence, channel, template_id AS "templateId", email_template_id AS "emailTemplateId", label, is_active AS "isActive" FROM nurture_evergreen_rules ORDER BY journey_id`));
      const templates = rows(await db.execute(sql`SELECT id, name, channel FROM communication_templates WHERE is_active = true ORDER BY (category = 'nurture') DESC, name`));
      /* KPI: 여정별 active enrollment 수 + 누적 발송 수 */
      const kpi = rows(await db.execute(sql`
        SELECT j.id AS "journeyId",
          (SELECT COUNT(*) FROM nurture_enrollments e WHERE e.journey_id = j.id AND e.status='active')::int AS "activeCount",
          (SELECT COUNT(*) FROM nurture_enrollments e WHERE e.journey_id = j.id AND e.status='converted')::int AS "convertedCount",
          (SELECT COUNT(*) FROM nurture_sends s JOIN nurture_enrollments e ON e.id=s.enrollment_id WHERE e.journey_id=j.id)::int AS "sentCount"
        FROM nurture_journeys j ORDER BY j.id
      `));
      return new Response(JSON.stringify({ ok: true, data: { journeys, steps, evergreen, templates, kpi } }), { status: 200, headers: H });
    } catch (e) { return err("get_state", e); }
  }

  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "GET/POST만" }), { status: 405, headers: H });

  let body: any = {};
  try { body = await req.json(); } catch (e) { return err("parse", e, 400); }
  const action = String(body?.action || "");

  try {
    switch (action) {
      case "toggleJourney": {
        const id = Number(body.journeyId); const on = body.isActive === true;
        if (!id) return err("validate", "journeyId 필요", 400);
        await db.execute(sql`UPDATE nurture_journeys SET is_active = ${on}, updated_at = NOW() WHERE id = ${id}`);
        return new Response(JSON.stringify({ ok: true, journeyId: id, isActive: on }), { status: 200, headers: H });
      }
      case "saveStep": {
        const journeyId = Number(body.journeyId);
        const dayOffset = Math.max(0, Math.min(365, Number(body.dayOffset)));
        const channel = String(body.channel || "sms"); // ★ 문자 1차 기본
        const templateId = body.templateId ? Number(body.templateId) : null;
        const emailTemplateId = body.emailTemplateId ? Number(body.emailTemplateId) : null; // ★ 보조 메일
        const label = body.label ? String(body.label).slice(0, 120) : null;
        const isActive = body.isActive !== false;
        const conditions = body.conditions && typeof body.conditions === "object" ? JSON.stringify(body.conditions) : "{}";
        if (!journeyId || !Number.isFinite(dayOffset)) return err("validate", "journeyId·dayOffset 필요", 400);
        if (!VALID_CHANNELS.includes(channel)) return err("validate", "지원하지 않는 채널", 400);
        if (body.id) {
          await db.execute(sql`
            UPDATE nurture_steps SET day_offset=${dayOffset}, channel=${channel}, template_id=${templateId}, email_template_id=${emailTemplateId},
              label=${label}, is_active=${isActive}, conditions=${conditions}::jsonb, updated_at=NOW()
            WHERE id=${Number(body.id)}`);
          return new Response(JSON.stringify({ ok: true, id: Number(body.id) }), { status: 200, headers: H });
        }
        const r = rows(await db.execute(sql`
          INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, email_template_id, label, is_active, conditions, sort_order)
          VALUES (${journeyId}, ${dayOffset}, ${channel}, ${templateId}, ${emailTemplateId}, ${label}, ${isActive}, ${conditions}::jsonb, ${dayOffset})
          RETURNING id`));
        return new Response(JSON.stringify({ ok: true, id: r[0]?.id }), { status: 200, headers: H });
      }
      case "deleteStep": {
        const id = Number(body.id); if (!id) return err("validate", "id 필요", 400);
        await db.execute(sql`DELETE FROM nurture_steps WHERE id=${id}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: H });
      }
      case "saveEvergreen": {
        const journeyId = Number(body.journeyId);
        const cadence = String(body.cadence || "quarterly");
        const channel = String(body.channel || "sms"); // ★ 문자 1차 기본
        const templateId = body.templateId ? Number(body.templateId) : null;
        const emailTemplateId = body.emailTemplateId ? Number(body.emailTemplateId) : null;
        const label = body.label ? String(body.label).slice(0, 120) : null;
        const isActive = body.isActive !== false;
        if (!journeyId) return err("validate", "journeyId 필요", 400);
        if (!VALID_CHANNELS.includes(channel)) return err("validate", "지원하지 않는 채널", 400);
        if (!VALID_CADENCES.includes(cadence)) return err("validate", "지원하지 않는 주기", 400);
        if (body.id) {
          await db.execute(sql`UPDATE nurture_evergreen_rules SET cadence=${cadence}, channel=${channel}, template_id=${templateId}, email_template_id=${emailTemplateId}, label=${label}, is_active=${isActive}, updated_at=NOW() WHERE id=${Number(body.id)}`);
          return new Response(JSON.stringify({ ok: true, id: Number(body.id) }), { status: 200, headers: H });
        }
        const r = rows(await db.execute(sql`INSERT INTO nurture_evergreen_rules (journey_id, cadence, channel, template_id, email_template_id, label, is_active) VALUES (${journeyId}, ${cadence}, ${channel}, ${templateId}, ${emailTemplateId}, ${label}, ${isActive}) RETURNING id`));
        return new Response(JSON.stringify({ ok: true, id: r[0]?.id }), { status: 200, headers: H });
      }
      case "deleteEvergreen": {
        const id = Number(body.id); if (!id) return err("validate", "id 필요", 400);
        await db.execute(sql`DELETE FROM nurture_evergreen_rules WHERE id=${id}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: H });
      }
      case "preview": {
        /* 오늘 실제로 무엇이 발송될지(dryRun) — 아무것도 안 보냄 */
        const summary = await runNurture({ dryRun: true });
        return new Response(JSON.stringify({ ok: true, summary }), { status: 200, headers: H });
      }
      case "testSend": {
        const templateId = Number(body.templateId);
        const toEmail = String(body.toEmail || "").trim();
        if (!templateId || !toEmail) return err("validate", "templateId·toEmail 필요", 400);
        const t = rows(await db.execute(sql`SELECT subject, body_template, variables FROM communication_templates WHERE id=${templateId} LIMIT 1`))[0];
        if (!t) return err("validate", "템플릿 없음", 404);
        const sample = { 이름: "홍길동", name: "홍길동", 회원이름: "홍길동" };
        const vars = Array.isArray(t.variables) ? t.variables : [];
        const subject = t.subject ? renderTemplate(String(t.subject), vars, sample as any).rendered : "(제목 없음)";
        const bodyHtml = renderTemplate(String(t.body_template || ""), vars, sample as any).rendered;
        const m = await sendEmail({ to: toEmail, subject: `[테스트] ${subject}`, html: bodyHtml });
        void adminId;
        return new Response(JSON.stringify({ ok: !!m.ok, sentTo: toEmail }), { status: 200, headers: H });
      }
      default:
        return err("action", `알 수 없는 action: ${action}`, 400);
    }
  } catch (e) { return err("action_" + action, e); }
}
