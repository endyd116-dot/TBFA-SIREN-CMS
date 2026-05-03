/**
 * POST /api/admin/hyosung-import
 *
 * 효성 CMS+ billing_update.csv 업로드 → 수납 결과 반영
 *
 * 동작:
 * 1. multipart/form-data로 CSV 파일 수신
 * 2. CSV 파싱 (EUC-KR/UTF-8 자동 감지)
 * 3. 각 행의 회원번호('00000060 → 60)로 donations 매칭
 * 4. 매칭된 건: 해당 월(청구월) donations 생성 또는 업데이트
 * 5. 중복 청구번호 건: 스킵 (멱등성)
 * 6. 매칭 실패 건: 기록만 (에러 아님)
 * 7. hyosung_import_logs에 결과 기록
 * 8. 감사 로그
 *
 * billing_update.csv 컬럼 (10개):
 *   회원번호 / 계약번호 / 회원명 / 청구월 / 약정일 /
 *   결제일 / 상품 / 기본금액 / 수량 / 청구번호
 *
 * 매칭 전략:
 *   csv.회원번호 → 숫자 변환 → donations.hyosung_member_no 매칭
 *   매칭 후 해당 회원의 해당 월 청구를 새 donation으로 INSERT
 *   (이미 같은 청구번호가 있으면 스킵)
 *
 * 보안:
 * - 관리자/운영자만
 * - 파일 크기 5MB 제한
 * - audit_logs + hyosung_import_logs 이중 기록
 */
import { eq, and } from "drizzle-orm";
import { db, donations, members, hyosungImportLogs } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
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

    /* 2. 파일 읽기 (인코딩 자동 감지) */
    const rawBuffer = await file.arrayBuffer();
    let csvText = "";

    /* UTF-8 시도 */
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      csvText = decoder.decode(rawBuffer);
    } catch (e) {
      /* EUC-KR fallback (효성 CSV는 보통 EUC-KR) */
      try {
        const decoder = new TextDecoder("euc-kr");
        csvText = decoder.decode(rawBuffer);
      } catch (e2) {
        /* 최종 fallback: UTF-8 비관용 */
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

    /* 헤더 행 */
    const headerLine = lines[0];
    const headers = parseCSVRow(headerLine);

    /* 컬럼 인덱스 매핑 (효성 billing_update 양식) */
    const colMap: Record<string, number> = {};
    const expectedCols = [
      "회원번호", "계약번호", "회원명", "청구월", "약정일",
      "결제일", "상품", "기본금액", "수량", "청구번호",
    ];

    /* 헤더에서 인코딩이 깨져도 순서 기반 fallback */
    if (headers.length >= 10) {
      /* 순서 기반 매핑 (billing_update는 항상 10컬럼 고정) */
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

      /* 회원번호: '00000060 → 60 (앞의 ' 제거 + 숫자 변환) */
      const rawMemberNo = String(cells[colMap["회원번호"]] || "").replace(/^'/, "").trim();
      const memberNo = Number(rawMemberNo);
      if (!memberNo || memberNo <= 0) continue; // 유효하지 않은 행 무시

      const rawBillNo = String(cells[colMap["청구번호"]] || "").replace(/^'/, "").trim();
      const rawContractNo = String(cells[colMap["계약번호"]] || "").replace(/^'/, "").trim();

      dataRows.push({
        hyosungMemberNo: memberNo,
        contractNo: rawContractNo,
        donorName: String(cells[colMap["회원명"]] || "").trim(),
        billingMonth: String(cells[colMap["청구월"]] || "").trim(), // 202605
        appointDay: String(cells[colMap["약정일"]] || "").trim(),   // 20
        paymentDate: String(cells[colMap["결제일"]] || "").trim(),  // 20260520
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
    const failures: any[] = [];

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
            continue; // 이미 처리된 청구번호
          }
        }

        /* 5-2. 효성 회원번호로 기존 donations 매칭 (completed 상태) */
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

        if (!matchedDonation) {
          /* 매칭 실패 — 우리 DB에 이 효성 번호가 없음 */
          failedCount++;
          failures.push({
            lineNo: row.lineNo,
            hyosungMemberNo: row.hyosungMemberNo,
            donorName: row.donorName,
            reason: "효성 회원번호 매칭 실패 (DB에 없음)",
          });
          continue;
        }

        matchedCount++;

        /* 5-3. 해당 월 청구에 대해 새 donation INSERT */
        const totalAmount = row.amount * row.quantity;

        const insertPayload: any = {
          memberId: matchedDonation.memberId,
          donorName: matchedDonation.donorName || row.donorName,
          donorPhone: matchedDonation.donorPhone,
          donorEmail: matchedDonation.donorEmail,
          amount: totalAmount,
          type: "regular",
          payMethod: "cms",
          pgProvider: "hyosung_cms",
          status: "completed", // billing_update는 청구 확정 → completed
          hyosungMemberNo: row.hyosungMemberNo,
          hyosungContractNo: row.contractNo,
          hyosungBillNo: row.billNo,
          receiptRequested: true,
          memo: `[효성 수납 ${row.billingMonth}] ${row.product} ₩${totalAmount.toLocaleString()} (약정일: ${row.appointDay}일, 결제일: ${row.paymentDate})`,
        };

        await db.insert(donations).values(insertPayload);
        createdCount++;
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
        failures: failures.slice(0, 100), // 최대 100건만 저장
        headers: headers.slice(0, 15),
      }).slice(0, 5000),
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
      },
    });

    /* 8. 응답 */
    return ok({
      fileName: file.name,
      totalRows: dataRows.length,
      matched: matchedCount,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      failed: failedCount,
      failures: failures.slice(0, 20), // 응답에는 20건만
    }, `처리 완료: ${dataRows.length}건 중 ${createdCount}건 생성, ${skippedCount}건 스킵, ${failedCount}건 실패`);
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