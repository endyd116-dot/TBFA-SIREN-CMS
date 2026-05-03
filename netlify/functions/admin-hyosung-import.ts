/**
 * POST /api/admin/hyosung-import
 *
 * 효성 CMS+ billing_update.csv 업로드 → 수납 결과 반영
 *
 * ★ M-13 추가:
 * - createMembers 폼 필드 (true/false) — 매칭 실패 행에 대해 회원 자동 생성
 * - 응답에 createdMembers 카운트 추가
 *
 * billing_update.csv 컬럼 (10개):
 *   회원번호 / 계약번호 / 회원명 / 청구월 / 약정일 /
 *   결제일 / 상품 / 기본금액 / 수량 / 청구번호
 */
import { eq, and, sql } from "drizzle-orm";
import { db, donations, members, hyosungImportLogs } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  upgradeToSponsor, getSignupSourceId, createHyosungMember,
} from "../../lib/member-classifier";
import {
  ok, badRequest, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* 1. multipart 파싱 */
    const formData = await req.formData().catch(() => null);
    if (!formData) return badRequest("파일이 없습니다");

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return badRequest("유효한 CSV 파일이 아닙니다");
    }

    if (file.size > MAX_FILE_SIZE) {
      return badRequest("파일 크기는 5MB 이하여야 합니다");
    }

    /* ★ M-13: createMembers 옵션 (매칭 실패 시 자동 회원 생성) */
    const createMembersFlag = String(formData.get("createMembers") || "").trim() === "true";

    /* 2. 파일 읽기 (인코딩 자동 감지) */
    const rawBuffer = await file.arrayBuffer();
    let csvText = "";

    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      csvText = decoder.decode(rawBuffer);
    } catch (e) {
      try {
        const decoder = new TextDecoder("euc-kr");
        csvText = decoder.decode(rawBuffer);
      } catch (e2) {
        csvText = new TextDecoder("utf-8").decode(rawBuffer);
      }
    }

    if (!csvText || csvText.trim().length < 10) {
      return badRequest("CSV 파일이 비어있거나 읽을 수 없습니다");
    }

    /* 3. CSV 파싱 */
    const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);

    if (lines.length < 2) {
      return badRequest("CSV에 데이터 행이 없습니다 (헤더만 있음)");
    }

    const headerLine = lines[0];
    const headers = parseCSVRow(headerLine);

    const colMap: Record<string, number> = {};

    if (headers.length >= 10) {
      colMap["회원번호"] = 0;
      colMap["계약번호"] = 1;
      colMap["회원명"] = 2;
      colMap["청구월"] = 3;
      colMap["약정일"] = 4;
      colMap["결제일"] = 5;
      colMap["상품"] = 6;
      colMap["기본금액"] = 7;
      colMap["수량"] = 8;
      colMap["청구번호"] = 9;
    } else {
      return badRequest(
        `CSV 컬럼 수가 ${headers.length}개입니다. billing_update 형식(10컬럼)이 아닙니다.`,
      );
    }

    /* 4. 데이터 행 파싱 */
    const dataRows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCSVRow(lines[i]);
      if (cells.length < 10) continue;

      const rawMemberNo = String(cells[colMap["회원번호"]] || "").replace(/^'/, "").trim();
      const memberNo = Number(rawMemberNo);
      if (!memberNo || memberNo <= 0) continue;

      const rawBillNo = String(cells[colMap["청구번호"]] || "").replace(/^'/, "").trim();
      const rawContractNo = String(cells[colMap["계약번호"]] || "").replace(/^'/, "").trim();

      dataRows.push({
        hyosungMemberNo: memberNo,
        contractNo: rawContractNo,
        donorName: String(cells[colMap["회원명"]] || "").trim(),
        billingMonth: String(cells[colMap["청구월"]] || "").trim(),
        appointDay: String(cells[colMap["약정일"]] || "").trim(),
        paymentDate: String(cells[colMap["결제일"]] || "").trim(),
        product: String(cells[colMap["상품"]] || "").trim(),
        amount: Number(String(cells[colMap["기본금액"]] || "0").replace(/[^0-9]/g, "")) || 0,
        quantity: Number(cells[colMap["수량"]] || "1") || 1,
        billNo: rawBillNo,
        lineNo: i + 1,
      });
    }

    if (dataRows.length === 0) {
      return badRequest("파싱 가능한 데이터 행이 없습니다");
    }

    /* 5. 행별 처리 */
    let matchedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let createdMembersCount = 0;        // ★ M-13: 자동 생성된 회원 수
    let reusedMembersCount = 0;         // ★ M-13: 중복으로 재사용된 회원 수
    const failures: any[] = [];
    const createdMembers: any[] = [];   // ★ M-13: 생성/재사용된 회원 정보

    for (const row of dataRows) {
      try {
        /* 5-1. 중복 청구번호 체크 (멱등성) */
        if (row.billNo) {
          const [existingBill] = await db
            .select({ id: donations.id })
            .from(donations)
            .where(eq(donations.hyosungBillNo, row.billNo))
            .limit(1);

          if (existingBill) {
            skippedCount++;
            continue;
          }
        }

        /* 5-2. 효성 회원번호로 기존 donations 매칭 */
        const [matchedDonation] = await db
          .select({
            id: donations.id,
            memberId: donations.memberId,
            donorName: donations.donorName,
            donorPhone: donations.donorPhone,
            donorEmail: donations.donorEmail,
            amount: donations.amount,
          })
          .from(donations)
          .where(
            and(
              eq(donations.hyosungMemberNo, row.hyosungMemberNo),
              eq(donations.pgProvider, "hyosung_cms"),
            ),
          )
          .limit(1);

        let useMemberId: number | null = null;
        let useDonorName = row.donorName;
        let useDonorPhone: string | null = null;
        let useDonorEmail: string | null = null;
        let isFromAutoCreate = false;

        if (matchedDonation) {
          /* 매칭 성공 — 기존 회원 활용 */
          matchedCount++;
          useMemberId = matchedDonation.memberId;
          useDonorName = matchedDonation.donorName || row.donorName;
          useDonorPhone = matchedDonation.donorPhone;
          useDonorEmail = matchedDonation.donorEmail;
        } else {
          /* ★ M-13: 매칭 실패 — createMembers 옵션에 따라 처리 */
          if (createMembersFlag) {
            /* 자동 회원 생성 */
            const createResult = await createHyosungMember({
              hyosungMemberNo: row.hyosungMemberNo,
              donorName: row.donorName,
            });

            if (createResult.ok && createResult.memberId) {
              useMemberId = createResult.memberId;
              useDonorEmail = createResult.email || null;
              isFromAutoCreate = true;

              if (createResult.duplicate) {
                reusedMembersCount++;
              } else {
                createdMembersCount++;
              }

              createdMembers.push({
                lineNo: row.lineNo,
                hyosungMemberNo: row.hyosungMemberNo,
                memberId: createResult.memberId,
                email: createResult.email,
                donorName: row.donorName,
                duplicate: createResult.duplicate,
              });
            } else {
              /* 자동 생성도 실패 */
              failedCount++;
              failures.push({
                lineNo: row.lineNo,
                hyosungMemberNo: row.hyosungMemberNo,
                donorName: row.donorName,
                reason: `자동 회원 생성 실패: ${createResult.error || "알 수 없음"}`,
              });
              continue;
            }
          } else {
            /* createMembers 미체크 → 기존 동작 (실패 처리) */
            failedCount++;
            failures.push({
              lineNo: row.lineNo,
              hyosungMemberNo: row.hyosungMemberNo,
              donorName: row.donorName,
              reason: "효성 회원번호 매칭 실패 (DB에 없음)",
            });
            continue;
          }
        }

        /* 5-3. donation INSERT */
        const totalAmount = row.amount * row.quantity;

        const memoPrefix = isFromAutoCreate
          ? `[효성 자동등록 + 수납 ${row.billingMonth}]`
          : `[효성 수납 ${row.billingMonth}]`;

        const insertPayload: any = {
          memberId: useMemberId,
          donorName: useDonorName,
          donorPhone: useDonorPhone,
          donorEmail: useDonorEmail,
          amount: totalAmount,
          type: "regular",
          payMethod: "cms",
          pgProvider: "hyosung_cms",
          status: "completed",
          hyosungMemberNo: row.hyosungMemberNo,
          hyosungContractNo: row.contractNo,
          hyosungBillNo: row.billNo,
          receiptRequested: true,
          memo: `${memoPrefix} ${row.product} ₩${totalAmount.toLocaleString()} (약정일: ${row.appointDay}일, 결제일: ${row.paymentDate})`,
        };

        await db.insert(donations).values(insertPayload);
        createdCount++;

        /* ★ M-12: 매칭된 회원이 있으면 sponsor + hyosung_donation으로 승급 */
        if (useMemberId) {
          try {
            await upgradeToSponsor(useMemberId, "hyosung");
            const hyosungSourceId = await getSignupSourceId("hyosung_csv");
            if (hyosungSourceId) {
              await db.execute(
                sql`UPDATE members SET signup_source_id = ${hyosungSourceId}
                    WHERE id = ${useMemberId}
                      AND signup_source_id IS NULL`
              );
            }
          } catch (classifyErr) {
            console.error("[hyosung-import] 분류 승급 실패:", classifyErr);
          }
        }
      } catch (rowErr: any) {
        failedCount++;
        failures.push({
          lineNo: row.lineNo,
          hyosungMemberNo: row.hyosungMemberNo,
          reason: rowErr?.message || "처리 중 오류",
        });
      }
    }

    /* 6. hyosung_import_logs에 결과 기록 */
    const importLogPayload: any = {
      uploadedBy: adminMember.id,
      uploadedByName: adminMember.name || admin.name,
      fileName: file.name,
      fileSize: file.size,
      totalRows: dataRows.length,
      matchedCount,
      createdCount,
      updatedCount,
      skippedCount,
      failedCount,
      detail: JSON.stringify({
        createMembersOption: createMembersFlag,
        createdMembersCount,
        reusedMembersCount,
        createdMembers: createdMembers.slice(0, 100),
        failures: failures.slice(0, 100),
        headers: headers.slice(0, 15),
      }).slice(0, 8000),
    };

    await db.insert(hyosungImportLogs).values(importLogPayload);

    /* 7. 감사 로그 */
    await logAdminAction(req, admin.uid, admin.name, "hyosung_csv_import", {
      target: file.name,
      detail: {
        totalRows: dataRows.length,
        matched: matchedCount,
        created: createdCount,
        skipped: skippedCount,
        failed: failedCount,
        createMembersOption: createMembersFlag,
        createdMembers: createdMembersCount,
        reusedMembers: reusedMembersCount,
      },
    });

    /* 8. 응답 */
    const summary = createMembersFlag
      ? `처리 완료: ${dataRows.length}건 중 ${createdCount}건 후원 생성, ` +
        `${createdMembersCount}명 신규 회원, ${reusedMembersCount}명 기존 회원 재사용, ` +
        `${skippedCount}건 스킵, ${failedCount}건 실패`
      : `처리 완료: ${dataRows.length}건 중 ${createdCount}건 생성, ` +
        `${skippedCount}건 스킵, ${failedCount}건 실패`;

    return ok({
      fileName: file.name,
      totalRows: dataRows.length,
      matched: matchedCount,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      failed: failedCount,
      /* ★ M-13: 자동 회원 생성 통계 */
      createMembersOption: createMembersFlag,
      createdMembers: createdMembersCount,
      reusedMembers: reusedMembersCount,
      newMembersList: createdMembers.slice(0, 30),
      failures: failures.slice(0, 20),
    }, summary);
  } catch (err) {
    console.error("[admin-hyosung-import]", err);
    return serverError("CSV 업로드 처리 중 오류", err);
  }
};

/* ───────── CSV 파싱 헬퍼 ───────── */
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

export const config = { path: "/api/admin/hyosung-import" };