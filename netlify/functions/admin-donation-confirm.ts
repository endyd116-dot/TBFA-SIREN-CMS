/**
 * POST /api/admin-donation-confirm
 *
 * ★ 6순위 #15: pending_donations → donations 확정 (1건/일괄)
 *
 * 요청 본문:
 *   {
 *     ids: number[],                  // pending_donations.id 배열
 *     action: 'confirm' | 'ignore' | 'rematch',
 *     memberIdOverride?: number,      // ids 1건일 때 매칭 회원 강제 지정 (action='confirm')
 *   }
 *
 * 처리:
 *   - confirm: pending → donations INSERT (status='completed', payMethod='bank' or 'cms')
 *              → pending_donations.status='confirmed', confirmed_donation_id 갱신
 *   - ignore : pending_donations.status='ignored'
 *   - rematch: matched_member_id 재실행 (memberIdOverride 사용)
 *
 * 응답:
 *   { processed, succeeded, failed, results[] }
 */
import type { Context } from "@netlify/functions";
import { sql, eq, inArray } from "drizzle-orm";
import { db, donations, members, pendingDonations } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, serverError, methodNotAllowed, corsPreflight, parseJson,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

interface Body {
  ids?: number[];
  action?: "confirm" | "ignore" | "rematch";
  memberIdOverride?: number;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const { admin, member: adminMember } = auth.ctx;

  try {
    const body = await parseJson<Body>(req);
    if (!body) return badRequest("요청 본문 파싱 실패");

    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.filter((n: any) => Number.isInteger(n) && n > 0)))
      : [];
    if (ids.length === 0) return badRequest("ids 배열이 비어있습니다");
    if (ids.length > 200) return badRequest("한 번에 처리 가능한 ids는 200건입니다");

    const action = body.action || "confirm";
    if (!["confirm", "ignore", "rematch"].includes(action)) {
      return badRequest("action은 confirm | ignore | rematch 중 하나여야 합니다");
    }

    const memberIdOverride = (action === "confirm" || action === "rematch") && body.memberIdOverride
      ? Number(body.memberIdOverride)
      : null;

    if (memberIdOverride && ids.length !== 1) {
      return badRequest("memberIdOverride는 ids가 1건일 때만 사용 가능합니다");
    }

    /* 1. pending 행 로드 */
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
          target: ids.join(","),
          detail: { count: ids.length },
        });
      } catch {}
      return ok({ processed: ids.length, succeeded: ids.length, failed: 0, action: "ignore" }, `${ids.length}건 무시 처리`);
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
          target: String(ids[0]),
          detail: { memberId: memberIdOverride, memberName: m.name },
        });
      } catch {}
      return ok({ processed: 1, succeeded: 1, failed: 0, action: "rematch", memberId: memberIdOverride }, `매칭 변경 완료 (${m.name})`);
    }

    /* 4. confirm 처리 — pending → donations INSERT */
    const results: Array<{ id: number; ok: boolean; donationId?: number; error?: string }> = [];

    for (const p of pendings) {
      try {
        if (p.status === "confirmed") {
          results.push({ id: p.id, ok: false, error: "이미 확정된 항목" });
          continue;
        }

        const targetMemberId = memberIdOverride || p.matchedMemberId;
        if (!targetMemberId) {
          results.push({ id: p.id, ok: false, error: "매칭된 회원이 없어 확정할 수 없음 (rematch 후 재시도)" });
          continue;
        }

        /* 회원 존재 확인 + 정보 가져오기 (donations 채우기용) */
        const [m] = await db
          .select({ id: members.id, name: members.name, phone: members.phone, email: members.email })
          .from(members)
          .where(eq(members.id, targetMemberId))
          .limit(1);
        if (!m) {
          results.push({ id: p.id, ok: false, error: "회원이 존재하지 않음" });
          continue;
        }

        if (!p.parsedAmount || p.parsedAmount <= 0) {
          results.push({ id: p.id, ok: false, error: "파싱된 금액이 0 이하" });
          continue;
        }

        /* 결제 수단·PG: source에 따라 결정 */
        const isHyosung = p.source === "hyosung";
        const payMethod = isHyosung ? "cms" : "bank";
        const pgProvider = isHyosung ? "hyosung_cms" : "ibk_bank";

        /* memo 조립 */
        const memoBase = p.parsedMemo || (isHyosung ? "효성 CSV 확정" : "기업은행 입금 확정");
        const memo = `[${isHyosung ? "효성" : "기업은행"} CSV 확정] ${memoBase}`.slice(0, 1000);

        /* hyosung 메타 보강 */
        const raw = (p.rawData || {}) as any;
        const hyosungMemberNo = isHyosung && raw._hyosungMemberNo ? Number(raw._hyosungMemberNo) || null : null;
        const hyosungContractNo = isHyosung && raw._contractNo ? String(raw._contractNo).slice(0, 20) : null;
        const hyosungBillingMonth = isHyosung && raw._billingMonth ? String(raw._billingMonth).slice(0, 10) : null;

        /* INSERT donations */
        const [inserted] = await db.insert(donations).values({
          memberId: m.id,
          donorName: p.parsedName || m.name || "(이름 없음)",
          donorPhone: m.phone,
          donorEmail: m.email,
          amount: p.parsedAmount,
          type: isHyosung ? "regular" : "onetime",
          payMethod,
          pgProvider,
          status: "completed",
          hyosungMemberNo,
          hyosungContractNo,
          hyosungBillingMonth,
          bankDepositorName: !isHyosung ? p.parsedName : null,
          memo,
          createdAt: p.parsedDate || new Date(),
        }).returning({ id: donations.id });

        /* UPDATE pending_donations */
        await db.execute(sql`
          UPDATE pending_donations
          SET status = 'confirmed',
              confirmed_donation_id = ${inserted.id},
              confirmed_by = ${adminMember.id},
              confirmed_at = now(),
              matched_member_id = ${m.id},
              updated_at = now()
          WHERE id = ${p.id}
        `);

        results.push({ id: p.id, ok: true, donationId: inserted.id });
      } catch (rowErr: any) {
        results.push({
          id: p.id,
          ok: false,
          error: String(rowErr?.message || rowErr).slice(0, 300),
        });
      }
    }

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.length - succeeded;

    /* 감사 로그 */
    try {
      await logAdminAction(req, admin.uid, admin.name, "donation_pending_confirm", {
        target: ids.join(","),
        detail: { processed: results.length, succeeded, failed, memberIdOverride },
      });
    } catch {}

    return ok(
      { processed: results.length, succeeded, failed, results, action: "confirm" },
      `확정 완료: ${succeeded}건 성공, ${failed}건 실패`
    );
  } catch (err: any) {
    console.error("[admin-donation-confirm]", err);
    return serverError("후원 확정 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-donation-confirm" };
