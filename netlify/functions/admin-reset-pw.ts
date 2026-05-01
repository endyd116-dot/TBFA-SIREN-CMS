/**
 * POST /api/admin-reset-pw?key=SECRET
 * 관리자 비밀번호를 ADMIN_DEFAULT_PW 환경변수 값으로 재해싱
 * - 보안: ADMIN_DEFAULT_PW 일치해야 실행 (key로 전달)
 * - 1회용 — 사용 후 파일 삭제 권장
 */
import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import { hashPassword } from "../../lib/auth";
import {
  ok, forbidden, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    const expected = process.env.ADMIN_DEFAULT_PW || "";

    if (!key || !expected || key !== expected) {
      return forbidden("권한이 없습니다");
    }

    /* admin@siren-org.kr 계정의 비밀번호를 ADMIN_DEFAULT_PW로 재해싱 */
    const adminEmail = "admin@siren-org.kr";
    const passwordHash = await hashPassword(expected);

    const updated = await db
      .update(members)
      .set({
        passwordHash: passwordHash,
        loginFailCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(members.email, adminEmail))
      .returning({ id: members.id, email: members.email, name: members.name });

    if (updated.length === 0) return notFound("관리자 계정 없음");

    return ok(
      { admin: updated[0] },
      "관리자 비밀번호가 재설정되었습니다. 즉시 이 함수 파일을 삭제하세요."
    );
  } catch (err) {
    console.error("[admin-reset-pw]", err);
    return serverError("재설정 실패", err);
  }
};

export const config = { path: "/api/admin-reset-pw" };