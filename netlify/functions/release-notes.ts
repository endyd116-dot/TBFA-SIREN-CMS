// netlify/functions/release-notes.ts
// [업데이트 소식 A안] 운영자용 변경내역 조회·관리
//
// GET  ?list=1&published=1 : 발행된 소식 목록 (운영자 전원 — 직원·관리자 모두)
// GET  ?list=1             : 전체 목록 (관리자: 이사장·국장)
// GET  ?drafts=1           : 코드 시드 초안 중 아직 안 가져온 것 (관리자)
// POST {importDrafts:true} : 시드 초안 → DB 초안으로 일괄 가져오기 (관리자)
// POST {title, items}      : 수동 초안 생성 (관리자)
// PATCH ?id=N              : 수정 {title?, items?} / ?action=publish 발행 / ?action=unpublish 발행취소 (관리자)
// DELETE ?id=N             : 삭제 (관리자)
import type { Context } from "@netlify/functions";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { releaseNotes } from "../../db/schema";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { PENDING_DRAFTS } from "../../lib/release-drafts";
import {
  ok, badRequest, forbidden, notFound, methodNotAllowed, serverError, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

export const config = { path: "/api/release-notes" };

const MAX_ITEMS = 30;

function sanitizeItems(raw: any): { text: string; link?: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it: any) => ({
      text: String(it?.text || "").slice(0, 300).trim(),
      link: it?.link ? String(it.link).slice(0, 300) : undefined,
    }))
    .filter((it) => it.text)
    .slice(0, MAX_ITEMS);
}

export default async (req: Request, _ctx: Context) => {
  let step = "auth";
  try {
    const guard = await requireOperator(req);
    if (operatorGuardFailed(guard)) return guard.res;
    const me = guard.ctx.member as any;
    const isManager = me.role === "super_admin" || me.role === "admin"; // 발행·관리 권한(이사장·국장)

    const url = new URL(req.url);

    /* ───── GET ───── */
    if (req.method === "GET") {
      // 시드 초안 조회 (관리자)
      if (url.searchParams.get("drafts") === "1") {
        step = "drafts";
        if (!isManager) return forbidden("관리 권한이 필요합니다");
        const keys = PENDING_DRAFTS.map((d) => d.key);
        let existing: string[] = [];
        if (keys.length > 0) {
          const rows: any = await db
            .select({ draftKey: releaseNotes.draftKey })
            .from(releaseNotes)
            .where(inArray(releaseNotes.draftKey, keys));
          existing = rows.map((r: any) => r.draftKey);
        }
        const pending = PENDING_DRAFTS.filter((d) => !existing.includes(d.key));
        return ok({ items: pending, total: pending.length });
      }

      step = "list";
      const publishedOnly = url.searchParams.get("published") === "1";
      const limit = Math.min(Number(url.searchParams.get("limit") || 30), 100);
      if (!publishedOnly && !isManager) return forbidden("관리 권한이 필요합니다");
      const where = publishedOnly ? eq(releaseNotes.status, "published") : undefined;
      const items: any = await db
        .select()
        .from(releaseNotes)
        .where(where as any)
        .orderBy(desc(releaseNotes.publishedAt), desc(releaseNotes.createdAt))
        .limit(limit);
      return ok({ items, total: items.length });
    }

    /* ───── POST — 생성/초안 가져오기 (관리자) ───── */
    if (req.method === "POST") {
      if (!isManager) return forbidden("관리 권한이 필요합니다");
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      // 시드 초안 일괄 가져오기
      if (body.importDrafts === true) {
        step = "import_drafts";
        const keys = PENDING_DRAFTS.map((d) => d.key);
        let existing: string[] = [];
        if (keys.length > 0) {
          const rows: any = await db
            .select({ draftKey: releaseNotes.draftKey })
            .from(releaseNotes)
            .where(inArray(releaseNotes.draftKey, keys));
          existing = rows.map((r: any) => r.draftKey);
        }
        const toInsert = PENDING_DRAFTS.filter((d) => !existing.includes(d.key));
        let imported = 0;
        for (const d of toInsert) {
          try {
            await db.insert(releaseNotes).values({
              draftKey: d.key,
              title: d.title.slice(0, 200),
              items: sanitizeItems(d.items),
              status: "draft",
              createdBy: me.id,
            } as any);
            imported++;
          } catch (e) {
            console.warn("[release-notes] 초안 삽입 실패:", d.key, e);
          }
        }
        return ok({ imported }, imported > 0 ? `초안 ${imported}건을 가져왔어요` : "가져올 새 초안이 없습니다");
      }

      // 수동 생성
      step = "create";
      const title = String(body.title || "").slice(0, 200).trim();
      if (!title) return badRequest("title 필수");
      const items = sanitizeItems(body.items);
      const inserted: any = await db
        .insert(releaseNotes)
        .values({ title, items, status: "draft", createdBy: me.id } as any)
        .returning();
      await logAudit({
        userId: me.id, userType: "admin", userName: me.name,
        action: "release_note.create", target: `release_note:${inserted[0].id}`,
        detail: { title }, req,
      } as any);
      return ok(inserted[0], "초안이 생성되었습니다");
    }

    /* ───── PATCH — 수정/발행/발행취소 (관리자) ───── */
    if (req.method === "PATCH") {
      if (!isManager) return forbidden("관리 권한이 필요합니다");
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");
      const action = url.searchParams.get("action");

      const [row]: any = await db.select().from(releaseNotes).where(eq(releaseNotes.id, id)).limit(1);
      if (!row) return notFound("소식을 찾을 수 없습니다");

      if (action === "publish" || action === "unpublish") {
        step = action;
        const publish = action === "publish";
        const [updated]: any = await db
          .update(releaseNotes)
          .set({
            status: publish ? "published" : "draft",
            publishedAt: publish ? new Date() : null,
            updatedAt: new Date(),
          } as any)
          .where(eq(releaseNotes.id, id))
          .returning();
        await logAudit({
          userId: me.id, userType: "admin", userName: me.name,
          action: publish ? "release_note.publish" : "release_note.unpublish",
          target: `release_note:${id}`, detail: { title: row.title }, req,
        } as any);
        return ok(updated, publish ? "발행되었습니다 — 운영자들에게 새 소식 배지가 표시됩니다" : "발행이 취소되었습니다");
      }

      step = "update";
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");
      const patch: any = { updatedAt: new Date() };
      if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.slice(0, 200).trim();
      if (body.items !== undefined) patch.items = sanitizeItems(body.items);
      const [updated]: any = await db
        .update(releaseNotes).set(patch).where(eq(releaseNotes.id, id)).returning();
      return ok(updated, "수정되었습니다");
    }

    /* ───── DELETE (관리자) ───── */
    if (req.method === "DELETE") {
      if (!isManager) return forbidden("관리 권한이 필요합니다");
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");
      await db.delete(releaseNotes).where(eq(releaseNotes.id, id));
      await logAudit({
        userId: me.id, userType: "admin", userName: me.name,
        action: "release_note.delete", target: `release_note:${id}`, req,
      } as any);
      return ok({ id }, "삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[release-notes]", err);
    return serverError(`업데이트 소식 처리 중 오류 (${step})`, err);
  }
};
