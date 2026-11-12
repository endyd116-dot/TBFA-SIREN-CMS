import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { memorialMessages, memorialLetters, memorialTeachers } from "../../db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { createNotification } from "../../lib/notify";
import { consentMapFor, letterExtrasReady } from "../../lib/memorial-letter-extras";
import {
  letterPhotoReady, letterPhotoInfo, pendingPhotoLetters, applyPhotoDecision,
  syncLetterPhotoVisibility, hidePhotoOfLetter, photoUrlOf, PHOTO_DECISIONS,
} from "../../lib/memorial-letter-photo";
import type { PhotoDecision } from "../../lib/memorial-letter-photo";

export const config = { path: "/api/admin-memorial-moderation" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "모더레이션 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const type = url.searchParams.get("type") === "letter" ? "letter" : "message";
  /* R41 Q2-013: sort=recent → 최신순(미검토 탭). 기본은 신고순 */
  const sortRecent = url.searchParams.get("sort") === "recent";

  /* ── GET: 신고순(기본) 또는 최신순(미검토) 목록 ── */
  if (method === "GET") {
    /* ★ 2026-11-12 «사진 편지 검토 대기» — 사진이 붙어 운영자 확인을 기다리는 편지 (오래된 것부터).
       사진은 아직 비공개라 /api/blob-image 가 관리자에게만 내준다(이 화면은 관리자 쿠키로 연다). */
    if (type === "letter" && url.searchParams.get("photo") === "pending") {
      try {
        if (!(await letterPhotoReady())) {
          return new Response(jsonKST({ ok: true, data: { items: [], photoReady: false } }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
        const rows = await pendingPhotoLetters(200);
        const ids = rows.map((r: any) => Number(r.id));

        /* 보조 조회는 실패해도 목록은 보여준다 — 선생님 이름·출판 동의 */
        const teacherIds = Array.from(new Set(rows.map((r: any) => Number(r.teacher_id)).filter((n) => n > 0)));
        const teacherName = new Map<number, string>();
        if (teacherIds.length) {
          try {
            const ts = await db
              .select({ id: memorialTeachers.id, name: memorialTeachers.name })
              .from(memorialTeachers)
              .where(inArray(memorialTeachers.id, teacherIds));
            for (const t of ts) teacherName.set(t.id, t.name);
          } catch (err) { console.warn("[admin-memorial-moderation] 선생님 이름 조회 실패", err); }
        }
        const consent = await consentMapFor(ids);

        const items = rows.map((r: any) => ({
          id: Number(r.id),
          teacherId: Number(r.teacher_id),
          teacherName: teacherName.get(Number(r.teacher_id)) || null,
          authorName: r.author_name,
          title: r.title,
          content: r.content,
          reportCount: Number(r.report_count || 0),
          isHidden: r.is_hidden === true,
          createdAt: r.created_at,
          isMemberWriter: r.member_id != null,
          publishConsent: consent[Number(r.id)] === true,
          photoUrl: photoUrlOf(r.photo_blob_id),
        }));
        return new Response(jsonKST({ ok: true, data: { items, photoReady: true } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("select_photo_pending", err);
      }
    }

    try {
      if (type === "letter") {
        const order = sortRecent
          ? [desc(memorialLetters.createdAt)]
          : [desc(memorialLetters.reportCount), desc(memorialLetters.createdAt)];
        const rows = await db
          .select({
            id:          memorialLetters.id,
            teacherId:   memorialLetters.teacherId,
            memberId:    memorialLetters.memberId,
            authorName:  memorialLetters.authorName,
            title:       memorialLetters.title,
            content:     memorialLetters.content,
            reportCount: memorialLetters.reportCount,
            isHidden:    memorialLetters.isHidden,
            createdAt:   memorialLetters.createdAt,
          })
          .from(memorialLetters)
          .orderBy(...order)
          .limit(500);

        /* ★ 2026-10-07: 책으로 엮는 데 동의한 편지인지 함께 보여준다 (출판 사업용).
           저장 칸이 아직 없으면(마이그 전) 표시만 빠진다. */
        const consent = await consentMapFor(rows.map((r) => r.id));
        const consentReady = await letterExtrasReady();
        /* ★ 2026-11-12: 사진이 붙은 편지는 사진 상태(검토 대기·공개·뺌)와 사진 주소를 함께 보여준다.
           저장 칸이 아직 없으면(마이그 전) 빈 값 — 목록은 예전 그대로. */
        const photoInfo = await letterPhotoInfo(rows.map((r) => r.id));
        const photoReady = await letterPhotoReady();
        const items = rows.map((r) => ({
          id: r.id,
          teacherId: r.teacherId,
          authorName: r.authorName,
          title: r.title,
          content: r.content,
          reportCount: r.reportCount,
          isHidden: r.isHidden,
          createdAt: r.createdAt,
          isMemberWriter: r.memberId != null,
          publishConsent: consent[r.id] === true,
          photoReview: photoInfo[r.id]?.photoReview ?? null,
          photoUrl: photoUrlOf(photoInfo[r.id]?.photoBlobId),
        }));
        return new Response(jsonKST({ ok: true, data: { items, consentReady, photoReady } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      const order = sortRecent
        ? [desc(memorialMessages.createdAt)]
        : [desc(memorialMessages.reportCount), desc(memorialMessages.createdAt)];
      const items = await db
        .select({
          id:          memorialMessages.id,
          teacherId:   memorialMessages.teacherId,
          authorName:  memorialMessages.authorName,
          content:     memorialMessages.content,
          likeCount:   memorialMessages.likeCount,
          reportCount: memorialMessages.reportCount,
          isHidden:    memorialMessages.isHidden,
          createdAt:   memorialMessages.createdAt,
        })
        .from(memorialMessages)
        .orderBy(...order)
        .limit(500);
      return new Response(jsonKST({ ok: true, data: { items } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_moderation", err);
    }
  }

  /* ── PATCH: 숨김 토글 ── */
  if (method === "PATCH") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    /* ★ 2026-11-12 사진 편지 결정 — [공개](사진과 함께) · [사진 빼고 공개] · [숨김]
       편지 상태와 사진 파일 공개 여부를 한 번에 바꾼다(lib/memorial-letter-photo applyPhotoDecision). */
    if (type === "letter" && body.photoDecision != null) {
      const decision = String(body.photoDecision) as PhotoDecision;
      if (!PHOTO_DECISIONS.includes(decision)) {
        return new Response(jsonKST({ ok: false, error: "photoDecision 은 approve·strip·hide 중 하나여야 합니다" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      try {
        if (!(await letterPhotoReady())) {
          return new Response(jsonKST({ ok: false, error: "사진 첨부 저장 칸이 아직 준비되지 않았습니다(마이그레이션 전)" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }
        const result = await applyPhotoDecision(id, decision);
        if (!result.ok) {
          const fail = result as { ok: false; status: number; error: string };
          return new Response(jsonKST({ ok: false, error: fail.error }), {
            status: fail.status, headers: { "Content-Type": "application/json" },
          });
        }
        const done = result as { ok: true; memberId: number | null; previous: string | null };

        /* 회원이 쓴 편지면 결과를 알려 드린다 (로그인 없이 쓴 분은 알릴 곳이 없다·best-effort) */
        if (done.memberId) {
          const note = decision === "approve"
            ? { title: "보내주신 편지와 사진이 공개되었습니다", message: "기억의 편지에 사진과 함께 봉투로 놓였습니다. 마음을 나눠 주셔서 고맙습니다.", severity: "info" as const }
            : decision === "strip"
              ? { title: "보내주신 편지가 공개되었습니다", message: "편지 글은 공개되었고, 사진은 운영 정책에 따라 함께 싣지 않았습니다. 문의가 있으시면 협의회로 연락 주세요.", severity: "info" as const }
              : { title: "추모 게시글이 비공개 처리되었습니다", message: "작성하신 추모 글이 운영 정책에 따라 비공개 처리되었습니다. 문의가 있으시면 협의회로 연락 주세요.", severity: "warning" as const };
          try {
            await createNotification({
              recipientId: done.memberId,
              recipientType: "user",
              category: "support",
              severity: note.severity,
              title: note.title,
              message: note.message,
              link: "/memorial.html",
              refTable: "memorial_letters",
              refId: id,
            });
          } catch (e) { console.warn("[admin-memorial-moderation] 사진 결정 통지 실패:", (e as any)?.message); }
        }

        const message = decision === "approve"
          ? "사진과 함께 공개했습니다"
          : decision === "strip"
            ? "사진은 빼고 편지만 공개했습니다"
            : "편지를 숨겼습니다(사진도 공개되지 않습니다)";
        return new Response(jsonKST({ ok: true, message }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("photo_decision", err);
      }
    }

    const isHidden = !!body.isHidden;

    const setHidden: any = { isHidden };
    try {
      // AD-046: 숨김 시 작성 회원에게 통지하기 위해 작성자 회원 id 확보
      let authorMemberId: number | null = null;
      if (type === "letter") {
        const [row] = await db.select({ memberId: memorialLetters.memberId }).from(memorialLetters).where(eq(memorialLetters.id, id)).limit(1);
        authorMemberId = (row as any)?.memberId ?? null;
        await db.update(memorialLetters).set(setHidden).where(eq(memorialLetters.id, id));
        /* ★ 2026-11-12: 공개된 사진은 편지와 함께 숨고 함께 돌아온다(검토 대기·뺀 사진은 계속 비공개) */
        await syncLetterPhotoVisibility(id);
      } else {
        const [row] = await db.select({ memberId: memorialMessages.memberId }).from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        authorMemberId = (row as any)?.memberId ?? null;
        await db.update(memorialMessages).set(setHidden).where(eq(memorialMessages.id, id));
      }
      /* AD-046: 숨김 처리 시 작성 회원에게 통지 (회원 글에 한함·best-effort) */
      if (isHidden && authorMemberId) {
        try {
          await createNotification({
            recipientId: authorMemberId,
            recipientType: "user",
            category: "support",
            severity: "warning",
            title: "추모 게시글이 비공개 처리되었습니다",
            message: "작성하신 추모 글이 운영 정책에 따라 비공개 처리되었습니다. 문의가 있으시면 협의회로 연락 주세요.",
            link: "/memorial.html",
            refTable: type === "letter" ? "memorial_letters" : "memorial_messages",
            refId: id,
          });
        } catch (e) { console.warn("[admin-memorial-moderation] 숨김 통지 실패:", (e as any)?.message); }
      }
      return new Response(jsonKST({ ok: true, message: isHidden ? "숨김 처리했습니다" : "다시 공개했습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("update_moderation", err);
    }
  }

  /* ── DELETE ── */
  if (method === "DELETE") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      // AD-046: 삭제 전 작성자 회원 id 확보 후 통지
      let authorMemberId: number | null = null;
      if (type === "letter") {
        const [row] = await db.select({ memberId: memorialLetters.memberId }).from(memorialLetters).where(eq(memorialLetters.id, id)).limit(1);
        authorMemberId = (row as any)?.memberId ?? null;
        await db.delete(memorialLetters).where(eq(memorialLetters.id, id));
        /* ★ 2026-11-12: 지운 편지에 붙어 있던 사진은 더는 주소로 볼 수 없게 비공개로 */
        await hidePhotoOfLetter(id);
      } else {
        const [row] = await db.select({ memberId: memorialMessages.memberId }).from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        authorMemberId = (row as any)?.memberId ?? null;
        await db.delete(memorialMessages).where(eq(memorialMessages.id, id));
      }
      if (authorMemberId) {
        try {
          await createNotification({
            recipientId: authorMemberId,
            recipientType: "user",
            category: "support",
            severity: "warning",
            title: "추모 게시글이 삭제되었습니다",
            message: "작성하신 추모 글이 운영 정책에 따라 삭제되었습니다. 문의가 있으시면 협의회로 연락 주세요.",
            link: "/memorial.html",
            refTable: type === "letter" ? "memorial_letters" : "memorial_messages",
            refId: id,
          });
        } catch (e) { console.warn("[admin-memorial-moderation] 삭제 통지 실패:", (e as any)?.message); }
      }
      return new Response(jsonKST({ ok: true, message: "삭제되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("delete_moderation", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
