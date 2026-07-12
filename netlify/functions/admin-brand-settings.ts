// netlify/functions/admin-brand-settings.ts
// 2026-06-03 브랜드 설정 어드민 (메인 화면 편집 → 브랜드 패널)
//   GET  /api/admin/brand-settings  → 현재 설정 { siteName, homeTitle, logoUrl, faviconUrl, version }
//   POST /api/admin/brand-settings  → multipart FormData 저장
//        필드: siteName, homeTitle, logo(file?), favicon(file?), removeLogo('1'?), removeFavicon('1'?)
//
// 저장: Netlify Blobs 영구 스토어 "brand" (public-brand.ts와 공유). 만료 없음.
// 권한: super_admin 또는 content/all 카테고리 (사이트 전역 변경이라 제한).
/* 2026-07-02: assignedCategories canEdit → role_permissions canAccess('content_edit') 교체 — 권한설계 화면에서 중앙 제어 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin/brand-settings" };

const JSON_HEADER = { "content-type": "application/json; charset=utf-8" };
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon", "image/gif"];
const MAX_BYTES = 3 * 1024 * 1024; // 3MB

function json(data: any, status = 200) {
  return new Response(jsonKST(data), { status, headers: JSON_HEADER });
}

async function canEdit(member: any): Promise<boolean> {
  return canAccess(String(member?.role || ""), "content_edit");
}

async function loadConfig(store: ReturnType<typeof getStore>): Promise<any> {
  try {
    const raw = await store.get("config", { type: "text" });
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

export default async (req: Request, _ctx: Context) => {
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const { admin, member } = guard.ctx;
  /* strong consistency — 저장 직후 공개 서빙이 최신값을 읽도록 보장 */
  const store = getStore({ name: "brand", consistency: "strong" });

  try {
    /* ── GET ── */
    if (req.method === "GET") {
      const cfg = await loadConfig(store);
      const v = cfg.version || 0;
      return json({
        ok: true,
        data: {
          siteName: cfg.siteName || "",
          homeTitle: cfg.homeTitle || "",
          logoUrl: cfg.logo ? `/api/public/brand?asset=logo&v=${v}` : null,
          faviconUrl: cfg.favicon ? `/api/public/brand?asset=favicon&v=${v}` : null,
          version: v,
        },
      });
    }

    /* ── POST: 저장 ── */
    if (req.method === "POST") {
      if (!(await canEdit(member))) return json({ ok: false, error: "브랜드 설정 변경 권한이 없습니다 (슈퍼관리자 또는 콘텐츠 담당)" }, 403);

      const form = await req.formData();
      const cfg = await loadConfig(store);

      // 텍스트
      if (form.has("siteName")) cfg.siteName = String(form.get("siteName") || "").trim().slice(0, 100);
      if (form.has("homeTitle")) cfg.homeTitle = String(form.get("homeTitle") || "").trim().slice(0, 200);

      // 이미지 업로드 헬퍼
      async function handleImage(field: string, key: string) {
        const f = form.get(field) as File | null;
        if (f && typeof (f as any).arrayBuffer === "function" && f.size > 0) {
          if (!IMAGE_MIME.includes(f.type)) throw new Error(`${field}: 지원하지 않는 이미지 형식 (${f.type})`);
          if (f.size > MAX_BYTES) throw new Error(`${field}: 3MB 이하만 가능`);
          const buf = await f.arrayBuffer();
          await store.set(key, buf, { metadata: { contentType: f.type } });
          cfg[key] = { type: f.type, size: f.size };
        }
        // 제거 플래그
        if (String(form.get("remove" + key.charAt(0).toUpperCase() + key.slice(1)) || "") === "1") {
          try { await store.delete(key); } catch (_) {}
          delete cfg[key];
        }
      }
      await handleImage("logo", "logo");
      await handleImage("favicon", "favicon");

      cfg.version = Date.now();
      await store.set("config", JSON.stringify(cfg), { metadata: { contentType: "application/json" } });

      try {
        await logAdminAction(req, admin.uid, admin.name, "brand_settings_update", {
          target: "brand", detail: { siteName: cfg.siteName, homeTitle: cfg.homeTitle, hasLogo: !!cfg.logo, hasFavicon: !!cfg.favicon },
        });
      } catch (_) {}

      const v = cfg.version;
      return json({
        ok: true,
        message: "브랜드 설정이 저장·적용되었습니다",
        data: {
          siteName: cfg.siteName || "",
          homeTitle: cfg.homeTitle || "",
          logoUrl: cfg.logo ? `/api/public/brand?asset=logo&v=${v}` : null,
          faviconUrl: cfg.favicon ? `/api/public/brand?asset=favicon&v=${v}` : null,
          version: v,
        },
      });
    }

    return json({ ok: false, error: "GET 또는 POST" }, 405);
  } catch (e: any) {
    console.error("[admin-brand-settings]", e);
    return json({ ok: false, error: e?.message || "브랜드 설정 처리 실패" }, 500);
  }
};
