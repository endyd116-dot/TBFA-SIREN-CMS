/**
 * netlify/functions/admin-memorial-reports.ts — 추모관 «제보·신청» 운영자 화면 (★ 2026-11-16 Swain 지시)
 *
 * GET    /api/admin-memorial-reports?status=open|all|new|checking|contacted|done|closed&kind=&q=
 *                                              — 목록 + 상태별 건수 + 준비 여부
 * GET    /api/admin-memorial-reports?countsOnly=1   — 상태별 건수만(탭 배지)
 * GET    /api/admin-memorial-reports?id=N      — 상세(개인정보 포함 — 열람 기록을 남긴다)
 * PATCH  /api/admin-memorial-reports           — { id, status?, adminMemo? }
 * POST   /api/admin-memorial-reports?action=to-teacher — { id, name?, schoolRegion?, deathDate? }
 *          선생님 관리에 «비공개» 초안을 만든다(사진·약력을 채운 뒤 운영자가 공개)
 * POST   /api/admin-memorial-reports?action=to-case    — { id, name?, schoolName?, deceasedAt? }
 *          딥릴리프(순직 인정 지원) 사건을 접수 단계로 만든다
 * DELETE /api/admin-memorial-reports?id=N      — 기록 삭제(잘못 들어온 접수·본인 삭제 요청)
 *
 * 권한: 관리자 + cms_memorial (lib/admin-guard.ts PATH_FEATURE — 추모관 관리와 같은 권한키)
 */
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, methodNotAllowed, corsPreflight, conflict } from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import {
  reportsReady, listReports, countReports, getReport, updateReport,
  reportToTeacher, reportToCase, deleteReport, isUserError,
  KIND_LABEL, STATUS_LABEL, RETENTION_YEARS,
} from "../../lib/memorial-reports";

export const config = { path: "/api/admin-memorial-reports" };

function userErrorResponse(e: any): Response {
  const status = Number(e?.status) || 400;
  if (status === 404) return notFound(e.message);
  if (status === 409) return conflict(e.message);
  return badRequest(e.message);
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard = await requireAdmin(req);
  if (guardFailed(guard)) return guard.res;
  const { admin, member } = guard.ctx;
  const adminName = member.name || String(admin.uid);

  let step = "start";
  try {
    const url = new URL(req.url);

    step = "ready";
    const ready = await reportsReady();
    const labels = { kinds: KIND_LABEL, statuses: STATUS_LABEL, retentionYears: RETENTION_YEARS };

    /* ===== GET ===== */
    if (req.method === "GET") {
      if (!ready) return ok({ ready: false, items: [], counts: null, labels });

      if (url.searchParams.get("countsOnly") === "1") {
        step = "counts";
        return ok({ ready: true, counts: await countReports() });
      }

      const id = Number(url.searchParams.get("id") || 0);
      if (id) {
        step = "detail";
        const item = await getReport(id);
        if (!item) return notFound("제보·신청을 찾을 수 없습니다");
        /* 개인정보가 담긴 화면 — 누가 언제 열어 봤는지 남긴다(내용은 기록하지 않는다) */
        await logAdminAction(req, admin.uid, adminName, "memorial_report_view", {
          target: item.reportNo, detail: { id, kind: item.kind },
        }).catch(() => {});
        return ok({ ready: true, item, labels });
      }

      step = "list";
      const [items, counts] = await Promise.all([
        listReports({
          status: url.searchParams.get("status") || "open",
          kind: url.searchParams.get("kind") || "",
          q: url.searchParams.get("q") || "",
          limit: Number(url.searchParams.get("limit") || 100),
        }),
        countReports(),
      ]);
      return ok({ ready: true, items, counts, labels });
    }

    if (!ready) return badRequest("저장소 준비가 아직 끝나지 않았습니다. /api/migrate-memorial-reports?run=1 을 먼저 실행해 주세요.");

    /* ===== PATCH — 상태·메모 ===== */
    if (req.method === "PATCH") {
      step = "patch.body";
      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }
      const id = Number(body.id || 0);
      if (!id) return badRequest("id가 필요합니다");
      if (body.status === undefined && body.adminMemo === undefined) return badRequest("바꿀 내용이 없습니다");
      step = "patch.update";
      try {
        const r = await updateReport(id, { status: body.status, adminMemo: body.adminMemo }, admin.uid);
        if (!r) return notFound("제보·신청을 찾을 수 없습니다");
        await logAdminAction(req, admin.uid, adminName, "memorial_report_update", {
          target: r.reportNo, detail: { id, status: r.status, memoChanged: body.adminMemo !== undefined },
        }).catch(() => {});
        return ok({ id: r.id, status: r.status }, "저장되었습니다");
      } catch (e: any) {
        if (isUserError(e)) return userErrorResponse(e);
        throw e;
      }
    }

    /* ===== POST — 추모관에 모시기 / 딥릴리프로 넘기기 ===== */
    if (req.method === "POST") {
      const action = url.searchParams.get("action") || "";
      step = "post.body";
      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }
      const id = Number(body.id || 0);
      if (!id) return badRequest("id가 필요합니다");

      if (action === "to-teacher") {
        step = "to-teacher";
        try {
          const r = await reportToTeacher(id, admin.uid, { name: body.name, schoolRegion: body.schoolRegion, deathDate: body.deathDate });
          await logAdminAction(req, admin.uid, adminName, "memorial_report_to_teacher", {
            target: r.reportNo, detail: { id, teacherId: r.teacherId },
          }).catch(() => {});
          return ok(r, "선생님 관리에 비공개 초안을 만들었습니다. 사진·약력을 채운 뒤 공개로 바꿔 주세요.");
        } catch (e: any) {
          if (isUserError(e)) return userErrorResponse(e);
          throw e;
        }
      }

      if (action === "to-case") {
        step = "to-case";
        try {
          const r = await reportToCase(id, admin.uid, { name: body.name, schoolName: body.schoolName, deceasedAt: body.deceasedAt });
          await logAdminAction(req, admin.uid, adminName, "memorial_report_to_case", {
            target: r.reportNo, detail: { id, caseId: r.caseId, caseNo: r.caseNo },
          }).catch(() => {});
          return ok(r, `딥릴리프에 사건 ${r.caseNo}(접수 단계)을 만들었습니다.`);
        } catch (e: any) {
          if (isUserError(e)) return userErrorResponse(e);
          throw e;
        }
      }

      return badRequest("알 수 없는 동작입니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id가 필요합니다");
      step = "delete";
      const r = await deleteReport(id);
      if (!r) return notFound("제보·신청을 찾을 수 없습니다");
      await logAdminAction(req, admin.uid, adminName, "memorial_report_delete", {
        target: r.reportNo, detail: { id, kind: r.kind, status: r.status },
      }).catch(() => {});
      return ok({ id }, "삭제했습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    return serverError("제보·신청 처리 실패", err, step);
  }
};
