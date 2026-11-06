/**
 * /api/admin-docs — 공통 결재 문서 (2026-11-06)
 * 설계: docs/active/2026-11-06-approval-docs-design.md
 *
 * GET  ?view=home | list | detail | version | search | budgets | budget | people | recommend | lines | settings | form
 * POST { action, ... }
 *   save, submit, recall, decide, comment, followup_link, card_usage
 *   cancel_request, cancel_decide, delete, hold
 *   file_presign, file_add, file_remove
 *   line_save, line_delete, settings_save, guide_save, grant_save, grant_revoke, purge
 *
 * 돈 처리는 admin-approval-pay, admin-approval-refund가 맡는다.
 * 트랜잭션 안에서는 tx만 쓰고 알림·PDF·근태는 커밋 뒤에 처리한다. 응답 전에 끝낸다(함수가 멈추면 유실된다).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db/index";
import { blobUploads, members } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { eq, sql } from "drizzle-orm";
import { LedgerError, ledgerErrorBody, recordHistory } from "../../lib/ledger-post";
import { verifyPassword } from "../../lib/auth";
import { createNotification, notifyMany } from "../../lib/notify";
import { buildAndStoreResolutionPdf } from "../../lib/resolution-pdf-store";
import { generateBlobKey, getR2Client, R2_BUCKET } from "../../lib/r2-client";
import { deleteFromR2 } from "../../lib/r2-delete";
import {
  activePurgeGrant, decideCancel, decideDoc, deleteDoc, DOC_TYPES, type DocActor, EXPENSE_KINDS, FILE_KINDS, INTERNAL_KINDS,
  type LeaveBridge, linkFollowup, PAY_METHODS, purgeDoc, recallDoc, recordCardUsage, requestCancel, saveDraft, submitDoc,
} from "../../lib/approval-docs";
import {
  budgetChoices, budgetProgress, canViewDoc, docDetail, docVersion, homeCounts, listDocs, loadGuides, loadPeople,
  loadPurgeGrants, loadSavedLines, loadSettings, type ReadScope, recommendLine, searchDocs,
} from "../../lib/approval-docs-read";
import { createLeaveRequest, decideLeaveById, LeaveRequestError, withdrawLeaveRequest } from "../../lib/att-leave";

export const config = { path: "/api/admin-docs" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(jsonKST(body), { status, headers: JSON_HEADERS });
const FILE_MAX = 50 * 1024 * 1024;
const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp", "application/vnd.hancom.hwpx", "application/hwp+zip",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

/* 내부결재 ↔ 근태 휴가. 규칙은 근태와 같은 공용 처리를 쓴다 */
const leaveBridge: LeaveBridge = {
  async create(memberUid, form) {
    try {
      const r = await createLeaveRequest(memberUid, {
        leaveTypeId: Number(form.leaveTypeId), startDate: form.periodFrom, endDate: form.periodTo,
        reason: String(form.reasonText ?? "").slice(0, 500) || null, halfDayPeriod: form.halfDayPeriod || null,
      }, false);
      return Number(r.leaveId);
    } catch (err: any) {
      if (err instanceof LeaveRequestError) throw new LedgerError(err.message, 422);
      throw err;
    }
  },
  decide: decideLeaveById,
  withdraw: withdrawLeaveRequest,
};

async function notifyDoc(ids: (number | null | undefined)[], title: string, message: string, refId: number, severity: "info" | "warning" = "info", tab = "docs-inbox") {
  const list = [...new Set(ids.filter(Boolean).map(Number))];
  if (!list.length) return;
  try {
    await notifyMany(list, {
      recipientType: "operator", category: "system", severity, title, message,
      link: `/cms-tbfa.html#${tab}`, refTable: "approval_requests", refId,
    });
  } catch (err: any) {
    console.warn("[admin-docs] 알림 실패(무시):", err?.message);
  }
}

async function financeMembers(featureKey: string): Promise<number[]> {
  const out: number[] = [];
  for (const r of rowsOf(await db.execute(sql`
    SELECT id, role FROM members WHERE type = 'admin' AND status = 'active' AND role IN ('admin','super_admin')`))) {
    if (r.role === "super_admin" || await canAccess(r.role, featureKey)) out.push(Number(r.id));
  }
  return out;
}

async function scopeOf(auth: any): Promise<ReadScope> {
  const role = String(auth.ctx.member.role ?? "");
  const actor: DocActor = { id: Number(auth.ctx.admin.uid), name: auth.ctx.member.name ?? "", role };
  return {
    actor,
    finance: await canAccess(role, "finance_view"),
    bookkeeping: await canAccess(role, "finance_bookkeeping"),
  };
}

async function handleGet(req: Request, scope: ReadScope) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "home";
  const num = (k: string) => Number(url.searchParams.get(k)) || 0;
  const str = (k: string) => url.searchParams.get(k);

  if (view === "home") return json({ ok: true, data: await homeCounts(scope) });
  if (view === "list") {
    return json({ ok: true, data: await listDocs(scope, {
      box: str("box") || "all", docType: str("docType"), status: str("status"), q: str("q"),
      from: str("from"), to: str("to"), limit: num("limit") || 50, offset: num("offset"),
    }) });
  }
  if (view === "detail") {
    const d = await docDetail(scope, num("id"));
    return d ? json({ ok: true, data: d }) : json({ ok: false, error: "문서를 찾을 수 없거나 열람 권한이 없습니다" }, 404);
  }
  if (view === "version") {
    const d = await docVersion(scope, num("id"), num("version"));
    return d ? json({ ok: true, data: d }) : json({ ok: false, error: "해당 버전을 찾을 수 없습니다" }, 404);
  }
  if (view === "search") return json({ ok: true, data: { items: await searchDocs(scope, str("q") || "", str("docType"), num("exclude"), str("from"), str("to")) } });
  if (view === "budgets") return json({ ok: true, data: await budgetChoices(num("year")) });
  if (view === "budget") return json({ ok: true, data: await budgetProgress(scope, num("year"), num("budgetAccountId")) });
  if (view === "people") return json({ ok: true, data: { people: await loadPeople() } });
  if (view === "recommend") return json({ ok: true, data: await recommendLine(num("amount"), scope.actor.id) });
  if (view === "lines") return json({ ok: true, data: { lines: await loadSavedLines(scope.actor.id) } });
  if (view === "form") {
    const settings = await loadSettings();
    const leaveTypes = rowsOf(await db.execute(sql`SELECT id, name FROM att_leave_types WHERE is_active = TRUE ORDER BY id`))
      .map((r: any) => ({ id: Number(r.id), name: r.name }));
    return json({ ok: true, data: {
      docTypes: DOC_TYPES, internalKinds: INTERNAL_KINDS, payMethods: PAY_METHODS, expenseKinds: EXPENSE_KINDS, fileKinds: FILE_KINDS,
      guides: await loadGuides(), settings, leaveTypes,
      me: { id: scope.actor.id, name: scope.actor.name, role: scope.actor.role },
    } });
  }
  if (view === "settings") {
    const chair = scope.actor.role === "super_admin";
    return json({ ok: true, data: {
      settings: await loadSettings(), guides: await loadGuides(), lines: await loadSavedLines(scope.actor.id),
      grants: chair ? await loadPurgeGrants() : [],
      myGrant: !!(await activePurgeGrant(db, scope.actor.id)),
    } });
  }
  return json({ ok: false, error: "알 수 없는 조회입니다" }, 400);
}

async function afterDecide(outcome: any, id: number, actor: DocActor, comment: string | null) {
  const doc = outcome.doc;
  const label = DOC_TYPES[doc.doc_type]?.label ?? "문서";
  const leaveId = doc.att_leave_request_id == null ? null : Number(doc.att_leave_request_id);
  if (outcome.kind === "rejected") {
    if (leaveId) {
      try {
        await leaveBridge.decide(leaveId, "REJECTED", actor.id, comment);
        await db.execute(sql`UPDATE approval_requests SET att_leave_request_id = NULL WHERE id = ${id}`);
      } catch (err: any) { console.warn("[admin-docs] 휴가 반려 처리 실패:", err?.message); }
    }
    await notifyDoc([doc.drafter_id], `${label} 반려`, `"${doc.title}" 문서가 반려됐습니다.${comment ? " 사유: " + comment : ""}`, id, "warning", "docs-mine");
    return;
  }
  if (outcome.kind === "advanced") {
    await notifyDoc([outcome.nextAssignee], `${label} 결재 차례`, `${doc.drafter_name}님의 "${doc.title}" 문서가 결재를 기다립니다.`, id, "warning");
    return;
  }
  if (leaveId) {
    try { await leaveBridge.decide(leaveId, "APPROVED", actor.id, comment); }
    catch (err: any) { console.warn("[admin-docs] 휴가 승인 처리 실패:", err?.message); }
  }
  if (doc.doc_type === "expense") {
    try { await buildAndStoreResolutionPdf(id, actor.id); }
    catch (err: any) { console.warn("[admin-docs] 결의서 PDF 실패(무시):", err?.message); }
    await notifyDoc(await financeMembers("finance_bookkeeping"), "지출확인 대기", `"${doc.title}" ${Number(doc.amount).toLocaleString("ko-KR")}원이 최종 승인됐습니다. 지급 후 지출완료를 확인해 주세요.`, id, "info", "docs-pay");
  }
  await notifyDoc([doc.drafter_id], `${label} 최종 승인`, `"${doc.title}" 문서가 최종 승인됐습니다.`, id, "info", "docs-mine");
}

async function handlePost(req: Request, auth: any, scope: ReadScope) {
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body?.action ?? "");
  const id = Number(body?.id) || 0;
  const { actor } = scope;
  const chair = actor.role === "super_admin";

  if (action === "save") {
    return json({ ok: true, data: await saveDraft(actor, body) });
  }

  if (action === "submit") {
    const r = await submitDoc(actor, id, leaveBridge);
    const label = DOC_TYPES[(await rowsOfDoc(id)).doc_type]?.label ?? "문서";
    if (r.status === "pending") {
      await notifyDoc([r.firstAssignee], `${label} 결재 차례`, `${r.drafterName}님의 "${r.title}" 문서가 결재를 기다립니다.`, id, "warning");
    } else {
      await notifyDoc(await financeMembers("finance_view"), `${label} 승인 갈음`, `"${r.title}" 문서가 근거 품의로 승인 갈음 처리됐습니다.`, id);
    }
    return json({ ok: true, data: r });
  }

  if (action === "recall") {
    const r = await recallDoc(actor, id);
    if (r.leaveId) {
      try { await leaveBridge.withdraw(r.leaveId); } catch (err: any) { console.warn("[admin-docs] 휴가 철회 실패:", err?.message); }
    }
    return json({ ok: true, data: { status: r.status } });
  }

  if (action === "decide") {
    const outcome = await decideDoc(actor, id, body);
    await afterDecide(outcome, id, actor, body?.comment ? String(body.comment).slice(0, 1000) : null);
    return json({ ok: true, data: { result: outcome.kind, resolutionNo: (outcome as any).resolutionNo ?? null } });
  }

  if (action === "comment") {
    const text = String(body?.body ?? "").trim().slice(0, 2000);
    if (!text) throw new LedgerError("내용을 입력하세요", 400);
    if (!(await canViewDoc(scope, id))) throw new LedgerError("열람 권한이 없습니다", 403);
    await db.execute(sql`INSERT INTO approval_doc_comments (request_id, member_id, member_name, body) VALUES (${id}, ${actor.id}, ${actor.name}, ${text})`);
    return json({ ok: true, data: { id } });
  }

  if (action === "followup_link") {
    return json({ ok: true, data: await linkFollowup(actor, id, Number(body?.targetId) || 0) });
  }

  if (action === "card_usage") {
    return json({ ok: true, data: await recordCardUsage(actor, id, body, scope.bookkeeping || chair) });
  }

  if (action === "cancel_request") {
    const r = await requestCancel(actor, id, String(body?.reason ?? ""));
    await notifyDoc([r.firstAssignee], "취소 승인 요청", `"${r.title}" 문서의 취소 승인을 기다립니다.`, id, "warning");
    return json({ ok: true, data: { cancelStatus: "requested" } });
  }

  if (action === "cancel_decide") {
    const outcome = await decideCancel(actor, id, body);
    const doc = outcome.doc;
    if (outcome.kind === "advanced") {
      await notifyDoc([outcome.nextAssignee], "취소 승인 요청", `"${doc.title}" 문서의 취소 승인을 기다립니다.`, id, "warning");
    } else if (outcome.kind === "rejected") {
      await notifyDoc([doc.drafter_id], "취소 반려", `"${doc.title}" 문서의 취소가 반려됐습니다. 원문은 그대로 유효합니다.`, id, "warning", "docs-mine");
    } else {
      const leaveId = doc.att_leave_request_id == null ? null : Number(doc.att_leave_request_id);
      if (leaveId) {
        try { await leaveBridge.decide(leaveId, "CANCELLED", actor.id, doc.cancel_reason); }
        catch (err: any) { console.warn("[admin-docs] 휴가 취소 처리 실패:", err?.message); }
      }
      await notifyDoc([doc.drafter_id], "취소 최종 승인", `"${doc.title}" 문서가 취소됐습니다.`, id, "info", "docs-mine");
      if (outcome.refundRequired) {
        await notifyDoc(await financeMembers("finance_bookkeeping"), "반환 확인 필요", `"${doc.title}"은 이미 지급된 문서입니다. 실제 반환을 확인해 주세요.`, id, "warning", "docs-pay");
      }
      /* 근거 품의가 취소되면 연결된 카드 문서를 확인해야 한다(설계도 9쪽) */
      if (doc.doc_type === "proposal") {
        const cards = rowsOf(await db.execute(sql`
          SELECT id, drafter_id, title, form_data FROM approval_requests WHERE doc_type = 'card' AND substitute_basis_id = ${id} AND status = 'approved'`));
        for (const c of cards) {
          const used = c.form_data?.actualAmount != null;
          await notifyDoc([c.drafter_id], "카드 사용 확인 필요", used
            ? `근거 품의가 취소됐습니다. "${c.title}"은 이미 사용했으니 거래 취소·반환을 확인해 주세요.`
            : `근거 품의가 취소됐습니다. 미사용 카드 기록 "${c.title}"을 취소해 주세요.`, Number(c.id), "warning", "docs-mine");
        }
      }
    }
    return json({ ok: true, data: { result: outcome.kind } });
  }

  if (action === "delete") {
    const r = await deleteDoc(actor, id, body?.reason ?? null, scope.bookkeeping || chair);
    if (!r.removed) await notifyDoc([r.drafterId], "문서 삭제 완료", `"${r.title}" 문서가 일반 문서함에서 삭제되고 내부 보존됐습니다.`, id, "info", "docs-mine");
    return json({ ok: true, data: r });
  }

  if (action === "hold") {
    if (!chair) throw new LedgerError("보존 중지는 이사장이 지정합니다", 403);
    const reason = String(body?.reason ?? "").trim().slice(0, 300) || null;
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE approval_requests SET hold_reason = ${reason}, updated_at = NOW() WHERE id = ${id}`);
      await recordHistory(tx, { entity: "approval", entityId: id, action: reason ? "hold_set" : "hold_released", actor, reason });
    });
    return json({ ok: true, data: { holdReason: reason } });
  }

  if (action === "file_presign") {
    const fileName = String(body?.fileName ?? "").slice(0, 300).trim();
    const contentType = String(body?.contentType ?? "").slice(0, 100).trim();
    const sizeBytes = Number(body?.sizeBytes) || 0;
    if (!fileName || !contentType) throw new LedgerError("파일 정보가 없습니다", 400);
    if (!ALLOWED_MIME.includes(contentType)) throw new LedgerError(`지원하지 않는 파일 형식입니다: ${contentType}`, 400);
    if (sizeBytes > FILE_MAX) throw new LedgerError("파일은 50MB 이하여야 합니다", 400);
    const blobKey = generateBlobKey("approval-docs", actor.id, fileName);
    const [row] = await db.insert(blobUploads).values({
      blobKey, originalName: fileName, mimeType: contentType, sizeBytes, uploadedBy: null, uploadedByAdmin: actor.id,
      context: "approval-docs", isPublic: false, storageProvider: "r2", uploadStatus: "pending", expiresAt: null,
    } as any).returning();
    const uploadUrl = await getSignedUrl(getR2Client(), new PutObjectCommand({ Bucket: R2_BUCKET, Key: blobKey, ContentType: contentType }), { expiresIn: 900 });
    return json({ ok: true, data: { id: (row as any).id, uploadUrl } });
  }

  if (action === "file_add") {
    const blobId = Number(body?.blobId) || 0;
    const fileKind = FILE_KINDS[String(body?.fileKind)] ? String(body.fileKind) : "attachment";
    const doc = rowsOf(await db.execute(sql`SELECT drafter_id, status, version FROM approval_requests WHERE id = ${id}`))[0];
    if (!doc) throw new LedgerError("문서를 찾을 수 없습니다", 404);
    const editable = ["draft", "rejected", "recalled"].includes(doc.status) && Number(doc.drafter_id) === actor.id;
    /* 승인본은 고정한다. 완료 뒤 자료는 추가증빙으로만 붙는다(설계도 8쪽) */
    const additional = doc.status === "approved" && (Number(doc.drafter_id) === actor.id || scope.bookkeeping || chair);
    if (!editable && !additional) throw new LedgerError("이 상태에서는 파일을 붙일 수 없습니다", 403);
    const [blob] = await db.select().from(blobUploads).where(eq(blobUploads.id, blobId)).limit(1);
    if (!blob || (blob as any).context !== "approval-docs") throw new LedgerError("업로드 기록을 찾을 수 없습니다", 404);
    const sha256 = String(body?.sha256 ?? "").slice(0, 64) || null;
    await db.execute(sql`
      INSERT INTO approval_doc_files (request_id, version, file_kind, blob_id, blob_key, file_name, mime_type, size_bytes, sha256, uploaded_by, uploaded_by_name)
      VALUES (${id}, ${Number(doc.version)}, ${additional ? "additional" : fileKind}, ${blobId}, ${(blob as any).blobKey}, ${(blob as any).originalName},
              ${(blob as any).mimeType}, ${(blob as any).sizeBytes}, ${sha256}, ${actor.id}, ${actor.name})`);
    await db.update(blobUploads).set({ referenceTable: "approval_requests", referenceId: id } as any).where(eq(blobUploads.id, blobId));
    return json({ ok: true, data: { id } });
  }

  if (action === "file_remove") {
    const fileId = Number(body?.fileId) || 0;
    const f = rowsOf(await db.execute(sql`
      SELECT f.id, r.status, r.drafter_id FROM approval_doc_files f JOIN approval_requests r ON r.id = f.request_id
       WHERE f.id = ${fileId} AND f.request_id = ${id}`))[0];
    if (!f) throw new LedgerError("파일을 찾을 수 없습니다", 404);
    if (Number(f.drafter_id) !== actor.id || !["draft", "rejected", "recalled"].includes(f.status)) {
      throw new LedgerError("상신한 문서의 첨부는 지울 수 없습니다", 403);
    }
    await db.execute(sql`UPDATE approval_doc_files SET removed_at = NOW() WHERE id = ${fileId}`);
    return json({ ok: true, data: { id } });
  }

  if (action === "line_save") {
    const name = String(body?.name ?? "").trim().slice(0, 120);
    const steps = Array.isArray(body?.steps) ? body.steps : [];
    if (!name || !steps.length) throw new LedgerError("이름과 결재선을 입력하세요", 400);
    const shared = body?.shared === true && chair;
    await db.execute(sql`INSERT INTO approval_saved_lines (owner_id, name, steps) VALUES (${shared ? null : actor.id}, ${name}, ${JSON.stringify(steps)}::jsonb)`);
    return json({ ok: true, data: { lines: await loadSavedLines(actor.id) } });
  }
  if (action === "line_delete") {
    await db.execute(sql`DELETE FROM approval_saved_lines WHERE id = ${Number(body?.lineId) || 0} AND (owner_id = ${actor.id} OR ${chair})`);
    return json({ ok: true, data: { lines: await loadSavedLines(actor.id) } });
  }

  if (!chair && ["settings_save", "guide_save", "grant_save", "grant_revoke"].includes(action)) {
    throw new LedgerError("이 설정은 이사장만 바꿀 수 있습니다", 403);
  }

  if (action === "settings_save") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.cardRuleEffectiveOn ?? "")) ? String(body.cardRuleEffectiveOn) : null;
    const years = Number(body?.retentionYears);
    const minAmount = Math.max(0, Math.trunc(Number(body?.proposalMinAmount)) || 0);
    await db.execute(sql`
      UPDATE approval_settings
         SET card_rule_effective_on = ${date}, card_rule_note = ${String(body?.cardRuleNote ?? "").trim().slice(0, 500) || null},
             retention_years = ${Number.isInteger(years) && years > 0 ? years : null}, require_proposal = ${body?.requireProposal !== false},
             proposal_min_amount = ${minAmount}, updated_by_name = ${actor.name}, updated_at = NOW()
       WHERE id = 1`);
    await db.transaction(async (tx) => {
      await recordHistory(tx, { entity: "approval_settings", entityId: 1, action: "updated", actor, after: { cardRuleEffectiveOn: date, retentionYears: years || null } });
    });
    return json({ ok: true, data: { settings: await loadSettings() } });
  }

  if (action === "guide_save") {
    const docType = String(body?.docType ?? "");
    if (!DOC_TYPES[docType]) throw new LedgerError("문서 유형을 고르세요", 400);
    const guide = String(body?.guide ?? "").trim().slice(0, 5000);
    if (!guide) throw new LedgerError("안내 문구를 입력하세요", 400);
    await db.execute(sql`
      INSERT INTO approval_form_guides (doc_type, version, guide, created_by_name)
      SELECT ${docType}, COALESCE(MAX(version), 0) + 1, ${guide}, ${actor.name} FROM approval_form_guides WHERE doc_type = ${docType}`);
    return json({ ok: true, data: { guides: await loadGuides() } });
  }

  if (action === "grant_save") {
    const memberId = Number(body?.memberId) || 0;
    const startOn = String(body?.startOn ?? "");
    const endOn = String(body?.endOn ?? "");
    const reason = String(body?.reason ?? "").trim().slice(0, 500);
    if (!memberId || !/^\d{4}-\d{2}-\d{2}$/.test(startOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endOn) || !reason) {
      throw new LedgerError("담당자, 적용기간, 사유를 입력하세요", 400);
    }
    const m = rowsOf(await db.execute(sql`SELECT name FROM members WHERE id = ${memberId} AND type = 'admin' AND status = 'active'`))[0];
    if (!m) throw new LedgerError("담당자를 찾을 수 없습니다", 404);
    await db.execute(sql`
      INSERT INTO approval_purge_grants (member_id, member_name, granted_by, granted_by_name, start_on, end_on, reason)
      VALUES (${memberId}, ${m.name}, ${actor.id}, ${actor.name}, ${startOn}, ${endOn}, ${reason})`);
    return json({ ok: true, data: { grants: await loadPurgeGrants() } });
  }
  if (action === "grant_revoke") {
    const reason = String(body?.reason ?? "").trim().slice(0, 500);
    if (!reason) throw new LedgerError("해제 사유를 입력하세요", 400);
    await db.execute(sql`
      UPDATE approval_purge_grants SET revoked_at = NOW(), revoked_by_name = ${actor.name}, revoke_reason = ${reason}
       WHERE id = ${Number(body?.grantId) || 0} AND revoked_at IS NULL`);
    return json({ ok: true, data: { grants: await loadPurgeGrants() } });
  }

  if (action === "purge") {
    const grant = await activePurgeGrant(db, actor.id);
    if (!grant) throw new LedgerError("완전삭제 권한이 없습니다", 403);
    /* 재인증(설계도 12쪽) */
    const [member] = await db.select({ passwordHash: members.passwordHash }).from(members).where(eq(members.id, actor.id)).limit(1);
    const ok = member?.passwordHash ? await verifyPassword(String(body?.password ?? ""), member.passwordHash) : false;
    if (!ok) throw new LedgerError("비밀번호가 맞지 않습니다", 403);
    const r = await purgeDoc(actor, id, String(body?.reason ?? ""), Number(grant.id));
    for (const key of r.blobKeys) {
      try { await deleteFromR2(key); } catch (err: any) { console.warn("[admin-docs] 첨부 삭제 실패:", err?.message); }
    }
    await notifyDoc(await financeMembers("finance_view"), "문서 완전삭제 완료", `문서 ${id}번이 완전삭제됐습니다.`, id);
    return json({ ok: true, data: { purged: true } });
  }

  return json({ ok: false, error: "알 수 없는 처리입니다" }, 400);
}

async function rowsOfDoc(id: number) {
  return rowsOf(await db.execute(sql`SELECT doc_type FROM approval_requests WHERE id = ${id}`))[0] ?? {};
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const scope = await scopeOf(auth);
  try {
    if (req.method === "GET") return await handleGet(req, scope);
    if (req.method === "POST") return await handlePost(req, auth, scope);
    return json({ ok: false, error: "GET, POST만 허용" }, 405);
  } catch (err: any) {
    const { status, body } = ledgerErrorBody("docs", "결재 문서 처리 실패", err);
    return json(body, status);
  }
}
