// netlify/functions/admin-donation-policy.ts
/**
 * GET   /api/admin/donation-policy   — 어드민용 정책 조회
 * PATCH /api/admin/donation-policy   — 정책 수정 (super_admin만)
 *
 * ★ 2026-05: 효성 카운트다운 메시지/초수 추가
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { donationPolicies } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

function parseJsonArr(v: any): any[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

function sanitizeAmountList(
  input: any, min: number, max: number,
): { ok: true; list: number[] } | { ok: false; reason: string } {
  if (!Array.isArray(input)) return { ok: false, reason: "배열이 아닙니다" };
  if (input.length === 0) return { ok: false, reason: "최소 1개 이상의 금액이 필요합니다" };
  if (input.length > 10) return { ok: false, reason: "최대 10개까지 가능합니다" };
  const set = new Set<number>();
  for (const v of input) {
    const n = Number(v);
    if (!Number.isInteger(n)) return { ok: false, reason: `정수가 아닌 값: ${v}` };
    if (n < min || n > max) return { ok: false, reason: `금액 범위(${min}~${max}) 벗어남: ${n}` };
    set.add(n);
  }
  return { ok: true, list: Array.from(set).sort((a, b) => a - b) };
}

function clipString(v: any, maxLen: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function validateUrl(v: any): { ok: true; url: string | null } | { ok: false; reason: string } {
  if (v === null || v === undefined || v === "") return { ok: true, url: null };
  const s = String(v).trim();
  if (!/^https?:\/\//i.test(s)) return { ok: false, reason: "URL은 http:// 또는 https://로 시작해야 합니다" };
  if (s.length > 500) return { ok: false, reason: "URL은 500자를 초과할 수 없습니다" };
  return { ok: true, url: s };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member } = guard.ctx;

  try {
    if (req.method === "GET") {
      const [row] = await db
        .select()
        .from(donationPolicies)
        .where(eq(donationPolicies.id, 1))
        .limit(1);

      if (!row) {
        return ok({
          policy: {
            id: 1,
            regularAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
            onetimeAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
            minAmount: 1000,
            maxAmount: 100000000,
            bankName: "",
            bankAccountNo: "",
            bankAccountHolder: "",
            bankGuideText: "",
            hyosungUrl: "",
            hyosungGuideText: "",
            hyosungCountdownMessage: "",
            hyosungCountdownSeconds: 5,
            modalTitle: "",
            modalSubtitle: "",
            stampBlobId: null,
            updatedAt: null,
            updatedBy: null,
          },
          isDefault: true,
        }, "기본 정책 (미설정)");
      }

      return ok({
        policy: {
          id: (row as any).id,
          regularAmounts: parseJsonArr((row as any).regularAmounts),
          onetimeAmounts: parseJsonArr((row as any).onetimeAmounts),
          minAmount: (row as any).minAmount ?? 1000,
          maxAmount: (row as any).maxAmount ?? 100000000,
          bankName: (row as any).bankName,
          bankAccountNo: (row as any).bankAccountNo,
          bankAccountHolder: (row as any).bankAccountHolder,
          bankGuideText: (row as any).bankGuideText,
          hyosungUrl: (row as any).hyosungUrl,
          hyosungGuideText: (row as any).hyosungGuideText,
          hyosungCountdownMessage: (row as any).hyosungCountdownMessage,
          hyosungCountdownSeconds: (row as any).hyosungCountdownSeconds ?? 5,
          modalTitle: (row as any).modalTitle,
          modalSubtitle: (row as any).modalSubtitle,
          stampBlobId: (row as any).stampBlobId,
          updatedAt: (row as any).updatedAt,
          updatedBy: (row as any).updatedBy,
        },
        isDefault: false,
      });
    }

    if (req.method === "PATCH") {
      if (member.role !== "super_admin") {
        return forbidden("후원 정책 수정은 슈퍼 관리자만 가능합니다");
      }

      const body = await parseJson(req);
      if (!body || typeof body !== "object") return badRequest("요청 본문이 비어있습니다");

      const [existing] = await db
        .select()
        .from(donationPolicies)
        .where(eq(donationPolicies.id, 1))
        .limit(1);

      const updateData: any = { updatedAt: new Date(), updatedBy: admin.uid };

      let minAmount = (existing as any)?.minAmount ?? 1000;
      let maxAmount = (existing as any)?.maxAmount ?? 100000000;

      if (body.minAmount !== undefined) {
        const n = Number(body.minAmount);
        if (!Number.isInteger(n) || n < 100) return badRequest("최소 금액은 100원 이상의 정수여야 합니다");
        minAmount = n;
        updateData.minAmount = n;
      }
      if (body.maxAmount !== undefined) {
        const n = Number(body.maxAmount);
        if (!Number.isInteger(n) || n < 1000) return badRequest("최대 금액은 1000원 이상의 정수여야 합니다");
        maxAmount = n;
        updateData.maxAmount = n;
      }
      if (minAmount >= maxAmount) return badRequest("최소 금액은 최대 금액보다 작아야 합니다");

      if (body.regularAmounts !== undefined) {
        const r: any = sanitizeAmountList(body.regularAmounts, minAmount, maxAmount);
        if (!r.ok) return badRequest(`정기 후원 금액 오류: ${r.reason}`);
        updateData.regularAmounts = JSON.stringify(r.list);
      }
      if (body.onetimeAmounts !== undefined) {
        const r: any = sanitizeAmountList(body.onetimeAmounts, minAmount, maxAmount);
        if (!r.ok) return badRequest(`일시 후원 금액 오류: ${r.reason}`);
        updateData.onetimeAmounts = JSON.stringify(r.list);
      }

      if (body.bankName !== undefined) updateData.bankName = clipString(body.bankName, 50);
      if (body.bankAccountNo !== undefined) updateData.bankAccountNo = clipString(body.bankAccountNo, 50);
      if (body.bankAccountHolder !== undefined) updateData.bankAccountHolder = clipString(body.bankAccountHolder, 50);
      if (body.bankGuideText !== undefined) updateData.bankGuideText = clipString(body.bankGuideText, 1000);
      if (body.hyosungGuideText !== undefined) updateData.hyosungGuideText = clipString(body.hyosungGuideText, 1000);
      if (body.hyosungCountdownMessage !== undefined) updateData.hyosungCountdownMessage = clipString(body.hyosungCountdownMessage, 500);
      if (body.hyosungCountdownSeconds !== undefined) {
        const n = Number(body.hyosungCountdownSeconds);
        if (!Number.isInteger(n) || n < 1 || n > 30) {
          return badRequest("효성 카운트다운 초수는 1~30 사이의 정수여야 합니다");
        }
        updateData.hyosungCountdownSeconds = n;
      }
      if (body.modalTitle !== undefined) updateData.modalTitle = clipString(body.modalTitle, 200);
      if (body.modalSubtitle !== undefined) updateData.modalSubtitle = clipString(body.modalSubtitle, 500);

      if (body.hyosungUrl !== undefined) {
        const u: any = validateUrl(body.hyosungUrl);
        if (!u.ok) return badRequest(`효성 URL 오류: ${u.reason}`);
        updateData.hyosungUrl = u.url;
      }

      if (body.stampBlobId !== undefined) {
        if (body.stampBlobId === null) {
          updateData.stampBlobId = null;
        } else {
          const n = Number(body.stampBlobId);
          if (!Number.isInteger(n) || n < 1) return badRequest("stampBlobId는 양의 정수여야 합니다");
          updateData.stampBlobId = n;
        }
      }

      let result: any;
      if (!existing) {
        const insertPayload: any = {
          id: 1,
          regularAmounts: updateData.regularAmounts ?? JSON.stringify([10000, 30000, 50000, 100000, 300000, 500000]),
          onetimeAmounts: updateData.onetimeAmounts ?? JSON.stringify([10000, 30000, 50000, 100000, 300000, 500000]),
          minAmount: updateData.minAmount ?? 1000,
          maxAmount: updateData.maxAmount ?? 100000000,
          bankName: updateData.bankName ?? null,
          bankAccountNo: updateData.bankAccountNo ?? null,
          bankAccountHolder: updateData.bankAccountHolder ?? null,
          bankGuideText: updateData.bankGuideText ?? null,
          hyosungUrl: updateData.hyosungUrl ?? null,
          hyosungGuideText: updateData.hyosungGuideText ?? null,
          hyosungCountdownMessage: updateData.hyosungCountdownMessage ?? null,
          hyosungCountdownSeconds: updateData.hyosungCountdownSeconds ?? 5,
          modalTitle: updateData.modalTitle ?? null,
          modalSubtitle: updateData.modalSubtitle ?? null,
          stampBlobId: updateData.stampBlobId ?? null,
          updatedAt: new Date(),
          updatedBy: admin.uid,
        };
        const [inserted] = await db.insert(donationPolicies).values(insertPayload).returning();
        result = inserted;
      } else {
        const [updated] = await db
          .update(donationPolicies)
          .set(updateData)
          .where(eq(donationPolicies.id, 1))
          .returning();
        result = updated;
      }

      const changedKeys = Object.keys(updateData).filter(k => k !== "updatedAt" && k !== "updatedBy");
      await logAdminAction(req, admin.uid, admin.name, "donation_policy_update", {
        target: "donation_policies#1",
        detail: { changedFields: changedKeys, minAmount: updateData.minAmount, maxAmount: updateData.maxAmount },
      });

      return ok({
        policy: {
          id: result.id,
          regularAmounts: parseJsonArr(result.regularAmounts),
          onetimeAmounts: parseJsonArr(result.onetimeAmounts),
          minAmount: result.minAmount,
          maxAmount: result.maxAmount,
          bankName: result.bankName,
          bankAccountNo: result.bankAccountNo,
          bankAccountHolder: result.bankAccountHolder,
          bankGuideText: result.bankGuideText,
          hyosungUrl: result.hyosungUrl,
          hyosungGuideText: result.hyosungGuideText,
          hyosungCountdownMessage: result.hyosungCountdownMessage,
          hyosungCountdownSeconds: result.hyosungCountdownSeconds,
          modalTitle: result.modalTitle,
          modalSubtitle: result.modalSubtitle,
          stampBlobId: result.stampBlobId,
          updatedAt: result.updatedAt,
          updatedBy: result.updatedBy,
        },
      }, "후원 정책이 저장되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-donation-policy]", err);
    return serverError("후원 정책 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin/donation-policy" };