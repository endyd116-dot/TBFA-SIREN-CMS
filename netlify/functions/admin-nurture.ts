/**
 * /api/admin-nurture — 후원자 너처링 어드민 (통합 핸들러)
 *
 * GET                : 전체 상태(여정·단계·영구규칙·템플릿목록·KPI)
 * POST {action}      : toggleJourney | saveStep | deleteStep | saveEvergreen | deleteEvergreen | preview | testSend
 *
 * 인증: requireAdmin (admin+). 발송 자체는 엔진/디스패처가 수행.
 */
import { jsonKST } from "../../lib/kst";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { runNurture } from "../../lib/nurture-engine";
import { renderTemplate } from "../../lib/template-render";
import { sendEmail } from "../../lib/email";

export const config = { path: "/api/admin-nurture" };
const H = { "Content-Type": "application/json; charset=utf-8" };

function err(step: string, e: any, status = 500) {
  return new Response(jsonKST({ ok: false, error: "너처링 처리 실패", step, detail: String(e?.message || e).slice(0, 500) }), { status, headers: H });
}
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }

/* A검증 #1 fix: SQL 주입 차단 — 채널·주기는 반드시 화이트리스트만 저장 (엔진이 sql.raw에 인터폴레이션). */
const VALID_CHANNELS = ["email", "sms", "kakao", "inapp"];
const VALID_CADENCES = ["monthly", "quarterly", "anniversary", "yearend"];

/* 2026-06-26: 문자 내용 인라인 CRUD — 카드에서 작성한 본문(bodyText)을 템플릿에 upsert.
   id 있으면 그 템플릿 수정, 없으면 신규 생성. 본문 비면 기존 templateId 유지. */
async function upsertTpl(opts: { id: number | null; channel: string; subject: string | null; body: string; label: string | null; imageUrl?: string | null; hasImageKey?: boolean }): Promise<number | null> {
  const bodyText = String(opts.body || "").trim();
  if (!bodyText) return opts.id;
  const subject = opts.channel === "email" ? (opts.subject ? String(opts.subject).slice(0, 200) : "교사유가족협의회 소식") : null;
  /* 이미지: 기존 시스템 images(jsonb) 재사용 → SMS는 자동 MMS, 메일은 본문 삽입. imageUrl=''면 제거. */
  const imgJson = opts.imageUrl
    ? JSON.stringify([{ url: String(opts.imageUrl), order: 0, position: "below", align: "center", width: 600, alt: "교사유가족협의회" }])
    : "[]";
  let id = opts.id;
  if (id) {
    await db.execute(sql`UPDATE communication_templates SET channel=${opts.channel}, subject=${subject}, body_template=${bodyText}, category='nurture', is_active=true, updated_at=NOW() WHERE id=${id}`);
  } else {
    const name = `[너처링] ${String(opts.label || "단계").slice(0, 60)} ${String(Date.now()).slice(-6)}`;
    const r = (await db.execute(sql`INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active, created_at, updated_at)
      VALUES (${name}, ${opts.channel}, 'nurture', ${subject}, ${bodyText}, '[{"key":"이름","label":"회원이름","sample":"김후원"}]'::jsonb, true, NOW(), NOW()) RETURNING id`) as any);
    id = Number((r?.rows ?? r ?? [])[0]?.id) || null;
  }
  /* images 컬럼이 있을 때만 갱신(기존 MMS 시스템 컬럼). imageUrl 키가 요청에 있을 때만 덮어씀. */
  if (id && opts.hasImageKey) {
    try { await db.execute(sql`UPDATE communication_templates SET images=${imgJson}::jsonb WHERE id=${id}`); }
    catch (e) { console.warn("[nurture] images 컬럼 갱신 실패(무시):", String((e as any)?.message || e)); }
  }
  return id;
}

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
      /* images 컬럼 존재 시에만 포함(기존 MMS 시스템 컬럼·환경별 상이) */
      let hasImages = false;
      try { hasImages = ((rows(await db.execute(sql`SELECT 1 AS ok FROM information_schema.columns WHERE table_name='communication_templates' AND column_name='images' LIMIT 1`))[0] || {}) as any).ok === 1; } catch { hasImages = false; }
      const templates = hasImages
        ? rows(await db.execute(sql`SELECT id, name, channel, CASE WHEN category='nurture' THEN subject END AS "subject", CASE WHEN category='nurture' THEN body_template END AS "body", CASE WHEN category='nurture' THEN images END AS "images" FROM communication_templates WHERE is_active = true ORDER BY (category = 'nurture') DESC, name`))
        : rows(await db.execute(sql`SELECT id, name, channel, CASE WHEN category='nurture' THEN subject END AS "subject", CASE WHEN category='nurture' THEN body_template END AS "body" FROM communication_templates WHERE is_active = true ORDER BY (category = 'nurture') DESC, name`));
      /* KPI: 여정별 active enrollment 수 + 누적 발송 수 */
      const kpi = rows(await db.execute(sql`
        SELECT j.id AS "journeyId",
          (SELECT COUNT(*) FROM nurture_enrollments e WHERE e.journey_id = j.id AND e.status='active')::int AS "activeCount",
          (SELECT COUNT(*) FROM nurture_enrollments e WHERE e.journey_id = j.id AND e.status='converted')::int AS "convertedCount",
          (SELECT COUNT(*) FROM nurture_sends s JOIN nurture_enrollments e ON e.id=s.enrollment_id WHERE e.journey_id=j.id)::int AS "sentCount"
        FROM nurture_journeys j ORDER BY j.id
      `));
      return new Response(jsonKST({ ok: true, data: { journeys, steps, evergreen, templates, kpi } }), { status: 200, headers: H });
    } catch (e) { return err("get_state", e); }
  }

  if (req.method !== "POST") return new Response(jsonKST({ ok: false, error: "GET/POST만" }), { status: 405, headers: H });

  let body: any = {};
  try { body = await req.json(); } catch (e) { return err("parse", e, 400); }
  const action = String(body?.action || "");

  try {
    switch (action) {
      case "toggleJourney": {
        const id = Number(body.journeyId); const on = body.isActive === true;
        if (!id) return err("validate", "journeyId 필요", 400);
        await db.execute(sql`UPDATE nurture_journeys SET is_active = ${on}, updated_at = NOW() WHERE id = ${id}`);
        return new Response(jsonKST({ ok: true, journeyId: id, isActive: on }), { status: 200, headers: H });
      }
      case "saveStep": {
        const journeyId = Number(body.journeyId);
        const dayOffset = Math.max(0, Math.min(365, Number(body.dayOffset)));
        const channel = String(body.channel || "sms"); // 문자 1차 기본
        let templateId = body.templateId ? Number(body.templateId) : null;
        const emailTemplateId = body.emailTemplateId ? Number(body.emailTemplateId) : null; // 보조 메일
        const label = body.label ? String(body.label).slice(0, 120) : null;
        const isActive = body.isActive !== false;
        const conditions = body.conditions && typeof body.conditions === "object" ? JSON.stringify(body.conditions) : "{}";
        if (!journeyId || !Number.isFinite(dayOffset)) return err("validate", "journeyId·dayOffset 필요", 400);
        if (!VALID_CHANNELS.includes(channel)) return err("validate", "지원하지 않는 채널", 400);
        /* 인라인 작성 본문이 있으면 템플릿 upsert → templateId 확정 (이미지 포함) */
        if (typeof body.bodyText === "string") templateId = await upsertTpl({ id: templateId, channel, subject: body.subject ?? null, body: body.bodyText, label, imageUrl: body.imageUrl ?? null, hasImageKey: "imageUrl" in body });
        if (body.id) {
          await db.execute(sql`
            UPDATE nurture_steps SET day_offset=${dayOffset}, channel=${channel}, template_id=${templateId}, email_template_id=${emailTemplateId},
              label=${label}, is_active=${isActive}, conditions=${conditions}::jsonb, updated_at=NOW()
            WHERE id=${Number(body.id)}`);
          return new Response(jsonKST({ ok: true, id: Number(body.id) }), { status: 200, headers: H });
        }
        const r = rows(await db.execute(sql`
          INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, email_template_id, label, is_active, conditions, sort_order)
          VALUES (${journeyId}, ${dayOffset}, ${channel}, ${templateId}, ${emailTemplateId}, ${label}, ${isActive}, ${conditions}::jsonb, ${dayOffset})
          RETURNING id`));
        return new Response(jsonKST({ ok: true, id: r[0]?.id }), { status: 200, headers: H });
      }
      case "deleteStep": {
        const id = Number(body.id); if (!id) return err("validate", "id 필요", 400);
        await db.execute(sql`DELETE FROM nurture_steps WHERE id=${id}`);
        return new Response(jsonKST({ ok: true }), { status: 200, headers: H });
      }
      case "saveEvergreen": {
        const journeyId = Number(body.journeyId);
        const cadence = String(body.cadence || "quarterly");
        const channel = String(body.channel || "sms"); // 문자 1차 기본
        let templateId = body.templateId ? Number(body.templateId) : null;
        const emailTemplateId = body.emailTemplateId ? Number(body.emailTemplateId) : null;
        const label = body.label ? String(body.label).slice(0, 120) : null;
        const isActive = body.isActive !== false;
        if (!journeyId) return err("validate", "journeyId 필요", 400);
        if (!VALID_CHANNELS.includes(channel)) return err("validate", "지원하지 않는 채널", 400);
        if (!VALID_CADENCES.includes(cadence)) return err("validate", "지원하지 않는 주기", 400);
        if (typeof body.bodyText === "string") templateId = await upsertTpl({ id: templateId, channel, subject: body.subject ?? null, body: body.bodyText, label, imageUrl: body.imageUrl ?? null, hasImageKey: "imageUrl" in body });
        if (body.id) {
          await db.execute(sql`UPDATE nurture_evergreen_rules SET cadence=${cadence}, channel=${channel}, template_id=${templateId}, email_template_id=${emailTemplateId}, label=${label}, is_active=${isActive}, updated_at=NOW() WHERE id=${Number(body.id)}`);
          return new Response(jsonKST({ ok: true, id: Number(body.id) }), { status: 200, headers: H });
        }
        const r = rows(await db.execute(sql`INSERT INTO nurture_evergreen_rules (journey_id, cadence, channel, template_id, email_template_id, label, is_active) VALUES (${journeyId}, ${cadence}, ${channel}, ${templateId}, ${emailTemplateId}, ${label}, ${isActive}) RETURNING id`));
        return new Response(jsonKST({ ok: true, id: r[0]?.id }), { status: 200, headers: H });
      }
      case "deleteEvergreen": {
        const id = Number(body.id); if (!id) return err("validate", "id 필요", 400);
        await db.execute(sql`DELETE FROM nurture_evergreen_rules WHERE id=${id}`);
        return new Response(jsonKST({ ok: true }), { status: 200, headers: H });
      }
      case "analytics": {
        /* 성과 대시보드 — 여정 퍼널·발송·채널·단계별 */
        const journeys = rows(await db.execute(sql`SELECT id, segment, name, is_active AS "isActive" FROM nurture_journeys ORDER BY id`));
        const funnel = rows(await db.execute(sql`
          SELECT journey_id AS "journeyId",
            COUNT(*)::int AS enrolled,
            COUNT(*) FILTER (WHERE status='active')::int AS active,
            COUNT(*) FILTER (WHERE status='converted')::int AS converted,
            COUNT(*) FILTER (WHERE status='exited')::int AS exited
          FROM nurture_enrollments GROUP BY journey_id`));
        const sentByJourney = rows(await db.execute(sql`
          SELECT e.journey_id AS "journeyId", COUNT(s.id)::int AS sent
          FROM nurture_sends s JOIN nurture_enrollments e ON e.id = s.enrollment_id
          GROUP BY e.journey_id`));
        const stepSends = rows(await db.execute(sql`SELECT step_id AS "stepId", COUNT(*)::int AS cnt FROM nurture_sends WHERE step_id IS NOT NULL GROUP BY step_id`));
        const channelTotals = rows(await db.execute(sql`SELECT channel, COUNT(*)::int AS cnt FROM nurture_sends GROUP BY channel`));
        const recent = rows(await db.execute(sql`
          SELECT COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '7 days')::int AS d7,
                 COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '30 days')::int AS d30,
                 COUNT(*)::int AS total FROM nurture_sends`))[0] || {};
        /* 보조 메일 오픈/클릭(nurture_sends.job_id = 메일 job → 수신자 추적) */
        const emailTracking = rows(await db.execute(sql`
          SELECT COUNT(DISTINCT r.id)::int AS sent,
                 COUNT(DISTINCT r.id) FILTER (WHERE r.opened_at IS NOT NULL)::int AS opens,
                 COUNT(DISTINCT r.id) FILTER (WHERE r.clicked_at IS NOT NULL)::int AS clicks
          FROM nurture_sends ns JOIN communication_send_recipients r ON r.job_id = ns.job_id
          WHERE ns.job_id IS NOT NULL`))[0] || {};
        return new Response(jsonKST({ ok: true, data: { journeys, funnel, sentByJourney, stepSends, channelTotals, recent, emailTracking } }), { status: 200, headers: H });
      }
      case "preview": {
        /* 오늘 실제로 무엇이 발송될지(dryRun) — 아무것도 안 보냄 */
        const summary = await runNurture({ dryRun: true });
        return new Response(jsonKST({ ok: true, summary }), { status: 200, headers: H });
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
        return new Response(jsonKST({ ok: !!m.ok, sentTo: toEmail }), { status: 200, headers: H });
      }
      default:
        return err("action", `알 수 없는 action: ${action}`, 400);
    }
  } catch (e) { return err("action_" + action, e); }
}
