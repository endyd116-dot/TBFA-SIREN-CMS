/**
 * 라운드 9 — 워크스페이스 서브태스크 생성
 * POST /api/admin-workspace-subtask-create  (requireAdmin)
 *
 * 정책: 1단계만 허용 — 부모 task의 parentTaskId가 이미 NOT NULL이면 403
 *
 * 요청: { parentTaskId, title, description?, assignedTo?, dueDate?, priority? }
 * 응답: { ok, id, task: { id, parentTaskId, title, status } }
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, workspaceTasks, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-workspace-subtask-create" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(status: number, step: string, error: string, detail?: any) {
  return new Response(
    JSON.stringify({ ok: false, error, step, detail: detail ? String(detail).slice(0, 500) : undefined }),
    { status, headers: JSON_HEADER }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return jsonError(405, "method", "POST만 허용");

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const meId = auth.ctx.member.id as number;

  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return jsonError(400, "parse", "JSON 본문 파싱 실패", e?.message);
  }

  const parentTaskId = Number(body?.parentTaskId);
  const title = String(body?.title || "").trim();
  if (!Number.isFinite(parentTaskId) || parentTaskId <= 0) return jsonError(400, "validate", "parentTaskId 필수");
  if (!title) return jsonError(400, "validate", "title 필수");

  try {
    /* check_parent — 부모 task 조회 + 손자 차단 */
    const [parent]: any = await db
      .select()
      .from(workspaceTasks)
      .where(eq(workspaceTasks.id, parentTaskId))
      .limit(1);
    if (!parent) return jsonError(404, "check_parent", "부모 작업을 찾을 수 없습니다");
    if (parent.parentTaskId) {
      return jsonError(403, "check_parent", "1단계 서브태스크만 허용됩니다.");
    }

    /* ★ Q3-004 fix: 부모 작업 접근 권한 검증 (메인 PATCH와 동일 — 소유/담당/지시/super) */
    const isSuperAdmin = (auth.ctx.member as any).role === "super_admin";
    const canEdit = isSuperAdmin || parent.memberId === meId || (parent.assignedTo === meId && parent.assignedBy) || parent.assignedBy === meId;
    if (!canEdit) return jsonError(403, "forbidden", "이 작업에 서브태스크를 추가할 권한이 없습니다");

    /* dueDate 처리 — 미지정 시 부모 마감일 사용 (workspaceTasks.dueDate NOT NULL 제약) */
    let dueDate: Date;
    if (body?.dueDate) {
      const d = new Date(body.dueDate);
      if (isNaN(d.getTime())) return jsonError(400, "validate", "dueDate 형식 오류");
      dueDate = d;
    } else {
      dueDate = new Date(parent.dueDate);
    }

    const description = body?.description ? String(body.description) : null;
    const assignedTo = body?.assignedTo ? Number(body.assignedTo) : null;
    const priority = String(body?.priority || "normal");

    // ★ Q3-040 fix: 담당자 지정 시 관리자(type='admin')만 허용 — 메인 작업 생성과 동일 (일반회원·유족 등 비관리자 배정 방지)
    if (assignedTo) {
      const [target]: any = await db.select({ id: members.id, type: members.type }).from(members).where(eq(members.id, assignedTo)).limit(1);
      if (!target || target.type !== "admin") return jsonError(400, "validate", "담당자는 관리자 계정만 지정할 수 있습니다");
    }

    const insertData: any = {
      memberId: meId,
      title,
      description,
      status: "todo",
      priority,
      dueDate,
      assignedBy: meId,
      assignedTo,
      assignedAt: assignedTo ? new Date() : null,
      parentTaskId,
    };

    const [task]: any = await db.insert(workspaceTasks).values(insertData).returning();

    return new Response(JSON.stringify({
      ok: true,
      id: task.id,
      task: {
        id: task.id,
        parentTaskId: task.parentTaskId,
        title: task.title,
        status: task.status,
      },
    }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    console.error("[admin-workspace-subtask-create]", err);
    return jsonError(500, "insert", "서브태스크 생성 실패", err?.message);
  }
};
