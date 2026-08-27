import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialMessages, memorialMessageLikes } from "../../db/schema";
import { authenticateUser, requireActiveUser, extractToken } from "../../lib/auth";
import { clientIpHash } from "../../lib/client-ip";
import { moderateMemorialText } from "../../lib/memorial-moderation";
import { notifyAllOperators } from "../../lib/notify";
import { eq, and, isNull, desc, sql, inArray } from "drizzle-orm";

export const config = { path: "/api/memorial-messages" };

const PAGE_SIZE = 20;
/* ★ 2026-08-28: 로그인하지 않은 분의 연속 작성 간격 (도배 방지) */
const ANON_COOLDOWN_SECONDS = 60;

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "추모 메시지 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const teacherIdRaw = url.searchParams.get("teacherId");
  const teacherId: number | null = teacherIdRaw ? Number(teacherIdRaw) : null;

  /* ───────────── GET: 공개 목록 ───────────── */
  if (method === "GET") {
    try {
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const offset = (page - 1) * PAGE_SIZE;

      /* ★ 2026-08-28 추모관 v2 — 어느 마음인지로 나눈다.
         kind=tribute(밤, 선생님 추모) / kind=support(아침, 유가족 응원)
         값을 안 주면 예전처럼 추모만 내보낸다(기존 화면 호환). */
      const kindRaw = (url.searchParams.get("kind") || "").trim();
      const kind = kindRaw === "support" ? "support" : "tribute";

      const scope = teacherId
        ? and(eq(memorialMessages.teacherId, teacherId), eq(memorialMessages.isHidden, false))
        : and(
            isNull(memorialMessages.teacherId),
            eq(memorialMessages.isHidden, false),
            eq(memorialMessages.kind, kind),
          );

      const rows = await db
        .select({
          id:         memorialMessages.id,
          memberId:   memorialMessages.memberId,   /* US-028: isMine 판정용(응답엔 미포함 — 익명성 유지) */
          authorName: memorialMessages.authorName,
          content:    memorialMessages.content,
          likeCount:  memorialMessages.likeCount,
          isAnonymous: memorialMessages.isAnonymous,
          createdAt:  memorialMessages.createdAt,
        })
        .from(memorialMessages)
        .where(scope)
        .orderBy(desc(memorialMessages.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset);

      /* 총 개수 */
      let total = 0;
      try {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(memorialMessages).where(scope);
        total = Number(n) || 0;
      } catch (err) { console.warn("[memorial-messages] total 실패", err); }

      /* 로그인 회원이면 공감 여부 표시 */
      const likedSet = new Set<number>();
      const user = authenticateUser(req);
      if (user && rows.length) {
        try {
          const ids = rows.map((r) => r.id);
          const likes = await db
            .select({ messageId: memorialMessageLikes.messageId })
            .from(memorialMessageLikes)
            .where(and(eq(memorialMessageLikes.memberId, user.uid), inArray(memorialMessageLikes.messageId, ids)));
          for (const l of likes) likedSet.add(l.messageId);
        } catch (err) { console.warn("[memorial-messages] liked 조회 실패", err); }
      }

      const messages = rows.map((r) => ({
        id:        r.id,
        authorName: r.authorName,
        content:   r.content,
        likeCount: r.likeCount,
        createdAt: r.createdAt,
        liked:     likedSet.has(r.id),
        /* US-028: 로그인 회원이 본인 글을 식별해 삭제 버튼을 띄울 수 있도록 isMine만 노출(memberId는 미노출) */
        isMine:    !!(user && r.memberId === user.uid),
      }));

      return new Response(jsonKST({
        ok: true,
        data: { messages, pagination: { page, total, hasMore: page * PAGE_SIZE < total } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("select_messages", err);
    }
  }

  /* ───────────── POST: 작성·공감·신고 (회원만) ───────────── */
  if (method === "POST") {
    const action = url.searchParams.get("action");
    const id = parseInt(url.searchParams.get("id") || "0", 10);

    /* ★ 2026-08-28: 마음 남기기는 로그인 없이도 된다.
       추모관에 온 분의 마음은 몇 초짜리라, 그 순간에 가입 절차를 요구하면
       회원이 되는 게 아니라 그냥 떠난다. 남긴 뒤에 가입을 권하는 편이 낫다.
       공감·신고·삭제는 누가 했는지 남아야 하므로 종전대로 회원만 할 수 있다. */
    const needsMember = action === "like" || action === "report" || action === "delete";
    let user: import("../../lib/auth").UserPayload | null = null;

    if (needsMember) {
      const guard = await requireActiveUser(req);
      if (!guard.ok) return (guard as { ok: false; res: Response }).res;
      user = (guard as { ok: true; user: import("../../lib/auth").UserPayload }).user;
    } else if (extractToken(req)) {
      /* 로그인 흔적이 있으면 회원으로 받되, 토큰이 만료된 것뿐이면 익명으로 받는다.
         단 차단된 분은 익명으로도 남길 수 없다. */
      const guard = await requireActiveUser(req);
      if (guard.ok) {
        user = (guard as { ok: true; user: import("../../lib/auth").UserPayload }).user;
      } else {
        const blocked = (guard as { ok: false; res: Response }).res;
        if (blocked && blocked.status === 403) return blocked;
      }
    }

    /* 공감 토글 */
    if (action === "like") {
      if (!id) return new Response(jsonKST({ ok: false, error: "id가 필요합니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
      try {
        /* R41 Q2-047: 존재·미숨김 메시지에만 공감 허용 (삭제·숨김 글에 고아 좋아요 방지) */
        const [msg] = await db.select({ id: memorialMessages.id, isHidden: memorialMessages.isHidden })
          .from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        if (!msg || msg.isHidden) {
          return new Response(jsonKST({ ok: false, error: "대상 메시지를 찾을 수 없습니다" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        const existing = await db
          .select({ id: memorialMessageLikes.id })
          .from(memorialMessageLikes)
          .where(and(eq(memorialMessageLikes.messageId, id), eq(memorialMessageLikes.memberId, user.uid)))
          .limit(1);

        let liked: boolean;
        if (existing.length) {
          await db.delete(memorialMessageLikes)
            .where(and(eq(memorialMessageLikes.messageId, id), eq(memorialMessageLikes.memberId, user.uid)));
          liked = false;
        } else {
          await db.insert(memorialMessageLikes).values({ messageId: id, memberId: user.uid });
          liked = true;
        }

        /* 실제 공감 수로 재동기화 (drift 방지) */
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
          .from(memorialMessageLikes).where(eq(memorialMessageLikes.messageId, id));
        const likeCount = Number(n) || 0;
        const setLike: any = { likeCount };
        await db.update(memorialMessages).set(setLike).where(eq(memorialMessages.id, id));

        return new Response(jsonKST({ ok: true, data: { likeCount, liked } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("like", err);
      }
    }

    /* 신고 */
    if (action === "report") {
      if (!id) return new Response(jsonKST({ ok: false, error: "id가 필요합니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
      try {
        /* R41 Q2-047: 존재하는 메시지에만 신고 누적 */
        const [msg] = await db.select({ id: memorialMessages.id, memberId: memorialMessages.memberId })
          .from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        if (!msg) {
          return new Response(jsonKST({ ok: false, error: "대상 메시지를 찾을 수 없습니다" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        /* US-030: 본인 글 신고 차단 */
        if (msg.memberId === user.uid) {
          return new Response(jsonKST({ ok: false, error: "본인이 작성한 글은 신고할 수 없습니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        /* US-030: 1인 1신고 멱등 — memorial_report_logs UNIQUE(member_id,ref_table,ref_id).
           마이그(migrate-r45-memorial-report-log) 적용 전이면 테이블이 없어 catch로 degrade(기존 동작). */
        let alreadyReported = false;
        try {
          const ins: any = await db.execute(sql`
            INSERT INTO memorial_report_logs (member_id, ref_table, ref_id)
            VALUES (${user.uid}, 'memorial_messages', ${id})
            ON CONFLICT (member_id, ref_table, ref_id) DO NOTHING
            RETURNING id
          `);
          const insRows = ins?.rows ?? ins ?? [];
          alreadyReported = insRows.length === 0;
        } catch (e) {
          console.warn("[memorial-messages] report dedup 생략(테이블 미존재 가능)", e);
        }
        if (alreadyReported) {
          return new Response(jsonKST({ ok: true, message: "이미 신고하신 글입니다." }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
        const setReport: any = { reportCount: sql`${memorialMessages.reportCount} + 1` };
        await db.update(memorialMessages)
          .set(setReport)
          .where(eq(memorialMessages.id, id));
        return new Response(jsonKST({ ok: true, message: "신고가 접수되었습니다. 운영자가 확인합니다." }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("report", err);
      }
    }

    /* US-028: 본인 추모 메시지 삭제 (작성자 본인만) */
    if (action === "delete") {
      if (!id) return new Response(jsonKST({ ok: false, error: "id가 필요합니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
      try {
        const [msg] = await db.select({ id: memorialMessages.id, memberId: memorialMessages.memberId })
          .from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        if (!msg) {
          return new Response(jsonKST({ ok: false, error: "대상 메시지를 찾을 수 없습니다" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        if (msg.memberId !== user.uid) {
          return new Response(jsonKST({ ok: false, error: "본인이 작성한 글만 삭제할 수 있습니다" }), { status: 403, headers: { "Content-Type": "application/json" } });
        }
        await db.delete(memorialMessageLikes).where(eq(memorialMessageLikes.messageId, id));
        await db.delete(memorialMessages).where(and(eq(memorialMessages.id, id), eq(memorialMessages.memberId, user.uid)));
        return new Response(jsonKST({ ok: true, message: "추모 메시지가 삭제되었습니다." }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("delete", err);
      }
    }

    /* 작성 */
    let body: any;
    try { body = await req.json(); } catch { body = {}; }
    const content = (body.content || "").toString().trim();
    const isAnonymous = !!body.isAnonymous;
    const bodyTeacherId: number | null = body.teacherId ? Number(body.teacherId) : null;

    if (!content) {
      return new Response(jsonKST({ ok: false, error: "추모 메시지를 입력해 주세요" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (content.length > 1000) {
      return new Response(jsonKST({ ok: false, error: "메시지는 1000자 이내로 작성해 주세요" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    /* ★ 2026-08-28 도배 방지 — 로그인하지 않은 분만.
       같은 기기가 잇달아 올리는 것을 막는다. 회원은 누가 썼는지 남으므로 제외. */
    const ipHash = user ? null : clientIpHash(req);
    if (!user) {
      try {
        const recent: any = await db.execute(sql`
          SELECT 1 FROM memorial_messages
          WHERE member_id IS NULL AND ip_hash = ${ipHash}
            AND created_at > NOW() - (${ANON_COOLDOWN_SECONDS} * INTERVAL '1 second')
          LIMIT 1
        `);
        const hit = (recent?.rows ?? recent ?? []) as any[];
        if (hit.length > 0) {
          return new Response(jsonKST({
            ok: false,
            error: `조금 전에 마음을 남기셨습니다. ${ANON_COOLDOWN_SECONDS}초 뒤에 다시 남겨주세요.`,
          }), { status: 429, headers: { "Content-Type": "application/json" } });
        }
      } catch (err) {
        /* 확인 자체가 실패하면 막지 않는다 — 정상 참여를 놓치지 않기 위해 */
        console.warn("[memorial-messages] 도배 확인 실패", err);
      }
    }

    try {
      /* 이름 — 회원은 계정 이름, 비회원은 적어 주신 이름(비우면 익명) */
      const typedName = String(body.authorName || "").trim().slice(0, 40);
      const authorName = isAnonymous
        ? "익명"
        : (user ? (user.name || "회원") : (typedName || "익명"));

      /* R41 Q2-013: 추모 글 AI 사전 검토 — 부적절 시 비공개 보류 + 운영자 통지.
         ★ 2026-08-28: 회원 글은 종전대로 '못 봤으면 통과'(정상 글을 막지 않기 위해).
         하지만 로그인하지 않은 글은 반대로 '못 봤으면 보류'다.
         유가족이 직접 읽는 자리라, 아무도 안 본 글이 그대로 나가면 안 된다. */
      const mod = await moderateMemorialText(content, { thorough: !user });
      const holdForReview = mod.flagged || (!user && !mod.checked);
      const holdReason = mod.flagged
        ? (mod.reason || "부적절 판단")
        : mod.skipReason === "budget"
          ? "AI 검토 예산이 소진되어 보류 (비회원 작성)"
          : "자동 검토를 하지 못해 보류 (비회원 작성)";

      /* ★ 2026-08-28: 선생님을 지정한 글은 언제나 '추모'다.
         통합 글만 밤(추모)·아침(응원)으로 나뉜다. */
      const bodyKind = (body.kind || "").toString().trim();
      const kindToSave = (!bodyTeacherId && bodyKind === "support") ? "support" : "tribute";

      const insertData: any = {
        teacherId: bodyTeacherId ?? undefined,
        memberId: user ? user.uid : null,
        authorName,
        content,
        isAnonymous,
        kind: kindToSave,
        ipHash,
        isHidden: holdForReview ? true : undefined,
      };
      const [row] = await db.insert(memorialMessages).values(insertData).returning();

      if (holdForReview) {
        /* 보류 → 운영자·슈퍼어드민에게 검토 요청 통지 (fire-and-forget) */
        notifyAllOperators({
          category: "support",
          severity: "warning",
          title: mod.skipReason === "budget"
            ? "AI 검토 예산 소진 — 비회원 글이 보류되고 있습니다"
            : "추모 메시지 자동 보류 — 검토 필요",
          message: mod.skipReason === "budget"
            ? `AI 검토 예산이 바닥나 비회원 글을 자동으로 확인하지 못하고 있습니다. ` +
              `그동안 들어오는 비회원 글은 모두 비공개로 보류됩니다. ` +
              `예산을 늘리거나, 보류된 글을 직접 확인해 공개해 주세요.`
            : `비공개로 보류했습니다. (사유: ${holdReason})`,
          link: `/admin.html#memorial`,
          refTable: "memorial_messages",
          refId: row.id,
        }).catch(() => {});
      }

      return new Response(jsonKST({
        ok: true,
        data: { message: {
          id: row.id,
          authorName: row.authorName,
          content: row.content,
          likeCount: row.likeCount,
          createdAt: row.createdAt,
          liked: false,
          pendingReview: holdForReview,
        } },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("insert_message", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
