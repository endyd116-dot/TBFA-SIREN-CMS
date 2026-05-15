// netlify/functions/admin-me-update.ts
//
// PATCH /api/admin-me-update
//
// 어드민 본인 정보 수정 — 이름·이메일·전화·비밀번호.
// 모든 관리자(super_admin·operator) 본인에 한해 자기 데이터만 수정 가능.
//
// 요청 body (모든 필드 선택):
//   { name?, email?, phone?,
//     currentPassword?, newPassword? }
//
// 비밀번호 변경 규칙:
//   - newPassword 입력 시 currentPassword 필수 (재인증)
//   - newPassword는 8자 이상, 현재 비밀번호와 달라야 함

import { eq, and, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-me-update" };

const JSON_HEADER = { "Content-Type": "application/json" };
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADER });
}
function badRequest(msg: string) { return json({ ok: false, error: msg }, 400); }
function conflict(msg: string)   { return json({ ok: false, error: msg }, 409); }
function serverError(step: string, err: any) {
  return json({
    ok: false,
    error: "정보 변경 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
  }, 500);
}

function normalizePhone(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 11) return null;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

export default async function handler(req: Request) {
  if (req.method !== "PATCH" && req.method !== "POST") {
    return json({ ok: false, error: "PATCH 또는 POST만 허용" }, 405);
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  /* admin uid 추출 — admin-guard 컨텍스트 표준 */
  const adminId = (auth as any).ctx?.admin?.uid;
  if (!adminId) {
    return serverError("auth_uid_missing", "어드민 식별자(uid)를 받지 못했습니다");
  }

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return badRequest("요청 본문이 JSON이 아닙니다");
  }

  /* 변경할 필드 누적 */
  const updates: Record<string, any> = {};

  /* ── 이름 ── */
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 50) {
      return badRequest("이름은 2~50자 사이여야 합니다");
    }
    updates.name = name;
  }

  /* ── 이메일 ── */
  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return badRequest("이메일 형식이 올바르지 않습니다");
    }
    /* 본인 제외 중복 확인 */
    try {
      const [dup] = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.email, email), ne(members.id, adminId)))
        .limit(1);
      if (dup) return conflict("이미 사용 중인 이메일입니다");
    } catch (err) {
      return serverError("email_dup_check", err);
    }
    updates.email = email;
  }

  /* ── 전화번호 ── */
  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === "") {
      updates.phone = null;
    } else if (typeof body.phone === "string") {
      const phone = normalizePhone(body.phone);
      if (!phone) return badRequest("전화번호 형식이 올바르지 않습니다 (예: 010-1234-5678)");
      try {
        const [dup] = await db
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.phone, phone), ne(members.id, adminId)))
          .limit(1);
        if (dup) return conflict("이미 사용 중인 연락처입니다");
      } catch (err) {
        return serverError("phone_dup_check", err);
      }
      updates.phone = phone;
    }
  }

  /* ── 비밀번호 변경 ── */
  if (body.newPassword) {
    if (!body.currentPassword) {
      return badRequest("비밀번호 변경 시 현재 비밀번호를 입력해 주세요");
    }
    if (typeof body.newPassword !== "string" || body.newPassword.length < 8) {
      return badRequest("새 비밀번호는 8자 이상이어야 합니다");
    }
    /* 본인 비밀번호 해시 조회 */
    let me: { id: number; passwordHash: string } | undefined;
    try {
      [me] = await db
        .select({ id: members.id, passwordHash: members.passwordHash })
        .from(members)
        .where(eq(members.id, adminId))
        .limit(1);
    } catch (err) {
      return serverError("password_select", err);
    }
    if (!me) return badRequest("회원을 찾을 수 없습니다");

    const valid = await bcrypt.compare(String(body.currentPassword), me.passwordHash);
    if (!valid) return badRequest("현재 비밀번호가 일치하지 않습니다");

    const sameAsBefore = await bcrypt.compare(String(body.newPassword), me.passwordHash);
    if (sameAsBefore) return badRequest("새 비밀번호가 현재 비밀번호와 동일합니다");

    updates.passwordHash = await bcrypt.hash(String(body.newPassword), BCRYPT_ROUNDS);
  }

  if (Object.keys(updates).length === 0) {
    return badRequest("변경할 내용이 없습니다");
  }

  /* ── UPDATE 실행 ── */
  try {
    await db.update(members).set(updates).where(eq(members.id, adminId));
  } catch (err) {
    return serverError("update", err);
  }

  /* 응답 — 비밀번호 해시는 절대 노출 안 함 */
  const changed: string[] = [];
  if (updates.name)         changed.push("이름");
  if (updates.email)        changed.push("이메일");
  if (updates.phone !== undefined) changed.push("연락처");
  if (updates.passwordHash) changed.push("비밀번호");

  return json({
    ok: true,
    message: `${changed.join("·")} 변경 완료`,
    changedFields: changed,
  });
}
