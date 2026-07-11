/**
 * /api/admin-payroll
 *   GET  /api/admin-payroll?year=&month=                  월별 명세서 일람
 *   GET  /api/admin-payroll?id=N                          명세서 상세
 *   PATCH /api/admin-payroll?id=N    body { reviewNote?, status? }   수정
 *   POST /api/admin-payroll?id=N&action=approve           승인 (APPROVED)
 *   POST /api/admin-payroll?id=N&action=hold              보류 (HOLD)
 *   POST /api/admin-payroll?action=recalculate&year=&month=   월별 수동 재집계 (3일차에서 구현)
 *
 * 권한: super_admin 전용 (member.role === 'super_admin')
 * R37 1일차 — API 골격. 자동 집계·발송은 후속 일차에서 구현.
 */
import { db } from "../../db/index";
import { payrollSlips, payrollAudit, members } from "../../db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { calculatePayrollForMonth } from "../../lib/payroll-calc";
import { callGemini } from "../../lib/ai-gemini";

export const config = { path: "/api/admin-payroll" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "급여 명세서 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBadRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  const admin = (auth as any).ctx.member;

  const url = new URL(req.url);
  const method = req.method;
  const idParam = url.searchParams.get("id");
  const idNum = idParam ? Number(idParam) : null;

  // GET
  if (method === "GET") {
    // 2026-06-03: 직원 연봉 설정용 — 활성 직원(운영자·관리자) 목록 + 현재 연봉.
    //   회원 모달이 아닌 급여관리에서 직원 연봉을 직접 관리(통합 일반 회원과 분리).
    if (url.searchParams.get("staff") === "1") {
      try {
        const r = await db.execute(sql`
          SELECT id, name, email, role, COALESCE(base_salary, 0)::numeric AS base_salary
          FROM members
          WHERE status = 'active' AND (type = 'admin' OR operator_active = TRUE)
          ORDER BY name
        `);
        const staff = (((r as any).rows || (r as any[])) || []).map((m: any) => ({
          id: Number(m.id), name: m.name, email: m.email, role: m.role,
          baseSalary: Number(m.base_salary || 0),
        }));
        return jsonOk({ staff });
      } catch (err) { return jsonError("select_staff", err); }
    }
    // 상세
    if (idNum) {
      try {
        const [slip] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
        if (!slip) return jsonBadRequest("명세서를 찾을 수 없습니다");
        // 회원 이름 부가 정보
        let memberInfo: any = null;
        try {
          const [m] = await db.select({
            id: members.id, name: members.name, email: members.email,
            role: members.role, milestoneRole: members.milestoneRole,
          }).from(members).where(eq(members.id, Number(slip.memberUid))).limit(1);
          memberInfo = m ?? null;
        } catch (err) {
          console.warn("[admin-payroll] member lookup failed:", err);
        }

        // 수정 이력 (누가·무엇·사유·언제) — 보조 SELECT 실패 시 빈 배열
        let audit: any[] = [];
        try {
          const rows = await db.select()
            .from(payrollAudit)
            .where(eq(payrollAudit.slipId, idNum))
            .orderBy(desc(payrollAudit.createdAt))
            .limit(100);
          // changedBy(=관리자 members.id) → 이름 매핑
          const editorIds = Array.from(new Set(
            rows.map(r => Number(r.changedBy)).filter(n => !isNaN(n))
          ));
          let editorMap = new Map<number, string>();
          if (editorIds.length > 0) {
            try {
              const es = await db.select({ id: members.id, name: members.name })
                .from(members).where(inArray(members.id, editorIds));
              editorMap = new Map(es.map(e => [e.id, e.name]));
            } catch (err) {
              console.warn("[admin-payroll] audit editor lookup failed:", err);
            }
          }
          audit = rows.map(r => ({
            ...r,
            changedByName: editorMap.get(Number(r.changedBy)) ?? null,
          }));
        } catch (err) {
          console.warn("[admin-payroll] audit lookup failed:", err);
        }

        return jsonOk({ slip, member: memberInfo, audit });
      } catch (err) { return jsonError("select_slip_detail", err); }
    }

    // 일람
    try {
      const year = Number(url.searchParams.get("year") || 0);
      const month = Number(url.searchParams.get("month") || 0);
      if (!year || !month) return jsonBadRequest("year·month 필수");

      const rows = await db.select()
        .from(payrollSlips)
        .where(and(eq(payrollSlips.payYear, year), eq(payrollSlips.payMonth, month)))
        .orderBy(desc(payrollSlips.grossPay))
        .limit(500); // OP-030: 안전 상한(§6.3 페이지네이션 limit 명시)

      // 회원 정보 separate query + Map (drizzle leftJoin 체인 금지 §6.3)
      const memberIds = Array.from(new Set(rows.map(r => Number(r.memberUid)).filter(n => !isNaN(n))));
      let memberMap = new Map<number, any>();
      if (memberIds.length > 0) {
        try {
          const ms = await db.select({
            id: members.id, name: members.name, email: members.email,
            role: members.role, milestoneRole: members.milestoneRole,
          }).from(members).where(inArray(members.id, memberIds));
          memberMap = new Map(ms.map(m => [m.id, m]));
        } catch (err) {
          console.warn("[admin-payroll] member batch lookup failed:", err);
        }
      }

      /* 저장소 키는 클라이언트에 내보내지 않는다 — 존재 여부만 알린다 */
      const enriched = rows.map(r => {
        const { documentR2Key, signedDocumentR2Key, ...rest } = r as any;
        return {
          ...rest,
          memberName: memberMap.get(Number(r.memberUid))?.name ?? null,
          memberEmail: memberMap.get(Number(r.memberUid))?.email ?? null,
          memberMilestoneRole: memberMap.get(Number(r.memberUid))?.milestoneRole ?? null,
          hasDocument: !!documentR2Key,
          hasSignedDocument: !!signedDocumentR2Key,
        };
      });

      // 통계 카드용 카운트
      const counts = {
        DRAFT: 0, REVIEWED: 0, APPROVED: 0, SENT: 0, HOLD: 0, PAID: 0,
      };
      for (const r of rows) {
        if (r.status in counts) counts[r.status as keyof typeof counts]++;
      }

      /* 수령확인(전자서명) 현황 — 교부된 명세서만 대상 */
      const issued = rows.filter(r => r.status === "SENT" || r.status === "PAID");
      const ackCounts = {
        issued: issued.length,
        pending: issued.filter(r => (r as any).ackStatus === "PENDING").length,
        acknowledged: issued.filter(r => (r as any).ackStatus === "ACKNOWLEDGED").length,
        objected: issued.filter(r => (r as any).ackStatus === "OBJECTED").length,
      };

      return jsonOk({ rows: enriched, counts, ackCounts, total: rows.length });
    } catch (err) { return jsonError("select_slips", err); }
  }

  // PATCH — 금액 직접편집·조정라인·검토메모·상태
  if (method === "PATCH") {
    if (!idNum) return jsonBadRequest("id 필수");
    let body: any;
    try { body = await req.json(); } catch { return jsonBadRequest("JSON 본문 필수"); }

    const MONEY_FIELDS = [
      "baseSalaryMonth", "overtimePay", "deductionUnpaid", "performanceBonus", "perfectBonus",
      "incomeTax", "localTax", "nationalPension", "healthInsurance", "longTermCare",
      "employmentInsurance", "otherDeduction",
    ];
    const SNAKE: Record<string, string> = {
      baseSalaryMonth: "base_salary_month", overtimePay: "overtime_pay", deductionUnpaid: "deduction_unpaid",
      performanceBonus: "performance_bonus", perfectBonus: "perfect_bonus",
      incomeTax: "income_tax", localTax: "local_tax", nationalPension: "national_pension",
      healthInsurance: "health_insurance", longTermCare: "long_term_care",
      employmentInsurance: "employment_insurance", otherDeduction: "other_deduction",
    };
    const isEdit = MONEY_FIELDS.some(f => f in body) || "adjustments" in body;

    try {
      const [cur] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
      if (!cur) return jsonBadRequest("명세서를 찾을 수 없습니다");

      // P2-25 fix: 지급 완료(PAID) 명세서는 서버에서도 금액 수정·상태 변경 차단 (화면 잠금만으론 직접 호출로 우회 가능)
      if (cur.status === "PAID" && (isEdit || typeof body.status === "string")) {
        return jsonBadRequest("지급 완료된 명세서는 수정·상태 변경할 수 없습니다 (정정은 지급 취소 절차로 진행)");
      }

      const update: any = { updatedAt: new Date() };
      const auditRows: Array<{ field: string; oldValue: string; newValue: string }> = [];

      if (isEdit) {
        const r2 = (n: number) => Math.round(n * 100) / 100;
        const next: Record<string, number> = {};
        for (const f of MONEY_FIELDS) {
          next[f] = (f in body) ? Number(body[f]) : Number((cur as any)[f] || 0);
          if (!Number.isFinite(next[f])) return jsonBadRequest(`${f} 숫자 오류`);
        }
        // 조정 라인 [{label, amount, kind:'ADD'|'DEDUCT', reason}]
        let adjustments: any[] = Array.isArray((cur as any).adjustments) ? (cur as any).adjustments : [];
        if ("adjustments" in body) {
          if (!Array.isArray(body.adjustments)) return jsonBadRequest("adjustments는 배열이어야 합니다");
          adjustments = body.adjustments.map((a: any) => ({
            label: String(a?.label || "").slice(0, 60),
            amount: Number(a?.amount) || 0,
            kind: a?.kind === "DEDUCT" ? "DEDUCT" : "ADD",
            reason: String(a?.reason || "").slice(0, 200),
          }));
        }
        const adjAdd = adjustments.filter(a => a.kind === "ADD").reduce((s, a) => s + (Number(a.amount) || 0), 0);
        const adjDeduct = adjustments.filter(a => a.kind === "DEDUCT").reduce((s, a) => s + (Number(a.amount) || 0), 0);

        const grossPay = next.baseSalaryMonth + next.overtimePay - next.deductionUnpaid
          + next.performanceBonus + next.perfectBonus + adjAdd - adjDeduct;
        const totalDeduction = next.incomeTax + next.localTax + next.nationalPension
          + next.healthInsurance + next.longTermCare + next.employmentInsurance + next.otherDeduction;
        const netPay = grossPay - totalDeduction;

        for (const f of MONEY_FIELDS) {
          const oldV = Number((cur as any)[f] || 0);
          if (r2(oldV) !== r2(next[f])) {
            auditRows.push({ field: SNAKE[f], oldValue: String(r2(oldV)), newValue: String(r2(next[f])) });
          }
          update[f] = String(r2(next[f]));
        }
        if ("adjustments" in body) {
          const oldAdj = JSON.stringify((cur as any).adjustments || []);
          const newAdj = JSON.stringify(adjustments);
          if (oldAdj !== newAdj) auditRows.push({ field: "adjustments", oldValue: oldAdj.slice(0, 500), newValue: newAdj.slice(0, 500) });
          update.adjustments = adjustments;
        }
        update.grossPay = String(r2(grossPay));
        update.totalDeduction = String(r2(totalDeduction));
        update.netPay = String(r2(netPay));
        update.manuallyEdited = true;   // 재집계가 덮지 않도록 잠금

        /* 2026-07-11: 금액을 손댔으므로 이미 교부해둔 고정 문서는 더 이상 이 명세서의 내용이 아니다.
           버려야 다시 발송할 때 새 문서(정정 차수)가 만들어진다 — 안 버리면 옛 PDF가 그대로 재발송된다.
           받아둔 서명도 '바뀌기 전 문서'에 대한 것이므로 수령확인을 다시 받는다.
           (지난 서명 증적은 payroll_acknowledgments에 그대로 남는다) */
        if (auditRows.length > 0 && (cur as any).documentR2Key) {
          update.documentR2Key = null;
          update.documentSha256 = null;
          update.signedDocumentR2Key = null;
          update.ackStatus = "PENDING";
          update.ackAt = null;
          update.firstViewedAt = null;
          update.reminderCount = 0;
          update.reminderSentAt = null;
        }
      }

      if (typeof body.reviewNote === "string") update.reviewNote = body.reviewNote;
      if (typeof body.status === "string") {
        const allowed = ["DRAFT", "REVIEWED", "APPROVED", "SENT", "HOLD"];
        if (!allowed.includes(body.status)) return jsonBadRequest("status 값 부적합 (PAID는 지급 확정 액션으로)");
        update.status = body.status;
        if (body.status === "REVIEWED") {
          update.reviewedBy = String(admin.id);
          update.reviewedAt = new Date();
        }
      }

      const [updated] = await db.update(payrollSlips).set(update)
        .where(eq(payrollSlips.id, idNum)).returning();
      if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");

      // 수정 이력 기록 (누가·무엇·사유)
      if (auditRows.length) {
        const reason = String(body.reason || "").slice(0, 200);
        try {
          await db.insert(payrollAudit).values(auditRows.map(a => ({
            slipId: idNum, changedBy: String(admin.id),
            field: a.field, oldValue: a.oldValue, newValue: a.newValue, reason,
          })));
        } catch (e) { console.warn("[admin-payroll] audit insert failed:", e); }
      }
      return jsonOk(updated);
    } catch (err) { return jsonError("update_slip", err); }
  }

  // POST — action 분기
  if (method === "POST") {
    const action = url.searchParams.get("action") || "";

    // 승인
    if (action === "approve") {
      if (!idNum) return jsonBadRequest("id 필수");
      try {
        // P2-25 fix: 초안·검토완료·보류에서만 승인 (지급완료·발송된 건의 상태 회귀 차단)
        const [curA] = await db.select({ status: payrollSlips.status })
          .from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
        if (!curA) return jsonBadRequest("명세서를 찾을 수 없습니다");
        if (!["DRAFT", "REVIEWED", "HOLD"].includes(curA.status)) {
          return jsonBadRequest("초안·검토완료·보류 상태에서만 승인할 수 있습니다");
        }
        const update: any = {
          status: "APPROVED",
          approvedBy: String(admin.id),
          approvedAt: new Date(),
          updatedAt: new Date(),
        };
        const [updated] = await db.update(payrollSlips).set(update)
          .where(eq(payrollSlips.id, idNum)).returning();
        if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");
        return jsonOk(updated);
      } catch (err) { return jsonError("approve_slip", err); }
    }

    // 보류
    if (action === "hold") {
      if (!idNum) return jsonBadRequest("id 필수");
      let body: any = {};
      try { body = await req.json(); } catch { /* 본문 없어도 허용 */ }
      try {
        // P2-25 fix: 지급 완료 명세서는 보류로 되돌릴 수 없음
        const [curH] = await db.select({ status: payrollSlips.status })
          .from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
        if (!curH) return jsonBadRequest("명세서를 찾을 수 없습니다");
        if (curH.status === "PAID") return jsonBadRequest("지급 완료된 명세서는 보류할 수 없습니다");
        const update: any = { status: "HOLD", updatedAt: new Date() };
        if (typeof body.reviewNote === "string") update.reviewNote = body.reviewNote;
        const [updated] = await db.update(payrollSlips).set(update)
          .where(eq(payrollSlips.id, idNum)).returning();
        if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");
        return jsonOk(updated);
      } catch (err) { return jsonError("hold_slip", err); }
    }

    // 지급 확정 (PAID·지급일·처리자 기록 — APPROVED/SENT에서만)
    if (action === "paid") {
      if (!idNum) return jsonBadRequest("id 필수");
      try {
        const [cur] = await db.select({ status: payrollSlips.status })
          .from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
        if (!cur) return jsonBadRequest("명세서를 찾을 수 없습니다");
        if (!["APPROVED", "SENT"].includes(cur.status)) {
          return jsonBadRequest("승인(APPROVED) 또는 발송(SENT) 상태에서만 지급 확정 가능합니다");
        }
        const paidUpdate: any = {
          status: "PAID", paidBy: String(admin.id), paidAt: new Date(), updatedAt: new Date(),
        };
        const [updated] = await db.update(payrollSlips).set(paidUpdate)
          .where(eq(payrollSlips.id, idNum)).returning();
        return jsonOk(updated);
      } catch (err) { return jsonError("paid_slip", err); }
    }

    // AI 분석 — 이상치 탐지 + 입력 누락·오류 점검(휴리스틱) + 집계 요약(Gemini)
    if (action === "analyze") {
      const y = Number(url.searchParams.get("year") || 0);
      const m = Number(url.searchParams.get("month") || 0);
      if (!y || !m) return jsonBadRequest("year·month 필수");
      try {
        // 이번 달 + 전월 명세서
        const curSlips = await db.select().from(payrollSlips)
          .where(and(eq(payrollSlips.payYear, y), eq(payrollSlips.payMonth, m)));
        const pm = m === 1 ? 12 : m - 1;
        const py = m === 1 ? y - 1 : y;
        const prevSlips = await db.select({ memberUid: payrollSlips.memberUid, netPay: payrollSlips.netPay })
          .from(payrollSlips)
          .where(and(eq(payrollSlips.payYear, py), eq(payrollSlips.payMonth, pm)));
        const prevNet = new Map<string, number>();
        for (const p of prevSlips) prevNet.set(String(p.memberUid), Number(p.netPay || 0));

        // 회원 이름 맵
        const ids = Array.from(new Set(curSlips.map(s => Number(s.memberUid)).filter(n => !isNaN(n))));
        const nameMap = new Map<number, string>();
        if (ids.length) {
          try {
            const ms = await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ids));
            for (const mm of ms) nameMap.set(mm.id, mm.name);
          } catch { /* 이름 없어도 계속 */ }
        }
        const nameOf = (uid: string) => nameMap.get(Number(uid)) || `직원#${uid}`;

        // ── 이상치 탐지 (규칙 기반) ──
        const anomalies: Array<{ memberUid: string; name: string; type: string; detail: string }> = [];
        let sumGross = 0, sumNet = 0;
        for (const s of curSlips) {
          const gross = Number(s.grossPay || 0);
          const net = Number(s.netPay || 0);
          const ded = Number(s.totalDeduction || 0);
          sumGross += gross; sumNet += net;
          const nm = nameOf(s.memberUid);
          if (net < 0) anomalies.push({ memberUid: s.memberUid, name: nm, type: "음수 실수령", detail: `실수령 ${Math.round(net).toLocaleString()}원 — 공제가 지급을 초과` });
          if (gross > 0 && ded > gross) anomalies.push({ memberUid: s.memberUid, name: nm, type: "공제 과다", detail: `공제 ${Math.round(ded).toLocaleString()}원 > 세전 ${Math.round(gross).toLocaleString()}원` });
          const pv = prevNet.get(String(s.memberUid));
          if (pv != null && pv > 0) {
            const chg = (net - pv) / pv;
            if (Math.abs(chg) >= 0.3) {
              anomalies.push({ memberUid: s.memberUid, name: nm, type: chg > 0 ? "전월 대비 급증" : "전월 대비 급감", detail: `전월 ${Math.round(pv).toLocaleString()} → 이번달 ${Math.round(net).toLocaleString()}원 (${chg > 0 ? "+" : ""}${(chg * 100).toFixed(0)}%)` });
            }
          }
        }

        // ── 입력 누락·오류 점검 ──
        const checklist: Array<{ type: string; detail: string }> = [];
        // 기본급 미설정 활성 운영자 (명세서 자체가 안 생김)
        try {
          const noSalary: any = await db.execute(sql`
            SELECT name FROM members
            WHERE status = 'active' AND (type = 'admin' OR operator_active = TRUE)
              AND COALESCE(base_salary, 0) = 0
            ORDER BY name LIMIT 50
          `);
          const nsRows = (noSalary.rows ?? noSalary ?? []) as any[];
          if (nsRows.length) checklist.push({ type: "기본급 미설정", detail: `${nsRows.length}명 — 명세서 생성 대상에서 제외됨 (${nsRows.slice(0, 5).map((r: any) => r.name).join(", ")}${nsRows.length > 5 ? " 외" : ""})` });
        } catch { /* 무시 */ }
        const draftCount = curSlips.filter(s => s.status === "DRAFT").length;
        if (draftCount) checklist.push({ type: "미검토 DRAFT", detail: `${draftCount}건이 검토 전(DRAFT) 상태입니다` });
        const holdCount = curSlips.filter(s => s.status === "HOLD").length;
        if (holdCount) checklist.push({ type: "보류(HOLD)", detail: `${holdCount}건이 보류 상태입니다` });
        if (curSlips.length === 0) checklist.push({ type: "명세서 없음", detail: "이 달 집계된 명세서가 없습니다 (기본급+근무실적 있는 직원 없음)" });

        // ── 집계 요약 (Gemini, 실패 시 휴리스틱 텍스트) ──
        const facts = `대상 월: ${y}년 ${m}월
명세서 건수: ${curSlips.length}건
세전 총액: ${Math.round(sumGross).toLocaleString()}원
실수령 총액: ${Math.round(sumNet).toLocaleString()}원
이상치: ${anomalies.length}건${anomalies.length ? " (" + anomalies.slice(0, 5).map(a => `${a.name} ${a.type}`).join(", ") + ")" : ""}
점검 항목: ${checklist.length}건${checklist.length ? " (" + checklist.map(c => c.type).join(", ") + ")" : ""}`;

        let summary = "";
        try {
          const g = await callGemini(
            `당신은 NPO의 급여 담당 보조입니다. 아래 ${y}년 ${m}월 급여 집계 사실만 근거로, 운영자가 빠르게 파악할 3~5문장 한국어 총평을 작성하세요. 과장·추측 금지, 숫자는 사실 그대로. 이상치·점검 항목이 있으면 무엇을 확인해야 하는지 안내하세요.\n\n${facts}`,
            { featureKey: "payroll_ai_summary", mode: "flash", maxOutputTokens: 600, temperature: 0.3 }
          );
          summary = g.ok && g.text ? g.text.trim() : "";
        } catch { /* 폴백 */ }
        if (!summary) {
          summary = `${y}년 ${m}월 급여 명세서 ${curSlips.length}건, 세전 총액 ${Math.round(sumGross).toLocaleString()}원·실수령 ${Math.round(sumNet).toLocaleString()}원입니다. ` +
            (anomalies.length ? `이상치 ${anomalies.length}건을 확인하세요. ` : "이상치는 없습니다. ") +
            (checklist.length ? `점검 항목 ${checklist.length}건이 있습니다.` : "점검할 항목은 없습니다.");
        }

        return jsonOk({
          year: y, month: m, slipCount: curSlips.length,
          sumGross: Math.round(sumGross), sumNet: Math.round(sumNet),
          anomalies, checklist, summary,
        });
      } catch (err) { return jsonError("analyze", err); }
    }

    // 월별 수동 재집계 — lib/payroll-calc.ts 의 calculatePayrollForMonth 공유
    //   memberUid 지정 시 그 직원 1명만 재집계 (다른 직원 명세서는 손대지 않음).
    //   근태를 뒤늦게 바로잡았는데 그 달 다른 직원은 이미 승인·발송된 상황에서 필요.
    if (action === "recalculate") {
      const y = Number(url.searchParams.get("year") || 0);
      const m = Number(url.searchParams.get("month") || 0);
      if (!y || !m) return jsonBadRequest("year·month 필수");
      let body: any = {};
      try { body = await req.json(); } catch { /* 본문 없어도 허용 */ }
      const force = body?.force === true;
      const memberUid = url.searchParams.get("memberUid") || body?.memberUid || undefined;
      try {
        const r = await calculatePayrollForMonth(y, m, { force, memberUid });
        return jsonOk(r);
      } catch (err) { return jsonError("recalculate", err); }
    }

    return jsonBadRequest("action 값 부적합 (approve|hold|paid|recalculate|analyze)");
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
