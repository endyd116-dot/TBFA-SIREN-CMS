/**
 * SIREN — 영수증 설정 관리 API (STEP H-2d-2)
 *
 * GET   /api/admin/receipt-settings    — 현재 설정 조회 (없으면 자동 생성)
 * PATCH /api/admin/receipt-settings    — 설정 업데이트
 *
 * 권한: 관리자 (사이렌/교유협 모두 동일)
 * 동작: 단일 행(id=1)만 사용 — 모든 관리자 페이지가 같은 데이터 공유
 */
import { eq } from "drizzle-orm";
import { db, receiptSettings, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/receipt-settings" };

/* ============ 기본값 (DB가 비어있을 때 자동 생성) ============ */
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

/* ============ 응답 객체에 footerNotes를 배열로 변환 ============ */
function normalizeForResponse(row: any) {
  let notes: string[] = [];
  if (row.footerNotes) {
    try {
      const parsed = JSON.parse(row.footerNotes);
      if (Array.isArray(parsed)) notes = parsed.map((s) => String(s));
    } catch {
      notes = [];
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
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  /* 관리자 인증 */
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET — 현재 설정 조회 ===== */
    if (req.method === "GET") {
      let [row] = await db
        .select()
        .from(receiptSettings)
        .where(eq(receiptSettings.id, 1))
        .limit(1);

      /* 자동 생성 (결정1-A안) */
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

      /* 마지막 수정자 이름 함께 반환 */
      let updatedByName: string | null = null;
      if ((row as any).updatedBy) {
        const [m] = await db
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, (row as any).updatedBy))
          .limit(1);
        if (m) updatedByName = (m as any).name;
      }

      return ok({
        settings: normalizeForResponse(row),
        updatedByName,
      });
    }

    /* ===== PATCH — 설정 업데이트 ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      /* 화이트리스트 — 허용된 필드만 업데이트 */
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

      /* footerNotes는 배열로 받아서 JSON 문자열로 저장 */
      if (Array.isArray(body.footerNotes)) {
        const cleaned = body.footerNotes
          .map((s: any) => String(s || "").trim())
          .filter((s: string) => s.length > 0)
          .slice(0, 10); // 최대 10개
        updateData.footerNotes = JSON.stringify(cleaned);
      }

      if (Object.keys(updateData).length === 0) {
        return badRequest("변경할 내용이 없습니다");
      }

      updateData.updatedAt = new Date();
      updateData.updatedBy = admin.uid;

      /* 행이 없으면 생성, 있으면 업데이트 (UPSERT 유사 처리) */
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

      /* 업데이트된 행 반환 */
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

      console.log(`[admin-receipt-settings] updated by admin uid=${admin.uid}`);

      return ok(
        {
          settings: normalizeForResponse(row),
          updatedByName,
        },
        "영수증 설정이 저장되었습니다"
      );
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-receipt-settings]", err);
    return serverError("영수증 설정 처리 중 오류", err);
  }
};