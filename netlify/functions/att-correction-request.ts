import { db } from "../../db/index";
import { attCorrections, members } from "../../db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { broadcastNotification } from "../../lib/workspace-logger";
import { notifyAllOperators } from "../../lib/notify";
import { normalizeEvidenceFiles } from "../../lib/att-evidence";

export const config = { path: "/api/att-correction-request" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "수정 요청 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  const method = req.method;

  const memberUid: string = String(auth.ctx.member.id);

  // GET — 본인 수정 요청 내역
  if (method === "GET") {
    try {
      const rows = await db
        .select()
        .from(attCorrections)
        .where(eq(attCorrections.memberUid, memberUid))
        .orderBy(sql`created_at DESC`)
        .limit(100);
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_corrections", err);
    }
  }

  // POST — 수정 요청 등록
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { targetDate, correctionType, requestedCheckIn, requestedCheckOut, reason, evidenceUrl } = body;
    if (!targetDate || !correctionType) {
      return jsonError("validate", new Error("targetDate, correctionType 필수"), 400);
    }
    if (!["CHECK_IN", "CHECK_OUT", "BOTH"].includes(correctionType)) {
      return jsonError("validate_type", new Error("correctionType은 CHECK_IN|CHECK_OUT|BOTH"), 400);
    }
    if (!reason || !String(reason).trim()) {
      return jsonError("validate_reason", new Error("사유는 필수입니다"), 400);
    }

    /* 증빙 첨부 — 본인 파일함의 파일만 붙일 수 있다(남의 파일 번호는 여기서 걸러진다).
       사유만으로 판단하기 어려운 정정(출장·병원·회의 등)을 결재자가 서류로 확인할 수 있게 한다. */
    let evidenceFiles: any[] = [];
    try {
      evidenceFiles = await normalizeEvidenceFiles(Number(memberUid), body.evidenceFiles);
    } catch (err) {
      console.warn("[att-correction-request] 첨부 확인 실패(첨부 없이 계속):", err);
    }

    let insertedRow: any;
    try {
      const [row] = await db.insert(attCorrections).values({
        memberUid,
        targetDate,
        correctionType,
        requestedCheckIn:  requestedCheckIn  ? new Date(requestedCheckIn)  : null,
        requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
        reason:       reason,
        evidenceUrl:  evidenceUrl  ?? null,
        evidenceFiles: evidenceFiles as any,
        status: "PENDING",
      } as any).returning();
      insertedRow = row;
    } catch (err) {
      return jsonError("insert_correction", err);
    }

    /* OP-024: 결재 대기 알림 수신자를 휴가 신청(att-leave-request)과 동일하게 통일.
       기존엔 정정 요청만 super_admin 한정이라 같은 '결재 대기' 워크플로우인데 수신 범위가 달랐다.
       실제 결재 권한자(권한 계층 OP-019 결정 시 notifyAllOperators 대상도 함께 조정)에게 일관 발송. */
    const actorName = auth.ctx.member.name ?? "직원";
    try {
      await notifyAllOperators({
        category: "system",
        severity: "info",
        title: `근태 정정 결재 대기 — ${actorName}`,
        message: `${targetDate} 출퇴근 정정 요청 접수${reason ? ` · ${String(reason).slice(0, 80)}` : ""}` +
          (evidenceFiles.length ? ` · 증빙 ${evidenceFiles.length}건 첨부` : ""),
        link: "/cms-tbfa.html#att-ops",
        refTable: "att_corrections",
        refId: insertedRow.id,
      });
    } catch (err) {
      console.warn("[att-correction-request] 결재 대기 알림 실패:", err);
    }

    return jsonOk(insertedRow, 201);
  }

  return new Response("Method Not Allowed", { status: 405 });
}
