// lib/ai-attachments.ts
// ★ B-9: 첨부 파일을 Gemini AI에 전달하기 위한 변환 헬퍼

import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { blobUploads } from "../db/schema";
import { downloadFromR2 } from "./r2-server";
import type { InlineFile } from "./ai-gemini";

const SUPPORTED_MIME = [
  "image/jpeg", "image/png", "image/webp",
  "application/pdf",
];

const MAX_FILE_SIZE = 20 * 1024 * 1024;       // 단일 20MB
const MAX_TOTAL_SIZE = 30 * 1024 * 1024;      // 합계 30MB
const MAX_FILES = 5;                           // 최대 5개

export async function loadAttachmentsForAI(attachmentIds: number[]): Promise<{
  files: InlineFile[];
  skipped: { id: number; reason: string }[];
  summary: string;
}> {
  const files: InlineFile[] = [];
  const skipped: { id: number; reason: string }[] = [];

  if (!attachmentIds || attachmentIds.length === 0) {
    return { files, skipped, summary: "" };
  }

  /* 최대 N개로 제한 */
  const ids = attachmentIds.slice(0, MAX_FILES);

  try {
    const blobs = await db.select().from(blobUploads).where(inArray(blobUploads.id, ids));

    let totalSize = 0;
    for (const blob of blobs as any[]) {
      const id = blob.id;
      const mimeType = blob.mimeType || "";
      const sizeBytes = blob.sizeBytes || 0;

      /* MIME 타입 검증 */
      if (!SUPPORTED_MIME.includes(mimeType)) {
        skipped.push({ id, reason: `미지원 형식 (${mimeType})` });
        continue;
      }

      /* 단일 크기 검증 */
      if (sizeBytes > MAX_FILE_SIZE) {
        skipped.push({ id, reason: `파일 너무 큼 (${(sizeBytes / 1024 / 1024).toFixed(1)}MB > 20MB)` });
        continue;
      }

      /* 합계 크기 검증 */
      if (totalSize + sizeBytes > MAX_TOTAL_SIZE) {
        skipped.push({ id, reason: "합계 크기 초과 (30MB)" });
        continue;
      }

      /* 업로드 완료 상태만 */
      if (blob.uploadStatus !== "completed") {
        skipped.push({ id, reason: "업로드 미완료" });
        continue;
      }

      /* R2에서 다운로드 */
      try {
        const buffer = await downloadFromR2(blob.blobKey);
        if (!buffer || buffer.length === 0) {
          skipped.push({ id, reason: "다운로드 실패 (빈 파일)" });
          continue;
        }

        /* base64 변환 */
        const base64 = Buffer.from(buffer).toString("base64");
        files.push({
          data: base64,
          mimeType,
        });
        totalSize += sizeBytes;
      } catch (err: any) {
        skipped.push({ id, reason: `R2 다운로드 오류: ${err?.message || "unknown"}` });
      }
    }
  } catch (e: any) {
    console.error("[ai-attachments] 조회 실패:", e);
  }

  /* 요약 메시지 (프롬프트에 포함할 메타) */
  const summary = files.length > 0
    ? `\n\n[첨부 자료 ${files.length}개 동봉됨 — AI가 직접 분석합니다]`
    : (skipped.length > 0 ? `\n\n[첨부 자료 ${skipped.length}개 — AI 분석 미지원 형식으로 스킵됨]` : "");

  return { files, skipped, summary };
}