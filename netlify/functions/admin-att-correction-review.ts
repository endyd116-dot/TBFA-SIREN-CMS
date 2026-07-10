import { db } from "../../db/index";
import { attCorrections, attRecords, members } from "../../db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { determineStatus, getDefaultPolicy, getFlexRangeMins, flexStartFloor } from "../../lib/att-utils";
import { rebuildSingleSession, recomputeSummary } from "../../lib/att-session";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/admin-att-correction-review" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "수정 요청 결재 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // R45 §4-1: 근태 정정 결재는 운영자 허용(att_manage)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "att_manage"))) {
    return new Response(JSON.stringify({ ok: false, error: "근태 관리 권한이 없습니다" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  // GET — 결재 대기/처리 목록 (status=PENDING 기본)
  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status") ?? "PENDING";

      const rows = await db
        .select()
        .from(attCorrections)
        .where(eq(attCorrections.status, status))
        .orderBy(attCorrections.createdAt)
        .limit(100);

      // member 이름·이메일 조인 (memberUid 는 members.id 의 문자열 형태)
      const memberIds = Array.from(
        new Set(rows.map(r => Number(r.memberUid)).filter(n => Number.isFinite(n) && n > 0))
      );
      let memberMap = new Map<number, { name: string; email: string }>();
      if (memberIds.length > 0) {
        try {
          const mRows = await db
            .select({ id: members.id, name: members.name, email: members.email })
            .from(members)
            .where(inArray(members.id, memberIds));
          for (const m of mRows) memberMap.set(m.id, { name: m.name, email: m.email });
        } catch (e) {
          console.warn("[admin-att-correction-review] member 조인 실패:", e);
        }
      }

      const corrections = rows.map(r => {
        const info = memberMap.get(Number(r.memberUid));
        return {
          id: r.id,
          memberUid: r.memberUid,
          memberName: info?.name ?? "—",
          memberEmail: info?.email ?? "",
          targetDate: r.targetDate,
          correctionType: r.correctionType,
          requestedCheckIn: r.requestedCheckIn,
          requestedCheckOut: r.requestedCheckOut,
          reason: r.reason,
          status: r.status,
          submittedAt: r.createdAt,
        };
      });
      return jsonOk({ corrections });
    } catch (err) {
      return jsonError("select_corrections", err);
    }
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { requestId, action, note } = body;
  if (!requestId || !action) {
    return jsonError("validate", new Error("requestId, action 필수"), 400);
  }
  if (!["APPROVED", "REJECTED"].includes(action)) {
    return jsonError("validate_action", new Error("action은 APPROVED|REJECTED"), 400);
  }

  try {
    const [correction] = await db
      .select()
      .from(attCorrections)
      .where(eq(attCorrections.id, requestId))
      .limit(1);

    if (!correction) return jsonError("not_found", new Error("수정 요청 없음"), 404);
    if (correction.status !== "PENDING") {
      return jsonError("already_reviewed", new Error("이미 처리된 요청"), 409);
    }

    // P2-56 fix: 셀프 결재 차단 — 본인이 신청한 정정은 본인이 승인할 수 없음 (이사장 예외)
    if (action === "APPROVED"
        && String(correction.memberUid) === String(auth.ctx.member.id)
        && auth.ctx.member.role !== "super_admin") {
      return jsonError("self_review", new Error("본인이 신청한 건은 본인이 승인할 수 없습니다 (다른 결재자에게 요청하세요)"), 403);
    }

    // ── APPROVED: 먼저 att_records에 반영(근무·야근 재계산 포함). 실패 시 결재 중단(조용한 실패 방지) ──
    if (action === "APPROVED") {
      try {
        const wantCI = correction.correctionType === "CHECK_IN"  || correction.correctionType === "BOTH";
        const wantCO = correction.correctionType === "CHECK_OUT" || correction.correctionType === "BOTH";

        // 기존 row 조회 (기존 lat/lng·근무형태 유지)
        const [existing] = await db
          .select()
          .from(attRecords)
          .where(and(
            eq(attRecords.memberUid, correction.memberUid),
            eq(attRecords.date, correction.targetDate),
          ))
          .limit(1);

        const newCheckIn  = wantCI ? correction.requestedCheckIn  : (existing?.checkInTime ?? null);
        const newCheckOut = wantCO ? correction.requestedCheckOut : (existing?.checkOutTime ?? null);
        const ciISO = newCheckIn  ? new Date(newCheckIn  as any).toISOString() : null;
        const coISO = newCheckOut ? new Date(newCheckOut as any).toISOString() : null;

        const policy = await getDefaultPolicy();

        // status 재산정 (유연근무 반영)
        let newStatus = existing?.status ?? "NORMAL";
        if (policy) {
          try {
            newStatus = determineStatus(
              newCheckIn ? new Date(newCheckIn as any) : null,
              newCheckOut ? new Date(newCheckOut as any) : null,
              {
                checkInTime:         String(policy.checkInTime),
                checkOutTime:        String(policy.checkOutTime),
                lateGraceMins:       policy.lateGraceMins,
                earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
                coreStartTime:       policy.coreStartTime ? String(policy.coreStartTime) : null,
                coreEndTime:         policy.coreEndTime   ? String(policy.coreEndTime)   : null,
                flexEnabled:         policy.flexEnabled,
                flexRangeMins:       policy.flexEnabled ? await getFlexRangeMins() : undefined,
              },
              false, false, existing?.workMode,
            );
          } catch (innerErr) {
            console.warn("[admin-att-correction-review] status 재산정 실패:", innerErr);
          }
        }

        /* sessions 재구성 — 요약 시각과 정합화(위치·거점 보존) */
        const ns = rebuildSingleSession(ciISO, coISO, {
          inLat: existing?.checkInLat, inLng: existing?.checkInLng,
          outLat: existing?.checkOutLat, outLng: existing?.checkOutLng,
          workplaceId: existing?.workplaceId ?? null,
        });
        // ★ 근무시간·야근시간 재계산 (유연 출근 하한 반영) — 승인이 집계에 반영되도록 (기존 누락 버그 fix)
        let workingMins: number | null = null;
        let overtimeMins = 0;
        if (policy && ciISO && coISO) {
          let minStart: Date | null = null;
          if (policy.flexEnabled) {   // 2026-07-10: 전 근무형태 하한 적용
            try { minStart = flexStartFloor(new Date(ciISO), String(policy.checkInTime), await getFlexRangeMins()); } catch {}
          }
          const summary = recomputeSummary(ns, {
            dailyHours: policy.dailyHours, breakMins: policy.breakMins, breakThresholdHours: policy.breakThresholdHours,
          }, minStart);
          workingMins = summary.workingMins;
          overtimeMins = summary.overtimeMins;
        }

        // UPSERT — drizzle insert(att-checkin/checkout와 동일 방식·타입 안전).
        //   기존 raw SQL의 Date 바인딩이 조용히 실패해 '승인해도 반영 안됨'이었음.
        const ciDate = newCheckIn  ? new Date(newCheckIn  as any) : null;
        const coDate = newCheckOut ? new Date(newCheckOut as any) : null;
        await db.insert(attRecords).values({
          memberUid: correction.memberUid,
          date: String(correction.targetDate),
          checkInTime: ciDate,
          checkOutTime: coDate,
          status: newStatus,
          isManuallyAdjusted: true,
          sessions: ns as any,
          workingMins,
          overtimeMins,
        } as any).onConflictDoUpdate({
          target: [attRecords.memberUid, attRecords.date],
          set: {
            checkInTime: ciDate,
            checkOutTime: coDate,
            status: newStatus,
            isManuallyAdjusted: true,
            sessions: ns as any,
            workingMins,
            overtimeMins,
            updatedAt: new Date(),
          } as any,
        });
      } catch (err) {
        // 조용한 실패 방지 — 반영 실패 시 결재 중단(결재 상태도 안 바꿈)
        return jsonError("apply_att_record", err);
      }
    }

    // 결재 상태 업데이트 (att_records 반영 성공 후)
    const [updated] = await db
      .update(attCorrections)
      .set({
        status: action,
        reviewedBy: String(auth.ctx.member.id),
        reviewNote: note ?? null,
        updatedAt: new Date(),
      } as any)
      .where(eq(attCorrections.id, requestId))
      .returning();

    // 결과 알림 → 신청자
    try {
      const recipientId = Number(correction.memberUid);
      if (Number.isFinite(recipientId) && recipientId > 0) {
        await sendWorkspaceNotification({
          memberId: recipientId,
          sourceType: "event" as any,
          sourceId: correction.id,
          notifType: action === "APPROVED" ? "approved" : "rejected",
          channel: "bell",
          title: action === "APPROVED" ? "근태 수정 요청 승인" : "근태 수정 요청 반려",
          body: `${correction.targetDate} 수정 요청이 ${action === "APPROVED" ? "승인" : "반려"}되었습니다.${note ? ` · ${String(note).slice(0, 100)}` : ""}`,
          actionUrl: "/workspace-attendance.html",
          category: "system",
        });
      }
    } catch (err) {
      console.warn("[admin-att-correction-review] 결과 알림 실패:", err);
    }

    return jsonOk(updated);
  } catch (err) {
    return jsonError("review_correction", err);
  }
}
