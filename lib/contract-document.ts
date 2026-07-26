// lib/contract-document.ts
// 전자 근로계약 '문서' 파이프라인 — 완료본 고정 보관 · 무결성 해시 · 재발행.
//
// 급여 증빙(lib/payroll-document.ts)과 같은 원칙:
//   계약이 완료(직원 서명)되는 시점에 PDF를 만들어 저장소(R2)에 고정하고 지문(sha256)을 남긴다.
//   이후 양측 다운로드는 이 고정본을 대상으로 한다. 정정이 필요하면 원본을 지우지 않고 다음 차수로 재발행.
//   → 나중에 양식(템플릿)을 고쳐도 이미 서명된 계약서는 변하지 않는다(ON 전자계약이 놓쳤던 지점).
//
// 헬퍼(sha256·서명정화)는 payroll-document를 import하지 않고 복제한다
// (그 모듈은 급여 PDF 생성까지 끌고 와 콜드스타트가 무겁다).

import { createHash } from "node:crypto";
// @ts-ignore — sharp는 runtime 의존성 (Netlify 빌드 시 자동 설치 + external_node_modules)
import sharp from "sharp";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { uploadToR2, downloadFromR2 } from "./r2-server";
import { generateContractPdf, contractFilename, ContractPdfInput } from "./contract-pdf";
import { decryptPII } from "./crypto-pii";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/** 서명 이미지 정화 — PDF에 넣기 전 반드시 통과(깨진 PNG는 pdf-lib를 멈추게 함). payroll과 동일 로직. */
export async function normalizeSignaturePng(
  bytes: Uint8Array
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  try {
    const src = sharp(Buffer.from(bytes)).ensureAlpha();
    try {
      const st: any = await src.clone().stats();
      const alpha = st?.channels?.[3];
      if (alpha && Number(alpha.max) === 0) {
        return { ok: false, error: "서명이 비어 있습니다. 서명란에 직접 서명해 주세요" };
      }
    } catch { /* 통계 실패는 무시 — 아래 재인코딩이 본 방어선 */ }
    const render = (s: any) =>
      s.resize({ width: 900, height: 300, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
    let out: Buffer;
    try { out = await render(src.clone().trim({ threshold: 8 })); }
    catch { out = await render(src.clone()); }
    if (!out || out.length === 0) return { ok: false, error: "서명 이미지를 처리하지 못했습니다" };
    return { ok: true, bytes: new Uint8Array(out) };
  } catch (err: any) {
    return { ok: false, error: `서명 이미지를 읽지 못했습니다: ${String(err?.message ?? err).slice(0, 120)}` };
  }
}

/** 계약 1건 + 사업자 + 직원 정보 (raw row) */
export async function loadContractRow(contractId: number): Promise<any | null> {
  const r: any = await db.execute(sql`
    SELECT c.*,
           e.name AS ent_name, e.representative AS ent_rep, e.biz_no AS ent_bizno,
           e.address AS ent_address, e.entity_type AS ent_type, e.seal_r2_key AS ent_seal_key,
           m.name AS m_name, m.email AS m_email
      FROM employment_contracts c
      JOIN contract_business_entities e ON e.id = c.entity_id
      LEFT JOIN members m ON m.id = c.member_id
     WHERE c.id = ${contractId}
     LIMIT 1
  `);
  return ((r as any).rows ?? r ?? [])[0] || null;
}

/** raw row → generateContractPdf 입력 (도장·서명 이미지 R2 로드 + 주민번호 복호화). */
export async function buildContractPdfInput(
  row: any,
  opts: { includeResident?: boolean; draftWatermark?: boolean } = {}
): Promise<ContractPdfInput> {
  let seal: Uint8Array | null = null;
  const sealKey = row.company_seal_r2_key || row.ent_seal_key;  // 발송 시 스냅샷 우선, 없으면 사업자 현재 도장
  if (sealKey) { try { seal = await downloadFromR2(sealKey); } catch { /* 도장 없어도 (인) 폴백 */ } }

  let empSig: Uint8Array | null = null;
  if (row.employee_sig_r2_key) { try { empSig = await downloadFromR2(row.employee_sig_r2_key); } catch { /* 무시 */ } }

  let residentNo: string | null = null;
  if (opts.includeResident && row.resident_no_enc) residentNo = decryptPII(row.resident_no_enc);

  let fields: Record<string, any> = {};
  try { fields = typeof row.fields === "string" ? JSON.parse(row.fields) : (row.fields || {}); } catch { fields = {}; }

  return {
    contract: {
      id: row.id,
      title: row.title || "근로계약서",
      bodySnapshot: row.body_snapshot || "",
      documentVersion: Number(row.document_version || 1),
      status: row.status,
      entityName: row.ent_name || "",
      entityRepresentative: row.ent_rep || null,
      entityBizNo: row.ent_bizno || null,
      entityAddress: row.ent_address || null,
      memberName: row.m_name || `직원#${row.member_id}`,
      fields,
      residentNo,
      companySignedAt: row.company_signed_at || null,
      employeeSignedName: row.employee_signed_name || null,
      employeeSignedAt: row.employee_signed_at || null,
      employeeSignIp: row.employee_sign_ip || null,
      employeeSignDevice: row.employee_sign_device || null,
    },
    seal,
    employeeSignature: empSig,
    draftWatermark: opts.draftWatermark,
  };
}

export interface ContractIssueResult {
  ok: boolean;
  r2Key?: string;
  sha256?: string;
  version?: number;
  bytes?: Uint8Array;
  error?: string;
}

/**
 * 완료본 확정 — 직원 서명 완료 시 PDF를 만들어 R2에 고정하고 계약에 지문을 기록한다.
 * 멱등: 이미 고정본이 있고 재발행 지시가 아니면 그대로 사용.
 * bumpVersion: 정정 재발행(차수 ↑, 이전 서명 증적은 events에 보존).
 */
export async function issueContractDocument(
  contractId: number,
  opts: { bumpVersion?: boolean } = {}
): Promise<ContractIssueResult> {
  const row = await loadContractRow(contractId);
  if (!row) return { ok: false, error: "계약을 찾을 수 없습니다" };

  if (!opts.bumpVersion && row.document_r2_key && row.document_sha256) {
    return { ok: true, r2Key: row.document_r2_key, sha256: row.document_sha256, version: Number(row.document_version || 1) };
  }

  const version = opts.bumpVersion ? Number(row.document_version || 1) + 1 : Number(row.document_version || 1);
  const input = await buildContractPdfInput({ ...row, document_version: version }, { includeResident: true });

  let bytes: Uint8Array;
  try { bytes = await generateContractPdf(input); }
  catch (err: any) { return { ok: false, error: `문서 생성 실패: ${String(err?.message ?? err).slice(0, 200)}` }; }

  const digest = sha256Hex(bytes);
  const up = await uploadToR2({
    buffer: bytes,
    originalName: contractFilename({ id: row.id, documentVersion: version }, row.m_name || "직원"),
    mimeType: "application/pdf",
    context: "contract",
    isPublic: false,        // 근로계약 문서 — 절대 공개 금지
    expiresInDays: null,    // 보존 (자동 만료 없음)
  });
  if (!up.ok || !up.blobKey) return { ok: false, error: up.error || "문서 저장 실패" };

  await db.execute(sql`
    UPDATE employment_contracts
       SET document_r2_key = ${up.blobKey},
           document_sha256 = ${digest},
           document_version = ${version},
           updated_at = NOW()
     WHERE id = ${contractId}
  `);

  return { ok: true, r2Key: up.blobKey, sha256: digest, version, bytes };
}

/**
 * 다운로드용 바이트 — 완료 고정본이 있으면 그대로, 없으면(미완료·미리보기) 즉석 생성.
 * draft=true면 항상 즉석 생성 + 워터마크(작성/발송 단계 미리보기).
 */
export async function fetchContractDocument(
  contractId: number,
  opts: { draft?: boolean } = {}
): Promise<{ ok: boolean; bytes?: Uint8Array; filename?: string; error?: string }> {
  const row = await loadContractRow(contractId);
  if (!row) return { ok: false, error: "계약을 찾을 수 없습니다" };

  const filename = contractFilename({ id: row.id, documentVersion: Number(row.document_version || 1) }, row.m_name || "직원");

  if (!opts.draft && row.document_r2_key) {
    try {
      const b = await downloadFromR2(row.document_r2_key);
      if (b && b.length) return { ok: true, bytes: b, filename };
    } catch { /* 유실 시 즉석 생성 폴백 */ }
  }

  const isDraft = !!opts.draft || row.status !== "completed";
  const input = await buildContractPdfInput(row, { includeResident: true, draftWatermark: isDraft });
  try {
    const bytes = await generateContractPdf(input);
    return { ok: true, bytes, filename };
  } catch (err: any) {
    return { ok: false, error: `문서 생성 실패: ${String(err?.message ?? err).slice(0, 200)}` };
  }
}

/** {{치환}} 채우기 — 사업자·근로자·조건 필드로 양식 본문을 실제 계약 본문으로. 미매칭 키는 그대로 둔다(안전). */
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return String(body || "").replace(/\{\{(\s*[^}]+?\s*)\}\}/g, (m, key) => {
    const k = String(key).trim();
    return (vars[k] !== undefined && vars[k] !== null && vars[k] !== "") ? String(vars[k]) : m;
  });
}
