/**
 * POST /api/admin/donation-import
 *
 * Phase 3 (DESIGN_PHASE3.md §6.2) — 효성 contracts·billings 흡수 통합 엔드포인트
 *
 * Body: { source, fileName, fileBase64 }
 *   source    : 'hyosung_contracts' | 'hyosung_billings' | 'ibk'
 *   fileName  : 원본 파일명 (로그용)
 *   fileBase64: CSV 텍스트를 Base64 인코딩 (A 채팅이 SheetJS로 xlsx→csv 변환 후 전송)
 *
 * 응답:
 *   HyosungContractsImportResult | HyosungBillingsImportResult
 *
 * SOT 원칙 (DESIGN §10.2): SIREN → 효성 푸시 절대 금지 (일방향 흡수만)
 */

import type { Context } from "@netlify/functions";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../../db";
import {
  members,
  hyosungContracts,
  hyosungBillings,
  donations,
  hyosungImportLogs,
  signupSources,
} from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, serverError, methodNotAllowed, corsPreflight,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import {
  parseContractsCsv,
  parseBillingsCsv,
  detectCsvType,
  type HyosungContractRow,
  type HyosungBillingRow,
} from "../../lib/hyosung-parser";
import {
  mapContractRowToInsert,
  mapBillingRowToInsert,
} from "../../lib/hyosung-mapper";
import {
  buildContractMergeUpdate,
  buildNewMemberFromContract,
  evaluateDonorTypeFromContract,
  patchDonorChannels,
  SIREN_PRESERVED_COLUMNS,
} from "../../lib/hyosung-merge";
import { safeReevaluate } from "../../lib/donor-status";

/* =========================================================
   API 계약 (DESIGN_PHASE3.md §6.2)
   ========================================================= */

export interface AdminDonationImportRequest {
  source: "hyosung_contracts" | "hyosung_billings" | "ibk";
  fileName: string;
  fileBase64: string;
}

export interface HyosungContractsImportResult {
  ok: true;
  source: "hyosung_contracts";
  totalRows: number;
  matched: number;
  created: number;
  updatedContracts: number;
  preservedColumns: string[];
  donorTypeChanged: number;
  errors: { rowIndex: number; reason: string }[];
}

export interface HyosungBillingsImportResult {
  ok: true;
  source: "hyosung_billings";
  totalRows: number;
  matched: number;
  unmatched: number;
  donationsCreated: number;
  billingsUpserted: number;
  errors: { rowIndex: number; reason: string }[];
}

/* =========================================================
   에러 응답 (CLAUDE.md §6.2)
   ========================================================= */

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "가져오기 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

/* =========================================================
   메인 핸들러
   ========================================================= */

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 1. 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const { admin, member: adminMember } = auth.ctx;

  /* 2. 요청 파싱 */
  let body: AdminDonationImportRequest;
  try {
    body = await req.json();
  } catch {
    return badRequest("요청 본문을 파싱할 수 없습니다 (JSON 형식 필요)");
  }

  const { source, fileName, fileBase64 } = body || {};
  if (!source || !fileBase64) {
    return badRequest("source와 fileBase64는 필수입니다");
  }
  if (!["hyosung_contracts", "hyosung_billings", "ibk"].includes(source)) {
    return badRequest("source는 hyosung_contracts | hyosung_billings | ibk 중 하나여야 합니다");
  }

  /* 3. Base64 → CSV 텍스트 */
  let csvText: string;
  try {
    const decoded = Buffer.from(fileBase64, "base64").toString("utf-8");
    // BOM 제거
    csvText = decoded.charCodeAt(0) === 0xFEFF ? decoded.slice(1) : decoded;
  } catch (err) {
    return jsonError("decode_base64", err);
  }

  if (!csvText || csvText.trim().length < 5) {
    return badRequest("파일 내용이 비어있거나 너무 짧습니다");
  }

  /* 4. 소스별 분기 */
  if (source === "hyosung_contracts") {
    return handleContractsImport(req, csvText, fileName || "contracts.csv", admin, adminMember);
  }
  if (source === "hyosung_billings") {
    return handleBillingsImport(req, csvText, fileName || "billings.csv", admin, adminMember);
  }

  return badRequest("ibk 소스는 기존 /api/admin-donation-import 엔드포인트를 사용하세요");
};

export const config = { path: "/api/admin/donation-import" };

/* =========================================================
   D1: 효성 contracts 처리
   §5.2 계약정보 22컬럼 → hyosungContracts UPSERT + members 매칭/신규 생성
   §5.4 merge 정책: SIREN 고유 컬럼 절대 보존
   ========================================================= */

async function handleContractsImport(
  req: Request,
  csvText: string,
  fileName: string,
  admin: any,
  adminMember: any,
): Promise<Response> {
  /* 파싱 */
  let parseResult: ReturnType<typeof parseContractsCsv>;
  try {
    parseResult = parseContractsCsv(csvText);
  } catch (err) {
    return jsonError("parse_contracts_csv", err);
  }

  if (parseResult.rows.length === 0) {
    return badRequest("계약정보 CSV 파싱 결과가 없습니다", {
      parseErrors: parseResult.errors.slice(0, 10),
    });
  }

  /* signup_sources 'hyosung_csv' ID 조회 (신규 회원 자동 생성 시 사용) */
  let hyosungSourceId: number | null = null;
  try {
    const ss: any = await db.execute(sql`
      SELECT id FROM signup_sources WHERE code = 'hyosung_csv' LIMIT 1
    `);
    const ssRow = (Array.isArray(ss) ? ss[0] : (ss as any).rows?.[0]);
    if (ssRow?.id) {
      hyosungSourceId = Number(ssRow.id);
    } else {
      /* 없으면 자동 등록 */
      const inserted: any = await db.execute(sql`
        INSERT INTO signup_sources (code, label, created_at)
        VALUES ('hyosung_csv', '효성', NOW())
        ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label
        RETURNING id
      `);
      const insertedRow = (Array.isArray(inserted) ? inserted[0] : (inserted as any).rows?.[0]);
      hyosungSourceId = insertedRow?.id ? Number(insertedRow.id) : null;
    }
  } catch (err) {
    console.warn("[donation-import-v3] signup_sources 조회 실패 — null fallback", err);
  }

  /* 기존 회원 매핑 테이블 구성: hyosungMemberNo → member.id */
  const memberNoToId = new Map<number, number>();
  const memberPhoneToId = new Map<string, number>();
  try {
    const mRows: any = await db.execute(sql`
      SELECT id, hyosung_member_no, phone FROM members
      WHERE hyosung_member_no IS NOT NULL
         OR phone IS NOT NULL
    `);
    const rows = Array.isArray(mRows) ? mRows : (mRows as any).rows || [];
    for (const r of rows) {
      if (r.hyosung_member_no) memberNoToId.set(Number(r.hyosung_member_no), Number(r.id));
      if (r.phone) memberPhoneToId.set(String(r.phone).replace(/[^\d]/g, ""), Number(r.id));
    }
  } catch (err) {
    return jsonError("select_members_map", err);
  }

  /* row별 처리 */
  let matched = 0;
  let created = 0;
  let updatedContracts = 0;
  let donorTypeChanged = 0;
  const importErrors: { rowIndex: number; reason: string }[] = [];
  const memberIdsToReevaluate: number[] = [];

  for (let i = 0; i < parseResult.rows.length; i++) {
    const row: HyosungContractRow = parseResult.rows[i];
    const rowIndex = i + 2; // 1-based + 헤더 row

    try {
      /* 1. 회원 매칭 (회원번호 우선, 전화번호 보조) */
      let linkedMemberId: number | null = memberNoToId.get(row.memberNo) ?? null;
      if (!linkedMemberId && row.phone) {
        const normalizedPhone = row.phone.replace(/[^\d]/g, "");
        linkedMemberId = memberPhoneToId.get(normalizedPhone) ?? null;
      }

      /* 2. hyosungContracts UPSERT (ON CONFLICT memberNo) */
      const contractPayload = mapContractRowToInsert(row, linkedMemberId);
      try {
        await db.execute(sql`
          INSERT INTO hyosung_contracts (
            member_no, member_name, phone, member_status, contract_status,
            promise_day, payment_method, payment_tool, payment_info, account_holder,
            registration_status, agreement_status, electronic_contract,
            product_name, product_amount, billing_start, billing_end,
            manager_name, member_type, billing_auto, send_method,
            linked_member_id, raw_data, updated_at
          ) VALUES (
            ${contractPayload.memberNo}, ${contractPayload.memberName}, ${contractPayload.phone},
            ${contractPayload.memberStatus}, ${contractPayload.contractStatus},
            ${contractPayload.promiseDay}, ${contractPayload.paymentMethod}, ${contractPayload.paymentTool},
            ${contractPayload.paymentInfo}, ${contractPayload.accountHolder},
            ${contractPayload.registrationStatus}, ${contractPayload.agreementStatus}, ${contractPayload.electronicContract},
            ${contractPayload.productName}, ${contractPayload.productAmount},
            ${contractPayload.billingStart ? contractPayload.billingStart.toISOString() : null}::timestamptz,
            ${contractPayload.billingEnd ? contractPayload.billingEnd.toISOString() : null}::timestamptz,
            ${contractPayload.managerName}, ${contractPayload.memberType}, ${contractPayload.billingAuto},
            ${contractPayload.sendMethod}, ${contractPayload.linkedMemberId},
            ${JSON.stringify(contractPayload.rawData)}::jsonb, NOW()
          )
          ON CONFLICT (member_no) DO UPDATE SET
            member_name = EXCLUDED.member_name,
            phone = EXCLUDED.phone,
            member_status = EXCLUDED.member_status,
            contract_status = EXCLUDED.contract_status,
            promise_day = EXCLUDED.promise_day,
            payment_method = EXCLUDED.payment_method,
            payment_tool = EXCLUDED.payment_tool,
            payment_info = EXCLUDED.payment_info,
            account_holder = EXCLUDED.account_holder,
            registration_status = EXCLUDED.registration_status,
            agreement_status = EXCLUDED.agreement_status,
            electronic_contract = EXCLUDED.electronic_contract,
            product_name = EXCLUDED.product_name,
            product_amount = EXCLUDED.product_amount,
            billing_start = EXCLUDED.billing_start,
            billing_end = EXCLUDED.billing_end,
            manager_name = EXCLUDED.manager_name,
            member_type = EXCLUDED.member_type,
            billing_auto = EXCLUDED.billing_auto,
            send_method = EXCLUDED.send_method,
            linked_member_id = COALESCE(EXCLUDED.linked_member_id, hyosung_contracts.linked_member_id),
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()
        `);
        updatedContracts++;
      } catch (contractErr: any) {
        importErrors.push({ rowIndex, reason: `hyosungContracts UPSERT 실패: ${String(contractErr?.message || contractErr).slice(0, 200)}` });
        continue;
      }

      /* 3. members 처리 */
      const typeEval = evaluateDonorTypeFromContract(row.contractStatus);

      if (linkedMemberId) {
        /* 3-a. 기존 회원 UPDATE — §5.4 화이트리스트 보존 */
        const mergeUpdate = buildContractMergeUpdate(row);
        try {
          /* donor_channels 현재값 조회 */
          const chRes: any = await db.execute(sql`
            SELECT donor_channels, donor_type FROM members WHERE id = ${linkedMemberId} LIMIT 1
          `);
          const chRow = (Array.isArray(chRes) ? chRes[0] : (chRes as any).rows?.[0]) || {};
          const existingChannels: string[] = (() => {
            try {
              const raw = chRow.donor_channels;
              if (Array.isArray(raw)) return raw;
              if (typeof raw === "string") return JSON.parse(raw);
              return [];
            } catch {
              return [];
            }
          })();
          const prevDonorType = chRow.donor_type || "none";
          const newChannels = patchDonorChannels(existingChannels, typeEval.channelAction);

          await db.execute(sql`
            UPDATE members SET
              hyosung_member_no = ${mergeUpdate.hyosungMemberNo},
              hyosung_contract_status = ${mergeUpdate.hyosungContractStatus},
              hyosung_payment_method = ${mergeUpdate.hyosungPaymentMethod},
              hyosung_payment_tool = ${mergeUpdate.hyosungPaymentTool},
              hyosung_bank_info = ${mergeUpdate.hyosungBankInfo},
              hyosung_promise_day = ${mergeUpdate.hyosungPromiseDay},
              hyosung_synced_at = NOW(),
              ${row.memberName ? sql`name = ${row.memberName},` : sql``}
              ${row.phone ? sql`phone = ${row.phone},` : sql``}
              donor_channels = ${JSON.stringify(newChannels)}::jsonb,
              donor_evaluated_at = NOW(),
              updated_at = NOW()
            WHERE id = ${linkedMemberId}
          `);

          if (prevDonorType !== typeEval.donorType) donorTypeChanged++;
          memberIdsToReevaluate.push(linkedMemberId);
          matched++;

          /* hyosung_contracts.linked_member_id 갱신 (이전에 없었던 경우) */
          await db.execute(sql`
            UPDATE hyosung_contracts SET linked_member_id = ${linkedMemberId}, updated_at = NOW()
            WHERE member_no = ${row.memberNo} AND (linked_member_id IS NULL OR linked_member_id != ${linkedMemberId})
          `);
        } catch (updateErr: any) {
          importErrors.push({ rowIndex, reason: `members UPDATE 실패: ${String(updateErr?.message || updateErr).slice(0, 200)}` });
        }
      } else {
        /* 3-b. 신규 회원 자동 생성 (§5.3) */
        try {
          const newMemberPayload = buildNewMemberFromContract(row, hyosungSourceId);
          const inserted: any = await db.execute(sql`
            INSERT INTO members (
              name, phone, signup_source_id,
              hyosung_member_no, hyosung_contract_status,
              hyosung_payment_method, hyosung_payment_tool,
              hyosung_bank_info, hyosung_promise_day, hyosung_synced_at,
              donor_type, donor_channels, prospect_subtype, donor_evaluated_at,
              status, type, email_verified,
              created_at, updated_at
            ) VALUES (
              ${newMemberPayload.name}, ${newMemberPayload.phone}, ${newMemberPayload.signupSourceId},
              ${newMemberPayload.hyosungMemberNo}, ${newMemberPayload.hyosungContractStatus},
              ${newMemberPayload.hyosungPaymentMethod}, ${newMemberPayload.hyosungPaymentTool},
              ${newMemberPayload.hyosungBankInfo}, ${newMemberPayload.hyosungPromiseDay}, NOW(),
              ${newMemberPayload.donorType}, ${JSON.stringify(newMemberPayload.donorChannels)}::jsonb,
              ${newMemberPayload.prospectSubtype}, NOW(),
              'active', 'regular', false,
              NOW(), NOW()
            )
            RETURNING id
          `);
          const insertedRow = (Array.isArray(inserted) ? inserted[0] : (inserted as any).rows?.[0]);
          const newMemberId = insertedRow?.id ? Number(insertedRow.id) : null;

          if (newMemberId) {
            /* hyosung_contracts.linked_member_id 갱신 */
            await db.execute(sql`
              UPDATE hyosung_contracts SET linked_member_id = ${newMemberId}, updated_at = NOW()
              WHERE member_no = ${row.memberNo}
            `);
            /* 다음 처리에서 매핑 활용 */
            memberNoToId.set(row.memberNo, newMemberId);
            if (row.phone) memberPhoneToId.set(row.phone.replace(/[^\d]/g, ""), newMemberId);
            created++;
          }
        } catch (insertErr: any) {
          importErrors.push({ rowIndex, reason: `신규 회원 생성 실패: ${String(insertErr?.message || insertErr).slice(0, 200)}` });
        }
      }
    } catch (rowErr: any) {
      importErrors.push({ rowIndex, reason: String(rowErr?.message || rowErr).slice(0, 300) });
    }
  }

  /* donor_type 재평가 (fire-and-forget, 후크 적용) */
  for (const mid of memberIdsToReevaluate) {
    await safeReevaluate(mid, "contracts-import").catch(() => {});
  }

  /* import 로그 */
  try {
    await db.insert(hyosungImportLogs).values({
      uploadedBy: adminMember.id ?? null,
      uploadedByName: adminMember.name ?? null,
      fileName: fileName.slice(0, 255),
      fileSize: csvText.length,
      totalRows: parseResult.totalCount,
      matchedCount: matched,
      createdCount: created,
      updatedCount: updatedContracts,
      skippedCount: 0,
      failedCount: importErrors.length,
      detail: JSON.stringify({ type: "contracts", parseErrors: parseResult.errors.slice(0, 5) }).slice(0, 5000),
    });
  } catch { /* 로그 실패는 본 흐름에 영향 없음 */ }

  /* 감사 로그 */
  try {
    await logAdminAction(req as any, admin.uid, admin.name, "hyosung_contracts_import", {
      target: fileName,
      detail: { totalRows: parseResult.totalCount, matched, created, updatedContracts, donorTypeChanged, errors: importErrors.length },
    });
  } catch { /* 감사 실패 무시 */ }

  const result: HyosungContractsImportResult = {
    ok: true,
    source: "hyosung_contracts",
    totalRows: parseResult.totalCount,
    matched,
    created,
    updatedContracts,
    preservedColumns: [...SIREN_PRESERVED_COLUMNS],
    donorTypeChanged,
    errors: importErrors.slice(0, 50),
  };

  return ok(result, `효성 계약정보 ${parseResult.totalCount}건 처리 완료 (매칭 ${matched}건, 신규 ${created}건)`);
}

/* =========================================================
   D2: 효성 billings 처리
   §5.2 수납내역 28컬럼 → hyosungBillings UPSERT + donations INSERT(완납)
   ========================================================= */

async function handleBillingsImport(
  req: Request,
  csvText: string,
  fileName: string,
  admin: any,
  adminMember: any,
): Promise<Response> {
  /* 파싱 */
  let parseResult: ReturnType<typeof parseBillingsCsv>;
  try {
    parseResult = parseBillingsCsv(csvText);
  } catch (err) {
    return jsonError("parse_billings_csv", err);
  }

  if (parseResult.rows.length === 0) {
    return badRequest("수납내역 CSV 파싱 결과가 없습니다", {
      parseErrors: parseResult.errors.slice(0, 10),
    });
  }

  /* 회원번호 → members.id 매핑 (hyosung_contracts 경유) */
  const memberNoToId = new Map<number, number>();
  try {
    const rs: any = await db.execute(sql`
      SELECT hc.member_no, hc.linked_member_id
      FROM hyosung_contracts hc
      WHERE hc.linked_member_id IS NOT NULL
    `);
    const rows = Array.isArray(rs) ? rs : (rs as any).rows || [];
    for (const r of rows) {
      if (r.member_no && r.linked_member_id) {
        memberNoToId.set(Number(r.member_no), Number(r.linked_member_id));
      }
    }
  } catch (err) {
    return jsonError("select_member_no_map", err);
  }

  let billingsUpserted = 0;
  let donationsCreated = 0;
  let matched = 0;
  let unmatched = 0;
  const importErrors: { rowIndex: number; reason: string }[] = [];

  for (let i = 0; i < parseResult.rows.length; i++) {
    const row: HyosungBillingRow = parseResult.rows[i];
    const rowIndex = i + 2;

    try {
      const linkedMemberId = memberNoToId.get(row.memberNo) ?? null;
      if (linkedMemberId) {
        matched++;
      } else {
        unmatched++;
      }

      /* 1. hyosungBillings UPSERT (memberNo + billingMonth + productName) */
      const billingPayload = mapBillingRowToInsert(row, linkedMemberId, null);

      const existingBilling: any = await db.execute(sql`
        SELECT id, linked_donation_id FROM hyosung_billings
        WHERE member_no = ${row.memberNo}
          AND billing_month = ${row.billingMonth}
          AND (${row.productName ? sql`product_name = ${row.productName}` : sql`product_name IS NULL`})
        LIMIT 1
      `);
      const existingRow = (Array.isArray(existingBilling) ? existingBilling[0] : (existingBilling as any).rows?.[0]);

      let billingRowId: number;

      if (existingRow) {
        await db.execute(sql`
          UPDATE hyosung_billings SET
            member_name = ${billingPayload.memberName},
            phone = ${billingPayload.phone},
            contract_no = ${billingPayload.contractNo},
            first_billing_month = ${billingPayload.firstBillingMonth},
            billing_amount = ${billingPayload.billingAmount},
            supply_amount = ${billingPayload.supplyAmount},
            vat_amount = ${billingPayload.vatAmount},
            received_amount = ${billingPayload.receivedAmount},
            unpaid_amount = ${billingPayload.unpaidAmount},
            cancel_amount = ${billingPayload.cancelAmount},
            refund_amount = ${billingPayload.refundAmount},
            receipt_status = ${billingPayload.receiptStatus},
            payment_status = ${billingPayload.paymentStatus},
            payment_method = ${billingPayload.paymentMethod},
            payment_tool = ${billingPayload.paymentTool},
            promise_day = ${billingPayload.promiseDay},
            payment_date = ${billingPayload.paymentDate ? billingPayload.paymentDate.toISOString() : null}::timestamptz,
            billing_type = ${billingPayload.billingType},
            unreceived_handling = ${billingPayload.unreceivedHandling},
            billing_completion_date = ${billingPayload.billingCompletionDate ? billingPayload.billingCompletionDate.toISOString() : null}::timestamptz,
            memo = ${billingPayload.memo},
            payment_result = ${billingPayload.paymentResult},
            raw_data = ${JSON.stringify(billingPayload.rawData)}::jsonb,
            updated_at = NOW()
          WHERE id = ${existingRow.id}
        `);
        billingRowId = Number(existingRow.id);
        billingsUpserted++;
      } else {
        const ins: any = await db.execute(sql`
          INSERT INTO hyosung_billings (
            member_no, contract_no, member_name, billing_month, first_billing_month,
            phone, product_name, billing_amount, supply_amount, vat_amount,
            received_amount, unpaid_amount, cancel_amount, refund_amount,
            receipt_status, payment_status, payment_method, payment_tool,
            promise_day, payment_date, billing_type, unreceived_handling,
            billing_completion_date, memo, payment_result, linked_donation_id,
            raw_data, created_at, updated_at
          ) VALUES (
            ${row.memberNo}, ${billingPayload.contractNo}, ${billingPayload.memberName},
            ${row.billingMonth}, ${billingPayload.firstBillingMonth},
            ${billingPayload.phone}, ${billingPayload.productName || null},
            ${billingPayload.billingAmount}, ${billingPayload.supplyAmount}, ${billingPayload.vatAmount},
            ${billingPayload.receivedAmount}, ${billingPayload.unpaidAmount},
            ${billingPayload.cancelAmount}, ${billingPayload.refundAmount},
            ${billingPayload.receiptStatus}, ${billingPayload.paymentStatus},
            ${billingPayload.paymentMethod}, ${billingPayload.paymentTool},
            ${billingPayload.promiseDay},
            ${billingPayload.paymentDate ? billingPayload.paymentDate.toISOString() : null}::timestamptz,
            ${billingPayload.billingType}, ${billingPayload.unreceivedHandling},
            ${billingPayload.billingCompletionDate ? billingPayload.billingCompletionDate.toISOString() : null}::timestamptz,
            ${billingPayload.memo}, ${billingPayload.paymentResult}, NULL,
            ${JSON.stringify(billingPayload.rawData)}::jsonb, NOW(), NOW()
          )
          RETURNING id
        `);
        const insRow = (Array.isArray(ins) ? ins[0] : (ins as any).rows?.[0]);
        billingRowId = insRow?.id ? Number(insRow.id) : 0;
        billingsUpserted++;
      }

      /* 2. 완납 → donations INSERT (linkedMemberId 있는 건만) */
      if (!linkedMemberId) continue;
      if (row.receiptStatus !== "완납") continue;

      const donationAmount = (row.receivedAmount > 0 ? row.receivedAmount : row.billingAmount) || 0;
      if (donationAmount <= 0) continue;

      /* 중복 체크 (같은 member + billingMonth) */
      const existingDonation: any = await db.execute(sql`
        SELECT id FROM donations
        WHERE member_id = ${linkedMemberId}
          AND hyosung_member_no = ${row.memberNo}
          AND hyosung_billing_month = ${row.billingMonth}
        LIMIT 1
      `);
      const existingDonationRow = (Array.isArray(existingDonation) ? existingDonation[0] : (existingDonation as any).rows?.[0]);
      if (existingDonationRow) {
        /* 이미 있으면 linkedDonationId만 보장 */
        if (billingRowId && !existingRow?.linked_donation_id) {
          await db.execute(sql`
            UPDATE hyosung_billings SET linked_donation_id = ${existingDonationRow.id}, updated_at = NOW()
            WHERE id = ${billingRowId}
          `);
        }
        continue;
      }

      /* donations INSERT */
      const donType = row.productName === "일시후원" ? "onetime" : "regular";
      const payMethod = row.paymentTool === "카드" ? "toss_card" : "hyosung";

      const insDonation: any = await db.execute(sql`
        INSERT INTO donations (
          member_id, donor_name, donor_phone, amount, type,
          pay_method, pg_provider, status,
          hyosung_member_no, hyosung_billing_month, hyosung_receipt_status, hyosung_paid_date,
          campaign_tag, created_at, updated_at
        ) VALUES (
          ${linkedMemberId}, ${row.memberName || "효성후원자"}, ${row.phone},
          ${donationAmount}, ${donType},
          ${payMethod}, 'hyosung', 'completed',
          ${row.memberNo}, ${row.billingMonth}, ${row.receiptStatus},
          ${row.paymentDate ? new Date(row.paymentDate).toISOString() : null}::timestamptz,
          ${row.productName || null}, NOW(), NOW()
        )
        RETURNING id
      `);
      const insDonRow = (Array.isArray(insDonation) ? insDonation[0] : (insDonation as any).rows?.[0]);
      const donationId = insDonRow?.id ? Number(insDonRow.id) : null;

      if (donationId) {
        donationsCreated++;
        /* hyosungBillings.linked_donation_id 역참조 */
        if (billingRowId) {
          await db.execute(sql`
            UPDATE hyosung_billings SET linked_donation_id = ${donationId}, updated_at = NOW()
            WHERE id = ${billingRowId}
          `);
        }
        /* hyosung_billing_id → donations 역참조 */
        await db.execute(sql`
          UPDATE donations SET hyosung_billing_id = ${billingRowId}, updated_at = NOW()
          WHERE id = ${donationId}
        `).catch(() => {});
      }
    } catch (rowErr: any) {
      importErrors.push({ rowIndex, reason: String(rowErr?.message || rowErr).slice(0, 300) });
    }
  }

  /* donor_type 즉시 재평가 — billings import 후 donations가 생성됐으므로 cron 기다리지 않고 즉시 갱신 */
  const memberIdsToReevaluate = [...new Set(
    parseResult.rows
      .map((row: any) => memberNoToId.get(row.memberNo) ?? null)
      .filter((id: any): id is number => typeof id === "number" && id > 0)
  )];
  for (const mid of memberIdsToReevaluate) {
    await safeReevaluate(mid, "billings-import").catch(() => {});
  }

  /* import 로그 */
  try {
    await db.insert(hyosungImportLogs).values({
      uploadedBy: adminMember.id ?? null,
      uploadedByName: adminMember.name ?? null,
      fileName: fileName.slice(0, 255),
      fileSize: csvText.length,
      totalRows: parseResult.totalCount,
      matchedCount: matched,
      createdCount: donationsCreated,
      updatedCount: billingsUpserted,
      skippedCount: unmatched,
      failedCount: importErrors.length,
      detail: JSON.stringify({ type: "billings", parseErrors: parseResult.errors.slice(0, 5) }).slice(0, 5000),
    });
  } catch { /* 로그 실패 무시 */ }

  /* 감사 로그 */
  try {
    await logAdminAction(req as any, admin.uid, admin.name, "hyosung_billings_import", {
      target: fileName,
      detail: { totalRows: parseResult.totalCount, matched, unmatched, billingsUpserted, donationsCreated, errors: importErrors.length },
    });
  } catch { /* 감사 실패 무시 */ }

  const result: HyosungBillingsImportResult = {
    ok: true,
    source: "hyosung_billings",
    totalRows: parseResult.totalCount,
    matched,
    unmatched,
    donationsCreated,
    billingsUpserted,
    errors: importErrors.slice(0, 50),
  };

  return ok(result, `효성 수납내역 ${parseResult.totalCount}건 처리 완료 (수납 ${billingsUpserted}건, 후원 ${donationsCreated}건 생성)`);
}
