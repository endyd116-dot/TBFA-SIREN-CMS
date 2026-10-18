/**
 * GET /api/admin/customer-journey?member=N   |   ?potential=N
 *
 * 고객 여정 집계 (2026-10-18) — 잠재·예비·정기 어느 화면에서든 한 사람을 누르면
 * 시작 경로 → 회원 가입 → 후원(금액·시기·대상·수단) → 정기 약정(효성 계좌·카드·입금) → 발송·너처링 → 관리자 메모까지
 * 한 번에 본다. AM 리드관리 «통합 타임라인» 형태.
 *
 * 응답 data 최상위 키(화면 계약·설계서 §2): subject · profile · potential · origin · donations · regular · comms · support · notes · activity · timeline · meta
 * 블록마다 독립 try/catch — 한 블록이 실패해도 패널은 열리고 meta.warnings에 사유만 남긴다.
 * 제외: SIREN 신고·외부기관 의뢰(민감). 유족 지원 신청은 건수·제목·상태만.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { type DonorStage, STAGE_LABEL, stageFromMemberRow, computeAutoStage, getActiveOverride } from "../../lib/donor-stage";

export const config = { path: "/api/admin/customer-journey" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const iso = (v: any): string | null => { if (!v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: any): string | null => (v == null || v === "" ? null : String(v));

interface TimelineItem { at: string; kind: string; title: string; detail?: string | null; amount?: number | null; status?: string | null; refId?: number | string | null }

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  if (req.method !== "GET") return new Response(jsonKST({ ok: false, error: "Method Not Allowed" }), { status: 405, headers: JSON_HEADER });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  let memberId = Number(url.searchParams.get("member")) || 0;
  const potentialParam = Number(url.searchParams.get("potential")) || 0;
  if (!memberId && !potentialParam) {
    return new Response(jsonKST({ ok: false, error: "member 또는 potential 파라미터가 필요합니다" }), { status: 400, headers: JSON_HEADER });
  }

  const warnings: string[] = [];
  const safe = async <T,>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e: any) { warnings.push(`${label}: ${String(e?.message || e).slice(0, 160)}`); return fallback; }
  };
  const t0 = Date.now();

  try {
    /* ── 0. 잠재 행에서 출발한 경우: 연결된 회원이 있으면 회원 기준으로 확장 ── */
    let potentialSelf: any = null;
    if (potentialParam) {
      potentialSelf = rowsOf(await db.execute(sql`
        SELECT id, name, phone, email, address, event_name, entry_path, participated_at, memo, linked_member_id, linked_at, linked_by, created_at
          FROM potential_donors WHERE id = ${potentialParam} LIMIT 1`))[0] || null;
      if (!potentialSelf) return new Response(jsonKST({ ok: false, error: "잠재 후원자를 찾을 수 없습니다" }), { status: 404, headers: JSON_HEADER });
      if (!memberId && potentialSelf.linked_member_id) memberId = Number(potentialSelf.linked_member_id);
    }

    /* ── 1. 회원 프로필 ── */
    let m: any = null;
    if (memberId) {
      m = rowsOf(await db.execute(sql`
        SELECT m.id, m.name, m.phone, m.email, m.type, m.status, m.role, m.member_category, m.member_subtype,
               m.created_at, m.updated_at, m.last_login_at, m.withdrawn_at, m.withdrawn_reason, m.blacklisted_at, m.blacklist_reason,
               m.school_name, m.memo, m.agree_email, m.agree_sms, m.agree_mail, m.email_verified, m.phone_verified_at, m.kakao_marketing_consent_at,
               m.donor_type, m.prospect_subtype, m.donor_channels, m.donor_evaluated_at, m.prospect_event_name, m.prospect_entry_path,
               m.total_donation_amount, m.regular_months_count, m.next_billing_date, m.billing_day, m.billing_retry_count, m.billing_last_failed_at,
               m.hyosung_member_no, m.hyosung_contract_status, m.hyosung_payment_method, m.hyosung_payment_tool, m.hyosung_bank_info, m.hyosung_promise_day, m.hyosung_synced_at,
               m.churn_risk_score, m.churn_risk_level, m.churn_last_evaluated_at, m.churn_signals,
               m.grade_id, m.grade_assigned_at, m.grade_locked, g.code AS grade_code, g.name_ko AS grade_name, g.icon AS grade_icon, g.color_hex AS grade_color,
               ss.code AS source_code, ss.label AS source_label,
               (COALESCE(m.prospect_entry_path, '') = 'potential_lead' OR COALESCE(m.email, '') ILIKE '%@noemail.%') AS is_lead_shell
          FROM members m
          LEFT JOIN member_grades g ON g.id = m.grade_id
          LEFT JOIN signup_sources ss ON ss.id = m.signup_source_id
         WHERE m.id = ${memberId} LIMIT 1`))[0] || null;
      if (!m && !potentialSelf) return new Response(jsonKST({ ok: false, error: "회원을 찾을 수 없습니다" }), { status: 404, headers: JSON_HEADER });
      if (!m) { warnings.push(`연결된 회원 #${memberId} 없음 — 잠재 정보만 표시`); memberId = 0; }
    }
    let stage: DonorStage = "potential";
    const hyosungNo = m?.hyosung_member_no ? Number(m.hyosung_member_no) : null;

    /* ── 2. 잠재 행(이 회원에 연결된 전부 + 출발한 잠재 행) ── */
    const potentialRows = await safe("잠재", [] as any[], async () => {
      const list = memberId ? rowsOf(await db.execute(sql`
        SELECT id, name, phone, email, address, event_name, entry_path, participated_at, memo, linked_member_id, linked_at, linked_by, created_at
          FROM potential_donors WHERE linked_member_id = ${memberId} ORDER BY participated_at ASC NULLS LAST, id ASC LIMIT 20`)) : [];
      if (potentialSelf && !list.some((p) => Number(p.id) === Number(potentialSelf.id))) list.unshift(potentialSelf);
      return list;
    });
    const potential = potentialRows.map((p) => ({
      id: num(p.id), name: str(p.name), phone: str(p.phone), email: str(p.email), address: str(p.address),
      eventName: str(p.event_name), entryPath: str(p.entry_path), participatedAt: iso(p.participated_at), memo: str(p.memo),
      linkedMemberId: p.linked_member_id ? num(p.linked_member_id) : null, linkedAt: iso(p.linked_at),
      linkedBy: p.linked_by ? num(p.linked_by) : null, linkMethod: p.linked_member_id ? (p.linked_by ? "manual" : "auto") : null,
      createdAt: iso(p.created_at),
    }));
    stage = m ? stageFromMemberRow(m.donor_type, m.prospect_subtype, potential.length > 0) : "potential";

    /* ── 2-b. 단계 정보: 자동 판정·수동 지정·이력(donor_stage_events — 표 없으면 비움) ── */
    const autoEval = memberId ? await safe("자동 판정", null as any, async () => computeAutoStage(memberId)) : null;
    const override = memberId ? await safe("수동 지정", null as any, async () => getActiveOverride(memberId)) : null;
    const stageEvents = memberId ? await safe("단계 이력", [] as any[], async () => {
      try {
        return rowsOf(await db.execute(sql`
          SELECT id, potential_donor_id, from_stage, to_stage, source, reason, auto_baseline, is_override, released_at, release_reason, changed_by, changed_by_name, created_at
            FROM donor_stage_events WHERE member_id = ${memberId} ORDER BY id DESC LIMIT 100`));
      } catch (e: any) { if (/relation "donor_stage_events" does not exist/i.test(String(e?.message || e))) return []; throw e; }
    }) : [];

    /* ── 3. 후원 ── */
    const donationList = memberId ? await safe("후원 목록", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT d.id, d.type, d.status, d.amount, d.pay_method, d.pg_provider, d.campaign_tag, d.campaign_id, c.title AS campaign_title,
             d.receipt_issued, d.receipt_number, d.receipt_issued_at, d.paid_at, d.created_at, d.failure_reason,
             d.hyosung_billing_month, d.hyosung_paid_date, d.bank_depositor_name, d.deposit_expected_at, d.donor_note, d.memo, d.transaction_id, d.pg_order_no, d.is_anonymous
        FROM donations d LEFT JOIN campaigns c ON c.id = d.campaign_id
       WHERE d.member_id = ${memberId}
       ORDER BY COALESCE(d.paid_at, d.created_at) DESC, d.id DESC LIMIT 300`))) : [];
    const donationTotals = memberId ? await safe("후원 합계", null as any, async () => rowsOf(await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
             COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0)::bigint AS completed_amount,
             MIN(COALESCE(paid_at, created_at)) FILTER (WHERE status = 'completed') AS first_paid,
             MAX(COALESCE(paid_at, created_at)) FILTER (WHERE status = 'completed') AS last_paid,
             COUNT(*) FILTER (WHERE status = 'completed' AND type = 'regular')::int AS regular_count,
             COUNT(*) FILTER (WHERE status = 'completed' AND type = 'onetime')::int AS onetime_count,
             COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
             COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled', 'refunded'))::int AS failed_count
        FROM donations WHERE member_id = ${memberId}`))[0]) : null;
    const byYear = memberId ? await safe("연도별", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT EXTRACT(YEAR FROM (COALESCE(paid_at, created_at) + interval '9 hours'))::int AS y, SUM(amount)::bigint AS amt, COUNT(*)::int AS n
        FROM donations WHERE member_id = ${memberId} AND status = 'completed' GROUP BY 1 ORDER BY 1 DESC LIMIT 12`))) : [];
    const byCampaign = memberId ? await safe("캠페인별", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT COALESCE(c.title, NULLIF(d.campaign_tag, ''), '일반 후원') AS label, SUM(d.amount)::bigint AS amt, COUNT(*)::int AS n
        FROM donations d LEFT JOIN campaigns c ON c.id = d.campaign_id
       WHERE d.member_id = ${memberId} AND d.status = 'completed' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`))) : [];
    const byMethod = memberId ? await safe("수단별", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT COALESCE(NULLIF(pay_method, ''), '미상') AS method, SUM(amount)::bigint AS amt, COUNT(*)::int AS n
        FROM donations WHERE member_id = ${memberId} AND status = 'completed' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`))) : [];

    /* ── 4. 정기·결제수단 ── */
    const contracts = memberId ? await safe("효성 약정", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT id, member_no, member_name, phone, member_status, contract_status, promise_day, payment_method, payment_tool, payment_info, account_holder,
             registration_status, agreement_status, electronic_contract, product_name, product_amount, billing_start, billing_end, manager_name, member_type,
             billing_auto, send_method, linked_member_id, created_at, updated_at
        FROM hyosung_contracts
       WHERE linked_member_id = ${memberId} OR (${hyosungNo}::int IS NOT NULL AND member_no = ${hyosungNo})
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 10`))) : [];
    const billingKeys = memberId ? await safe("카드 빌링키", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT id, pg_provider, card_company, card_number_masked, card_type, amount, is_active, next_charge_at, last_charged_at,
             consecutive_fail_count, last_failure_reason, deactivated_at, deactivated_reason, created_at, updated_at
        FROM billing_keys WHERE member_id = ${memberId} ORDER BY is_active DESC, created_at DESC LIMIT 10`))) : [];
    const hyosungBillingList = hyosungNo ? await safe("효성 수납", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT id, contract_no, billing_month, billing_amount, received_amount, unpaid_amount, cancel_amount, refund_amount, receipt_status, payment_status,
             payment_method, payment_tool, promise_day, payment_date, billing_type, unreceived_handling, billing_completion_date, payment_result, linked_donation_id, memo
        FROM hyosung_billings WHERE member_no = ${hyosungNo}
       ORDER BY billing_month DESC NULLS LAST, payment_date DESC NULLS LAST, id DESC LIMIT 60`))) : [];
    const hyosungTotals = hyosungNo ? await safe("효성 합계", null as any, async () => rowsOf(await db.execute(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(received_amount), 0)::bigint AS received, COALESCE(SUM(unpaid_amount), 0)::bigint AS unpaid,
             MAX(payment_date) AS last_payment, MIN(billing_month) AS first_month, MAX(billing_month) AS last_month
        FROM hyosung_billings WHERE member_no = ${hyosungNo}`))[0]) : null;
    const billingLogs = memberId ? await safe("카드 청구 시도", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT id, attempt_type, attempt_number, amount, status, pg_provider, pg_response_code, pg_response_message, donation_id, requested_at, completed_at, next_retry_at, created_at
        FROM billing_logs WHERE member_id = ${memberId} ORDER BY COALESCE(requested_at, created_at) DESC, id DESC LIMIT 60`))) : [];
    const bankMatches = memberId ? await safe("입금 매칭", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT id, source, parsed_name, parsed_amount, parsed_date, parsed_memo, parsed_account_tail4, match_score, match_reason, status, confirmed_donation_id, confirmed_at, created_at
        FROM pending_donations WHERE matched_member_id = ${memberId} ORDER BY COALESCE(parsed_date, created_at) DESC, id DESC LIMIT 30`))) : [];
    const cardAlerts = memberId ? await safe("카드 만료 알림", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT id, card_expiry_month, alert_type, channels_sent, sent_at, created_at FROM card_expiry_alerts WHERE member_id = ${memberId} ORDER BY created_at DESC LIMIT 10`))) : [];

    /* ── 5. 발송·너처링 ── */
    const nurtureEnrollments = memberId ? await safe("너처링 등록", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT ne.id, ne.status, ne.enrolled_at, ne.converted_at, ne.last_evergreen_at, j.name AS journey_name, j.segment
        FROM nurture_enrollments ne LEFT JOIN nurture_journeys j ON j.id = ne.journey_id
       WHERE ne.member_id = ${memberId} ORDER BY ne.enrolled_at DESC NULLS LAST, ne.id DESC LIMIT 20`))) : [];
    const nurtureSends = memberId ? await safe("너처링 발송", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT ns.id, ns.channel, ns.status, ns.sent_at, st.label AS step_label, st.day_offset, j.name AS journey_name, j.segment, ns.evergreen_rule_id
        FROM nurture_sends ns
        JOIN nurture_enrollments ne ON ne.id = ns.enrollment_id
        LEFT JOIN nurture_steps st ON st.id = ns.step_id
        LEFT JOIN nurture_journeys j ON j.id = ne.journey_id
       WHERE ne.member_id = ${memberId} ORDER BY ns.sent_at DESC NULLS LAST, ns.id DESC LIMIT 60`))) : [];
    const sends = memberId ? await safe("발송 이력", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT r.id, r.channel, r.status, r.sent_at, r.created_at, r.rendered_subject, r.opened_at, r.clicked_at, r.error, j.name AS job_name
        FROM communication_send_recipients r LEFT JOIN communication_send_jobs j ON j.id = r.job_id
       WHERE r.member_id = ${memberId} ORDER BY COALESCE(r.sent_at, r.created_at) DESC, r.id DESC LIMIT 60`))) : [];
    const notifications = memberId ? await safe("알림 발송", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT id, event_type, channel, status, sent_at, created_at, error
        FROM notification_dispatch_logs WHERE target_type IN ('member', 'members', 'user') AND target_id = ${memberId}
       ORDER BY COALESCE(sent_at, created_at) DESC, id DESC LIMIT 40`))) : [];

    /* ── 6. 유족 지원 신청(건수·제목·상태만) ── */
    const supportList = memberId ? await safe("지원 신청", [] as any[], async () => rowsOf(await db.execute(sql`
      SELECT id, request_no, category, title, status, created_at FROM support_requests WHERE member_id = ${memberId} ORDER BY created_at DESC LIMIT 10`))) : [];

    /* ── 7. 관리자 메모(customer_notes — 표 없으면 ready:false) ── */
    const pidList = potential.map((p) => p.id).filter(Boolean);
    let notesReady = true;
    const notes = await safe("메모", [] as any[], async () => {
      try {
        return rowsOf(await db.execute(sql`
          SELECT id, member_id, potential_donor_id, body, pinned, created_by, created_by_name, created_at, updated_at
            FROM customer_notes
           WHERE (${memberId}::int > 0 AND member_id = ${memberId})
              OR potential_donor_id = ANY(${sql.raw(`ARRAY[${(pidList.length ? pidList : [0]).join(",")}]::int[]`)})
           ORDER BY pinned DESC, created_at DESC LIMIT 200`));
      } catch (e: any) {
        if (/relation "customer_notes" does not exist/i.test(String(e?.message || e))) { notesReady = false; return []; }
        throw e;
      }
    });

    /* ── 8. 관리 작업 기록(감사 로그 — 이 사람 대상 것만) ── */
    const activity = await safe("관리 기록", [] as any[], async () => {
      const targets: string[] = [];
      if (memberId) targets.push(`M-${memberId}`, `${memberId}`, `M-${String(memberId).padStart(5, "0")}`);
      const pdTargets = pidList.flatMap((id) => [`PD-${id}`, `${id}`]);
      const q = (arr: string[]) => sql.raw(`ARRAY[${arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") || "''"}]::text[]`);
      return rowsOf(await db.execute(sql`
        SELECT id, action, user_name, target, detail, created_at FROM audit_logs
         WHERE (target = ANY(${q(targets)}) AND (action LIKE 'member\\_%' OR action LIKE 'grade\\_%' OR action LIKE 'customer\\_note\\_%' OR action LIKE 'hyosung\\_info\\_%'))
            OR (target = ANY(${q(pdTargets)}) AND action LIKE 'potential\\_donor\\_%')
         ORDER BY created_at DESC LIMIT 40`));
    });

    /* ── 9. 시작·전환 단계(origin) ── */
    const originSteps: { key: string; label: string; at: string | null; detail?: string | null }[] = [];
    const firstPotential = potential.length ? potential.reduce((a, b) => ((a.participatedAt || a.createdAt || "") <= (b.participatedAt || b.createdAt || "") ? a : b)) : null;
    if (firstPotential) originSteps.push({ key: "potential", label: "잠재 후원자 등록", at: firstPotential.participatedAt || firstPotential.createdAt, detail: [firstPotential.eventName, firstPotential.entryPath].filter(Boolean).join(" · ") || null });
    if (m) originSteps.push({ key: "signup", label: m.is_lead_shell ? "리드 회원 생성(자동 동기화)" : "회원 가입", at: iso(m.created_at), detail: [m.source_label || m.source_code, m.prospect_entry_path, m.prospect_event_name].filter(Boolean).join(" · ") || null });
    if (donationTotals?.first_paid) originSteps.push({ key: "first_donation", label: "첫 후원", at: iso(donationTotals.first_paid), detail: `${num(donationTotals.completed_count)}건 · 합계 ₩${num(donationTotals.completed_amount).toLocaleString()}` });
    const firstRegular = donationList.filter((d) => d.type === "regular" && d.status === "completed").map((d) => iso(d.paid_at || d.created_at)).filter(Boolean).sort()[0]
      || (contracts.length ? iso(contracts.map((c) => c.billing_start).filter(Boolean).sort()[0]) : null);
    if (stage === "regular" || firstRegular) originSteps.push({ key: "regular", label: stage === "regular" ? "정기 후원 중" : "정기 후원 시작", at: firstRegular || iso(m?.donor_evaluated_at), detail: m?.donor_channels ? `채널 ${JSON.stringify(m.donor_channels)}` : null });
    if (stage === "prospect_cancelled") {
      const deact = billingKeys.map((b) => iso(b.deactivated_at)).filter(Boolean).sort().pop() || null;
      originSteps.push({ key: "cancelled", label: "정기 후원 해지", at: deact || iso(m?.donor_evaluated_at), detail: billingKeys.find((b) => b.deactivated_reason)?.deactivated_reason || (m?.hyosung_contract_status ? `효성 ${m.hyosung_contract_status}` : null) });
    }

    /* ── 10. 통합 타임라인 ── */
    const tl: TimelineItem[] = [];
    for (const p of potential) if (p.participatedAt || p.createdAt) tl.push({ at: p.participatedAt || p.createdAt!, kind: "potential", title: `잠재 후원자 등록 — ${p.eventName || "이벤트 미상"}`, detail: [p.entryPath ? `경로 ${p.entryPath}` : null, p.memo].filter(Boolean).join(" · ") || null, refId: p.id });
    if (m?.created_at) tl.push({ at: iso(m.created_at)!, kind: "signup", title: m.is_lead_shell ? "리드 회원 자동 생성" : "회원 가입", detail: [m.source_label || m.source_code, m.member_category, m.prospect_entry_path].filter(Boolean).join(" · ") || null, refId: m.id });
    if (stageEvents.length) {
      for (const e of stageEvents) if (e.created_at) tl.push({
        at: iso(e.created_at)!, kind: "stage",
        title: `단계 ${e.from_stage && STAGE_LABEL[e.from_stage as DonorStage] ? STAGE_LABEL[e.from_stage as DonorStage] : (e.from_stage || "—")} → ${STAGE_LABEL[e.to_stage as DonorStage] || e.to_stage} (${e.source === "manual" ? "수동" : e.source === "system" ? "시스템" : "자동"})`,
        detail: [e.changed_by_name, e.reason, e.is_override ? "수동 지정 유지 중" : (e.released_at ? `해제 ${String(e.release_reason || "")}` : null)].filter(Boolean).join(" · ") || null,
        status: e.source, refId: e.id,
      });
    } else if (m?.donor_evaluated_at) {
      tl.push({ at: iso(m.donor_evaluated_at)!, kind: "stage", title: `후원자 유형 판정 — ${STAGE_LABEL[stage]}`, detail: m.donor_channels ? `채널 ${JSON.stringify(m.donor_channels)}` : null });
    }
    for (const d of donationList) {
      const at = iso(d.paid_at || d.created_at); if (!at) continue;
      tl.push({ at, kind: "donation", title: `${d.type === "regular" ? "정기" : "일시"} 후원 ${d.status === "completed" ? "완료" : d.status === "pending" ? "대기" : d.status === "failed" ? "실패" : d.status === "cancelled" ? "취소" : d.status === "refunded" ? "환불" : d.status}`,
        detail: [d.pay_method, d.pg_provider, d.campaign_title || d.campaign_tag, d.hyosung_billing_month ? `효성 ${d.hyosung_billing_month}` : null, d.bank_depositor_name ? `입금자 ${d.bank_depositor_name}` : null, d.failure_reason].filter(Boolean).join(" · ") || null,
        amount: num(d.amount), status: d.status, refId: d.id });
      if (d.receipt_issued && d.receipt_issued_at) tl.push({ at: iso(d.receipt_issued_at)!, kind: "receipt", title: `납부 확인서 발급 ${d.receipt_number || ""}`.trim(), amount: num(d.amount), refId: d.id });
    }
    for (const h of hyosungBillingList) {
      const at = iso(h.payment_date || h.billing_completion_date); if (!at) continue;
      const got = num(h.received_amount);
      tl.push({ at, kind: "hyosung", title: `효성 CMS ${h.billing_month || ""} ${got > 0 ? "수납" : "미수납"}`.replace(/\s+/g, " ").trim(),
        detail: [h.receipt_status, h.payment_status, h.payment_result, h.payment_method, h.payment_tool, num(h.unpaid_amount) > 0 ? `미납 ₩${num(h.unpaid_amount).toLocaleString()}` : null].filter(Boolean).join(" · ") || null,
        amount: got > 0 ? got : num(h.billing_amount), status: got > 0 ? "received" : "unpaid", refId: h.id });
    }
    for (const c of contracts) {
      if (c.billing_start) tl.push({ at: iso(c.billing_start)!, kind: "contract", title: `효성 약정 시작 — ${c.product_name || ""} ₩${num(c.product_amount).toLocaleString()}`.trim(), detail: [c.payment_method, c.payment_tool, c.payment_info, c.account_holder ? `예금주 ${c.account_holder}` : null, c.promise_day ? `매월 ${c.promise_day}일` : null].filter(Boolean).join(" · ") || null, refId: c.id });
      if (c.billing_end) tl.push({ at: iso(c.billing_end)!, kind: "contract", title: `효성 약정 종료 (${c.contract_status || ""})`, refId: c.id });
    }
    for (const b of billingKeys) {
      if (b.created_at) tl.push({ at: iso(b.created_at)!, kind: "card", title: `카드 등록 — ${b.card_company || b.pg_provider || ""} ${b.card_number_masked || ""}`.trim(), detail: b.amount ? `정기 ₩${num(b.amount).toLocaleString()}` : null, refId: b.id });
      if (b.deactivated_at) tl.push({ at: iso(b.deactivated_at)!, kind: "card", title: "카드 정기 해지", detail: b.deactivated_reason || null, status: "deactivated", refId: b.id });
    }
    for (const l of billingLogs) {
      const at = iso(l.requested_at || l.created_at); if (!at) continue;
      tl.push({ at, kind: "billing", title: `카드 청구 ${l.status === "success" || l.status === "completed" ? "성공" : l.status === "failed" ? "실패" : l.status || ""} (${l.attempt_type || "정기"}${l.attempt_number ? ` #${l.attempt_number}` : ""})`,
        detail: [l.pg_provider, l.pg_response_message].filter(Boolean).join(" · ") || null, amount: num(l.amount), status: l.status, refId: l.id });
    }
    for (const bm of bankMatches) {
      const at = iso(bm.parsed_date || bm.created_at); if (!at) continue;
      tl.push({ at, kind: "bank", title: `계좌 입금 ${bm.status === "confirmed" ? "확정" : bm.status || "대기"} — ${bm.parsed_name || ""}`.trim(), detail: [bm.parsed_account_tail4 ? `계좌 끝 ${bm.parsed_account_tail4}` : null, bm.match_reason, bm.parsed_memo].filter(Boolean).join(" · ") || null, amount: num(bm.parsed_amount), status: bm.status, refId: bm.id });
    }
    for (const a of cardAlerts) if (a.sent_at || a.created_at) tl.push({ at: iso(a.sent_at || a.created_at)!, kind: "notification", title: `카드 만료 안내 (${a.card_expiry_month || ""})`, detail: a.channels_sent || null, refId: a.id });
    for (const e of nurtureEnrollments) if (e.enrolled_at) tl.push({ at: iso(e.enrolled_at)!, kind: "nurture", title: `너처링 등록 — ${e.journey_name || e.segment || ""}`, detail: e.status || null, refId: e.id });
    for (const s of nurtureSends) if (s.sent_at) tl.push({ at: iso(s.sent_at)!, kind: "nurture", title: `너처링 발송 — ${s.journey_name || s.segment || ""} ${s.step_label || (s.day_offset != null ? `D+${s.day_offset}` : "")}`.trim(), detail: [s.channel, s.status].filter(Boolean).join(" · ") || null, status: s.status, refId: s.id });
    for (const s of sends) { const at = iso(s.sent_at || s.created_at); if (!at) continue; tl.push({ at, kind: "send", title: `${s.channel || ""} 발송 — ${s.job_name || s.rendered_subject || ""}`.trim(), detail: [s.status, s.opened_at ? "열람" : null, s.clicked_at ? "클릭" : null, s.error].filter(Boolean).join(" · ") || null, status: s.status, refId: s.id }); }
    for (const n of notifications) { const at = iso(n.sent_at || n.created_at); if (!at) continue; tl.push({ at, kind: "notification", title: `알림 — ${n.event_type || ""} (${n.channel || ""})`, detail: [n.status, n.error].filter(Boolean).join(" · ") || null, status: n.status, refId: n.id }); }
    for (const s of supportList) if (s.created_at) tl.push({ at: iso(s.created_at)!, kind: "support", title: `지원 신청 — ${s.title || s.request_no || ""}`, detail: [s.category, s.status].filter(Boolean).join(" · ") || null, refId: s.id });
    for (const n of notes) if (n.created_at) tl.push({ at: iso(n.created_at)!, kind: "note", title: `관리자 메모 — ${n.created_by_name || "관리자"}`, detail: String(n.body || "").slice(0, 200), refId: n.id });
    for (const a of activity) if (a.created_at) tl.push({ at: iso(a.created_at)!, kind: "admin", title: `관리 작업 — ${a.action}`, detail: [a.user_name, typeof a.detail === "string" ? a.detail.slice(0, 160) : null].filter(Boolean).join(" · ") || null, refId: a.id });
    tl.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const timeline = tl.slice(0, 400);

    /* ── 11. 응답 조립 ── */
    const activeKey = billingKeys.find((b) => b.is_active);
    const activeContract = contracts.find((c) => String(c.contract_status || "").toLowerCase() === "active") || contracts[0] || null;
    const monthlyAmount = activeKey?.amount ? num(activeKey.amount) : activeContract?.product_amount ? num(activeContract.product_amount) : null;

    const data = {
      subject: { kind: potentialParam && !memberId ? "potential" : "member", memberId: memberId || null, potentialId: potentialParam || (potential[0]?.id ?? null) },
      profile: m ? {
        id: num(m.id), name: str(m.name), phone: str(m.phone), email: m.is_lead_shell ? null : str(m.email), emailRaw: str(m.email),
        type: str(m.type), status: str(m.status), role: str(m.role), memberCategory: str(m.member_category), memberSubtype: str(m.member_subtype),
        createdAt: iso(m.created_at), lastLoginAt: iso(m.last_login_at), withdrawnAt: iso(m.withdrawn_at), withdrawnReason: str(m.withdrawn_reason),
        blacklistedAt: iso(m.blacklisted_at), blacklistReason: str(m.blacklist_reason), schoolName: str(m.school_name), memo: str(m.memo),
        isLeadShell: !!m.is_lead_shell,
        donorType: str(m.donor_type), prospectSubtype: str(m.prospect_subtype), donorChannels: m.donor_channels ?? null, donorEvaluatedAt: iso(m.donor_evaluated_at),
        prospectEventName: str(m.prospect_event_name), prospectEntryPath: str(m.prospect_entry_path),
        signupSource: m.source_code || m.source_label ? { code: str(m.source_code), label: str(m.source_label) } : null,
        grade: m.grade_id ? { code: str(m.grade_code), nameKo: str(m.grade_name), icon: str(m.grade_icon), color: str(m.grade_color), assignedAt: iso(m.grade_assigned_at), locked: !!m.grade_locked } : null,
        consents: { email: m.agree_email === true, sms: m.agree_sms === true, mail: m.agree_mail === true, emailVerified: m.email_verified === true, phoneVerifiedAt: iso(m.phone_verified_at), kakaoConsentAt: iso(m.kakao_marketing_consent_at) },
        churn: m.churn_risk_level || m.churn_risk_score != null ? { score: m.churn_risk_score != null ? num(m.churn_risk_score) : null, level: str(m.churn_risk_level), evaluatedAt: iso(m.churn_last_evaluated_at), signals: m.churn_signals ?? null } : null,
        stage, stageLabel: STAGE_LABEL[stage],
      } : null,
      stage, stageLabel: STAGE_LABEL[stage],
      stageInfo: {
        current: stage, label: STAGE_LABEL[stage],
        auto: autoEval ? autoEval.stage : null, autoLabel: autoEval ? STAGE_LABEL[autoEval.stage] : null, autoSignals: autoEval ? autoEval.signals : null,
        override: override ? { id: override.id, toStage: override.toStage, toLabel: STAGE_LABEL[override.toStage], autoBaseline: override.autoBaseline, reason: override.reason, changedByName: override.changedByName, createdAt: override.createdAt } : null,
        events: stageEvents.map((e) => ({
          id: num(e.id), fromStage: str(e.from_stage), toStage: str(e.to_stage), fromLabel: e.from_stage ? (STAGE_LABEL[e.from_stage as DonorStage] || e.from_stage) : null, toLabel: STAGE_LABEL[e.to_stage as DonorStage] || e.to_stage,
          source: str(e.source), reason: str(e.reason), autoBaseline: str(e.auto_baseline), isOverride: e.is_override === true, releasedAt: iso(e.released_at), releaseReason: str(e.release_reason),
          changedBy: e.changed_by != null ? num(e.changed_by) : null, changedByName: str(e.changed_by_name), createdAt: iso(e.created_at),
        })),
      },
      potential,
      origin: { steps: originSteps },
      donations: {
        summary: {
          completedAmount: num(donationTotals?.completed_amount), completedCount: num(donationTotals?.completed_count),
          firstPaidAt: iso(donationTotals?.first_paid), lastPaidAt: iso(donationTotals?.last_paid),
          avgAmount: num(donationTotals?.completed_count) ? Math.round(num(donationTotals?.completed_amount) / num(donationTotals?.completed_count)) : 0,
          regularCount: num(donationTotals?.regular_count), onetimeCount: num(donationTotals?.onetime_count),
          pendingCount: num(donationTotals?.pending_count), failedCount: num(donationTotals?.failed_count),
          memberTotalAmount: m ? num(m.total_donation_amount) : 0, regularMonthsCount: m ? num(m.regular_months_count) : 0,
          byYear: byYear.map((r) => ({ year: num(r.y), amount: num(r.amt), count: num(r.n) })),
          byCampaign: byCampaign.map((r) => ({ label: str(r.label) || "일반 후원", amount: num(r.amt), count: num(r.n) })),
          byMethod: byMethod.map((r) => ({ method: str(r.method) || "미상", amount: num(r.amt), count: num(r.n) })),
        },
        list: donationList.map((d) => ({
          id: num(d.id), type: str(d.type), status: str(d.status), amount: num(d.amount), payMethod: str(d.pay_method), pgProvider: str(d.pg_provider),
          campaign: str(d.campaign_title) || str(d.campaign_tag), receiptIssued: d.receipt_issued === true, receiptNumber: str(d.receipt_number), receiptIssuedAt: iso(d.receipt_issued_at),
          paidAt: iso(d.paid_at), createdAt: iso(d.created_at), failureReason: str(d.failure_reason), hyosungBillingMonth: str(d.hyosung_billing_month),
          bankDepositorName: str(d.bank_depositor_name), depositExpectedAt: iso(d.deposit_expected_at), donorNote: str(d.donor_note), memo: str(d.memo),
          transactionId: str(d.transaction_id), pgOrderNo: str(d.pg_order_no), isAnonymous: d.is_anonymous === true,
        })),
      },
      regular: {
        isActive: stage === "regular", channels: m?.donor_channels ?? null, monthlyAmount,
        nextBillingDate: iso(m?.next_billing_date), billingDay: m?.billing_day != null ? num(m.billing_day) : null,
        billingRetryCount: m ? num(m.billing_retry_count) : 0, billingLastFailedAt: iso(m?.billing_last_failed_at),
        regularMonthsCount: m ? num(m.regular_months_count) : 0, totalDonationAmount: m ? num(m.total_donation_amount) : 0,
        hyosung: m && (m.hyosung_member_no || m.hyosung_contract_status) ? {
          memberNo: m.hyosung_member_no != null ? num(m.hyosung_member_no) : null, contractStatus: str(m.hyosung_contract_status), paymentMethod: str(m.hyosung_payment_method),
          paymentTool: str(m.hyosung_payment_tool), bankInfo: str(m.hyosung_bank_info), promiseDay: m.hyosung_promise_day != null ? num(m.hyosung_promise_day) : null, syncedAt: iso(m.hyosung_synced_at),
        } : null,
        contracts: contracts.map((c) => ({
          id: num(c.id), memberNo: c.member_no != null ? num(c.member_no) : null, memberName: str(c.member_name), phone: str(c.phone), memberStatus: str(c.member_status),
          contractStatus: str(c.contract_status), promiseDay: c.promise_day != null ? num(c.promise_day) : null, paymentMethod: str(c.payment_method), paymentTool: str(c.payment_tool),
          paymentInfo: str(c.payment_info), accountHolder: str(c.account_holder), registrationStatus: str(c.registration_status), agreementStatus: str(c.agreement_status),
          electronicContract: str(c.electronic_contract), productName: str(c.product_name), productAmount: c.product_amount != null ? num(c.product_amount) : null,
          billingStart: iso(c.billing_start), billingEnd: iso(c.billing_end), managerName: str(c.manager_name), memberType: str(c.member_type), billingAuto: str(c.billing_auto),
          sendMethod: str(c.send_method), linkedMemberId: c.linked_member_id != null ? num(c.linked_member_id) : null, updatedAt: iso(c.updated_at),
        })),
        billingKeys: billingKeys.map((b) => ({
          id: num(b.id), pgProvider: str(b.pg_provider), cardCompany: str(b.card_company), cardNumberMasked: str(b.card_number_masked), cardType: str(b.card_type),
          amount: b.amount != null ? num(b.amount) : null, isActive: b.is_active === true, nextChargeAt: iso(b.next_charge_at), lastChargedAt: iso(b.last_charged_at),
          consecutiveFailCount: num(b.consecutive_fail_count), lastFailureReason: str(b.last_failure_reason), deactivatedAt: iso(b.deactivated_at), deactivatedReason: str(b.deactivated_reason), createdAt: iso(b.created_at),
        })),
        hyosungBillings: {
          count: num(hyosungTotals?.n), receivedSum: num(hyosungTotals?.received), unpaidSum: num(hyosungTotals?.unpaid), lastPaymentDate: iso(hyosungTotals?.last_payment),
          firstMonth: str(hyosungTotals?.first_month), lastMonth: str(hyosungTotals?.last_month),
          list: hyosungBillingList.map((h) => ({
            id: num(h.id), contractNo: str(h.contract_no), billingMonth: str(h.billing_month), billingAmount: num(h.billing_amount), receivedAmount: num(h.received_amount), unpaidAmount: num(h.unpaid_amount),
            cancelAmount: num(h.cancel_amount), refundAmount: num(h.refund_amount), receiptStatus: str(h.receipt_status), paymentStatus: str(h.payment_status), paymentMethod: str(h.payment_method),
            paymentTool: str(h.payment_tool), promiseDay: h.promise_day != null ? num(h.promise_day) : null, paymentDate: iso(h.payment_date), billingType: str(h.billing_type),
            unreceivedHandling: str(h.unreceived_handling), billingCompletionDate: iso(h.billing_completion_date), paymentResult: str(h.payment_result), linkedDonationId: h.linked_donation_id != null ? num(h.linked_donation_id) : null, memo: str(h.memo),
          })),
        },
        billingLogs: billingLogs.map((l) => ({
          id: num(l.id), attemptType: str(l.attempt_type), attemptNumber: l.attempt_number != null ? num(l.attempt_number) : null, amount: num(l.amount), status: str(l.status), pgProvider: str(l.pg_provider),
          pgResponseCode: str(l.pg_response_code), pgResponseMessage: str(l.pg_response_message), donationId: l.donation_id != null ? num(l.donation_id) : null,
          requestedAt: iso(l.requested_at), completedAt: iso(l.completed_at), nextRetryAt: iso(l.next_retry_at),
        })),
        bankMatches: bankMatches.map((b) => ({
          id: num(b.id), source: str(b.source), parsedName: str(b.parsed_name), parsedAmount: num(b.parsed_amount), parsedDate: iso(b.parsed_date), parsedMemo: str(b.parsed_memo),
          parsedAccountTail4: str(b.parsed_account_tail4), matchScore: b.match_score != null ? Number(b.match_score) : null, matchReason: str(b.match_reason), status: str(b.status),
          confirmedDonationId: b.confirmed_donation_id != null ? num(b.confirmed_donation_id) : null, confirmedAt: iso(b.confirmed_at),
        })),
        cardAlerts: cardAlerts.map((a) => ({ id: num(a.id), cardExpiryMonth: str(a.card_expiry_month), alertType: str(a.alert_type), channelsSent: str(a.channels_sent), sentAt: iso(a.sent_at) })),
      },
      comms: {
        nurture: {
          enrollments: nurtureEnrollments.map((e) => ({ id: num(e.id), journeyName: str(e.journey_name), segment: str(e.segment), status: str(e.status), enrolledAt: iso(e.enrolled_at), convertedAt: iso(e.converted_at), lastEvergreenAt: iso(e.last_evergreen_at) })),
          sends: nurtureSends.map((s) => ({ id: num(s.id), journeyName: str(s.journey_name), segment: str(s.segment), stepLabel: str(s.step_label), dayOffset: s.day_offset != null ? num(s.day_offset) : null, channel: str(s.channel), status: str(s.status), sentAt: iso(s.sent_at), evergreen: s.evergreen_rule_id != null })),
        },
        sends: sends.map((s) => ({ id: num(s.id), jobName: str(s.job_name), channel: str(s.channel), status: str(s.status), sentAt: iso(s.sent_at), createdAt: iso(s.created_at), subject: str(s.rendered_subject), openedAt: iso(s.opened_at), clickedAt: iso(s.clicked_at), error: str(s.error) })),
        notifications: notifications.map((n) => ({ id: num(n.id), eventType: str(n.event_type), channel: str(n.channel), status: str(n.status), sentAt: iso(n.sent_at), createdAt: iso(n.created_at), error: str(n.error) })),
      },
      support: {
        total: supportList.length,
        inProgress: supportList.filter((s) => ["submitted", "reviewing", "supplement", "matched", "in_progress"].includes(String(s.status))).length,
        list: supportList.map((s) => ({ id: num(s.id), requestNo: str(s.request_no), category: str(s.category), title: str(s.title), status: str(s.status), createdAt: iso(s.created_at) })),
      },
      notes: {
        ready: notesReady,
        list: notes.map((n) => ({ id: num(n.id), memberId: n.member_id != null ? num(n.member_id) : null, potentialId: n.potential_donor_id != null ? num(n.potential_donor_id) : null, body: String(n.body || ""), pinned: n.pinned === true, createdBy: n.created_by != null ? num(n.created_by) : null, createdByName: str(n.created_by_name), createdAt: iso(n.created_at), updatedAt: iso(n.updated_at) })),
      },
      activity: activity.map((a) => ({ id: num(a.id), action: str(a.action), userName: str(a.user_name), target: str(a.target), detail: typeof a.detail === "string" ? a.detail.slice(0, 300) : a.detail ?? null, createdAt: iso(a.created_at) })),
      timeline,
      meta: { generatedAt: new Date().toISOString(), elapsedMs: Date.now() - t0, warnings, timelineTotal: tl.length },
    };

    return new Response(jsonKST({ ok: true, message: null, data }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "고객 여정 조회 실패", step: "journey",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
};
