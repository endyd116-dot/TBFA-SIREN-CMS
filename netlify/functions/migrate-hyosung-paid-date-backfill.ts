// netlify/functions/migrate-hyosung-paid-date-backfill.ts
// #BACKFILL-1 — 옛 효성 후원 결제일 백필 (1회용, 2차 — raw 시퀀스 매칭)
//
// 방식: hyosung_billings(효성 자료 raw)의 paymentDate를 회원번호 시퀀스로 후원 행에 복사
//   1. paid_date NULL + provider='hyosung_cms'인 후원 행 SELECT (id 순)
//   2. 회원 ID로 그룹핑 + 회원의 hyosungMemberNo 가져옴
//   3. hyosung_billings에서 memberNo IN (...) SELECT (paymentDate IS NOT NULL)
//   4. 각 회원별 raw billings를 billingMonth + paymentDate 기준 오름차순 정렬
//   5. 후원 행(id 오름차순)과 raw billings(시기 순)를 1:1 시퀀스 매핑
//   6. raw의 paymentDate를 후원의 hyosungPaidDate에 UPDATE
//
// 매핑 시나리오:
//   회원 5번 후원 6건 + raw 5건 → 1~5번째 매핑, 6번째 후원은 미처리 (raw 부족)
//   회원 5번 후원 4건 + raw 6건 → 1~4번째 매핑, raw 5·6번째는 사용 안 함
//
// 미처리 사유:
//   - no_member_id: 후원 행에 memberId NULL
//   - no_hyosung_member_no: 회원의 hyosungMemberNo NULL → raw 매칭 불가
//   - no_raw_match: 회원의 raw billings가 부족하거나 paymentDate 없음
//
// 진단 모드 (GET, 인증 불필요): 매칭 결과 미리보기
// 실행 모드 (?run=1, requireAdmin): 실제 UPDATE
// 호출 후 본 파일 삭제 + 커밋·푸시 (1회용 보안 원칙)

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { donations, members, hyosungBillings } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { and, eq, isNull, isNotNull, inArray, asc } from "drizzle-orm";

export const config = { path: "/api/migrate-hyosung-paid-date-backfill" };

interface PredictedRow {
  donationId: number;
  memberId: number;
  hyosungMemberNo: number;
  rawBillingId: number;
  billingMonth: string;
  paymentDate: Date;
  sequence: number; // 1-based
}

interface UnprocessableRow {
  donationId: number;
  memberId: number | null;
  reason: "no_member_id" | "no_hyosung_member_no" | "no_raw_match";
  detail?: string;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (run) {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
  }

  try {
    /* ===== 1. 후원 행 SELECT ===== */
    const targetRows = await db
      .select({
        id: donations.id,
        memberId: donations.memberId,
        hyosungMemberNo: donations.hyosungMemberNo,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .where(
        and(
          eq(donations.pgProvider, "hyosung_cms"),
          isNull(donations.hyosungPaidDate),
        ),
      )
      .orderBy(asc(donations.id));

    /* ===== 2. 회원별 그룹핑 ===== */
    const byMember = new Map<number, typeof targetRows>();
    const noMember: typeof targetRows = [];
    for (const row of targetRows) {
      if (row.memberId == null) {
        noMember.push(row);
        continue;
      }
      const arr = byMember.get(row.memberId) ?? [];
      arr.push(row);
      byMember.set(row.memberId, arr);
    }

    /* ===== 3. 회원 정보 조회 ===== */
    const memberIds = [...byMember.keys()];
    const memberRows =
      memberIds.length > 0
        ? await db
            .select({
              id: members.id,
              hyosungMemberNo: members.hyosungMemberNo,
            })
            .from(members)
            .where(inArray(members.id, memberIds))
        : [];

    const memberMap = new Map<number, (typeof memberRows)[number]>();
    for (const m of memberRows) memberMap.set(m.id, m);

    /* ===== 4. 효성 자료 raw — paymentDate 있는 행만 ===== */
    const memberNos = memberRows
      .map((m) => m.hyosungMemberNo)
      .filter((v): v is number => v != null);

    const rawRows =
      memberNos.length > 0
        ? await db
            .select({
              id: hyosungBillings.id,
              memberNo: hyosungBillings.memberNo,
              billingMonth: hyosungBillings.billingMonth,
              paymentDate: hyosungBillings.paymentDate,
            })
            .from(hyosungBillings)
            .where(
              and(
                inArray(hyosungBillings.memberNo, memberNos),
                isNotNull(hyosungBillings.paymentDate),
              ),
            )
        : [];

    // 회원번호별 raw 그룹핑 (시기 순)
    const rawByMemberNo = new Map<number, typeof rawRows>();
    for (const r of rawRows) {
      const arr = rawByMemberNo.get(r.memberNo) ?? [];
      arr.push(r);
      rawByMemberNo.set(r.memberNo, arr);
    }
    // 정렬: billingMonth 오름차순(사전순=시간순), 동률이면 paymentDate
    for (const [, arr] of rawByMemberNo) {
      arr.sort((a, b) => {
        const m = (a.billingMonth || "").localeCompare(b.billingMonth || "");
        if (m !== 0) return m;
        const ta = a.paymentDate?.getTime() ?? 0;
        const tb = b.paymentDate?.getTime() ?? 0;
        return ta - tb;
      });
    }

    /* ===== 5. 시퀀스 매핑 ===== */
    const predicted: PredictedRow[] = [];
    const unprocessable: UnprocessableRow[] = [];

    for (const [memberId, donationList] of byMember.entries()) {
      const member = memberMap.get(memberId);
      if (!member || member.hyosungMemberNo == null) {
        for (const d of donationList) {
          unprocessable.push({
            donationId: d.id,
            memberId,
            reason: "no_hyosung_member_no",
          });
        }
        continue;
      }

      const rawList = rawByMemberNo.get(member.hyosungMemberNo) ?? [];
      // 1:1 시퀀스 매핑 — donationList[i] ↔ rawList[i]
      for (let i = 0; i < donationList.length; i++) {
        const d = donationList[i];
        const r = rawList[i];
        if (!r || !r.paymentDate) {
          unprocessable.push({
            donationId: d.id,
            memberId,
            reason: "no_raw_match",
            detail: `후원 ${donationList.length}건 vs raw ${rawList.length}건 — ${i + 1}번째 raw 없음`,
          });
          continue;
        }
        predicted.push({
          donationId: d.id,
          memberId,
          hyosungMemberNo: member.hyosungMemberNo,
          rawBillingId: r.id,
          billingMonth: r.billingMonth,
          paymentDate: r.paymentDate,
          sequence: i + 1,
        });
      }
    }

    for (const d of noMember) {
      unprocessable.push({ donationId: d.id, memberId: null, reason: "no_member_id" });
    }

    /* ===== 6. 진단 모드 응답 ===== */
    if (!run) {
      // 회원별 상세 — Swain이 매핑 검토용
      const byMemberDetail: any[] = [];
      const seenMembers = new Set<number>();
      for (const p of predicted) {
        if (seenMembers.has(p.memberId)) continue;
        seenMembers.add(p.memberId);
        const memberPredictions = predicted.filter((x) => x.memberId === p.memberId);
        const member = memberMap.get(p.memberId)!;
        const totalDonations = byMember.get(p.memberId)?.length ?? 0;
        const totalRaw = rawByMemberNo.get(member.hyosungMemberNo!)?.length ?? 0;
        byMemberDetail.push({
          member_id: p.memberId,
          hyosung_member_no: member.hyosungMemberNo,
          donation_count: totalDonations,
          raw_count: totalRaw,
          matched: memberPredictions.length,
          mappings: memberPredictions.map((x) => ({
            donation_id: x.donationId,
            sequence: x.sequence,
            billing_month: x.billingMonth,
            predicted_date: formatDate(x.paymentDate),
          })),
        });
      }

      const breakdown = {
        no_member_id: unprocessable.filter((u) => u.reason === "no_member_id").length,
        no_hyosung_member_no: unprocessable.filter((u) => u.reason === "no_hyosung_member_no").length,
        no_raw_match: unprocessable.filter((u) => u.reason === "no_raw_match").length,
      };

      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnostic",
          method: "raw_sequence_matching",
          totals: {
            target_rows: targetRows.length,
            processable: predicted.length,
            unprocessable: unprocessable.length,
            unique_members: byMemberDetail.length,
            raw_total: rawRows.length,
          },
          breakdown,
          by_member_detail: byMemberDetail,
          unprocessable_sample: unprocessable.slice(0, 15),
          note: "검토 후 ?run=1로 적용. 회원별 후원·raw 건수와 매칭 시퀀스를 확인.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    /* ===== 7. 실행 모드 — UPDATE ===== */
    let updated = 0;
    const errors: any[] = [];
    for (const p of predicted) {
      try {
        await db
          .update(donations)
          .set({ hyosungPaidDate: p.paymentDate } as any)
          .where(and(eq(donations.id, p.donationId), isNull(donations.hyosungPaidDate)));
        updated++;
      } catch (err: any) {
        errors.push({ donationId: p.donationId, error: String(err?.message || err).slice(0, 200) });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "executed",
        method: "raw_sequence_matching",
        updated,
        unprocessable: unprocessable.length,
        errors: errors.slice(0, 10),
        note: `${updated}건 결제일 채움. 미처리 ${unprocessable.length}건은 운영자가 후원 수정 화면에서 직접 입력.`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "백필 처리 실패",
        step: "main",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
