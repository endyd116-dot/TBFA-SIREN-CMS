/**
 * 1회용 — 관련 사이트 6개 교원단체 더미 데이터 시드
 *
 * 호출 (어드민 로그인 후 주소창):
 *   https://tbfa-siren-cms.netlify.app/api/seed-related-sites?run=1
 *
 * 진단 (인증 불필요):
 *   GET /api/seed-related-sites
 *
 * ⚠️ 호출 성공 후 즉시 이 파일을 삭제하고 커밋·푸시.
 *
 * 멱등: 동일 이름이 이미 존재하면 SKIP (중복 INSERT 방지).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { relatedSites } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

const SEED_DATA = [
  {
    name: "전국교직원노동조합 (전교조)",
    url: "https://www.eduhope.net",
    description: "전국 교사들의 권익과 교육 개혁을 위한 노동조합",
    sortOrder: 10,
  },
  {
    name: "한국교원단체총연합회 (한교총)",
    url: "https://www.kfta.or.kr",
    description: "교원의 사회·경제·전문적 지위 향상을 위한 단체",
    sortOrder: 20,
  },
  {
    name: "전국초등교사노동조합",
    url: "https://www.kpu.or.kr",
    description: "초등 교사들의 권익 보호와 노동 환경 개선",
    sortOrder: 30,
  },
  {
    name: "교사노동조합연맹",
    url: "https://www.kjnoso.or.kr",
    description: "교사 노동조합 연합 조직",
    sortOrder: 40,
  },
  {
    name: "좋은교사운동",
    url: "https://goodteacher.org",
    description: "기독교 교사 단체, 교육 개혁 운동",
    sortOrder: 50,
  },
  {
    name: "실천교육교사모임",
    url: "https://www.koreateach.org",
    description: "교육 실천을 통한 교실 변화를 추구하는 교사 모임",
    sortOrder: 60,
  },
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  /* GET ?run=1 : 어드민 인증 후 시드 INSERT */
  if (req.method === "GET" && url.searchParams.get("run") === "1") {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.res;

    const results: Array<{ name: string; ok: boolean; skipped?: boolean; id?: number; error?: string }> = [];

    try {
      for (const item of SEED_DATA) {
        try {
          // 멱등: 이미 같은 이름 있으면 skip
          const existing: any = await db
            .select({ id: relatedSites.id })
            .from(relatedSites)
            .where(eq(relatedSites.name, item.name))
            .limit(1);
          if (existing.length > 0) {
            results.push({ name: item.name, ok: true, skipped: true, id: existing[0].id });
            continue;
          }
          const inserted: any = await db
            .insert(relatedSites)
            .values({
              name: item.name,
              url: item.url,
              description: item.description,
              sortOrder: item.sortOrder,
              isActive: true,
            } as any)
            .returning({ id: relatedSites.id });
          results.push({ name: item.name, ok: true, id: inserted[0]?.id });
        } catch (err: any) {
          results.push({ name: item.name, ok: false, error: err?.message || String(err) });
        }
      }

      const successCount = results.filter(r => r.ok).length;
      const skippedCount = results.filter(r => r.skipped).length;
      const insertedCount = successCount - skippedCount;

      return new Response(JSON.stringify({
        ok: successCount === SEED_DATA.length,
        mode: "run",
        executor: (auth.ctx.member as any).name || "admin",
        total: SEED_DATA.length,
        inserted: insertedCount,
        skipped: skippedCount,
        failed: SEED_DATA.length - successCount,
        results,
        nextAction: "✅ AI에게 결과 알리세요. 자동으로 이 파일 삭제 + 푸시됩니다.",
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, mode: "run", error: err?.message || String(err), results,
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  /* GET (기본) : 진단 */
  if (req.method === "GET") {
    try {
      const existing: any = await db
        .select({ id: relatedSites.id, name: relatedSites.name, url: relatedSites.url, isActive: relatedSites.isActive })
        .from(relatedSites)
        .limit(50);
      return new Response(JSON.stringify({
        ok: true,
        mode: "diagnose",
        currentCount: existing.length,
        currentItems: existing,
        seedToInsert: SEED_DATA.map(s => s.name),
        howToSeed: "어드민 로그인 후 주소창: /api/seed-related-sites?run=1",
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, mode: "diagnose", error: err?.message || String(err),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response(
    JSON.stringify({ ok: false, error: "GET 만 허용 (?run=1로 시드)" }),
    { status: 405, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/api/seed-related-sites" };
