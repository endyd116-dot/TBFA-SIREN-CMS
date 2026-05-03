/**
 * SIREN — 영수증 설정 관리 API
 *
 * GET   /api/admin/receipt-settings    — 현재 설정 조회 (직인 정보 포함)
 * PATCH /api/admin/receipt-settings    — 설정 업데이트
 *
 * ★ M-14: 직인 이미지 처리 추가
 *   - PATCH body에 stampBlobId 포함 시 직인 변경
 *   - stampBlobId=null로 보내면 직인 제거
 *   - 응답에 stampUrl 자동 생성
 */
import { eq } from "drizzle-orm";
import { db, receiptSettings, members } from "../../db";
import { blobUploads } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/receipt-settings" };

/* ============ 기본값 ============ */
function buildDefaults() {
  const orgName = process.env.ORG_NAME || "(샘플) 교사유가족협의회";
  const orgRegNo = process.env.ORG_REGISTRATION_NO || "000-00-00000";
  const orgRep = process.env.ORG_REPRESENTATIVE || "○○○";
  const orgAddr = process.env.ORG_ADDRESS || "(샘플) 서울특별시 ○○구 ○○로 ○○";
  const orgPhone = process.env.ORG_PHONE || "(샘플) 02-0000-0000";

  return {
    orgName,
    orgRegistrationNo: orgRegNo,
    orgRepresentative: orgRep,
    orgAddress: orgAddr,
    orgPhone,
    title: "기 부 금  영 수 증",
    subtitle: "(소득세법 시행규칙 별지 제45호의2 서식)",
    proofText: "위와 같이 기부금을 기부하였음을 증명합니다.",
    donationTypeLabel: "지정기부금",
    footerNotes: JSON.stringify([
      "• 본 영수증은 「소득세법」 제34조 및 「법인세법」 제24조에 따른 기부금 영수증입니다.",
      "• 본 영수증은 발급기관에서 전자 발급되었으며, 영수증 번호로 진위를 확인할 수 있습니다.",
      `• 문의: ${orgPhone} / ${orgName}`,
    ]),
  };
}

/* ============ 응답 정규화 (★ M-14: 직인 정보 포함) ============ */
async function normalizeForResponse(row: any) {
  let notes: string[] = [];
  if (row.footerNotes) {
    try {
      const parsed = JSON.parse(row.footerNotes);
      if (Array.isArray(parsed)) notes = parsed.map((s) => String(s));
    } catch { notes = []; }
  }

  /* ★ M-14: 직인 정보 조회 */
  let stampUrl: string | null = null;
  let stampOriginalName: string | null = null;
  if (row.stampBlobId) {
    try {
      const [b] = await db
        .select({
          id: blobUploads.id,
          originalName: blobUploads.originalName,
          mimeType: blobUploads.mimeType,
        })
        .from(blobUploads)
        .where(eq(blobUploads.id, row.stampBlobId))
        .limit(1);

      if (b) {
        stampUrl = `/api/blob-image?id=${(b as any).id}`;
        stampOriginalName = (b as any).originalName;
      }
    } catch (e) {
      console.warn("[admin-receipt-settings] 직인 BLOB 조회 실패:", e);
    }
  }

  return {
    id: row.id,
    orgName: row.orgName || "",
    orgRegistrationNo: row.orgRegistrationNo || "",
    orgRepresentative: row.orgRepresentative || "",
    orgAddress: row.orgAddress || "",
    orgPhone: row.orgPhone || "",
    title: row.title || "",
    subtitle: row.subtitle || "",
    proofText: row.proofText || "",
    donationTypeLabel: row.donationTypeLabel || "",
    footerNotes: notes,
    /* ★ M-14: 직인 정보 */
    stampBlobId: row.stampBlobId || null,
    stampUrl,
    stampOriginalName,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      let [row] = await db
        .select()
        .from(receiptSettings)
        .where(eq(receiptSettings.id, 1))
        .limit(1);

      if (!row) {
        const defaults = buildDefaults();
        const inserted = await db
          .insert(receiptSettings)
          .values({
            id: 1,
            ...defaults,
            updatedBy: admin.uid,
          } as any)
          .returning();
        row = inserted[0];
      }

      let updatedByName: string | null = null;
      if ((row as any).updatedBy) {
        const [m] = await db
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, (row as any).updatedBy))
          .limit(1);
        if (m) updatedByName = (m as any).name;
      }

      const normalized = await normalizeForResponse(row);
      return ok({ settings: normalized, updatedByName });
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const updateData: any = {};

      if (typeof body.orgName === "string") updateData.orgName = body.orgName.trim().slice(0, 100);
      if (typeof body.orgRegistrationNo === "string") updateData.orgRegistrationNo = body.orgRegistrationNo.trim().slice(0, 50);
      if (typeof body.orgRepresentative === "string") updateData.orgRepresentative = body.orgRepresentative.trim().slice(0, 50);
      if (typeof body.orgAddress === "string") updateData.orgAddress = body.orgAddress.trim().slice(0, 255);
      if (typeof body.orgPhone === "string") updateData.orgPhone = body.orgPhone.trim().slice(0, 50);
      if (typeof body.title === "string") updateData.title = body.title.trim().slice(0, 100);
      if (typeof body.subtitle === "string") updateData.subtitle = body.subtitle.trim().slice(0, 200);
      if (typeof body.proofText === "string") updateData.proofText = body.proofText.trim().slice(0, 200);
      if (typeof body.donationTypeLabel === "string") updateData.donationTypeLabel = body.donationTypeLabel.trim().slice(0, 50);

      if (Array.isArray(body.footerNotes)) {
        const cleaned = body.footerNotes
          .map((s: any) => String(s || "").trim())
          .filter((s: string) => s.length > 0)
          .slice(0, 10);
        updateData.footerNotes = JSON.stringify(cleaned);
      }

      /* ★ M-14: 직인 처리 */
      if (body.stampBlobId !== undefined) {
        if (body.stampBlobId === null || body.stampBlobId === 0 || body.stampBlobId === "") {
          /* 직인 제거 */
          updateData.stampBlobId = null;
        } else {
          const blobId = Number(body.stampBlobId);
          if (!Number.isFinite(blobId) || blobId <= 0) {
            return badRequest("stampBlobId가 유효하지 않습니다");
          }

          /* 해당 BLOB이 실존하고 이미지인지 검증 */
          const [b] = await db
            .select({ id: blobUploads.id, mimeType: blobUploads.mimeType })
            .from(blobUploads)
            .where(eq(blobUploads.id, blobId))
            .limit(1);

          if (!b) return badRequest("업로드된 직인 이미지를 찾을 수 없습니다");

          const mime = String((b as any).mimeType || "").toLowerCase();
          if (!mime.startsWith("image/")) {
            return badRequest("직인은 이미지 파일이어야 합니다");
          }

          updateData.stampBlobId = blobId;
        }
      }

      if (Object.keys(updateData).length === 0) {
        return badRequest("변경할 내용이 없습니다");
      }

      updateData.updatedAt = new Date();
      updateData.updatedBy = admin.uid;

      /* UPSERT */
      const [existing] = await db
        .select({ id: receiptSettings.id })
        .from(receiptSettings)
        .where(eq(receiptSettings.id, 1))
        .limit(1);

      if (!existing) {
        const defaults = buildDefaults();
        await db
          .insert(receiptSettings)
          .values({
            id: 1,
            ...defaults,
            ...updateData,
          } as any);
      } else {
        await db
          .update(receiptSettings)
          .set(updateData)
          .where(eq(receiptSettings.id, 1));
      }

      const [row] = await db
        .select()
        .from(receiptSettings)
        .where(eq(receiptSettings.id, 1))
        .limit(1);

      let updatedByName: string | null = null;
      if ((row as any).updatedBy) {
        const [m] = await db
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, (row as any).updatedBy))
          .limit(1);
        if (m) updatedByName = (m as any).name;
      }

      console.log(`[admin-receipt-settings] updated by admin uid=${admin.uid}, stampChanged=${updateData.stampBlobId !== undefined}`);

      const normalized = await normalizeForResponse(row);
      return ok(
        { settings: normalized, updatedByName },
        updateData.stampBlobId !== undefined
          ? (updateData.stampBlobId === null
            ? "직인이 제거되었습니다"
            : "직인이 변경되었습니다")
          : "영수증 설정이 저장되었습니다"
      );
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-receipt-settings]", err);
    return serverError("영수증 설정 처리 중 오류", err);
  }
};