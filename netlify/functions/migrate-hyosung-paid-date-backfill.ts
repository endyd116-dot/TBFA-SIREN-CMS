// netlify/functions/migrate-hyosung-paid-date-backfill.ts
// #BACKFILL-1 — 옛 효성 자료 삭제 (1회용, 4차 — Swain 결정 2026-05-11)
//
// 자동 백필 경로 3차례 모두 막힘 (memo 정규식·약정일 시퀀스·raw 시퀀스 모두 키 부족).
// → Swain이 옛 자료 모두 삭제 후 처음부터 재 import 결정 (계약 관리 → 수납 파일 순서).
//
// 삭제 대상:
//   1. donations (paid_date NULL + provider='hyosung_cms') — 옛 효성 후원 44건
//   2. hyosung_billings — 효성 청구 raw (회원번호 기준 — 옛 import 자료 41건)
//   3. hyosung_contracts — 효성 계약 raw (회원번호 기준 — 옛 import 자료)
//
// 안전성:
//   - donations.id를 참조하는 모든 FK가 onDelete=set null (CASCADE 아님)
//     → donations DELETE해도 영수증·발송 이력·billing_logs 등 보존, 연결만 끊어짐
//   - 회원 본체(members)의 hyosung* 필드는 그대로 유지 (재 import에서 갱신 예정)
//   - 진단 모드에서 삭제 영향 범위 미리 표시
//
// 진단 모드 (GET, 인증 불필요): 삭제 대상 건수·연결 영향 점검
// 실행 모드 (?run=1, requireAdmin): 실제 DELETE
// 호출 후 본 파일 삭제 + 커밋·푸시 (1회용 보안 원칙)

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { donations, hyosungBillings, hyosungContracts } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";

export const config = { path: "/api/migrate-hyosung-paid-date-backfill" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (run) {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
  }

  try {
    /* ===== 1. 삭제 대상 후원 행 ===== */
    const targetDonations = await db
      .select({
        id: donations.id,
        memberId: donations.memberId,
        hyosungMemberNo: donations.hyosungMemberNo,
        amount: donations.amount,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .where(
        and(
          eq(donations.pgProvider, "hyosung_cms"),
          isNull(donations.hyosungPaidDate),
        ),
      );

    /* ===== 2. 영향 받는 회원 ID·효성 회원번호 ===== */
    const affectedMemberIds = [...new Set(targetDonations.map((d) => d.memberId).filter((v): v is number => v != null))];
    const affectedHyosungMemberNos = [
      ...new Set(targetDonations.map((d) => d.hyosungMemberNo).filter((v): v is number => v != null)),
    ];

    /* ===== 3. 효성 청구 raw — 영향 범위 ===== */
    const billingsCount = await db
      .select({ id: hyosungBillings.id })
      .from(hyosungBillings);
    const billingsTotal = billingsCount.length;

    /* ===== 4. 효성 계약 raw — 영향 범위 ===== */
    const contractsCount = await db
      .select({ id: hyosungContracts.id })
      .from(hyosungContracts);
    const contractsTotal = contractsCount.length;

    /* ===== 5. 진단 모드 ===== */
    if (!run) {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnostic",
          method: "delete_old_hyosung_data",
          delete_targets: {
            donations: {
              count: targetDonations.length,
              note: "paid_date NULL + provider='hyosung_cms'인 후원 행",
              affected_member_ids: affectedMemberIds,
              affected_hyosung_member_nos: affectedHyosungMemberNos,
            },
            hyosung_billings: {
              total_in_table: billingsTotal,
              note: "효성 청구 raw 전체 — 모두 옛 import 자료라 가정. 모두 삭제 예정",
            },
            hyosung_contracts: {
              total_in_table: contractsTotal,
              note: "효성 계약 raw 전체 — 모두 옛 import 자료라 가정. 모두 삭제 예정",
            },
          },
          fk_safety: {
            donations_referenced_by: [
              "hyosung_billings.linked_donation_id (set null)",
              "billing_logs.donation_id (set null)",
              "donor_score_history.confirmed_donation_id (set null)",
            ],
            note: "모든 FK가 onDelete=set null. donations DELETE해도 영수증·발송·청구 이력 보존",
          },
          members_preservation: {
            note: "회원 본체(members)의 hyosung* 필드는 그대로 유지. 재 import에서 갱신",
          },
          sample_donations: targetDonations.slice(0, 10).map((d) => ({
            id: d.id,
            member_id: d.memberId,
            hyosung_member_no: d.hyosungMemberNo,
            amount: d.amount,
            created_at: d.createdAt,
          })),
          next_step: "검토 후 ?run=1로 적용. 적용 후 운영자가 계약 관리 → 수납 파일 순서로 재 import",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    /* ===== 6. 실행 모드 — DELETE ===== */
    // 순서: hyosung_billings → hyosung_contracts → donations
    // (FK가 set null이라 순서 무관하지만, 의미상 raw 자료 먼저 정리 후 후원 행)

    const deletedBillings = await db.execute(
      sql`DELETE FROM hyosung_billings RETURNING id`,
    );
    const billingsDeleted = (deletedBillings as any)?.rows?.length ?? (Array.isArray(deletedBillings) ? deletedBillings.length : 0);

    const deletedContracts = await db.execute(
      sql`DELETE FROM hyosung_contracts RETURNING id`,
    );
    const contractsDeleted = (deletedContracts as any)?.rows?.length ?? (Array.isArray(deletedContracts) ? deletedContracts.length : 0);

    let donationsDeleted = 0;
    const errors: any[] = [];
    for (const d of targetDonations) {
      try {
        await db.delete(donations).where(eq(donations.id, d.id));
        donationsDeleted++;
      } catch (err: any) {
        errors.push({ donationId: d.id, error: String(err?.message || err).slice(0, 200) });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "executed",
        method: "delete_old_hyosung_data",
        deleted: {
          donations: donationsDeleted,
          hyosung_billings: billingsDeleted,
          hyosung_contracts: contractsDeleted,
        },
        errors: errors.slice(0, 10),
        next_step: "운영자가 계약 관리 → 수납 파일 순서로 재 import. 회원 본체 효성번호·약정일이 자동 채워지면 paid_date도 자동 정상 채움",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "삭제 처리 실패",
        step: "main",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
