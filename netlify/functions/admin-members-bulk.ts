// netlify/functions/admin-members-bulk.ts
// 통합 CMS «외부 등록 › 신규 회원 일괄 등록» 실제 저장 API (2026-09-06)
//   그동안 이 탭의 [등록] 버튼은 화면에서만 등록된 척하는 시연 코드였다(서버 저장 0). 이제 진짜로 넣는다.
//
// POST /api/admin-members-bulk   body { rows:[{ name, phone, email?, type?, joinedAt?, memo? }], dryRun? }
//   - 전화번호(숫자 비교) → 이메일 순으로 기존 회원을 찾는다. 있으면 «병합»(이름·이메일은 그대로, 메모만 덧붙임 · 새 회원 생성 0)
//   - 없으면 생성: 가입경로 'admin'(수기) · 임시 비밀번호 · 이메일이 없으면 자리표시 이메일(bulk_<전화>@noemail.siren.local)
//   - 회원유형: 유족→family(pending) · 후원→regular(sponsor) · 봉사→volunteer · 일반/기타→regular
//   → { ok, data:{ total, created, merged, skipped, errors:[{row,error}], createdIds } }
// 권한: 통합 회원 관리(siren_member)

import { eq, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { hashPassword } from "../../lib/auth";
import { classifyForSignup } from "../../lib/member-classifier";
import { logAdminAction } from "../../lib/audit";
import { findMemberIdsByPhones, phoneDigits } from "../../lib/member-match";
import { ok, badRequest, forbidden, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-members-bulk" };

const MAX_ROWS = 2000;

function normalizePhone(phone: string): string | null {
  const d = phoneDigits(phone);
  if (!/^\d{10,11}$/.test(d)) return null;
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

function mapType(label: string): "regular" | "family" | "volunteer" {
  const s = String(label || "").trim().toLowerCase();
  if (/유족|family/.test(s)) return "family";
  if (/봉사|volunteer/.test(s)) return "volunteer";
  return "regular";
}

function parseDate(v: any): Date | null {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s.replace(/\./g, "-").replace(/\//g, "-"));
  return isNaN(d.getTime()) ? null : d;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;
  if (!(await canAccess(String(adminMember?.role || ""), "siren_member"))) return forbidden("회원 등록 권한이 없습니다");

  try {
    const body = await parseJson(req);
    const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
    const dryRun = body?.dryRun === true;
    if (rows.length === 0) return badRequest("등록할 행이 없습니다");
    if (rows.length > MAX_ROWS) return badRequest(`한 번에 ${MAX_ROWS}행까지 등록할 수 있습니다`);

    /* 1) 정규화·검증 */
    const errors: { row: number; error: string }[] = [];
    const prepared: Array<{ row: number; name: string; phone: string; email: string | null; type: "regular" | "family" | "volunteer"; joinedAt: Date | null; memo: string | null }> = [];
    const seenPhones = new Set<string>();
    rows.forEach((r, i) => {
      const rowNo = i + 2; // 엑셀 기준(1행 헤더)
      const name = String(r.name || "").trim().slice(0, 50);
      const phone = normalizePhone(String(r.phone || ""));
      const emailRaw = String(r.email || "").trim().toLowerCase();
      const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.slice(0, 100) : null;
      if (!name || name.length < 2) { errors.push({ row: rowNo, error: "이름이 없거나 1자입니다" }); return; }
      if (!phone) { errors.push({ row: rowNo, error: "전화번호 형식 오류(10~11자리)" }); return; }
      if (emailRaw && !email) { errors.push({ row: rowNo, error: "이메일 형식 오류" }); return; }
      const d = phoneDigits(phone);
      if (seenPhones.has(d)) { errors.push({ row: rowNo, error: "파일 안에서 전화번호 중복" }); return; }
      seenPhones.add(d);
      prepared.push({ row: rowNo, name, phone, email, type: mapType(r.type), joinedAt: parseDate(r.joinedAt), memo: String(r.memo || "").trim().slice(0, 300) || null });
    });

    /* 2) 기존 회원 매칭 — 전화번호 → 이메일 */
    const phoneMap = await findMemberIdsByPhones(prepared.map((p) => p.phone));
    const emails = prepared.map((p) => p.email).filter(Boolean) as string[];
    const emailMap = new Map<string, number>();
    if (emails.length) {
      try {
        const res: any = await db.execute(sql`SELECT id, email FROM members WHERE email = ANY(${emails}::text[])`);
        for (const r of ((res?.rows ?? res ?? []) as any[])) emailMap.set(String(r.email).toLowerCase(), Number(r.id));
      } catch { /* noop */ }
    }

    let created = 0, merged = 0;
    const createdIds: number[] = [];
    const classifyCache = new Map<string, any>();

    for (const p of prepared) {
      const existingId = phoneMap.get(phoneDigits(p.phone)) ?? (p.email ? emailMap.get(p.email) : undefined) ?? null;
      if (existingId) {
        merged++;
        if (!dryRun && p.memo) {
          try {
            await db.execute(sql`UPDATE members SET memo = CASE WHEN memo IS NULL OR memo = '' THEN ${p.memo} ELSE memo || ' / ' || ${p.memo} END, updated_at = NOW() WHERE id = ${existingId}`);
          } catch { /* noop */ }
        }
        continue;
      }
      if (dryRun) { created++; continue; }
      try {
        let classify = classifyCache.get(p.type);
        if (!classify) { classify = await classifyForSignup({ type: p.type, signupSource: "admin" }); classifyCache.set(p.type, classify); }
        const email = p.email || `bulk_${phoneDigits(p.phone)}_${Date.now().toString(36)}@noemail.siren.local`;
        const passwordHash = await hashPassword(crypto.randomBytes(18).toString("base64url"));
        const [ins] = await db.insert(members).values({
          email,
          passwordHash,
          name: p.name,
          phone: p.phone,
          type: p.type,
          status: p.type === "family" ? "pending" : "active",
          emailVerified: false,
          memo: p.memo ? `[일괄 등록] ${p.memo}` : "[일괄 등록]",
          agreeEmail: true,
          agreeSms: true,
          agreeMail: false,
          memberCategory: p.type === "regular" ? "sponsor" : classify.memberCategory,
          memberSubtype: classify.memberSubtype,
          signupSourceId: classify.signupSourceId,
          operatorActive: false,
          ...(p.joinedAt ? { createdAt: p.joinedAt } : {}),
        } as any).returning({ id: members.id });
        created++;
        createdIds.push(ins.id);
      } catch (e: any) {
        errors.push({ row: p.row, error: String(e?.message || e).slice(0, 200) });
      }
    }

    if (!dryRun) {
      await logAdminAction(req, admin.uid, admin.name, "member_bulk_import", {
        target: `rows=${rows.length}`,
        detail: { total: rows.length, created, merged, skipped: errors.length, createdIds: createdIds.slice(0, 200) },
      });
    }

    return ok(
      { total: rows.length, created, merged, skipped: errors.length, errors: errors.slice(0, 100), createdIds, dryRun },
      dryRun
        ? `미리보기 — 신규 ${created}명 · 기존 회원과 겹침 ${merged}명 · 오류 ${errors.length}행`
        : `신규 ${created}명 등록 · 기존 회원 ${merged}명은 메모만 병합 · 오류 ${errors.length}행`,
    );
  } catch (err: any) {
    console.error("[admin-members-bulk]", err);
    return serverError("일괄 등록 중 오류가 발생했습니다", err);
  }
};
