// lib/payroll-document.ts
// 급여명세서 '증빙 문서' 파이프라인 — 고정 보관 · 무결성 해시 · 서명본.
//
// 왜 필요한가:
//   과거엔 PDF를 저장하지 않고 다운로드할 때마다 그 순간의 DB 값으로 새로 만들었다.
//   나중에 4대보험 요율이나 급여 기준을 바꾸면 '작년 명세서'를 다시 뽑았을 때 숫자가 달라진다.
//   이 상태로 서명을 받으면 직원이 무엇에 서명했는지 증명할 수 없다.
//   → 교부(발송) 시점에 PDF를 만들어 저장소에 고정하고 지문(해시)을 남긴다.
//     이후 직원 열람·다운로드·서명은 전부 이 고정 문서를 대상으로 한다.
//     정정이 필요하면 원본을 지우지 않고 다음 차수 문서를 새로 발행한다.

import { createHash } from "node:crypto";
// @ts-ignore — sharp는 runtime 의존성 (Netlify 빌드 시 자동 설치 + external_node_modules)
import sharp from "sharp";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { uploadToR2, downloadFromR2 } from "./r2-server";
import { generatePayrollSlipPdf, payrollSlipFilename, PayrollSignatureInput } from "./payroll-pdf";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/**
 * 서명 이미지 정화 — PDF에 넣기 전에 반드시 통과시킨다.
 *
 * 왜 필요한가:
 *   PDF 라이브러리는 깨진 PNG를 만나면 오류를 내지 않고 '그대로 멈춰버린다'(무한 루프).
 *   서명 제출은 서버리스 함수라 멈추면 타임아웃 → 직원은 서명이 안 됐는지 됐는지도 모른다.
 *   그래서 검증된 이미지 처리기로 한 번 다시 그려서(re-encode) 그 위험을 원천 차단한다.
 * 덤:
 *   - 캔버스의 빈 여백을 잘라내 서명이 서명란에 꽉 차게 보인다
 *   - 완전히 빈 캔버스(아무것도 안 그림)를 여기서 걸러낸다
 */
export async function normalizeSignaturePng(
  bytes: Uint8Array
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  try {
    const src = sharp(Buffer.from(bytes)).ensureAlpha();

    /* 완전히 투명(=아무것도 안 그림)이면 서명으로 인정하지 않는다 */
    try {
      const st: any = await src.clone().stats();
      const alpha = st?.channels?.[3];
      if (alpha && Number(alpha.max) === 0) {
        return { ok: false, error: "서명이 비어 있습니다. 서명란에 직접 서명해 주세요" };
      }
    } catch { /* 통계 실패는 무시하고 계속 (아래 재인코딩이 본 방어선) */ }

    const render = (s: any) =>
      s.resize({ width: 900, height: 300, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();

    /* 여백 잘라내기 — 전부 비어 있으면 실패하므로 그때는 자르지 않고 그대로 */
    let out: Buffer;
    try {
      out = await render(src.clone().trim({ threshold: 8 }));
    } catch {
      out = await render(src.clone());
    }

    if (!out || out.length === 0) return { ok: false, error: "서명 이미지를 처리하지 못했습니다" };
    return { ok: true, bytes: new Uint8Array(out) };
  } catch (err: any) {
    return { ok: false, error: `서명 이미지를 읽지 못했습니다: ${String(err?.message ?? err).slice(0, 120)}` };
  }
}

export interface SlipWithMember {
  slip: any;
  member: { id: number | string; name: string; email?: string | null; position?: string | null; role?: string | null; milestoneRole?: string | null };
}

/** 명세서 1건 + 직원 정보 (PDF 생성에 필요한 최소 묶음) */
export async function loadSlipWithMember(slipId: number): Promise<SlipWithMember | null> {
  const r: any = await db.execute(sql`
    SELECT s.*, m.name AS m_name, m.email AS m_email, m.role AS m_role,
           m.milestone_role AS m_milestone_role, m.position AS m_position
      FROM payroll_slips s
      LEFT JOIN members m ON m.id = NULLIF(s.member_uid, '')::int
     WHERE s.id = ${slipId}
     LIMIT 1
  `);
  const row = ((r as any).rows ?? r ?? [])[0];
  if (!row) return null;

  return {
    slip: {
      ...row,
      // drizzle raw 결과는 snake_case — PDF·계산근거 모듈이 둘 다 읽도록 camel 별칭을 얹는다
      payYear: row.pay_year, payMonth: row.pay_month,
      workingDays: row.working_days, workingMins: row.working_mins, overtimeMins: row.overtime_mins,
      lateCount: row.late_count, absentCount: row.absent_count,
      paidLeaveDays: row.paid_leave_days, unpaidLeaveDays: row.unpaid_leave_days,
      perfectAttendance: row.perfect_attendance,
      baseSalaryMonth: row.base_salary_month, overtimePay: row.overtime_pay,
      deductionUnpaid: row.deduction_unpaid, performanceBonus: row.performance_bonus,
      perfectBonus: row.perfect_bonus, grossPay: row.gross_pay,
      nationalPension: row.national_pension, healthInsurance: row.health_insurance,
      longTermCare: row.long_term_care, employmentInsurance: row.employment_insurance,
      incomeTax: row.income_tax, localTax: row.local_tax,
      otherDeduction: row.other_deduction, totalDeduction: row.total_deduction, netPay: row.net_pay,
      calculationSnapshot: row.calculation_snapshot,
      documentVersion: row.document_version, documentR2Key: row.document_r2_key,
      documentSha256: row.document_sha256, signedDocumentR2Key: row.signed_document_r2_key,
      issuedAt: row.issued_at, sentAt: row.sent_at, paidAt: row.paid_at, approvedAt: row.approved_at,
      ackStatus: row.ack_status, ackAt: row.ack_at,
    },
    member: {
      id: Number(row.member_uid),
      name: row.m_name ?? `회원ID:${row.member_uid}`,
      email: row.m_email ?? null,
      role: row.m_role ?? null,
      milestoneRole: row.m_milestone_role ?? null,
      position: row.m_position ?? null,
    },
  };
}

export interface IssueResult {
  ok: boolean;
  r2Key?: string;
  sha256?: string;
  version?: number;
  bytes?: Uint8Array;
  error?: string;
}

/**
 * 교부 문서 확정 — PDF를 만들어 저장소에 고정하고 명세서에 지문을 기록한다.
 *
 * 문서 차수(version)가 언제 올라가는가:
 *   1) 이미 확정된 문서가 있으면 그대로 쓴다 — 문서는 한 번 교부되면 변하지 않는다.
 *   2) 관리자가 [정정 재발행]을 눌렀을 때 (bumpVersion)
 *   3) **이미 교부한 적이 있는데 고정 문서가 사라졌을 때** — 금액이 다시 계산됐거나 관리자가
 *      직접 수정하면 그 시점에 고정 문서를 버린다(payroll-calc·admin-payroll). 그 상태로 다시
 *      발송하면 '내용이 바뀐 새 문서'이므로 차수를 올려 정정본으로 교부한다.
 *      (이 처리가 없으면 재발송 시 옛 PDF가 그대로 나가 직원이 틀린 명세서를 받는다.)
 *
 * 차수가 올라가면 이전 서명은 그 문서에 대한 것이 아니므로 수령확인을 다시 받는다.
 * 이전 서명 증적은 payroll_acknowledgments에 그대로 남는다 — 지우지 않는다.
 */
export async function issuePayrollDocument(
  slipId: number,
  opts: { bumpVersion?: boolean; issuedAt?: Date } = {}
): Promise<IssueResult> {
  const loaded = await loadSlipWithMember(slipId);
  if (!loaded) return { ok: false, error: "명세서를 찾을 수 없습니다" };

  const { slip, member } = loaded;

  /* 이미 확정된 문서가 있고 재발행 지시가 아니면 그대로 쓴다 */
  if (!opts.bumpVersion && slip.documentR2Key && slip.documentSha256) {
    return {
      ok: true,
      r2Key: slip.documentR2Key,
      sha256: slip.documentSha256,
      version: Number(slip.documentVersion || 1),
    };
  }

  /* 교부 이력이 있는데 고정 문서가 없다 = 내용이 바뀌었다 → 정정본 */
  const isReissue = !!opts.bumpVersion || (!!slip.issuedAt && !slip.documentR2Key);
  const version = isReissue ? Number(slip.documentVersion || 1) + 1 : Number(slip.documentVersion || 1);
  const issuedAt = opts.issuedAt ?? (isReissue || !slip.issuedAt ? new Date() : new Date(slip.issuedAt));

  let bytes: Uint8Array;
  try {
    bytes = await generatePayrollSlipPdf({
      slip: { ...slip, documentVersion: version, issuedAt },
      member,
    });
  } catch (err: any) {
    return { ok: false, error: `문서 생성 실패: ${String(err?.message ?? err).slice(0, 200)}` };
  }

  const digest = sha256Hex(bytes);

  const up = await uploadToR2({
    buffer: bytes,
    originalName: payrollSlipFilename({ ...slip, documentVersion: version }, member.name),
    mimeType: "application/pdf",
    context: "payroll",
    isPublic: false,          // 급여 문서 — 절대 공개 금지
    expiresInDays: null,      // 법정 보존 (자동 만료 없음)
  });
  if (!up.ok || !up.blobKey) return { ok: false, error: up.error || "문서 저장 실패" };

  try {
    if (isReissue) {
      await db.execute(sql`
        UPDATE payroll_slips SET
          document_version = ${version},
          document_r2_key  = ${up.blobKey},
          document_sha256  = ${digest},
          issued_at        = ${issuedAt.toISOString()}::timestamp,
          signed_document_r2_key = NULL,
          ack_status       = 'PENDING',
          ack_at           = NULL,
          first_viewed_at  = NULL,
          reminder_count   = 0,
          reminder_sent_at = NULL,
          updated_at       = NOW()
        WHERE id = ${slipId}
      `);
    } else {
      await db.execute(sql`
        UPDATE payroll_slips SET
          document_version = ${version},
          document_r2_key  = ${up.blobKey},
          document_sha256  = ${digest},
          issued_at        = COALESCE(issued_at, ${issuedAt.toISOString()}::timestamp),
          updated_at       = NOW()
        WHERE id = ${slipId}
      `);
    }
  } catch (err: any) {
    return { ok: false, error: `문서 기록 실패: ${String(err?.message ?? err).slice(0, 200)}` };
  }

  return { ok: true, r2Key: up.blobKey, sha256: digest, version, bytes };
}

/**
 * 서명본 생성 — 확정 문서와 같은 내용에 서명란을 찍어 별도 보관한다.
 * (원본 문서는 그대로 두고, 서명본을 따로 남겨 '무엇에 서명했는지'가 명확해지도록)
 */
export async function buildSignedPayrollDocument(
  slipId: number,
  signature: PayrollSignatureInput
): Promise<IssueResult> {
  const loaded = await loadSlipWithMember(slipId);
  if (!loaded) return { ok: false, error: "명세서를 찾을 수 없습니다" };
  const { slip, member } = loaded;

  let bytes: Uint8Array;
  try {
    bytes = await generatePayrollSlipPdf({ slip, member, signature });
  } catch (err: any) {
    return { ok: false, error: `서명본 생성 실패: ${String(err?.message ?? err).slice(0, 200)}` };
  }

  const digest = sha256Hex(bytes);
  const up = await uploadToR2({
    buffer: bytes,
    originalName: payrollSlipFilename(slip, member.name, { signed: true }),
    mimeType: "application/pdf",
    context: "payroll",
    isPublic: false,
    expiresInDays: null,
  });
  if (!up.ok || !up.blobKey) return { ok: false, error: up.error || "서명본 저장 실패" };

  return { ok: true, r2Key: up.blobKey, sha256: digest, version: Number(slip.documentVersion || 1), bytes };
}

/**
 * 문서 내려받기 — 고정 보관된 문서를 그대로 준다.
 * 옛 명세서(고정 문서가 없던 시절)는 즉석 생성으로 폴백하되, 그 사실을 호출부가 알 수 있게 반환한다.
 */
export async function fetchPayrollDocument(
  slipId: number,
  opts: { signed?: boolean } = {}
): Promise<{ ok: boolean; bytes?: Uint8Array; filename?: string; fixed?: boolean; error?: string }> {
  const loaded = await loadSlipWithMember(slipId);
  if (!loaded) return { ok: false, error: "명세서를 찾을 수 없습니다" };
  const { slip, member } = loaded;

  const key = opts.signed
    ? (slip.signedDocumentR2Key || null)
    : (slip.documentR2Key || null);

  if (key) {
    const bytes = await downloadFromR2(key);
    if (bytes && bytes.length > 0) {
      return {
        ok: true, bytes, fixed: true,
        filename: payrollSlipFilename(slip, member.name, { signed: !!opts.signed }),
      };
    }
    console.warn(`[payroll-document] 저장된 문서를 읽지 못함 (slip=${slipId}, key=${key}) — 즉석 생성으로 폴백`);
  }

  /* 폴백 — 고정 문서가 없는 옛 명세서 */
  try {
    const bytes = await generatePayrollSlipPdf({ slip, member });
    return {
      ok: true, bytes, fixed: false,
      filename: payrollSlipFilename(slip, member.name),
    };
  } catch (err: any) {
    return { ok: false, error: `문서 생성 실패: ${String(err?.message ?? err).slice(0, 200)}` };
  }
}
