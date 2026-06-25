/**
 * migrate-prospect-backfill — 비회원 일시후원자를 예비 후원자로 일괄 소급 등록 (1회용)
 *
 * 배경(2026-06-26): 비회원(게스트) 일시후원은 회원 레코드가 없어 예비 후원자 명단에 안 떴음.
 *   ensureProspectFromDonation(전화·이메일 매칭/생성)을 기존 완료 일시후원에 소급 적용.
 *
 *   GET           : 진단 — member_id 없는 완료 일시후원 건수(=예비후원자 미등록 게스트) 집계. 변경 없음.
 *   GET ?run=1    : 소급 등록 — 각 건을 매칭(기존 회원 연결)·또는 신규 예비후원자 생성 후 후원 연결.
 *
 * 멱등: 전화/이메일 매칭이 재실행 시 중복 회원 생성을 막음. 여러 번 호출해도 안전.
 * 호출 후 즉시 삭제(1회용).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ensureProspectFromDonation } from "../../lib/prospect-from-donation";

export const config = { path: "/api/migrate-prospect-backfill" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 1000, 1), 5000);

  try {
    /* 대상: 완료된 일시후원 중 회원 미연결(게스트) — 예비후원자에 안 잡히는 건 */
    const rows: any = await db.execute(sql`
      SELECT id, member_id, donor_name, donor_email, donor_phone, amount, created_at
        FROM donations
       WHERE type = 'onetime' AND status = 'completed' AND member_id IS NULL
       ORDER BY id ASC
       LIMIT ${limit}
    `);
    const list = (rows?.rows ?? rows ?? []) as any[];

    if (!run) {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "진단(읽기전용)",
          guestOnetimeCount: list.length,
          sample: list.slice(0, 20).map((d) => ({ id: d.id, donor: d.donor_name, amount: d.amount })),
          note: "?run=1 호출 시 위 건들을 예비 후원자로 등록(기존 회원 매칭·또는 신규 생성)합니다.",
        }, null, 2),
        { status: 200, headers: JSON_HEADER },
      );
    }

    /* 소급 등록 */
    let processed = 0;
    const errors: any[] = [];
    for (const d of list) {
      try {
        await ensureProspectFromDonation({
          donationId: Number(d.id),
          memberId: d.member_id,
          donorName: d.donor_name,
          donorEmail: d.donor_email,
          donorPhone: d.donor_phone,
          entryPath: "onetime_donation",
        });
        processed++;
      } catch (e: any) {
        errors.push({ id: d.id, error: String(e?.message || e).slice(0, 200) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, mode: "소급등록", targeted: list.length, processed, errors }, null, 2),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: "백필 실패", detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 800) }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
