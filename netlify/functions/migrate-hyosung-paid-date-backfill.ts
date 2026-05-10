// netlify/functions/migrate-hyosung-paid-date-backfill.ts
// #BACKFILL-1 — 옛 효성 후원 결제일 백필 (1회용)
// 방식: 약정일(members.hyosungPromiseDay 또는 hyosung_contracts.promiseDay)
//       + 계약 시작일(hyosung_contracts.billingStart) 시퀀스
//
// 로직:
//   1. paid_date NULL + provider='hyosung_cms'인 후원 행 SELECT (id 순)
//   2. 회원 ID로 그룹핑 (회원당 여러 행 가능)
//   3. 회원의 약정일 + 효성 계약의 청구 시작일 join
//   4. 첫 결제일 = 청구 시작일 이후 첫 약정일
//      (시작일의 일 ≤ 약정일이면 같은 달, 시작일의 일 > 약정일이면 다음 달)
//   5. N번째 후원 행(id 오름차순) → 첫 결제일 + (N-1)개월
//   6. UPDATE donations.hyosung_paid_date
//
// 진단 모드 (GET, 인증 불필요):
//   - 처리 가능 행 수, 미처리 행 수 (사유별)
//   - 회원별 후원 ID 순서 + 예측 결제일 (Swain이 ID 순서 검토용)
//
// 실행 모드 (GET ?run=1, requireAdmin):
//   - 진단에서 처리 가능한 행만 UPDATE
//
// 호출 후 본 파일 삭제 + 커밋·푸시 (1회용 보안 원칙)

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { donations, members, hyosungContracts } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { and, eq, isNull, inArray, asc } from "drizzle-orm";

export const config = { path: "/api/migrate-hyosung-paid-date-backfill" };

interface PredictedRow {
  donationId: number;
  memberId: number;
  hyosungMemberNo: number | null;
  predictedDate: Date;
  sequence: number; // 1-based
}

interface UnprocessableRow {
  donationId: number;
  memberId: number | null;
  reason: "no_member_id" | "no_promise_day" | "no_billing_start" | "no_contract";
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 실행 모드: 어드민 인증 ── */
  if (run) {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
  }

  try {
    /* ===== 1. 후원 행 SELECT (paid_date NULL + 효성 결제) ===== */
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

    /* ===== 2. 회원별 그룹핑 (memberId 있는 행만) ===== */
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
              hyosungPromiseDay: members.hyosungPromiseDay,
            })
            .from(members)
            .where(inArray(members.id, memberIds))
        : [];

    const memberMap = new Map<number, (typeof memberRows)[number]>();
    for (const m of memberRows) memberMap.set(m.id, m);

    /* ===== 4. 효성 계약 raw — 청구 시작일 + 약정일 ===== */
    const memberNos = memberRows
      .map((m) => m.hyosungMemberNo)
      .filter((v): v is number => v != null);

    const contractRows =
      memberNos.length > 0
        ? await db
            .select({
              memberNo: hyosungContracts.memberNo,
              billingStart: hyosungContracts.billingStart,
              promiseDay: hyosungContracts.promiseDay,
            })
            .from(hyosungContracts)
            .where(inArray(hyosungContracts.memberNo, memberNos))
        : [];

    const contractMap = new Map<number, (typeof contractRows)[number]>();
    for (const c of contractRows) contractMap.set(c.memberNo, c);

    /* ===== 5. 회원별 시퀀스 계산 ===== */
    const predicted: PredictedRow[] = [];
    const unprocessable: UnprocessableRow[] = [];

    for (const [memberId, donationList] of byMember.entries()) {
      const member = memberMap.get(memberId);
      if (!member) {
        for (const d of donationList) {
          unprocessable.push({ donationId: d.id, memberId, reason: "no_member_id" });
        }
        continue;
      }

      // 약정일: members 본체 우선, 없으면 효성 계약 raw
      let promiseDay: number | null = member.hyosungPromiseDay ?? null;
      let billingStart: Date | null = null;
      let contract: (typeof contractRows)[number] | undefined;
      if (member.hyosungMemberNo != null) {
        contract = contractMap.get(member.hyosungMemberNo);
        if (contract) {
          billingStart = contract.billingStart ?? null;
          if (!promiseDay && contract.promiseDay) promiseDay = contract.promiseDay;
        }
      }

      if (!promiseDay) {
        for (const d of donationList) {
          unprocessable.push({ donationId: d.id, memberId, reason: "no_promise_day" });
        }
        continue;
      }
      if (!billingStart) {
        const reason: UnprocessableRow["reason"] = contract ? "no_billing_start" : "no_contract";
        for (const d of donationList) {
          unprocessable.push({ donationId: d.id, memberId, reason });
        }
        continue;
      }

      // 첫 결제일: 청구 시작일 이후 첫 약정일
      // 시작일의 일(day) ≤ 약정일이면 같은 달의 약정일
      // 시작일의 일 > 약정일이면 다음 달의 약정일
      const startYear = billingStart.getFullYear();
      const startMonth = billingStart.getMonth(); // 0-based
      const startDay = billingStart.getDate();

      let firstPaidYear = startYear;
      let firstPaidMonth = startMonth;
      if (startDay > promiseDay) {
        firstPaidMonth += 1;
        if (firstPaidMonth > 11) {
          firstPaidYear += 1;
          firstPaidMonth = 0;
        }
      }
      const firstPaidDate = new Date(firstPaidYear, firstPaidMonth, promiseDay);

      // donationList는 id 오름차순 정렬됨 → 1·2·3번째 결제
      for (let i = 0; i < donationList.length; i++) {
        const d = donationList[i];
        const paidDate = new Date(firstPaidDate);
        paidDate.setMonth(paidDate.getMonth() + i);
        // setMonth는 자동으로 연도 보정
        predicted.push({
          donationId: d.id,
          memberId,
          hyosungMemberNo: member.hyosungMemberNo,
          predictedDate: paidDate,
          sequence: i + 1,
        });
      }
    }

    // 회원번호 없는 행 → 미처리
    for (const d of noMember) {
      unprocessable.push({ donationId: d.id, memberId: null, reason: "no_member_id" });
    }

    /* ===== 6. 진단 모드 응답 ===== */
    if (!run) {
      // 회원별 상세 — Swain이 ID 순서·예측일 검토용
      const byMemberDetail: any[] = [];
      const seenMembers = new Set<number>();
      for (const p of predicted) {
        if (seenMembers.has(p.memberId)) continue;
        seenMembers.add(p.memberId);
        const memberPredictions = predicted.filter((x) => x.memberId === p.memberId);
        const member = memberMap.get(p.memberId)!;
        const contract = member.hyosungMemberNo != null ? contractMap.get(member.hyosungMemberNo) : undefined;
        byMemberDetail.push({
          member_id: p.memberId,
          hyosung_member_no: member.hyosungMemberNo,
          promise_day: member.hyosungPromiseDay ?? contract?.promiseDay ?? null,
          billing_start: contract?.billingStart ? formatDate(contract.billingStart) : null,
          donation_count: memberPredictions.length,
          donations: memberPredictions.map((x) => ({
            id: x.donationId,
            sequence: x.sequence,
            predicted_date: formatDate(x.predictedDate),
          })),
        });
      }

      const breakdown = {
        no_member_id: unprocessable.filter((u) => u.reason === "no_member_id").length,
        no_promise_day: unprocessable.filter((u) => u.reason === "no_promise_day").length,
        no_billing_start: unprocessable.filter((u) => u.reason === "no_billing_start").length,
        no_contract: unprocessable.filter((u) => u.reason === "no_contract").length,
      };

      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnostic",
          totals: {
            target_rows: targetRows.length,
            processable: predicted.length,
            unprocessable: unprocessable.length,
            unique_members: byMemberDetail.length,
          },
          breakdown,
          by_member_detail: byMemberDetail.slice(0, 30),
          unprocessable_sample: unprocessable.slice(0, 10),
          note: "검토 후 ?run=1로 적용. ID 순서가 실제 결제 순서와 다르면 적용 후 운영자가 후원 수정 화면에서 보정.",
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
          .set({ hyosungPaidDate: p.predictedDate } as any)
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
