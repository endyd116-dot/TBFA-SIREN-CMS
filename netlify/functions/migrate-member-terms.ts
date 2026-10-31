/**
 * GET /api/migrate-member-terms        — 진단 (인증 불필요·readonly) : 표별로 바뀔 항목 수와 id
 * GET /api/migrate-member-terms?preview=1 — 미리보기 (어드민 인증) : 바뀌는 문장 앞뒤 문맥·멱등(재변환 시 불변) 점검, 쓰기 없음
 * GET /api/migrate-member-terms?run=1  — 실행 (어드민 인증)        : DB 콘텐츠의 옛 용어를 후원회원·회비 어휘로 치환
 *
 * 대상(공개 화면에 보이는 운영자 콘텐츠): site_pages(발행본 + 임시저장본 둘 다 · 변경 전 리비전 자동 백업) ·
 *   notices(title/content/excerpt) · faqs(question/answer) · campaigns(title/summary/content_html/extras) · resources(title/description/content_html) ·
 *   site_settings(발행 값 + 임시저장 값 · footer.donation.notice는 사실에 맞게 새 문구)
 * 행 단위 try/catch — 한 행이 실패해도 나머지는 적용되고 failed 목록으로 보고.
 * 제외: 활동 글(«유가족 후원금 전달식» 같은 역사 기록) · 게시판 · 업데이트 소식 · 발송 템플릿(운영자 검토 영역)
 * 규칙 단일 출처: lib/member-terms.ts. 멱등(재실행 시 0건). 변경 전 값은 audit_logs(member_terms_migration)에 보관.
 * 호출 성공 후 즉시 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { convertMemberTerms, convertMemberTermsTraced, MEMBER_TERM_RX, MEMBER_TERM_RULES } from "../../lib/member-terms";

export const config = { path: "/api/migrate-member-terms" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const conv = (v: any): string | null => (v == null ? null : convertMemberTerms(String(v)));
const FOOTER_NOTICE = "협의회는 사단법인으로 아직 기부금영수증(세액공제) 발급이 되지 않습니다. 회비 납부 확인서는 마이페이지에서 발급받으실 수 있으며, 공익법인 지정 시 바로 안내드리겠습니다.";

interface Plan { table: string; id: number; label: string; before: Record<string, any>; after: Record<string, any>; skipReason?: string }

async function buildPlan(): Promise<Plan[]> {
  const plans: Plan[] = [];
  const diff = (table: string, id: number, label: string, before: Record<string, any>, after: Record<string, any>, skipReason?: string) => {
    const changedKeys = Object.keys(after).filter((k) => (after[k] ?? null) !== (before[k] ?? null));
    if (!changedKeys.length) return;
    const b: Record<string, any> = {}; const a: Record<string, any> = {};
    for (const k of changedKeys) { b[k] = before[k]; a[k] = after[k]; }
    plans.push({ table, id, label, before: b, after: a, skipReason });
  };

  for (const r of rowsOf(await db.execute(sql`SELECT id, slug, title, eyebrow, subtitle, content_html, has_draft, draft_title, draft_eyebrow, draft_subtitle, draft_content_html FROM site_pages ORDER BY id`))) {
    const before: Record<string, any> = { title: r.title, eyebrow: r.eyebrow, subtitle: r.subtitle, content_html: r.content_html };
    const after: Record<string, any> = { title: conv(r.title), eyebrow: conv(r.eyebrow), subtitle: conv(r.subtitle), content_html: conv(r.content_html) };
    if (r.has_draft) { // 운영자 임시저장본도 함께 — 나중에 [배포]해도 옛 용어로 되돌아가지 않게
      Object.assign(before, { draft_title: r.draft_title, draft_eyebrow: r.draft_eyebrow, draft_subtitle: r.draft_subtitle, draft_content_html: r.draft_content_html });
      Object.assign(after, { draft_title: conv(r.draft_title), draft_eyebrow: conv(r.draft_eyebrow), draft_subtitle: conv(r.draft_subtitle), draft_content_html: conv(r.draft_content_html) });
    }
    diff("site_pages", Number(r.id), `/p/${r.slug}`, before, after);
  }
  for (const r of rowsOf(await db.execute(sql`SELECT id, title, content, excerpt FROM notices ORDER BY id`))) {
    diff("notices", Number(r.id), String(r.title || "").slice(0, 40), { title: r.title, content: r.content, excerpt: r.excerpt }, { title: conv(r.title), content: conv(r.content), excerpt: conv(r.excerpt) });
  }
  for (const r of rowsOf(await db.execute(sql`SELECT id, question, answer FROM faqs ORDER BY id`))) {
    diff("faqs", Number(r.id), String(r.question || "").slice(0, 40), { question: r.question, answer: r.answer }, { question: conv(r.question), answer: conv(r.answer) });
  }
  for (const r of rowsOf(await db.execute(sql`SELECT id, slug, title, summary, content_html, extras::text AS extras_text FROM campaigns ORDER BY id`))) {
    diff("campaigns", Number(r.id), String(r.slug || r.title).slice(0, 40), { title: r.title, summary: r.summary, content_html: r.content_html, extras_text: r.extras_text },
      { title: conv(r.title), summary: conv(r.summary), content_html: conv(r.content_html), extras_text: conv(r.extras_text) });
  }
  for (const r of rowsOf(await db.execute(sql`SELECT id, slug, title, description, content_html FROM resources ORDER BY id`))) {
    diff("resources", Number(r.id), String(r.title || r.slug).slice(0, 40), { title: r.title, description: r.description, content_html: r.content_html },
      { title: conv(r.title), description: conv(r.description), content_html: conv(r.content_html) });
  }
  for (const r of rowsOf(await db.execute(sql`SELECT id, scope, key, value_text, value_json::text AS value_json_text, has_draft, draft_value_text, draft_value_json::text AS draft_value_json_text FROM site_settings ORDER BY id`))) {
    const isFooterNotice = r.scope === "footer" && r.key === "donation.notice";
    const before: Record<string, any> = { value_text: r.value_text, value_json_text: r.value_json_text };
    const after: Record<string, any> = { value_text: isFooterNotice && r.value_text != null ? FOOTER_NOTICE : conv(r.value_text), value_json_text: conv(r.value_json_text) };
    if (r.has_draft) { // 임시저장 값도 함께
      Object.assign(before, { draft_value_text: r.draft_value_text, draft_value_json_text: r.draft_value_json_text });
      Object.assign(after, { draft_value_text: isFooterNotice && r.draft_value_text != null ? FOOTER_NOTICE : conv(r.draft_value_text), draft_value_json_text: conv(r.draft_value_json_text) });
    }
    diff("site_settings", Number(r.id), `${r.scope}.${r.key}`, before, after);
  }
  return plans;
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";
    const preview = url.searchParams.get("preview") === "1";

    step = "plan";
    const plans = await buildPlan();
    const summary: Record<string, { willChange: number[]; skipped: { id: number; reason: string }[] }> = {};
    for (const p of plans) {
      summary[p.table] ??= { willChange: [], skipped: [] };
      if (p.skipReason) summary[p.table].skipped.push({ id: p.id, reason: p.skipReason }); else summary[p.table].willChange.push(p.id);
    }
    const total = plans.filter((p) => !p.skipReason).length;

    if (preview) {
      step = "auth";
      const pv = await requireAdmin(req);
      if (!pv.ok) return (pv as { ok: false; res: Response }).res;
      const items = plans.map((p) => ({
        table: p.table, id: p.id, label: p.label, skipReason: p.skipReason,
        fields: Object.keys(p.after).map((k) => {
          const t = convertMemberTermsTraced(p.before[k]);
          const out = String(p.after[k] ?? "");
          return {
            field: k, beforeLen: String(p.before[k] ?? "").length, afterLen: out.length, changes: t.trace.length,
            idempotent: convertMemberTerms(out) === out,
            remainingOldTerms: Array.from(new Set(out.match(new RegExp(MEMBER_TERM_RX.source, "g")) || [])),
            trace: t.trace,
          };
        }),
      }));
      return new Response(jsonKST({ ok: true, mode: "preview", totalChanges: total, items }, null, 2), { headers: JSON_HEADER });
    }

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose", rules: MEMBER_TERM_RULES.length, totalChanges: total, tables: summary,
        samples: plans.filter((p) => !p.skipReason).slice(0, 12).map((p) => ({ table: p.table, id: p.id, label: p.label, fields: Object.keys(p.after) })),
        hint: total ? `?run=1 로 실행하면 ${total}건이 후원회원·회비 어휘로 바뀝니다(재실행 안전·페이지는 리비전 백업).` : "바꿀 항목이 없습니다.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
    const admin = (auth as any).ctx?.admin;
    const uid = Number(admin?.uid) || null;

    step = "apply";
    const applied: Record<string, number[]> = {};
    const failed: { table: string; id: number; error: string }[] = [];
    for (const p of plans) {
      if (p.skipReason) continue;
      const a = p.after;
      try {
      if (p.table === "site_pages") {
        const cur = rowsOf(await db.execute(sql`SELECT title, eyebrow, subtitle, content_html FROM site_pages WHERE id = ${p.id}`))[0];
        if (cur) await db.execute(sql`
          INSERT INTO site_page_revisions (page_id, title, eyebrow, subtitle, content_html, note, saved_by, saved_by_name, saved_at)
          VALUES (${p.id}, ${cur.title}, ${cur.eyebrow}, ${cur.subtitle}, ${cur.content_html}, ${"용어 전환(후원→후원회원·회비) 전 자동 백업"}, ${uid}, ${"시스템"}, NOW())`);
        await db.execute(sql`UPDATE site_pages SET
          title = COALESCE(${a.title ?? null}, title), eyebrow = CASE WHEN ${"eyebrow" in a} THEN ${a.eyebrow ?? null} ELSE eyebrow END,
          subtitle = CASE WHEN ${"subtitle" in a} THEN ${a.subtitle ?? null} ELSE subtitle END,
          content_html = COALESCE(${a.content_html ?? null}, content_html),
          draft_title = CASE WHEN ${"draft_title" in a} THEN ${a.draft_title ?? null} ELSE draft_title END,
          draft_eyebrow = CASE WHEN ${"draft_eyebrow" in a} THEN ${a.draft_eyebrow ?? null} ELSE draft_eyebrow END,
          draft_subtitle = CASE WHEN ${"draft_subtitle" in a} THEN ${a.draft_subtitle ?? null} ELSE draft_subtitle END,
          draft_content_html = CASE WHEN ${"draft_content_html" in a} THEN ${a.draft_content_html ?? null} ELSE draft_content_html END,
          updated_at = NOW() WHERE id = ${p.id}`);
      } else if (p.table === "notices") {
        await db.execute(sql`UPDATE notices SET title = COALESCE(${a.title ?? null}, title), content = COALESCE(${a.content ?? null}, content),
          excerpt = CASE WHEN ${"excerpt" in a} THEN ${a.excerpt ?? null} ELSE excerpt END, updated_at = NOW() WHERE id = ${p.id}`);
      } else if (p.table === "faqs") {
        await db.execute(sql`UPDATE faqs SET question = COALESCE(${a.question ?? null}, question), answer = COALESCE(${a.answer ?? null}, answer), updated_at = NOW() WHERE id = ${p.id}`);
      } else if (p.table === "campaigns") {
        await db.execute(sql`UPDATE campaigns SET title = COALESCE(${a.title ?? null}, title),
          summary = CASE WHEN ${"summary" in a} THEN ${a.summary ?? null} ELSE summary END,
          content_html = CASE WHEN ${"content_html" in a} THEN ${a.content_html ?? null} ELSE content_html END,
          extras = CASE WHEN ${"extras_text" in a} THEN ${a.extras_text ?? null}::jsonb ELSE extras END, updated_at = NOW() WHERE id = ${p.id}`);
      } else if (p.table === "resources") {
        await db.execute(sql`UPDATE resources SET title = COALESCE(${a.title ?? null}, title),
          description = CASE WHEN ${"description" in a} THEN ${a.description ?? null} ELSE description END,
          content_html = CASE WHEN ${"content_html" in a} THEN ${a.content_html ?? null} ELSE content_html END, updated_at = NOW() WHERE id = ${p.id}`);
      } else if (p.table === "site_settings") {
        await db.execute(sql`UPDATE site_settings SET
          value_text = CASE WHEN ${"value_text" in a} THEN ${a.value_text ?? null} ELSE value_text END,
          value_json = CASE WHEN ${"value_json_text" in a} THEN ${a.value_json_text ?? null}::jsonb ELSE value_json END,
          draft_value_text = CASE WHEN ${"draft_value_text" in a} THEN ${a.draft_value_text ?? null} ELSE draft_value_text END,
          draft_value_json = CASE WHEN ${"draft_value_json_text" in a} THEN ${a.draft_value_json_text ?? null}::jsonb ELSE draft_value_json END,
          updated_at = NOW() WHERE id = ${p.id}`);
      }
      applied[p.table] ??= []; applied[p.table].push(p.id);
      } catch (e: any) { failed.push({ table: p.table, id: p.id, error: String(e?.message || e).slice(0, 300) }); }
    }

    step = "audit";
    await logAdminAction(req as any, admin?.uid, admin?.name, "member_terms_migration", {
      target: "public_content", detail: { applied, before: plans.filter((p) => !p.skipReason).map((p) => ({ table: p.table, id: p.id, before: p.before })) },
    }).catch(() => {});

    return new Response(jsonKST({
      ok: failed.length === 0, mode: "executed", totalChanges: total, appliedCount: total - failed.length, applied, failed,
      skipped: Object.fromEntries(Object.entries(summary).map(([t, v]) => [t, v.skipped])),
      hint: failed.length ? `${failed.length}건은 바꾸지 못했습니다(failed 참고) — 나머지는 반영됨.` : "공개 화면(5분 캐시)·홈 서버 렌더에 곧 반영됩니다. 성공 확인 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "용어 전환 마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
