import { db } from "../../db/index";
import { attCorrections, attRecords, members } from "../../db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { determineStatus, getDefaultPolicy } from "../../lib/att-utils";
import { rebuildSingleSession } from "../../lib/att-session";
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

    // 결재 상태 업데이트
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

    // APPROVED: att_records 해당 날짜 기록 UPSERT (없으면 INSERT, 있으면 UPDATE)
    //           + 변경된 출퇴근으로 status 재산정
    if (action === "APPROVED") {
      try {
        const wantCI = correction.correctionType === "CHECK_IN"  || correction.correctionType === "BOTH";
        const wantCO = correction.correctionType === "CHECK_OUT" || correction.correctionType === "BOTH";

        // 기존 row 조회 (status 재산정 시 기존 lat/lng 유지)
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

        // status 재산정
        let newStatus = existing?.status ?? "NORMAL";
        try {
          const policy = await getDefaultPolicy();
          if (policy) {
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
              },
              false,
              false,
              existing?.workMode,
            );
          }
        } catch (innerErr) {
          console.warn("[admin-att-correction-review] status 재산정 실패:", innerErr);
        }

        /* sessions 동기화 — 요약 시각과 정합화(안 하면 같은 날 직원 재출근·퇴근 시 stale 재계산으로 정정이 되돌아감).
           기존 위치·거점 정보는 보존. */
        const ciISO = newCheckIn  ? new Date(newCheckIn  as any).toISOString() : null;
        const coISO = newCheckOut ? new Date(newCheckOut as any).toISOString() : null;
        const ns = rebuildSingleSession(ciISO, coISO, {
          inLat: existing?.checkInLat, inLng: existing?.checkInLng,
          outLat: existing?.checkOutLat, outLng: existing?.checkOutLng,
          workplaceId: existing?.workplaceId ?? null,
        });
        const nsJson = JSON.stringify(ns);

        // UPSERT
        await db.execute(sql`
          INSERT INTO att_records
            (member_uid, date, check_in_time, check_out_time, status, is_manually_adjusted, sessions)
          VALUES
            (${correction.memberUid}, ${String(correction.targetDate)}::date,
             ${newCheckIn as any}, ${newCheckOut as any}, ${newStatus}, true, ${nsJson}::jsonb)
          ON CONFLICT (member_uid, date)
          DO UPDATE SET
            check_in_time  = ${newCheckIn as any},
            check_out_time = ${newCheckOut as any},
            status         = ${newStatus},
            is_manually_adjusted = true,
            sessions       = ${nsJson}::jsonb,
            updated_at     = NOW()
        `);
      } catch (err) {
        console.warn("[admin-att-correction-review] 출퇴근 기록 반영 실패:", err);
      }
    }

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
