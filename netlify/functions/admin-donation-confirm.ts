/**
 * POST /api/admin-donation-confirm
 *
 * ★ 6순위 #15 + Phase 3 D1·D2 (2026-05-10 재작성):
 *   pending_donations 행을 통과(확정) 처리.
 *   source 별 분기:
 *     - 'hyosung_contracts' : hyosungContracts UPSERT + 회원 매칭/신규 생성
 *     - 'hyosung_billings'  : hyosungBillings UPSERT + (수납금액 > 0) donations 생성
 *     - 'ibk' / 'hyosung'(legacy) : donations 생성
 *
 * 요청 본문:
 *   {
 *     ids: number[],
 *     action: 'confirm' | 'ignore' | 'rematch',
 *     memberIdOverride?: number,
 *   }
 */
import type { Context } from "@netlify/functions";
import { sql, eq, inArray, and } from "drizzle-orm";
import crypto from "crypto";
import {
  db, donations, members, pendingDonations,
  hyosungContracts, hyosungBillings, signupSources,
} from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import {
  ok, badRequest, forbidden, serverError, methodNotAllowed, corsPreflight, parseJson,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import { safeReevaluate } from "../../lib/donor-status";
import {
  mapContractRowToInsert, mapBillingRowToInsert,
} from "../../lib/hyosung-mapper";
import {
  buildContractMergeUpdate, buildNewMemberFromContract,
  evaluateDonorTypeFromContract, patchDonorChannels,
} from "../../lib/hyosung-merge";
import type { HyosungContractRow, HyosungBillingRow } from "../../lib/hyosung-parser";

interface Body {
  ids?: number[];
  action?: "confirm" | "ignore" | "rematch";
  memberIdOverride?: number;
}

interface ConfirmResult {
  id: number;
  ok: boolean;
  donationId?: number;
  contractId?: number;
  billingId?: number;
  memberId?: number;
  error?: string;
}

/* =========================================================
   효성 계약정보 통과 처리
   ========================================================= */
async function confirmHyosungContract(
  p: any,
  memberIdOverride: number | null,
  hyosungSourceId: number | null,
): Promise<{ ok: true; memberId: number; contractId: number | null } | { ok: false; error: string }> {
  let raw: any = p.rawData || {};
  /* 방어적 파싱: jsonb가 문자열로 올 가능성 대비 */
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  const row = raw._hyosungContractRow as HyosungContractRow | undefined;
  if (!row || !row.memberNo) {
    const keys = raw && typeof raw === "object" ? Object.keys(raw).slice(0, 5).join(",") : "(empty)";
    return { ok: false, error: `효성 계약 행 데이터를 복원할 수 없음 — rawData keys: [${keys}]` };
  }

  /* 1. hyosungContracts UPSERT (memberNo unique) */
  const contractPayload = mapContractRowToInsert(row);
  const upsertResult = await db.insert(hyosungContracts)
    .values({ ...contractPayload, updatedAt: new Date() } as any)
    .onConflictDoUpdate({
      target: hyosungContracts.memberNo,
      set: { ...contractPayload, updatedAt: new Date() } as any,
    })
    .returning({ id: hyosungContracts.id });
  const contractId = upsertResult[0]?.id ?? null;

  /* 2. 회원 매칭 또는 신규 생성 */
  const typeEval = evaluateDonorTypeFromContract(row.contractStatus);
  let memberId: number;

  /* 우선순위: 관리자 강제 지정 > 임시 보관함 매칭 > 효성번호 재조회 */
  let targetMemberId: number | null = memberIdOverride || p.matchedMemberId || null;
  if (!targetMemberId) {
    const found = await db.select({ id: members.id })
      .from(members)
      .where(eq(members.hyosungMemberNo, row.memberNo))
      .limit(1);
    targetMemberId = found[0]?.id ?? null;
  }

  if (targetMemberId) {
    /* 기존 회원 갱신 */
    const [existing] = await db.select({
      id: members.id, donorChannels: members.donorChannels,
    }).from(members).where(eq(members.id, targetMemberId)).limit(1);
    if (!existing) return { ok: false, error: "매칭 회원이 삭제됨" };

    const newChannels = patchDonorChannels(
      Array.isArray(existing.donorChannels) ? existing.donorChannels as string[] : [],
      typeEval.channelAction,
    );
    const mergeUpdate = buildContractMergeUpdate(row);
    await db.update(members)
      .set({ ...mergeUpdate, donorChannels: newChannels, donorEvaluatedAt: new Date() } as any)
      .where(eq(members.id, existing.id));
    memberId = existing.id;
  } else {
    /* 신규 회원 생성 — 로그인 불가 임시 계정 */
    const newMemberPayload = buildNewMemberFromContract(row, hyosungSourceId);
    const tempEmail = `hyosung_${row.memberNo}_${Date.now()}@noemail.siren.local`;
    const tempPwHash = crypto.randomBytes(32).toString("hex");
    const insResult = await db.insert(members)
      .values({
        ...newMemberPayload,
        email: tempEmail,
        passwordHash: tempPwHash,
        emailVerified: false,
      } as any)
      .returning({ id: members.id });
    const newId = insResult[0]?.id;
    if (!newId) return { ok: false, error: "신규 회원 생성 실패" };
    memberId = newId;
  }

  /* 3. hyosungContracts.linkedMemberId 연결 */
  if (contractId) {
    await db.update(hyosungContracts)
      .set({ linkedMemberId: memberId } as any)
      .where(eq(hyosungContracts.id, contractId));
  }

  return { ok: true, memberId, contractId };
}

/* =========================================================
   효성 수납내역 통과 처리
   ========================================================= */
async function confirmHyosungBilling(
  p: any,
  memberIdOverride: number | null,
): Promise<{ ok: true; memberId: number; billingId: number | null; donationId: number | null } | { ok: false; error: string }> {
  let raw: any = p.rawData || {};
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  const row = raw._hyosungBillingRow as HyosungBillingRow | undefined;
  if (!row || !row.memberNo || !row.billingMonth) {
    const keys = raw && typeof raw === "object" ? Object.keys(raw).slice(0, 5).join(",") : "(empty)";
    return { ok: false, error: `효성 수납 행 데이터를 복원할 수 없음 — rawData keys: [${keys}]` };
  }

  /* 회원 찾기 — 강제지정 > 매칭 > 효성번호 재조회 */
  let targetMemberId: number | null = memberIdOverride || p.matchedMemberId || null;
  if (!targetMemberId) {
    const found = await db.select({ id: members.id })
      .from(members)
      .where(eq(members.hyosungMemberNo, row.memberNo))
      .limit(1);
    targetMemberId = found[0]?.id ?? null;
  }
  if (!targetMemberId) {
    return { ok: false, error: `회원이 없음 (효성회원번호 #${row.memberNo}). 효성 계약관리 파일 먼저 통과 처리하세요.` };
  }

  /* hyosungBillings UPSERT (memberNo + billingMonth) */
  const billingPayload = mapBillingRowToInsert(row, targetMemberId);
  let billingId: number | null = null;
  const existingBilling = await db.select({ id: hyosungBillings.id })
    .from(hyosungBillings)
    .where(and(
      eq(hyosungBillings.memberNo, row.memberNo),
      eq(hyosungBillings.billingMonth, row.billingMonth),
    ))
    .limit(1);
  if (existingBilling.length > 0) {
    await db.update(hyosungBillings)
      .set({ ...billingPayload, updatedAt: new Date() } as any)
      .where(eq(hyosungBillings.id, existingBilling[0].id));
    billingId = existingBilling[0].id;
  } else {
    const ins = await db.insert(hyosungBillings)
      .values(billingPayload as any)
      .returning({ id: hyosungBillings.id });
    billingId = ins[0]?.id ?? null;
  }

  /* 수납금액 > 0 → donations 생성 (중복 방지) */
  let donationId: number | null = null;
  if (row.receivedAmount && row.receivedAmount > 0) {
    const existingDonation = await db.select({ id: donations.id })
      .from(donations)
      .where(and(
        eq(donations.hyosungMemberNo, row.memberNo),
        eq(donations.hyosungBillingMonth, row.billingMonth),
      ))
      .limit(1);

    if (existingDonation.length === 0) {
      /* ★ 2026-05-16 fix: PDF '상품' 값 기준으로 정기/일시 분기.
         '일시후원' = onetime, 그 외('정기후원'·'후원회비') = regular.
         이전엔 무조건 regular로 박혀서 후원 결제 내역 유형이 부정확. */
      const donationType = row.productName === "일시후원" ? "onetime" : "regular";
      const ins = await db.insert(donations).values({
        memberId: targetMemberId,
        donorName: (row.memberName || `효성회원_${row.memberNo}`).slice(0, 50),
        donorPhone: row.phone,
        amount: row.receivedAmount,
        type: donationType,
        payMethod: (row.paymentMethod || row.paymentTool || "bank_transfer").slice(0, 20),
        status: "completed",
        pgProvider: "hyosung",
        hyosungMemberNo: row.memberNo,
        hyosungContractNo: row.contractNo,
        hyosungBillingMonth: row.billingMonth,
        hyosungReceiptStatus: row.receiptStatus,
        hyosungPaidDate: row.paymentDate ? new Date(row.paymentDate) : null,
        hyosungBillingId: billingId,
        paidAt: row.paymentDate ? new Date(row.paymentDate) : new Date(),
      } as any).returning({ id: donations.id });
      donationId = ins[0]?.id ?? null;

      /* hyosungBillings.linkedDonationId 연결 */
      if (donationId && billingId) {
        await db.update(hyosungBillings)
          .set({ linkedDonationId: donationId } as any)
          .where(eq(hyosungBillings.id, billingId));
      }
    } else {
      donationId = existingDonation[0].id;
    }
  }

  return { ok: true, memberId: targetMemberId, billingId, donationId };
}

/* =========================================================
   IBK / 레거시 'hyosung' donations INSERT (기존 #15 로직)
   ========================================================= */
async function confirmIbkOrLegacy(
  p: any,
  memberIdOverride: number | null,
): Promise<{ ok: true; memberId: number; donationId: number } | { ok: false; error: string }> {
  const targetMemberId = memberIdOverride || p.matchedMemberId;
  if (!targetMemberId) {
    return { ok: false, error: "매칭된 회원이 없음 (수동 매칭 후 재시도)" };
  }

  const [m] = await db
    .select({ id: members.id, name: members.name, phone: members.phone, email: members.email })
    .from(members).where(eq(members.id, targetMemberId)).limit(1);
  if (!m) return { ok: false, error: "회원이 존재하지 않음" };

  if (!p.parsedAmount || p.parsedAmount <= 0) {
    return { ok: false, error: "파싱된 금액이 0 이하" };
  }

  const isHyosung = p.source === "hyosung";
  const payMethod = isHyosung ? "cms" : "bank";
  const pgProvider = isHyosung ? "hyosung_cms" : "ibk_bank";
  const memoBase = p.parsedMemo || (isHyosung ? "효성 CSV 확정" : "기업은행 입금 확정");
  const memo = `[${isHyosung ? "효성" : "기업은행"} CSV 확정] ${memoBase}`.slice(0, 1000);

  const raw = (p.rawData || {}) as any;
  const hyosungMemberNo = isHyosung && raw._hyosungMemberNo ? Number(raw._hyosungMemberNo) || null : null;
  const hyosungContractNo = isHyosung && raw._contractNo ? String(raw._contractNo).slice(0, 20) : null;
  const hyosungBillingMonth = isHyosung && raw._billingMonth ? String(raw._billingMonth).slice(0, 10) : null;

  const [inserted] = await db.insert(donations).values({
    memberId: m.id,
    donorName: p.parsedName || m.name || "(이름 없음)",
    donorPhone: m.phone,
    donorEmail: m.email,
    amount: p.parsedAmount,
    type: isHyosung ? "regular" : "onetime",
    payMethod, pgProvider,
    status: "completed",
    hyosungMemberNo, hyosungContractNo, hyosungBillingMonth,
    bankDepositorName: !isHyosung ? p.parsedName : null,
    memo,
    createdAt: p.parsedDate || new Date(),
    paidAt: p.parsedDate || new Date(),
  } as any).returning({ id: donations.id });

  return { ok: true, memberId: m.id, donationId: inserted.id };
}

/* =========================================================
   메인 핸들러
   ========================================================= */
export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const { admin, member: adminMember } = (auth as any).ctx;

  /* ★ R41 Q1-009 / R45 F2: 후원 통과 처리 권한 게이트 — 권한 정책 화면(admin-role-policy)에서 토글.
     시드 기본값 operator 차단(재무성 작업·admin+ 전용), super_admin이 권한정책에서 운영자 허용으로 조정 가능. */
  if (!(await canAccess(adminMember.role ?? "", "donation_confirm"))) {
    return forbidden("후원 통과 처리 권한이 없습니다");
  }

  try {
    const body = await parseJson<Body>(req);
    if (!body) return badRequest("요청 본문 파싱 실패");

    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.filter((n: any) => Number.isInteger(n) && n > 0)))
      : [];
    if (ids.length === 0) return badRequest("ids 배열이 비어있습니다");
    if (ids.length > 200) return badRequest("한 번에 처리 가능한 ids는 200건입니다");

    const action: string = body.action || "confirm";
    if (!["confirm", "ignore", "rematch", "restore", "hold"].includes(action)) {
      return badRequest("action은 confirm | ignore | rematch | restore | hold 중 하나여야 합니다");
    }

    const memberIdOverride = (action === "confirm" || action === "rematch") && body.memberIdOverride
      ? Number(body.memberIdOverride)
      : null;

    if (memberIdOverride && ids.length !== 1) {
      return badRequest("memberIdOverride는 ids가 1건일 때만 사용 가능합니다");
    }

    /* 1. pending 행 로드 — drizzle select로 jsonb 자동 파싱 + camelCase 필드 보장 */
    const pendings = await db
      .select()
      .from(pendingDonations)
      .where(inArray(pendingDonations.id, ids));

    if (pendings.length === 0) return badRequest("해당 미확정 항목을 찾을 수 없습니다");

    /* 2. ignore 처리 — 단순 상태 업데이트 */
    if (action === "ignore") {
      await db.execute(sql`
        UPDATE pending_donations
        SET status = 'ignored', updated_at = now()
        WHERE id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
      `);
      try {
        await logAdminAction(req, admin.uid, admin.name, "donation_pending_ignore", {
          target: ids.join(","), detail: { count: ids.length },
        });
      } catch {}
      return ok({ processed: ids.length, succeeded: ids.length, failed: 0, action: "ignore" }, `${ids.length}건 무시 처리`);
    }

    /* 2-b. AD-051 restore — 무시(ignored)·보류(held) 건을 검토 대기로 복원 (확정 건은 불변·별도 취소 경로)
       매칭된 회원이 있으면 'matched', 없으면 'pending'으로 복귀. */
    if (action === "restore") {
      await db.execute(sql`
        UPDATE pending_donations
        SET status = CASE WHEN matched_member_id IS NOT NULL THEN 'matched' ELSE 'pending' END,
            updated_at = now()
        WHERE id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
          AND status IN ('ignored', 'held')
      `);
      try {
        await logAdminAction(req, admin.uid, admin.name, "donation_pending_restore", {
          target: ids.join(","), detail: { count: ids.length },
        });
      } catch {}
      return ok({ processed: ids.length, succeeded: ids.length, failed: 0, action: "restore" }, `${ids.length}건 복원`);
    }

    /* 2-c. AD-052 hold — 판단 보류. 미확정/매칭됨 건을 '보류(held)'로 격리(확정·무시 건은 제외). */
    if (action === "hold") {
      await db.execute(sql`
        UPDATE pending_donations
        SET status = 'held', updated_at = now()
        WHERE id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
          AND status IN ('pending', 'matched')
      `);
      try {
        await logAdminAction(req, admin.uid, admin.name, "donation_pending_hold", {
          target: ids.join(","), detail: { count: ids.length },
        });
      } catch {}
      return ok({ processed: ids.length, succeeded: ids.length, failed: 0, action: "hold" }, `${ids.length}건 보류 처리`);
    }

    /* 3. rematch 처리 (수동 매칭 강제 지정 — 1건만) */
    if (action === "rematch") {
      if (!memberIdOverride) return badRequest("rematch는 memberIdOverride가 필수입니다");
      const [m] = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, memberIdOverride)).limit(1);
      if (!m) return badRequest("memberIdOverride에 해당하는 회원이 없습니다");
      await db.execute(sql`
        UPDATE pending_donations
        SET matched_member_id = ${memberIdOverride},
            match_score = 1.00,
            match_reason = '관리자 수동 지정',
            status = 'matched',
            updated_at = now()
        WHERE id = ${ids[0]}
      `);
      try {
        await logAdminAction(req, admin.uid, admin.name, "donation_pending_rematch", {
          target: String(ids[0]), detail: { memberId: memberIdOverride, memberName: m.name },
        });
      } catch {}
      return ok({ processed: 1, succeeded: 1, failed: 0, action: "rematch", memberId: memberIdOverride }, `매칭 변경 완료 (${m.name})`);
    }

    /* 4. confirm 처리 — source 별 분기 */
    /* 가입경로 'hyosung_csv' id 한 번 조회 (계약 통과 시 신규 회원 생성용) */
    let hyosungSourceId: number | null = null;
    try {
      const src = await db.select({ id: signupSources.id })
        .from(signupSources).where(eq(signupSources.code, "hyosung_csv")).limit(1);
      hyosungSourceId = src[0]?.id ?? null;
    } catch { /* fallback null */ }

    const results: ConfirmResult[] = [];

    for (const p of pendings) {
      try {
        if (p.status === "confirmed") {
          results.push({ id: p.id, ok: false, error: "이미 통과된 항목" });
          continue;
        }

        let outcome:
          | { ok: true; memberId: number; donationId?: number; contractId?: number | null; billingId?: number | null }
          | { ok: false; error: string };

        if (p.source === "hyosung_contracts") {
          outcome = await confirmHyosungContract(p, memberIdOverride, hyosungSourceId);
        } else if (p.source === "hyosung_billings") {
          outcome = await confirmHyosungBilling(p, memberIdOverride);
        } else {
          /* ibk + 레거시 'hyosung' */
          outcome = await confirmIbkOrLegacy(p, memberIdOverride);
        }

        if (!outcome.ok) {
          results.push({ id: p.id, ok: false, error: (outcome as { ok: false; error: string }).error });
          continue;
        }

        /* pending_donations 상태 갱신 */
        const donationIdValue = (outcome as any).donationId ?? null;
        await db.execute(sql`
          UPDATE pending_donations
          SET status = 'confirmed',
              confirmed_donation_id = ${donationIdValue},
              confirmed_by = ${adminMember.id},
              confirmed_at = now(),
              matched_member_id = ${outcome.memberId},
              updated_at = now()
          WHERE id = ${p.id}
        `);

        results.push({
          id: p.id, ok: true,
          memberId: outcome.memberId,
          donationId: (outcome as any).donationId ?? undefined,
          contractId: (outcome as any).contractId ?? undefined,
          billingId: (outcome as any).billingId ?? undefined,
        });
      } catch (rowErr: any) {
        results.push({
          id: p.id, ok: false,
          error: String(rowErr?.message || rowErr).slice(0, 300),
        });
      }
    }

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.length - succeeded;

    try {
      await logAdminAction(req, admin.uid, admin.name, "donation_pending_confirm", {
        target: ids.join(","),
        detail: { processed: results.length, succeeded, failed, memberIdOverride },
      });
    } catch {}

    /* ★ Phase 2 (마일스톤 #16 단계 C): donor_type 재평가
     * 효성 계약/수납·IBK 통과로 회원 또는 후원 변경 → 자동 분류 갱신
     * 회원별 1회씩 fire-and-forget. */
    const reevalIds = Array.from(
      new Set(
        results
          .filter(r => r.ok && r.memberId)
          .map(r => r.memberId as number),
      ),
    );
    for (const mid of reevalIds) {
      await safeReevaluate(mid, "admin-donation-confirm");
    }

    return ok(
      { processed: results.length, succeeded, failed, results, action: "confirm" },
      `통과 처리 완료: ${succeeded}건 성공, ${failed}건 실패`
    );
  } catch (err: any) {
    console.error("[admin-donation-confirm]", err);
    return serverError("후원 통과 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-donation-confirm" };
