import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { familyStories } from "../../db/schema";
import { eq, asc } from "drizzle-orm";

export const config = { path: "/api/admin-family-stories" };

// 유튜브 ID 추출 (watch?v= / youtu.be/ / embed/ / shorts/ / live/)
function extractYoutubeId(url: string): string | null {
  const pattern = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  const m = url.match(pattern);
  return m ? m[1] : null;
}

// oEmbed로 제목·썸네일 가져오기
async function fetchOembed(youtubeUrl: string): Promise<{ title?: string; thumbnailUrl?: string }> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`
    );
    if (!res.ok) return {};
    const data = await res.json() as { title?: string; thumbnail_url?: string };
    return { title: data.title, thumbnailUrl: data.thumbnail_url };
  } catch {
    return {};
  }
}

export default async function handler(req: Request, _ctx: Context) {
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const auth = guard.ctx as import("../../lib/admin-guard").AdminContext;

  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // ── GET ?ytOembed=URL: 유튜브 제목·썸네일 미리보기 ──
  if (method === "GET" && url.searchParams.has("ytOembed")) {
    const ytUrl = url.searchParams.get("ytOembed") || "";
    const youtubeId = extractYoutubeId(ytUrl);
    if (!youtubeId) {
      return new Response(jsonKST({ ok: false, error: "올바른 유튜브 URL이 아닙니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    const oembed = await fetchOembed(ytUrl);
    return new Response(jsonKST({
      ok: true,
      data: { oembed: {
        title: oembed.title || null,
        thumbnailUrl: oembed.thumbnailUrl || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
      } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // ── GET: 전체 목록 ──
  if (method === "GET") {
    try {
      const rows = await db
        .select()
        .from(familyStories)
        .orderBy(asc(familyStories.sortOrder), asc(familyStories.createdAt));

      return new Response(jsonKST({ ok: true, data: { stories: rows } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_stories", err);
    }
  }

  // ── POST: 생성 ──
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const {
      youtubeUrl, title, subtitle, summary, detailHtml,
      adminNotes, duration, category, status, sortOrder,
    } = body;

    if (!title) {
      return new Response(jsonKST({ ok: false, error: "제목은 필수입니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    try {
      let youtubeId: string | null = null;
      let thumbnailUrl: string | null = body.thumbnailUrl || null;
      let resolvedTitle = title;

      if (youtubeUrl) {
        youtubeId = extractYoutubeId(youtubeUrl);
        if (youtubeId) {
          const oembed = await fetchOembed(youtubeUrl);
          if (!resolvedTitle && oembed.title) resolvedTitle = oembed.title;
          if (!thumbnailUrl) {
            thumbnailUrl = oembed.thumbnailUrl || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
          }
        }
      }

      // 발행 검증
      if (status === "published" && !youtubeId) {
        return new Response(jsonKST({ ok: false, error: "영상 URL을 먼저 입력하세요" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      const insertValues: any = {
        youtubeId: youtubeId ?? undefined,
        youtubeUrl: youtubeUrl || undefined,
        title: resolvedTitle,
        subtitle: subtitle || undefined,
        thumbnailUrl: thumbnailUrl ?? undefined,
        summary: summary || undefined,
        detailHtml: detailHtml || undefined,
        adminNotes: adminNotes || undefined,
        duration: duration || undefined,
        category: category || "voice",
        status: status || "draft",
        sortOrder: sortOrder ?? 0,
        publishedAt: status === "published" ? new Date() : undefined,
        createdBy: auth.admin.uid,
      };
      const [row] = await db.insert(familyStories).values(insertValues).returning();

      return new Response(jsonKST({ ok: true, data: { story: row }, message: "저장되었습니다" }), {
        status: 201, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("insert_story", err);
    }
  }

  // ── PATCH: 수정 ──
  if (method === "PATCH") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      // 기존 레코드 확인
      const existing = await db.select().from(familyStories).where(eq(familyStories.id, id)).limit(1);
      if (!existing.length) {
        return new Response(jsonKST({ ok: false, error: "존재하지 않는 이야기입니다" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      const updates: Record<string, any> = { updatedAt: new Date() };

      if (body.youtubeUrl !== undefined) {
        const newUrl = body.youtubeUrl || null;
        updates.youtubeUrl = newUrl;
        if (newUrl) {
          const newId = extractYoutubeId(newUrl);
          updates.youtubeId = newId;
          if (newId && !body.thumbnailUrl) {
            const oembed = await fetchOembed(newUrl);
            updates.thumbnailUrl = oembed.thumbnailUrl || `https://i.ytimg.com/vi/${newId}/hqdefault.jpg`;
            if (!body.title && oembed.title) updates.title = oembed.title;
          }
        } else {
          updates.youtubeId = null;
        }
      }
      if (body.title !== undefined) updates.title = body.title;
      if (body.subtitle !== undefined) updates.subtitle = body.subtitle;
      if (body.thumbnailUrl !== undefined) updates.thumbnailUrl = body.thumbnailUrl;
      if (body.summary !== undefined) updates.summary = body.summary;
      if (body.detailHtml !== undefined) updates.detailHtml = body.detailHtml;
      if (body.adminNotes !== undefined) updates.adminNotes = body.adminNotes;
      if (body.duration !== undefined) updates.duration = body.duration;
      if (body.category !== undefined) updates.category = body.category;
      if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

      if (body.status !== undefined) {
        const finalYoutubeId = updates.youtubeId ?? existing[0].youtubeId;
        if (body.status === "published" && !finalYoutubeId) {
          return new Response(jsonKST({ ok: false, error: "영상 URL을 먼저 입력하세요" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }
        updates.status = body.status;
        if (body.status === "published" && !existing[0].publishedAt) {
          updates.publishedAt = new Date();
        }
      }

      const [row] = await db.update(familyStories).set(updates).where(eq(familyStories.id, id)).returning();

      return new Response(jsonKST({ ok: true, data: { story: row }, message: "수정되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("update_story", err);
    }
  }

  // ── DELETE ──
  if (method === "DELETE") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    try {
      await db.delete(familyStories).where(eq(familyStories.id, id));
      return new Response(jsonKST({ ok: true, message: "삭제되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("delete_story", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "처리 중 오류가 발생했습니다",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
