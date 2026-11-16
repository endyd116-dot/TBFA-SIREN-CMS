/**
 * lib/memorial-reports.ts — 추모관 «함께 알려 주세요» 제보·신청 (★ 2026-11-16 Swain 지시)
 *
 * 추모관을 찾은 선생님·유가족이 남기는 세 가지 이야기를 받는다.
 *   death    : 선생님의 사망 소식 제보 — 동료·지인이 알게 된 소식
 *   family   : 도움이 필요한 유가족 제보 — 곁에서 힘겨워하는 유가족
 *   enshrine : 유가족이 직접 고인을 추모관에 모시고 싶다는 신청
 *
 * Swain 결정(2026-11-16)
 *   · 운영자는 추모관 관리의 «제보·신청» 탭에서 본다(cms_memorial 권한). 공개 화면에는 절대 나오지 않는다.
 *   · 확인 뒤 [추모관에 모시기](선생님 관리에 비공개 초안) · [딥릴리프로 넘기기](순직 인정 지원 사건 접수)로 잇는다.
 *   · 유가족 연락처는 제한 없이 받는다.
 *   · 기록은 처리가 끝난 뒤 3년 보관 — 매일 새벽 정리 cron이 지난 기록을 지운다(개인정보처리방침 «추모관 제보·신청»).
 *   · 로그인 없이 받는다(편지와 같은 원칙) — 같은 기기 60초 간격·하루 5건 한도·자동 입력 차단 칸.
 *
 * 저장 공간(memorial_reports)은 직접 SQL로 다룬다. 마이그(migrate-memorial-reports) 전에는
 * «준비 안 됨»으로 답하고 화면이 멈추지 않는다(이달의 기억·징검다리와 같은 방식).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { memorialTeachers } from "../db/schema";
import { todayKST } from "./kst";

export type ReportKind = "death" | "family" | "enshrine";
export type ReportStatus = "new" | "checking" | "contacted" | "done" | "closed";

export const REPORT_KINDS: ReportKind[] = ["death", "family", "enshrine"];
export const REPORT_STATUSES: ReportStatus[] = ["new", "checking", "contacted", "done", "closed"];
export const KIND_LABEL: Record<ReportKind, string> = {
  death: "선생님 사망 소식",
  family: "도움이 필요한 유가족",
  enshrine: "추모관에 모시기 신청",
};
export const STATUS_LABEL: Record<ReportStatus, string> = {
  new: "새 접수",
  checking: "확인 중",
  contacted: "연락함",
  done: "처리 완료",
  closed: "종결",
};
/* 처리가 끝난 상태 — 이때부터 보관 기간(3년)을 센다 */
const TERMINAL: ReportStatus[] = ["done", "closed"];

export const RETENTION_YEARS = 3;
export const CONSENT_VERSION = "memorial-report v1 (2026-11-16)";
export const ANON_COOLDOWN_SECONDS = 60;
export const DAILY_LIMIT_PER_DEVICE = 5;

const MAX_CONTENT = 3000;
const MAX_MEMO = 2000;

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}
function clip(v: any, n: number): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, n) : null;
}
function digitsOf(s: any): string {
  return String(s ?? "").replace(/[^0-9]/g, "");
}

/* ───────── 준비 확인 ─────────
   «있음»은 기억하고, «없음»은 30초마다 다시 본다 — 마이그 뒤 재배포 없이 켜지게(편지 사진과 같은 방식). */
let _ready = false;
let _checkedAt = 0;
export async function reportsReady(): Promise<boolean> {
  if (_ready) return true;
  if (Date.now() - _checkedAt < 30_000) return false;
  _checkedAt = Date.now();
  try {
    const r = rowsOf(await db.execute(sql`SELECT to_regclass('public.memorial_reports') IS NOT NULL AS ok`));
    _ready = r[0]?.ok === true;
  } catch {
    _ready = false;
  }
  return _ready;
}

/* ───────── 접수 내용 검사 ───────── */
export interface ReportInput {
  kind: ReportKind;
  teacherName: string | null;
  schoolRegion: string | null;
  deathDateText: string | null;
  content: string | null;
  familyName: string | null;
  familyRelation: string | null;
  familyPhone: string | null;
  reporterName: string | null;
  reporterRelation: string | null;
  reporterPhone: string | null;
  reporterEmail: string | null;
}

export function validateReportInput(body: any): { ok: true; value: ReportInput } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const kind = String(body?.kind || "") as ReportKind;
  if (!REPORT_KINDS.includes(kind)) return fail("어떤 이야기를 전해 주시는지 골라 주세요");
  const isFamilyApplicant = kind === "enshrine";   // 신청하시는 분이 곧 유가족 — 따로 적는 유가족 칸은 없다
  const v: ReportInput = {
    kind,
    teacherName: clip(body?.teacherName, 60),
    schoolRegion: clip(body?.schoolRegion, 150),
    deathDateText: clip(body?.deathDateText, 40),
    content: clip(body?.content, MAX_CONTENT),
    familyName: isFamilyApplicant ? null : clip(body?.familyName, 60),
    familyRelation: isFamilyApplicant ? null : clip(body?.familyRelation, 40),
    familyPhone: isFamilyApplicant ? null : clip(body?.familyPhone, 30),
    reporterName: clip(body?.reporterName, 60),
    reporterRelation: clip(body?.reporterRelation, 40),
    reporterPhone: clip(body?.reporterPhone, 30),
    reporterEmail: clip(body?.reporterEmail, 120),
  };
  if ((kind === "death" || kind === "enshrine") && !v.teacherName) return fail("선생님 성함을 적어 주세요");
  if (kind === "family" && !v.content) return fail("어떤 도움이 필요해 보이는지 적어 주세요");
  if (kind === "enshrine" && !v.reporterRelation) return fail("고인과의 관계를 적어 주세요");
  if (!v.reporterName) return fail("신청하시는 분의 성함을 적어 주세요");
  if (!v.reporterPhone || digitsOf(v.reporterPhone).length < 9) return fail("연락받으실 휴대폰 번호를 적어 주세요");
  if (v.familyPhone && digitsOf(v.familyPhone).length < 9) return fail("유가족 연락처를 다시 확인해 주세요");
  if (v.reporterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.reporterEmail)) return fail("이메일 주소를 다시 확인해 주세요");
  if (body?.consent !== true) return fail("개인정보 수집·이용에 동의해 주셔야 접수할 수 있습니다");
  return { ok: true, value: v };
}

/* ───────── 도배 방지 (로그인하지 않은 분만) ───────── */
export async function anonLimitHit(ipHash: string): Promise<"cooldown" | "daily" | null> {
  if (!ipHash) return null;
  const r = rowsOf(await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at > now() - ${sql.raw(`interval '${ANON_COOLDOWN_SECONDS} seconds'`)})::int AS recent,
      COUNT(*)::int AS day
    FROM memorial_reports
    WHERE ip_hash = ${ipHash} AND member_id IS NULL AND created_at > now() - interval '24 hours'
  `));
  const recent = Number(r[0]?.recent || 0);
  const day = Number(r[0]?.day || 0);
  if (recent > 0) return "cooldown";
  if (day >= DAILY_LIMIT_PER_DEVICE) return "daily";
  return null;
}

/* ───────── 접수 저장 ─────────
   접수번호 MR-YYYYMMDD-XXXX (한국 날짜 + 헷갈리지 않는 글자 4개). 겹치면 새로 만들어 다시 넣는다. */
function makeReportNo(): string {
  const ymd = todayKST().replace(/-/g, "");
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `MR-${ymd}-${s}`;
}

export async function insertReport(
  v: ReportInput,
  meta: { memberId: number | null; ipHash: string | null },
): Promise<{ id: number; reportNo: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const reportNo = makeReportNo();
    try {
      const r = rowsOf(await db.execute(sql`
        INSERT INTO memorial_reports
          (report_no, kind, status, teacher_name, school_region, death_date_text, content,
           family_name, family_relation, family_phone,
           reporter_name, reporter_relation, reporter_phone, reporter_email,
           member_id, consent_at, consent_version, ip_hash)
        VALUES
          (${reportNo}, ${v.kind}, 'new', ${v.teacherName}, ${v.schoolRegion}, ${v.deathDateText}, ${v.content},
           ${v.familyName}, ${v.familyRelation}, ${v.familyPhone},
           ${v.reporterName}, ${v.reporterRelation}, ${v.reporterPhone}, ${v.reporterEmail},
           ${meta.memberId}, now(), ${CONSENT_VERSION}, ${meta.ipHash})
        RETURNING id, report_no
      `));
      return { id: Number(r[0].id), reportNo: String(r[0].report_no) };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (err?.code === "23505" || msg.includes("report_no")) continue;   // 접수번호가 겹쳤다 — 다시
      throw err;
    }
  }
  throw new Error("접수번호를 만들지 못했습니다");
}

/* ───────── 운영자 화면 ───────── */
function iso(v: any): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function shapeSummary(r: any) {
  const kind = String(r.kind) as ReportKind;
  const status = String(r.status) as ReportStatus;
  return {
    id: Number(r.id),
    reportNo: String(r.report_no || ""),
    kind,
    kindLabel: KIND_LABEL[kind] || kind,
    status,
    statusLabel: STATUS_LABEL[status] || status,
    teacherName: r.teacher_name ?? null,
    schoolRegion: r.school_region ?? null,
    deathDateText: r.death_date_text ?? null,
    reporterName: r.reporter_name ?? null,
    reporterRelation: r.reporter_relation ?? null,
    reporterPhone: r.reporter_phone ?? null,
    hasFamilyContact: !!(r.family_phone || r.family_name),
    linkedTeacherId: r.linked_teacher_id == null ? null : Number(r.linked_teacher_id),
    linkedCaseId: r.linked_case_id == null ? null : Number(r.linked_case_id),
    isMember: r.member_id != null,
    createdAt: iso(r.created_at),
    processedAt: iso(r.processed_at),
  };
}

export async function listReports(opts: { status?: string; kind?: string; q?: string; limit?: number }) {
  const conds: any[] = [sql`TRUE`];
  const status = String(opts.status || "open");
  if (status === "open") conds.push(sql`status IN ('new', 'checking', 'contacted')`);
  else if ((REPORT_STATUSES as string[]).includes(status)) conds.push(sql`status = ${status}`);
  const kind = String(opts.kind || "");
  if ((REPORT_KINDS as string[]).includes(kind)) conds.push(sql`kind = ${kind}`);
  const q = String(opts.q || "").trim().slice(0, 60);
  if (q) {
    const like = `%${q}%`;
    const dq = digitsOf(q);
    const parts: any[] = [
      sql`teacher_name ILIKE ${like}`, sql`reporter_name ILIKE ${like}`, sql`school_region ILIKE ${like}`,
      sql`family_name ILIKE ${like}`, sql`report_no ILIKE ${like}`,
    ];
    if (dq.length >= 4) {
      const dlike = `%${dq}%`;
      parts.push(sql`regexp_replace(coalesce(reporter_phone, ''), '[^0-9]', '', 'g') LIKE ${dlike}`);
      parts.push(sql`regexp_replace(coalesce(family_phone, ''), '[^0-9]', '', 'g') LIKE ${dlike}`);
    }
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 300);
  const rows = rowsOf(await db.execute(sql`
    SELECT id, report_no, kind, status, teacher_name, school_region, death_date_text,
           reporter_name, reporter_relation, reporter_phone, family_name, family_phone,
           linked_teacher_id, linked_case_id, member_id, created_at, processed_at
      FROM memorial_reports
     WHERE ${sql.join(conds, sql` AND `)}
     ORDER BY (status = 'new') DESC, created_at DESC
     LIMIT ${limit}
  `));
  return rows.map(shapeSummary);
}

export async function countReports(): Promise<Record<string, number>> {
  const out: Record<string, number> = { new: 0, checking: 0, contacted: 0, done: 0, closed: 0, open: 0, total: 0 };
  const rows = rowsOf(await db.execute(sql`SELECT status, COUNT(*)::int AS n FROM memorial_reports GROUP BY status`));
  for (const r of rows) {
    const n = Number(r.n || 0);
    out[String(r.status)] = n;
    out.total += n;
    if (["new", "checking", "contacted"].includes(String(r.status))) out.open += n;
  }
  return out;
}

export async function getReport(id: number) {
  const rows = rowsOf(await db.execute(sql`SELECT * FROM memorial_reports WHERE id = ${id} LIMIT 1`));
  const r = rows[0];
  if (!r) return null;
  let linkedTeacher: any = null;
  let linkedCase: any = null;
  if (r.linked_teacher_id != null) {
    try {
      const t = rowsOf(await db.execute(sql`SELECT id, name, is_public FROM memorial_teachers WHERE id = ${Number(r.linked_teacher_id)}`))[0];
      if (t) linkedTeacher = { id: Number(t.id), name: t.name, isPublic: t.is_public === true };
    } catch { /* 보조 — 없으면 비워 둔다 */ }
  }
  if (r.linked_case_id != null) {
    try {
      const c = rowsOf(await db.execute(sql`SELECT id, case_no, status FROM martyrdom_cases WHERE id = ${Number(r.linked_case_id)}`))[0];
      if (c) linkedCase = { id: Number(c.id), caseNo: c.case_no, status: c.status };
    } catch { /* 보조 */ }
  }
  return {
    ...shapeSummary(r),
    content: r.content ?? null,
    familyName: r.family_name ?? null,
    familyRelation: r.family_relation ?? null,
    familyPhone: r.family_phone ?? null,
    reporterEmail: r.reporter_email ?? null,
    adminMemo: r.admin_memo ?? null,
    consentAt: iso(r.consent_at),
    consentVersion: r.consent_version ?? null,
    updatedAt: iso(r.updated_at),
    linkedTeacher,
    linkedCase,
  };
}

/** 상태·운영자 메모 저장. 처리 완료·종결로 바뀌는 순간부터 보관 기간을 센다(다시 열면 지운다). */
export async function updateReport(id: number, patch: { status?: any; adminMemo?: any }, adminId: number) {
  const sets: any[] = [sql`updated_at = now()`, sql`handled_by = ${adminId}`];
  if (patch.status !== undefined) {
    const st = String(patch.status) as ReportStatus;
    if (!REPORT_STATUSES.includes(st)) throw Object.assign(new Error("알 수 없는 상태입니다"), { userError: true });
    sets.push(sql`status = ${st}`);
    sets.push(TERMINAL.includes(st)
      ? sql`processed_at = COALESCE(processed_at, now())`
      : sql`processed_at = NULL`);
  }
  if (patch.adminMemo !== undefined) sets.push(sql`admin_memo = ${clip(patch.adminMemo, MAX_MEMO)}`);
  const r = rowsOf(await db.execute(sql`
    UPDATE memorial_reports SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING id, report_no, status
  `));
  return r[0] ? { id: Number(r[0].id), reportNo: String(r[0].report_no), status: String(r[0].status) } : null;
}

/** YYYY-MM-DD(또는 2026.10.03·2026/10/03)만 날짜로 본다. 그 밖의 «10월쯤» 같은 말은 날짜 칸에 넣지 않는다. */
export function parseYmd(s: any): string | null {
  const m = String(s ?? "").trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

class UserError extends Error { userError = true; status: number; constructor(m: string, status = 400) { super(m); this.status = status; } }
export function isUserError(e: any): e is { message: string; status?: number } { return !!(e && e.userError); }

/** [추모관에 모시기] — 선생님 관리에 «비공개» 초안을 만든다. 사진·약력을 채운 뒤 운영자가 공개로 바꾼다. */
export async function reportToTeacher(
  id: number, adminId: number, over: { name?: any; schoolRegion?: any; deathDate?: any },
) {
  return await db.transaction(async (tx) => {
    const r = rowsOf(await tx.execute(sql`
      SELECT id, report_no, kind, teacher_name, school_region, death_date_text, linked_teacher_id
        FROM memorial_reports WHERE id = ${id} FOR UPDATE
    `))[0];
    if (!r) throw new UserError("제보·신청을 찾을 수 없습니다", 404);
    if (r.linked_teacher_id != null) throw new UserError(`이미 추모관에 모셨습니다 (선생님 #${r.linked_teacher_id})`, 409);
    const name = clip(over.name, 60) || clip(r.teacher_name, 60);
    if (!name) throw new UserError("선생님 성함을 적어 주세요");
    const schoolRegion = clip(over.schoolRegion, 120) ?? clip(r.school_region, 120);
    const deathDate = parseYmd(over.deathDate !== undefined ? over.deathDate : r.death_date_text);
    /* 이 프로젝트는 strictNullChecks가 꺼져 있어 drizzle이 선택 칸을 타입에서 빼므로 any로 넘긴다
       (선생님 관리 admin-memorial-teachers.ts의 insertData와 같은 방식) */
    const values: any = {
      name,
      schoolRegion: schoolRegion ?? undefined,
      deathDate: deathDate ?? undefined,
      isPublic: false,
      createdBy: adminId,
    };
    const [t] = await tx.insert(memorialTeachers).values(values).returning({ id: memorialTeachers.id });
    await tx.execute(sql`
      UPDATE memorial_reports
         SET linked_teacher_id = ${t.id}, handled_by = ${adminId}, updated_at = now(),
             status = CASE WHEN status = 'new' THEN 'checking' ELSE status END
       WHERE id = ${id}
    `);
    return { teacherId: Number(t.id), name, reportNo: String(r.report_no) };
  });
}

/** [딥릴리프로 넘기기] — 순직 인정 지원 사건(접수 단계)을 만든다. 연락처는 옮기지 않고 접수번호로 이어 둔다. */
export async function reportToCase(
  id: number, adminId: number, over: { name?: any; schoolName?: any; deceasedAt?: any },
) {
  return await db.transaction(async (tx) => {
    const r = rowsOf(await tx.execute(sql`
      SELECT id, report_no, kind, teacher_name, school_region, death_date_text, content, linked_case_id
        FROM memorial_reports WHERE id = ${id} FOR UPDATE
    `))[0];
    if (!r) throw new UserError("제보·신청을 찾을 수 없습니다", 404);
    if (r.linked_case_id != null) throw new UserError(`이미 딥릴리프로 넘겼습니다 (사건 #${r.linked_case_id})`, 409);
    const kind = String(r.kind) as ReportKind;
    const name = clip(over.name, 50) || clip(r.teacher_name, 50);
    const schoolName = clip(over.schoolName, 150) ?? clip(r.school_region, 150);
    const deceasedAt = parseYmd(over.deceasedAt !== undefined ? over.deceasedAt : r.death_date_text);
    const title = `${name || "성함 미상"} 선생님 — 추모관 ${KIND_LABEL[kind] || "제보"} (${r.report_no})`.slice(0, 200);
    const summary = [
      clip(r.content, 1700),
      `[추모관 제보·신청 ${r.report_no}에서 넘어온 사건입니다. 신청하신 분·유가족 연락처는 추모관 관리 › 제보·신청에서 확인하세요.]`,
    ].filter(Boolean).join("\n\n").slice(0, 2000);

    /* 사건 번호는 딥릴리프 화면과 같은 규칙(MTR-YYYYMMDD-순번) — admin-martyrdom-cases.ts와 맞춘다 */
    const prefix = `MTR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-`;
    let created: any = null;
    for (let attempt = 0; attempt < 4 && !created; attempt++) {
      const last = rowsOf(await tx.execute(sql`
        SELECT case_no FROM martyrdom_cases WHERE case_no LIKE ${prefix + "%"} ORDER BY case_no DESC LIMIT 1
      `))[0];
      const seq = (last?.case_no ? Number(String(last.case_no).split("-").pop()) || 0 : 0) + 1 + attempt;
      const caseNo = `${prefix}${String(seq).padStart(4, "0")}`;
      const ins = rowsOf(await tx.execute(sql`
        INSERT INTO martyrdom_cases
          (case_no, case_kind, title, deceased_name, school_name, deceased_at, occurred_summary, created_by, updated_at)
        VALUES
          (${caseNo}, 'active', ${title}, ${name}, ${schoolName}, ${deceasedAt}, ${summary}, ${adminId}, now())
        ON CONFLICT (case_no) DO NOTHING
        RETURNING id, case_no
      `));
      if (ins[0]) created = ins[0];
    }
    if (!created) throw new Error("사건 번호를 만들지 못했습니다");
    await tx.execute(sql`
      UPDATE memorial_reports
         SET linked_case_id = ${Number(created.id)}, handled_by = ${adminId}, updated_at = now(),
             status = CASE WHEN status = 'new' THEN 'checking' ELSE status END
       WHERE id = ${id}
    `);
    return { caseId: Number(created.id), caseNo: String(created.case_no), reportNo: String(r.report_no) };
  });
}

export async function deleteReport(id: number) {
  const r = rowsOf(await db.execute(sql`
    DELETE FROM memorial_reports WHERE id = ${id} RETURNING report_no, kind, status
  `));
  return r[0] ? { reportNo: String(r[0].report_no), kind: String(r[0].kind), status: String(r[0].status) } : null;
}

/** 처리가 끝난 지 3년 지난 기록을 지운다(매일 새벽 정리 cron). 저장 공간이 없으면 0. */
export async function purgeExpiredReports(): Promise<number> {
  if (!(await reportsReady())) return 0;
  const r: any = await db.execute(sql`
    DELETE FROM memorial_reports
     WHERE processed_at IS NOT NULL
       AND processed_at < now() - ${sql.raw(`interval '${RETENTION_YEARS} years'`)}
  `);
  /* 운영(postgres-js)은 count, 다른 드라이버는 rowCount·affectedRows로 지운 건수를 알려 준다 */
  return Number(r?.count ?? r?.rowCount ?? r?.affectedRows ?? 0) || 0;
}
