/**
 * POST /api/billing-card-expiry-set
 *
 * 정기 빌키 등록 직후 billing-success 페이지에서 카드 유효기간(MM/YY)을 1회 입력받아
 * billing_keys.card_expiry_month(YYMM 4자리)에 저장한다. KICC 빌키발급 응답에는 카드
 * 만료월이 없어(검수 P1-3) 사용자 입력으로 보완하는 경로(방식②). 저장되면
 * cron-billing-card-expiry 의 만료 30일·14일 전 사전 안내가 작동한다.
 *
 * body: { donationId, expiryMM(1~12), expiryYY(00~99) }
 *  - donationId → donations.billingKeyId → 해당 빌키만 갱신
 *  - card_expiry_month 는 billing_keys 에 raw SQL UPDATE (cron 과 동일 관행·schema 정의 비의존)
 *
 * 보안: 만료월은 비밀정보가 아니고(카드번호·CVC 아님) 본인이 막 결제한 화면에서의 입력이라,
 *       donationId→활성 빌키 매칭만 확인한다(없으면 404). 잘못 입력해도 알림만 빗나갈 뿐.
 */
import { db, donations } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { eq, sql } from "drizzle-orm";

export const config = { path: "/api/billing-card-expiry-set" };

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST만 허용됩니다" });

  // R45 US-012: 인증·소유자 검증 — 결제번호 추측으로 타인 빌키 만료월 변조(IDOR) 차단
  const auth = authenticateUser(req);
  if (!auth) return json(401, { ok: false, error: "로그인이 필요합니다" });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const donationId = Number(body.donationId);
  const mm = Number(body.expiryMM);
  const yy = Number(body.expiryYY);

  if (!donationId || !Number.isFinite(mm) || !Number.isFinite(yy)) {
    return json(400, { ok: false, error: "입력값이 올바르지 않습니다" });
  }
  if (mm < 1 || mm > 12 || yy < 0 || yy > 99) {
    return json(400, { ok: false, error: "유효기간 형식이 올바르지 않습니다 (월 01~12, 연 2자리)" });
  }

  // cron 이 기대하는 형식과 동일: YYMM 4자리 (예: 2027년 12월 → "2712")
  const yymm = String(yy).padStart(2, "0") + String(mm).padStart(2, "0");

  try {
    const [donation] = await db
      .select({ id: donations.id, billingKeyId: donations.billingKeyId, memberId: donations.memberId })
      .from(donations)
      .where(eq(donations.id, donationId))
      .limit(1);

    if (!donation || !donation.billingKeyId) {
      return json(404, { ok: false, error: "결제 정보를 찾을 수 없습니다" });
    }
    if (donation.memberId !== auth.uid) {
      return json(403, { ok: false, error: "본인 결제 건만 수정할 수 있습니다" });
    }

    await db.execute(sql`
      UPDATE billing_keys
      SET card_expiry_month = ${yymm}, updated_at = NOW()
      WHERE id = ${donation.billingKeyId}
    `);

    return json(200, { ok: true });
  } catch (err: any) {
    return json(500, {
      ok: false,
      error: "유효기간 저장에 실패했습니다",
      detail: String(err?.message ?? err).slice(0, 300),
    });
  }
};
