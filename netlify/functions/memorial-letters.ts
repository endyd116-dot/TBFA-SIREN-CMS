import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialLetters, memorialOfferings } from "../../db/schema";
import { requireActiveUser, authenticateUser, extractToken } from "../../lib/auth";
import { clientIpHash } from "../../lib/client-ip";
import { moderateMemorialText } from "../../lib/memorial-moderation";
import { notifyAllOperators } from "../../lib/notify";
import { saveLetterExtras, anonLetterRecently } from "../../lib/memorial-letter-extras";
import {
  letterPhotoReady, verifyPhotoToken, findAttachablePhoto, insertLetterWithPhoto,
  claimLetterPhoto, hidePhotoOfLetter, photoUrlOf,
} from "../../lib/memorial-letter-photo";
import { eq, and, desc, sql } from "drizzle-orm";

export const config = { path: "/api/memorial-letters" };

/* ★ 2026-10-07: 로그인하지 않은 분의 연속 작성 간격 (도배 방지 — 한마디와 같은 60초) */
const ANON_COOLDOWN_SECONDS = 60;
const MAX_CONTENT = 5000;

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "기억의 편지 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function bad(msg: string, status = 400) {
  return new Response(jsonKST({ ok: false, error: msg }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  /* ───────────── GET: 공개 목록 (teacherId 필수) ───────────── */
  if (method === "GET") {
    const teacherId = parseInt(url.searchParams.get("teacherId") || "0", 10);
    if (!teacherId) return bad("teacherId 파라미터가 필요합니다");
    try {
      /* ★ 2026-11-12 사진 첨부 — 저장 칸이 준비됐을 때만 사진 칸을 함께 읽고,
         «사진 검토 대기» 편지는 운영자가 확인하기 전까지 목록에서 뺀다.
         칸이 없으면(마이그 전) 예전과 똑같은 조회다. */
      const photoReady = await letterPhotoReady();
      const baseFields = {
        id:         memorialLetters.id,
        memberId:   memorialLetters.memberId,   /* US-028: isMine 판정용(응답엔 미포함) */
        authorName: memorialLetters.authorName,
        title:      memorialLetters.title,
        content:    memorialLetters.content,
        createdAt:  memorialLetters.createdAt,
      };
      const fields: any = photoReady
        ? {
            ...baseFields,
            photoBlobId: sql<number | null>`photo_blob_id`,
            photoReview: sql<string | null>`photo_review`,
          }
        : baseFields;
      const visible = photoReady
        ? and(
            eq(memorialLetters.teacherId, teacherId),
            eq(memorialLetters.isHidden, false),
            sql`photo_review IS DISTINCT FROM 'pending'`,
          )
        : and(eq(memorialLetters.teacherId, teacherId), eq(memorialLetters.isHidden, false));
      const rows: any[] = await db
        .select(fields)
        .from(memorialLetters)
        .where(visible)
        .orderBy(desc(memorialLetters.createdAt));

      /* US-028: 로그인 회원이 본인 편지를 식별하도록 isMine만 노출(memberId는 제외) */
      const viewer = authenticateUser(req);
      const letters = rows.map((r) => ({
        id: r.id,
        authorName: r.authorName,
        title: r.title,
        content: r.content,
        createdAt: r.createdAt,
        isMine: !!(viewer && r.memberId === viewer.uid),
        /* 운영자가 사진과 함께 공개한 편지만 사진 주소가 실린다(봉투 표지·크게 보기) */
        photoUrl: photoReady && r.photoReview === "approved" ? photoUrlOf(r.photoBlobId) : null,
      }));

      /* photoEnabled: 화면이 «사진 1장 붙이기» 칸을 보여줄지 정한다(마이그 전에는 감춘다) */
      return new Response(jsonKST({ ok: true, data: { letters, photoEnabled: photoReady } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_letters", err);
    }
  }

  /* ───────────── POST: 작성(누구나) · 삭제(본인 회원만) ───────────── */
  if (method === "POST") {
    const action = url.searchParams.get("action");

    /* ★ 2026-10-07: 편지도 로그인 없이 보낼 수 있다 (정책국장 요청 — 30통 목표).
       추모관에 온 분의 마음은 몇 분짜리라, 그 순간에 가입 절차를 요구하면 그냥 떠난다.
       삭제는 누가 했는지 남아야 하므로 종전대로 회원만 할 수 있다. */
    const needsMember = action === "delete";
    let user: import("../../lib/auth").UserPayload | null = null;

    if (needsMember) {
      const guard = await requireActiveUser(req);
      if (!guard.ok) return (guard as { ok: false; res: Response }).res;
      user = (guard as { ok: true; user: import("../../lib/auth").UserPayload }).user;
    } else if (extractToken(req)) {
      /* 로그인 흔적이 있으면 회원으로 받되, 토큰이 만료된 것뿐이면 익명으로 받는다.
         단 차단된 분은 익명으로도 보낼 수 없다. */
      const guard = await requireActiveUser(req);
      if (guard.ok) {
        user = (guard as { ok: true; user: import("../../lib/auth").UserPayload }).user;
      } else {
        const blocked = (guard as { ok: false; res: Response }).res;
        if (blocked && blocked.status === 403) return blocked;
      }
    }

    /* US-028: 본인 편지 삭제 (작성자 본인만) */
    if (action === "delete") {
      const lid = parseInt(url.searchParams.get("id") || "0", 10);
      if (!lid) return bad("id가 필요합니다");
      try {
        const [letter] = await db.select({ id: memorialLetters.id, memberId: memorialLetters.memberId })
          .from(memorialLetters).where(eq(memorialLetters.id, lid)).limit(1);
        if (!letter) return bad("대상 편지를 찾을 수 없습니다", 404);
        if (letter.memberId !== user!.uid) return bad("본인이 작성한 편지만 삭제할 수 있습니다", 403);
        await db.delete(memorialLetters).where(and(eq(memorialLetters.id, lid), eq(memorialLetters.memberId, user!.uid)));
        /* ★ 2026-11-12: 편지에 붙어 있던 사진도 더는 주소로 볼 수 없게 비공개로 돌린다 */
        await hidePhotoOfLetter(lid);
        return new Response(jsonKST({ ok: true, message: "편지가 삭제되었습니다." }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("delete_letter", err);
      }
    }

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const teacherId: number = body.teacherId ? Number(body.teacherId) : 0;
    /* 제목 자리에는 고른 질문 카드가 들어온다 (정책국장 기획: 질문이 곧 주제) */
    const title = (body.title || "").toString().trim().slice(0, 150) || null;
    const content = (body.content || "").toString().trim();
    const isAnonymous = !!body.isAnonymous;
    const publishConsent = !!body.publishConsent;
    const invited = !!body.invited;

    if (!teacherId) return bad("어느 선생님께 드리는 편지인지 지정해 주세요");
    if (!content) return bad("편지 내용을 입력해 주세요");
    if (content.length > MAX_CONTENT) return bad(`편지는 ${MAX_CONTENT.toLocaleString("ko-KR")}자 이내로 적어주세요`);

    /* ★ 2026-11-12 사진 한 장 (Swain 결정: 누구나 붙일 수 있고, 사진 편지는 운영자가 확인한 뒤 공개).
       사진은 먼저 /api/memorial-letter-photo 로 올리고, 받은 번호·확인표를 함께 낸다.
       확인하는 것: 저장 칸 준비 · 올린 사람의 확인표 · 이 경로로 6시간 안에 올라왔고 아직 어느 편지에도 안 붙은 사진 */
    const photoBlobId = Number(body.photoBlobId || 0);
    const hasPhoto = Number.isFinite(photoBlobId) && photoBlobId > 0;
    if (hasPhoto) {
      try {
        if (!(await letterPhotoReady())) {
          return bad("사진 첨부는 준비 중입니다. 사진을 지우고 편지만 보내 주세요.");
        }
        const tokenOk = verifyPhotoToken(photoBlobId, body.photoToken);
        if (!tokenOk || !(await findAttachablePhoto(photoBlobId))) {
          /* photoInvalid: 화면이 붙여 둔 사진을 새로 올리도록 기억을 지운다 */
          return new Response(jsonKST({
            ok: false,
            error: "붙인 사진을 확인하지 못했습니다(시간이 오래 지났거나 이미 보낸 사진입니다). 사진을 지우고 다시 붙여 주세요.",
            photoInvalid: true,
          }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
      } catch (err: any) {
        return jsonError("check_photo", err);
      }
    }

    /* ★ 도배 방지 — 로그인하지 않은 분만. 같은 기기가 잇달아 보내는 것을 막는다. */
    const ipHash = clientIpHash(req);
    if (!user && await anonLetterRecently(ipHash, ANON_COOLDOWN_SECONDS)) {
      return bad(`조금 전에 편지를 보내셨습니다. ${ANON_COOLDOWN_SECONDS}초 뒤에 다시 보내주세요.`, 429);
    }

    try {
      /* 이름 — 적어 주신 '보내는 이'가 있으면 그것을, 없으면 회원은 계정 이름, 비회원은 익명 */
      const typedName = String(body.authorName || "").trim().slice(0, 50);
      const authorName = isAnonymous
        ? "익명"
        : (typedName || (user ? (user.name || "회원") : "익명"));

      /* R41 Q2-013: 추모 글 AI 사전 검토 — 부적절 시 비공개 보류 + 운영자 통지.
         ★ 2026-10-07: 회원 글은 '못 봤으면 통과'(정상 글을 막지 않기 위해),
         로그인하지 않은 글은 '못 봤으면 보류' — 한마디와 같은 원칙(유가족이 읽는 자리). */
      const mod = await moderateMemorialText(`${title || ""}\n${content}`, { thorough: !user });
      const holdForReview = mod.flagged || (!user && !mod.checked);
      const holdReason = mod.flagged
        ? (mod.reason || "부적절 판단")
        : mod.skipReason === "budget"
          ? "AI 검토 예산이 소진되어 보류 (비회원 작성)"
          : "자동 검토를 하지 못해 보류 (비회원 작성)";

      /* 사진이 붙은 편지는 처음부터 «사진 검토 대기»로 한 번에 저장한다(잠깐이라도 공개 목록에 뜨지 않게).
         글만 있는 편지는 예전과 똑같이 저장한다. */
      let row: any;
      if (hasPhoto) {
        row = await insertLetterWithPhoto({
          teacherId,
          memberId: user ? user.uid : null,
          authorName,
          title,
          content,
          isAnonymous,
          isHidden: holdForReview,
          photoBlobId,
        });
      } else {
        const insertData: any = {
          teacherId,
          memberId: user ? user.uid : null,
          authorName,
          title: title ?? undefined,
          content,
          isAnonymous,
          isHidden: holdForReview ? true : undefined,
        };
        [row] = await db.insert(memorialLetters).values(insertData).returning();
      }

      /* 사진을 이 편지 몫으로 묶는다 — 같은 사진이 다른 편지에 다시 붙지 않게 */
      const photoAttached = hasPhoto ? await claimLetterPhoto(photoBlobId, row.id) : false;

      /* 더해진 칸 — 출판 동의·질문·초대 경로. 저장소 준비 전이면 조용히 건너뛴다 */
      const extrasSaved = await saveLetterExtras(row.id, {
        publishConsent,
        meta: {
          topic: title,
          invited,
          anonymousWriter: !user,
          source: "web",
          /* 앞으로 음성 편지·손편지 사진이 붙을 자리 */
          attachments: [],
        },
        ipHash: user ? null : ipHash,
      });

      /* ★ 편지 한 통 = 별빛 하나. 밤하늘(메인)·이 선생님 첫 화면의 별에도 함께 센다.
         실패해도 편지는 이미 도착했으므로 조용히 넘어간다. */
      try {
        const offering: any = {
          teacherId,
          memberId: user ? user.uid : undefined,
          nickname: isAnonymous ? undefined : authorName,
          offeringType: "candle",
          ipHash,
        };
        await db.insert(memorialOfferings).values(offering);
      } catch (err) {
        console.warn("[memorial-letters] 별빛 반영 실패", err);
      }

      /* ★ 2026-11-12: 알림은 응답을 돌려주기 전에 끝낸다 — 응답 뒤에 남은 일은 함수가 멈추며 끊겨 유실된다
         (2026-11-01 해지 운영자 알림 유실과 같은 함정). 알림이 실패해도 편지는 이미 도착했다. */
      if (hasPhoto) {
        /* 사진 편지 → 운영자 확인 요청 (글 자동 검토에서 보류됐으면 그 사유도 함께) */
        try {
          await notifyAllOperators({
            category: "support",
            severity: "warning",
            title: "사진이 붙은 기억의 편지 — 확인 후 공개해 주세요",
            message:
              `사진이 붙은 편지가 도착했습니다(편지 #${row.id}). 운영자가 확인하기 전에는 공개되지 않습니다. ` +
              `통합 CMS › 온라인 추모관 › 메시지·편지 모더레이션의 «사진 편지 검토 대기»에서 ` +
              `[공개]·[사진 빼고 공개]·[숨김] 중 하나를 눌러 주세요.` +
              (holdForReview ? ` 글 자동 검토 결과: 보류(${holdReason}).` : ""),
            link: `/cms-tbfa.html#memorial`,
            refTable: "memorial_letters",
            refId: row.id,
          });
        } catch (err) {
          console.warn("[memorial-letters] 사진 편지 알림 실패", err);
        }
      } else if (holdForReview) {
        /* 보류 → 운영자·슈퍼어드민에게 검토 요청 통지 */
        try {
          await notifyAllOperators({
            category: "support",
            severity: "warning",
            title: mod.skipReason === "budget"
              ? "AI 검토 예산 소진 — 비회원 편지가 보류되고 있습니다"
              : "기억의 편지 자동 보류 — 검토 필요",
            message: mod.skipReason === "budget"
              ? `AI 검토 예산이 바닥나 비회원 편지를 자동으로 확인하지 못하고 있습니다. ` +
                `그동안 들어오는 비회원 편지는 모두 비공개로 보류됩니다. ` +
                `예산을 늘리거나, 보류된 편지를 직접 확인해 공개해 주세요.`
              : `비공개로 보류했습니다. (사유: ${holdReason})`,
            link: `/admin.html#memorial`,
            refTable: "memorial_letters",
            refId: row.id,
          });
        } catch (err) {
          console.warn("[memorial-letters] 보류 알림 실패", err);
        }
      }

      return new Response(jsonKST({
        ok: true,
        data: { letter: {
          id: row.id,
          authorName: row.authorName,
          title: row.title,
          content: row.content,
          createdAt: row.createdAt,
          /* 사진 편지는 운영자가 확인하기 전까지 공개 목록에 없다 */
          pendingReview: holdForReview || hasPhoto,
          /* ★ 2026-11-12: 사진 때문에 확인을 기다리는지 — 화면이 «확인 뒤 공개» 안내를 띄운다 */
          photoPending: hasPhoto,
          photoAttached,
          publishConsent: extrasSaved ? publishConsent : false,
          extrasSaved,
        } },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("insert_letter", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
