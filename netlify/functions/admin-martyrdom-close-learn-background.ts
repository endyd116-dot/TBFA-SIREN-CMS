/**
 * admin-martyrdom-close-learn-background — 종결 학습 루프 (⑥·INTERNAL·Background)
 *
 * 백그라운드 함수(-background)는 config.path 금지.
 *
 * POST { caseId, secret }
 *   사건 종결(status='closed' + outcome) 시 admin-martyrdom-cases PATCH가 트리거.
 *   learnFromClosedCase(caseId): recognitionPattern 추출 → reference 전환 → martyr_case 색인 전환.
 *
 * fail-closed(INTERNAL_TRIGGER_SECRET) · throw 안 함.
 */
import type { Context } from "@netlify/functions";
import { learnFromClosedCase, indexApprovedReport } from "../../lib/martyrdom-ai";
import { notifyMartyrdomAdmins } from "../../lib/martyrdom-notify";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  const caseId = Number(body?.caseId || 0);
  if (!caseId) {
    return new Response(JSON.stringify({ ok: false, error: "caseId 필수" }), { status: 400 });
  }

  console.info(`[martyrdom-close-learn] start caseId=${caseId}`);

  try {
    const r = await learnFromClosedCase(caseId);

    /* ⑥ 인정(approved) 사건 — application 문서를 형식 모델(approved-report)로 추가 색인 (P3·§9.2) */
    let approvedIndexed = 0;
    try {
      const idx = await indexApprovedReport(caseId);
      approvedIndexed = idx.indexed || 0;
      if (!idx.ok && idx.error) console.warn(`[martyrdom-close-learn] indexApprovedReport: ${idx.error}`);
    } catch (e: any) {
      console.warn(`[martyrdom-close-learn] indexApprovedReport 예외: ${e?.message}`);
    }

    if (r.ok) {
      await notifyMartyrdomAdmins({
        caseId,
        title: "순직 지원 — 종결 사건 학습 완료",
        message: `종결 사건이 과거 학습사례(reference)로 전환되고 인정 패턴이 색인되었습니다 (RAG 청크 ${r.promoted}개${approvedIndexed ? `, 인정 보고서 형식 모델 ${approvedIndexed}청크` : ""}).`,
        severity: "info",
      });
    }
    console.info(`[martyrdom-close-learn] done caseId=${caseId} ok=${r.ok} promoted=${r.promoted} approvedIndexed=${approvedIndexed}`);
    return new Response(JSON.stringify({ ok: r.ok, caseId, promoted: r.promoted, approvedIndexed, error: r.error }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(`[martyrdom-close-learn] caseId=${caseId} 예외:`, err?.message, err?.stack);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err).slice(0, 300) }), { status: 500 });
  }
};
