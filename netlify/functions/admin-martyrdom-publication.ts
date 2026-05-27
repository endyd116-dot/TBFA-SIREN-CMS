/**
 * admin-martyrdom-publication — 연구 발간물 CRUD (P4·§P4.2)
 *
 * POST   { pubType, caseIds?, blendRatio?, maskLevel? }   → 발간물 생성 큐 (background 트리거)
 * GET               → 목록 (publications[])
 * GET    ?id=N      → 상세 (publication{})
 * PATCH  { id, status, title?, note? }                    → 검수/발간 상태 변경 (super_admin)
 * DELETE ?id=N      → 삭제 (super_admin)
 *
 * 응답 계약: §P4.2 JSON 계약 1글자도 안 바꿈
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { roleForbidden } from "../../lib/admin-role";
import { canAccess } from "../../lib/role-permission-check";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-publication" };

/* 발간 쓰기(생성·발간·삭제) 권한 — 권한 정책 관리에서 토글 (기본 admin ON·operator OFF·super 항상). 조회(GET)는 운영자 이상 그대로 */
const PUB_WRITE_FEATURE = "martyrdom_publication";

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }),
    { status: 400, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  const url = new URL(req.url);
  const idParam = Number(url.searchParams.get("id") || "0");

  /* ── GET 목록 ── */
  if (req.method === "GET" && !idParam) {
    try {
      const r: any = await db.execute(sql.raw(`
        SELECT id, pub_type AS "pubType", title, status, created_at AS "createdAt"
        FROM martyrdom_publications
        ORDER BY created_at DESC
        LIMIT 100
      `));
      const publications = (r?.rows ?? r ?? []).map((row: any) => ({
        id:        Number(row.id),
        pubType:   String(row.pubType || ""),
        title:     String(row.title || ""),
        status:    String(row.status || "draft"),
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      }));
      return new Response(JSON.stringify({ ok: true, publications }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_list", err);
    }
  }

  /* ── GET 상세 ── */
  if (req.method === "GET" && idParam) {
    try {
      const r: any = await db.execute(sql.raw(`
        SELECT id, pub_type AS "pubType", title, content_html AS "contentHtml",
               content_json AS "contentJson", blend_ratio AS "blendRatio",
               source_case_ids AS "sourceCaseIds", anonymized, reid_risk AS "reidRisk",
               rag_sources AS "ragSources", status,
               created_by AS "createdBy", reviewed_by AS "reviewedBy", published_by AS "publishedBy",
               created_at AS "createdAt", published_at AS "publishedAt"
        FROM martyrdom_publications WHERE id = ${idParam} LIMIT 1
      `));
      const row = (r?.rows ?? r ?? [])[0];
      if (!row) return badRequest("발간물을 찾을 수 없습니다");

      return new Response(JSON.stringify({
        ok: true,
        publication: {
          id:            Number(row.id),
          pubType:       String(row.pubType || ""),
          title:         String(row.title || ""),
          contentHtml:   row.contentHtml || null,
          blendRatio:    row.blendRatio || { self: 70, ai: 30 },
          anonymized:    row.anonymized !== false,
          reidRisk:      String(row.reidRisk || "low"),
          status:        String(row.status || "draft"),
          ragSources:    row.ragSources || [],
          createdAt:     row.createdAt ? new Date(row.createdAt).toISOString() : null,
          publishedAt:   row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("select_detail", err);
    }
  }

  /* ── POST 생성 큐 (admin 이상 — 운영자는 조회만) ── */
  if (req.method === "POST") {
    if (!(await canAccess(member.role ?? "", PUB_WRITE_FEATURE))) return roleForbidden("admin");

    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

    const pubType = String(body?.pubType || "").trim();
    if (!["guide", "trend", "case_study"].includes(pubType)) {
      return badRequest("pubType은 guide|trend|case_study");
    }
    const caseIds   = Array.isArray(body?.caseIds) ? body.caseIds.map(Number).filter((n: number) => n > 0) : [];
    const blendRatio = body?.blendRatio || { self: 70, ai: 30 };
    const maskLevel  = ["light", "medium", "full"].includes(body?.maskLevel) ? body.maskLevel : "medium";

    const PUB_TITLE: Record<string, string> = {
      guide:      "교사 사망 시 순직 인정 종합 가이드",
      trend:      "순직 인정 최근 동향 보고서",
      case_study: "익명 순직 인정 사례 연구",
    };

    try {
      /* draft 행 먼저 INSERT */
      const blendJson = JSON.stringify(blendRatio).replace(/'/g, "''");
      const sourceCaseIdsJson = JSON.stringify(caseIds).replace(/'/g, "''");
      const safeTitle = PUB_TITLE[pubType].replace(/'/g, "''");
      const insertRes: any = await db.execute(sql.raw(`
        INSERT INTO martyrdom_publications
          (pub_type, title, blend_ratio, source_case_ids, anonymized, status, created_by, created_at)
        VALUES
          ('${pubType}', '${safeTitle}', '${blendJson}', '${sourceCaseIdsJson}', true, 'draft', ${admin.uid}, NOW())
        RETURNING id
      `));
      const pubId = Number((insertRes?.rows ?? insertRes ?? [])[0]?.id || 0);
      if (!pubId) throw new Error("INSERT 실패");

      /* background 트리거 */
      const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
      if (secret) {
        const baseUrl = process.env.URL || process.env.SITE_URL || "https://tbfa.co.kr";
        try {
          await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-publication-generate-background`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pubId, pubType, caseIds, blendRatio, maskLevel, secret }),
          });
        } catch (triggerErr: any) {
          console.warn(`[martyrdom-publication] background 트리거 실패: ${triggerErr?.message}`);
        }
      }

      await logAdminAction(req, admin.uid, String(member.name || ""), "martyrdom_publication_create", { target: `martyrdom_publications:${pubId}`, detail: { pubType } });

      return new Response(JSON.stringify({
        ok: true, queued: true, id: pubId, pubType, status: "draft",
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("create_publication", err);
    }
  }

  /* ── PATCH 상태 변경·발간 (admin 이상) ── */
  if (req.method === "PATCH") {
    if (!(await canAccess(member.role ?? "", PUB_WRITE_FEATURE))) return roleForbidden("admin");

    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const id     = Number(body?.id || 0);
    const status = String(body?.status || "").trim();
    if (!id) return badRequest("id 필수");
    if (!["reviewed", "published", "draft"].includes(status)) {
      return badRequest("status는 reviewed|published|draft");
    }

    try {
      const sets: string[] = [`status = '${status}'`];
      if (status === "reviewed") {
        sets.push(`reviewed_by = ${admin.uid}`);
      }
      if (status === "published") {
        sets.push(`published_by = ${admin.uid}`);
        sets.push(`published_at = NOW()`);
      }

      await db.execute(sql.raw(`
        UPDATE martyrdom_publications
        SET ${sets.join(", ")}
        WHERE id = ${id}
      `));

      await logAdminAction(req, admin.uid, String(member.name || ""), "martyrdom_publication_status", { target: `martyrdom_publications:${id}`, detail: { status } });

      return new Response(JSON.stringify({ ok: true, id, status }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("patch_publication", err);
    }
  }

  /* ── DELETE (admin 이상) ── */
  if (req.method === "DELETE") {
    if (!(await canAccess(member.role ?? "", PUB_WRITE_FEATURE))) return roleForbidden("admin");
    if (!idParam) return badRequest("id 필수 (?id=N)");

    try {
      await db.execute(sql.raw(`DELETE FROM martyrdom_publications WHERE id = ${idParam}`));
      await logAdminAction(req, admin.uid, String(member.name || ""), "martyrdom_publication_delete", { target: `martyrdom_publications:${idParam}` });
      return new Response(JSON.stringify({ ok: true, id: idParam }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("delete_publication", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "GET·POST·PATCH·DELETE만 허용" }), { status: 405 });
};
