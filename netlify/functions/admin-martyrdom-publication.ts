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
import { jsonKST } from "../../lib/kst";
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
  return new Response(jsonKST({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }),
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
      const canWrite = await canAccess(member.role ?? "", PUB_WRITE_FEATURE);
      return new Response(jsonKST({ ok: true, publications, canWrite }), {
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

      return new Response(jsonKST({
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

      /* background 트리거 — 결과를 bgStatus로 가시화(조용한 스킵 방지·generate.ts:128 패턴) */
      const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
      let bgStatus: string | number = "ok";
      let bgError: string | undefined;
      if (!secret) {
        /* R41 Q2-028: 시크릿 미설정 시 백그라운드 생성 불가 — 응답에 경고 노출 */
        bgStatus = "secret_missing";
        console.warn("[martyrdom-publication] INTERNAL_TRIGGER_SECRET 미설정 — 발간물 본문 자동 생성 스킵(draft만 생성)");
      } else {
        /* R41 Q2-051: baseUrl http 정규화 가드(generate.ts:52-53 패턴) */
        const base = process.env.URL || process.env.SITE_URL || "https://tbfa.co.kr";
        const baseUrl = base.startsWith("http") ? base : `https://${base}`;
        try {
          const resp = await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-publication-generate-background`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pubId, pubType, caseIds, blendRatio, maskLevel, secret }),
          });
          bgStatus = resp.status;
          if (resp.status !== 200 && resp.status !== 202) {
            bgError = (await resp.text().catch(() => "")).slice(0, 200);
          }
        } catch (triggerErr: any) {
          bgStatus = 0;
          bgError = String(triggerErr?.message || triggerErr).slice(0, 200);
          console.warn(`[martyrdom-publication] background 트리거 실패: ${triggerErr?.message}`);
        }
      }

      await logAdminAction(req, admin.uid, String(member.name || ""), "martyrdom_publication_create", { target: `martyrdom_publications:${pubId}`, detail: { pubType } });

      return new Response(jsonKST({
        ok: true, queued: true, id: pubId, pubType, status: "draft",
        bgStatus, bgError: bgError || undefined,
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
      /* R41 Q2-007: 현재 상태 확인 후 전이 검증 — 검수(reviewed) 없이 발간(published) 직행 차단 */
      const curRes: any = await db.execute(sql.raw(
        `SELECT status, title, (content_html IS NULL OR content_html = '') AS "isEmpty" FROM martyrdom_publications WHERE id = ${id} LIMIT 1`
      ));
      const curRow = (curRes?.rows ?? curRes ?? [])[0];
      if (!curRow) return badRequest("발간물을 찾을 수 없습니다");
      const cur = String(curRow.status || "draft");

      /* AD-080: 본문 생성 실패/미완료('(생성 실패)' 마커 또는 본문 없음) 발간물은 검수·발간 차단 — 실패 더미 발간 방지 */
      if (status === "reviewed" || status === "published") {
        const isEmpty = curRow.isEmpty === true || curRow.isEmpty === "t";
        if (String(curRow.title || "").includes("(생성 실패)") || isEmpty) {
          return badRequest("본문 생성이 완료되지 않았거나 실패한 발간물은 검수·발간할 수 없습니다. 본문을 재생성한 뒤 진행해 주세요.");
        }
      }

      /* 허용 전이: draft→reviewed, reviewed→published, 발간/검수 취소(→draft), 동일 상태(멱등) */
      const allowed: Record<string, string[]> = {
        draft:     ["reviewed", "draft"],
        reviewed:  ["published", "draft", "reviewed"],
        published: ["draft", "published"],
      };
      if (!(allowed[cur] || []).includes(status)) {
        return badRequest(
          status === "published"
            ? "검수 완료(reviewed) 상태에서만 발간할 수 있습니다"
            : `'${cur}' → '${status}' 전이는 허용되지 않습니다`
        );
      }

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

      return new Response(jsonKST({ ok: true, id, status }),
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
      return new Response(jsonKST({ ok: true, id: idParam }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("delete_publication", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "GET·POST·PATCH·DELETE만 허용" }), { status: 405 });
};
