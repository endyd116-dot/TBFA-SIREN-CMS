import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { memorialSettings } from "../../db/schema";
import { getMemorialDisplay, saveMemorialDisplay, displayColumnsReady } from "../../lib/memorial-display";
import { eq, desc } from "drizzle-orm";

export const config = { path: "/api/admin-memorial-settings" };

const DEFAULT_HERO_ID = "l97eBPM_d9E";
const DEFAULT_HERO_COPY = "우리는 당신들을 기억합니다";

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "추모관 설정 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

function shape(s: any) {
  return {
    heroYoutubeId: s?.heroYoutubeId || DEFAULT_HERO_ID,
    heroCopy:      s?.heroCopy || DEFAULT_HERO_COPY,
    bgmTracks:     Array.isArray(s?.bgmTracks) ? s.bgmTracks : [],
  };
}

export default async function handler(req: Request, _ctx: Context) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  const method = req.method.toUpperCase();

  /* ── GET ── */
  if (method === "GET") {
    try {
      const [s] = await db.select().from(memorialSettings).orderBy(desc(memorialSettings.id)).limit(1);
      /* 2026-08-04: 표시 문구·개별 헌화 노출 설정을 함께 내려준다 */
      const display = await getMemorialDisplay();
      return new Response(jsonKST({
        ok: true,
        data: { settings: { ...shape(s), ...display }, displayReady: await displayColumnsReady() },
      }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_settings", err);
    }
  }

  /* ── PATCH: 단일 행 upsert ── */
  if (method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (body.heroYoutubeId !== undefined) updates.heroYoutubeId = (body.heroYoutubeId || "").toString().slice(0, 20) || null;
    if (body.heroCopy !== undefined)      updates.heroCopy = (body.heroCopy || "").toString().slice(0, 300) || null;
    if (body.bgmTracks !== undefined)     updates.bgmTracks = Array.isArray(body.bgmTracks) ? body.bgmTracks : [];

    try {
      const [existing] = await db.select().from(memorialSettings).orderBy(desc(memorialSettings.id)).limit(1);
      let row;
      if (existing) {
        [row] = await db.update(memorialSettings).set(updates).where(eq(memorialSettings.id, existing.id)).returning();
      } else {
        const insertData: any = {
          heroYoutubeId: updates.heroYoutubeId ?? DEFAULT_HERO_ID,
          heroCopy:      updates.heroCopy ?? DEFAULT_HERO_COPY,
          bgmTracks:     updates.bgmTracks ?? [],
        };
        [row] = await db.insert(memorialSettings).values(insertData).returning();
      }

      /* 2026-08-04: 표시 문구·개별 헌화 노출도 함께 저장 (다른 칸을 쓰므로 별도 처리) */
      let displayWarn: string | undefined;
      if (body.bioLabel !== undefined || body.timelineLabel !== undefined || body.showTeacherOffering !== undefined) {
        const r = await saveMemorialDisplay({
          bioLabel: body.bioLabel,
          timelineLabel: body.timelineLabel,
          showTeacherOffering: body.showTeacherOffering,
        });
        if (!r.ok) displayWarn = r.error;
      }
      const display = await getMemorialDisplay();

      return new Response(jsonKST({
        ok: true,
        data: { settings: { ...shape(row), ...display } },
        message: displayWarn ? `저장되었습니다 (일부 미반영: ${displayWarn})` : "저장되었습니다",
      }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("upsert_settings", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
