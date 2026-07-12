// netlify/functions/board-create.ts
// Phase M-8: 게시글 작성 (로그인 필수)

import { yearKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts, members } from "../../db/schema";
import { authenticateUser, requireActiveUser } from "../../lib/auth";
import {
  created, badRequest, unauthorized, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/board/create" };

const VALID_CATEGORIES = ["general", "share", "question", "info", "etc"];

function genPostNo(): string {
  const y = yearKST();
  const r = String(Math.floor(Math.random() * 9000) + 1000);
  return `B-${y}-${r}`;
}

// Q2-049: 저장형 XSS 표면 완화 — 새 의존성 없이 경량 정화
// <script> 블록 / on*= 이벤트 핸들러 속성 / javascript: 스킴 제거
function sanitizeContentHtml(html: string): string {
  return String(html || "")
    // <script ...> ... </script> 통째 제거 (대소문자 무시·줄바꿈 포함)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    // 닫는 태그 없는 잔여 <script ...> 단독 태그 제거
    .replace(/<script\b[^>]*>/gi, "")
    // on이벤트="..." / on이벤트='...' / on이벤트=값 형태의 이벤트 핸들러 속성 제거
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    // javascript: 스킴 제거 (href/src 등) — 사이 공백·제어문자 허용
    .replace(/javascript\s*:/gi, "");
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 인증 + 차단 검증 (5순위 #1) */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const user = _r.user;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const category = VALID_CATEGORIES.includes(body.category) ? body.category : "general";
    const title = String(body.title || "").trim().slice(0, 200);
    // Q2-049: 저장 전 경량 정화 적용
    const contentHtml = sanitizeContentHtml(String(body.contentHtml || "").trim());
    const isAnonymous = !!body.isAnonymous;
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((x: any) => Number.isFinite(Number(x))).map(Number)
      : [];

    if (!title) return badRequest("제목은 필수입니다");
    if (!contentHtml || contentHtml.length < 5) return badRequest("내용을 5자 이상 입력해주세요");
    if (contentHtml.length > 100000) return badRequest("내용이 너무 깁니다");

    const [me] = await db.select().from(members).where(eq(members.id, user.uid)).limit(1);
    const authorName = isAnonymous ? "익명" : (me as any)?.name || "회원";

    /* Q2-041: postNo UNIQUE 충돌 시 최대 5회까지 재생성·재시도 (랜덤 번호 충돌로 작성 실패 방지) */
    let record: any = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const insertData: any = {
        postNo: genPostNo(),
        memberId: user.uid,
        authorName,
        category,
        title,
        contentHtml,
        attachmentIds: attachmentIds.length ? JSON.stringify(attachmentIds) : null,
        isAnonymous,
      };
      try {
        const rows = await db.insert(boardPosts).values(insertData).returning();
        record = rows[0];
        break;
      } catch (err: any) {
        lastErr = err;
        // UNIQUE 위반(postgres 코드 23505 또는 메시지 내 duplicate)이면 새 번호로 재시도, 그 외 즉시 throw
        const code = String(err?.code || "");
        const msg = String(err?.message || "").toLowerCase();
        if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
          continue;
        }
        throw err;
      }
    }
    if (!record) throw lastErr || new Error("게시글 번호 생성 실패");

    try {
      await logUserAction(req, user.uid, (me as any)?.name || "unknown", "board_post_create", {
        target: (record as any).postNo,
        detail: { category, isAnonymous },
        success: true,
      });
    } catch (_) {}

    return created({
      postId: (record as any).id,
      postNo: (record as any).postNo,
    }, "게시글이 등록되었습니다");
  } catch (e: any) {
    console.error("[board-create]", e);
    return serverError("작성 실패", e);
  }
};