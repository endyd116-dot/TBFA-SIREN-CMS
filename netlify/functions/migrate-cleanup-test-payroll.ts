/**
 * /api/migrate-cleanup-test-payroll?run=1   — 1회용 (호출 후 파일 삭제)
 *
 * 2026-07-12 라이브 검증 과정에서 총괄관리자(members.id=1) 계정에 만들어진
 * 테스트 급여명세서 2건과 그에 딸린 문서·서명 증적·저장 파일을 지운다.
 *
 * 급여명세서는 법정 문서라 상시 삭제 기능을 두지 않는다.
 * 그래서 대상을 코드에 박아두고, 아래 3중 안전장치를 모두 통과할 때만 지운다:
 *   ① 슈퍼어드민 인증
 *   ② 지정한 명세서 ID만 (다른 ID는 절대 안 건드림)
 *   ③ 그 명세서의 소유자가 총괄관리자(id=1)인지 재확인 — 아니면 건너뜀
 *
 * 함께 지우는 것:
 *   - 저장소(R2)에 보관된 교부 문서·서명본·서명 이미지 파일
 *   - blob_uploads 기록
 *   - payroll_acknowledgments / payroll_objections / payroll_audit / payroll_send_history
 *     (명세서 삭제 시 FK cascade로 함께 삭제됨)
 *
 * GET (기본) : 진단 — 무엇이 지워질지만 보여줌 (인증 불필요)
 * GET ?run=1 : 어드민 인증 후 실제 삭제
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { deleteFromR2 } from "../../lib/r2-delete";

export const config = { path: "/api/migrate-cleanup-test-payroll" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/** 지울 대상 — 라이브 검증으로 생긴 총괄관리자 테스트 명세서 */
const TARGET_SLIP_IDS = [3, 4];
const OWNER_UID = "1";                 // 총괄 관리자 (이 사람 것이 아니면 건너뜀)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADER });
}
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

/** 지울 명세서와 그에 딸린 저장 파일 키를 모은다 */
async function inspect() {
  const idList = sql.raw(TARGET_SLIP_IDS.join(","));

  const slipRows = rows(await db.execute(sql`
    SELECT id, member_uid, pay_year, pay_month, status, document_version,
           document_r2_key, signed_document_r2_key
      FROM payroll_slips
     WHERE id = ANY(ARRAY[${idList}]::int[])
     ORDER BY id
  `));

  /* 안전장치 ③ — 소유자가 총괄관리자인 것만 대상으로 남긴다 */
  const safe = slipRows.filter(s => String(s.member_uid) === OWNER_UID);
  const refused = slipRows.filter(s => String(s.member_uid) !== OWNER_UID)
    .map(s => ({ id: s.id, memberUid: s.member_uid, 사유: "총괄관리자 것이 아니라 건너뜀" }));

  const safeIds = safe.map(s => Number(s.id));
  let ackRows: any[] = [];
  if (safeIds.length > 0) {
    ackRows = rows(await db.execute(sql`
      SELECT id, slip_id, action, signature_r2_key, document_r2_key, signed_document_r2_key
        FROM payroll_acknowledgments
       WHERE slip_id = ANY(ARRAY[${sql.raw(safeIds.join(","))}]::int[])
    `));
  }

  /* 저장소에서 지울 파일 키 (중복 제거) */
  const keys = new Set<string>();
  for (const s of safe) {
    if (s.document_r2_key) keys.add(String(s.document_r2_key));
    if (s.signed_document_r2_key) keys.add(String(s.signed_document_r2_key));
  }
  for (const a of ackRows) {
    if (a.signature_r2_key) keys.add(String(a.signature_r2_key));
    if (a.document_r2_key) keys.add(String(a.document_r2_key));
    if (a.signed_document_r2_key) keys.add(String(a.signed_document_r2_key));
  }

  return {
    슬립: safe.map(s => ({
      id: s.id, 대상월: `${s.pay_year}-${String(s.pay_month).padStart(2, "0")}`,
      상태: s.status, 문서차수: s.document_version,
    })),
    건너뜀: refused,
    증적건수: ackRows.length,
    저장파일수: keys.size,
    keys: [...keys],
    safeIds,
  };
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 ── */
  if (!run) {
    try {
      const s = await inspect();
      return json({
        ok: true, mode: "diagnose",
        message: s.safeIds.length === 0
          ? "지울 대상이 없습니다 (이미 정리됨)"
          : `삭제 대상 명세서 ${s.safeIds.length}건 · 서명 증적 ${s.증적건수}건 · 저장 파일 ${s.저장파일수}개`,
        슬립: s.슬립, 건너뜀: s.건너뜀,
        저장파일수: s.저장파일수,
        안내: "어드민 로그인 후 ?run=1 로 호출하면 실제로 삭제됩니다",
      });
    } catch (err: any) {
      return json({ ok: false, step: "diagnose", detail: String(err?.message ?? err).slice(0, 500) }, 500);
    }
  }

  /* ── 실행 ── */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return json({ ok: false, error: "슈퍼어드민 전용" }, 403);
  }

  let before: any;
  try { before = await inspect(); }
  catch (err: any) { return json({ ok: false, step: "inspect", detail: String(err?.message ?? err).slice(0, 500) }, 500); }

  if (before.safeIds.length === 0) {
    return json({ ok: true, mode: "run", message: "지울 대상이 없습니다 (이미 정리됨)", 건너뜀: before.건너뜀 });
  }

  /* 1) 저장소(R2) 파일 삭제 — 실패해도 DB 정리는 계속 (고아 파일보다 DB 정합이 우선) */
  let r2Deleted = 0;
  const r2Failed: string[] = [];
  for (const key of before.keys as string[]) {
    try {
      const res = await deleteFromR2(key);
      if (res.success) r2Deleted++;
      else r2Failed.push(key);
    } catch { r2Failed.push(key); }
  }

  /* 2) blob_uploads 기록 삭제 */
  let blobRows = 0;
  try {
    if ((before.keys as string[]).length > 0) {
      const quoted = (before.keys as string[])
        .map(k => `'${String(k).replace(/'/g, "''")}'`).join(",");
      const r: any = await db.execute(sql`
        DELETE FROM blob_uploads WHERE blob_key IN (${sql.raw(quoted)}) RETURNING id
      `);
      blobRows = rows(r).length;
    }
  } catch (err) {
    console.warn("[cleanup-test-payroll] blob_uploads 정리 실패:", err);
  }

  /* 3) 명세서 삭제 — 증적·이의·이력·발송기록은 FK cascade로 함께 지워진다 */
  let deletedSlips = 0;
  try {
    const r: any = await db.execute(sql`
      DELETE FROM payroll_slips
       WHERE id = ANY(ARRAY[${sql.raw((before.safeIds as number[]).join(","))}]::int[])
         AND member_uid = ${OWNER_UID}
       RETURNING id
    `);
    deletedSlips = rows(r).length;
  } catch (err: any) {
    return json({ ok: false, step: "delete_slips", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  const after = await inspect().catch(() => null);

  return json({
    ok: true,
    mode: "run",
    message: `테스트 명세서 ${deletedSlips}건 삭제 완료 (서명 증적·이의·이력·발송기록 함께 정리)`,
    삭제된_명세서: before.슬립,
    저장파일: { 삭제: r2Deleted, 실패: r2Failed.length, blob기록: blobRows },
    건너뜀: before.건너뜀,
    남은_대상: after ? after.safeIds.length : null,
  });
}
