// lib/ai-attachments.ts
// B-9 v2: 첨부 파일을 Gemini AI에 전달하기 위한 변환 헬퍼

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

export interface LoadResult {
  files: InlineFile[];
  skipped: { id: number; reason: string }[];
  summary: string;
  /* v2: AI 프롬프트 맨 앞에 강제 주입할 인스트럭션 */
  instructionPrefix: string;
  /* v2: 파일 인덱싱 정보 (AI가 "1번 파일", "2번 파일"로 참조 가능) */
  fileIndex: { idx: number; mimeType: string; sizeKB: number; filename?: string }[];
}

export async function loadAttachmentsForAI(attachmentIds: number[]): Promise<LoadResult> {
  const files: InlineFile[] = [];
  const skipped: { id: number; reason: string }[] = [];
  const fileIndex: LoadResult["fileIndex"] = [];

  if (!attachmentIds || attachmentIds.length === 0) {
    return { files, skipped, summary: "", instructionPrefix: "", fileIndex };
  }

  const ids = attachmentIds.slice(0, MAX_FILES);

  try {
    const blobs = await db.select().from(blobUploads).where(inArray(blobUploads.id, ids));

    let totalSize = 0;
    for (const blob of blobs as any[]) {
      const id = blob.id;
      const mimeType = blob.mimeType || "";
      const sizeBytes = blob.sizeBytes || 0;
      const filename = blob.fileName || blob.filename || `file-${id}`;

      if (!SUPPORTED_MIME.includes(mimeType)) {
        skipped.push({ id, reason: `미지원 형식 (${mimeType})` });
        continue;
      }
      if (sizeBytes > MAX_FILE_SIZE) {
        skipped.push({ id, reason: `파일 너무 큼 (${(sizeBytes / 1024 / 1024).toFixed(1)}MB > 20MB)` });
        continue;
      }
      if (totalSize + sizeBytes > MAX_TOTAL_SIZE) {
        skipped.push({ id, reason: "합계 크기 초과 (30MB)" });
        continue;
      }
      /* v2: failed/deleted만 차단 (pending도 R2 시도 — confirm 지연 대응) */
      if (blob.uploadStatus === "failed" || blob.uploadStatus === "deleted") {
        skipped.push({ id, reason: `업로드 상태 비정상 (${blob.uploadStatus})` });
        continue;
      }

      try {
        const buffer = await downloadFromR2(blob.blobKey);
        if (!buffer || buffer.length === 0) {
          skipped.push({ id, reason: "다운로드 실패 (빈 파일)" });
          continue;
        }

        const base64 = Buffer.from(buffer).toString("base64");
        files.push({ data: base64, mimeType });
        fileIndex.push({
          idx: files.length,
          mimeType,
          sizeKB: Math.round(buffer.length / 1024),
          filename,
        });
        totalSize += sizeBytes;
      } catch (err: any) {
        skipped.push({ id, reason: `R2 다운로드 오류: ${err?.message || "unknown"}` });
      }
    }
  } catch (e: any) {
    console.error("[ai-attachments] 조회 실패:", e);
  }

  /* v2: 진단 로그 */
  console.info("[ai-attachments] 로드 결과:", {
    요청된IDs: attachmentIds,
    성공한_파일수: files.length,
    스킵된_파일: skipped,
    파일별_정보: fileIndex,
  });

  /* v2: 프롬프트 맨 앞에 강제 주입할 인스트럭션 */
  let instructionPrefix = "";
  if (files.length > 0) {
    const fileList = fileIndex.map(f =>
      `  • ${f.idx}번 파일: ${f.filename} (${f.mimeType}, ${f.sizeKB}KB)`
    ).join("\n");

    instructionPrefix = `[필독 — 첨부 파일 분석 지시]
이 메시지에는 ${files.length}개의 첨부 파일이 inlineData로 함께 전송되었습니다.
${fileList}

당신은 반드시 다음을 준수해야 합니다:
1. 위 첨부 파일(PDF/이미지)의 내용을 직접 읽고 분석하십시오.
2. 답변의 핵심 항목(요약·관련법령·법률의견 등)에 첨부 파일에서 발견한 구체적 사실(고유명사·날짜·금액·인명·직책·페이지 번호 등) 중 최소 1개 이상을 명시적으로 인용하십시오.
3. "본문에 구체적 내용이 명시되지 않아", "자료를 정리해 두시기 바랍니다" 같은 회피성 답변은 절대 금지입니다 — 당신은 이미 자료를 받았습니다.
4. 첨부 파일이 스캔본/저화질이라 일부 식별이 어렵다면, 어디까지 식별 가능했는지를 답변에 명시하십시오.
5. 본문 텍스트와 첨부 파일 내용을 종합하여 분석하십시오.

---

`;
  } else if (skipped.length > 0) {
    instructionPrefix = `[참고] 사용자가 ${skipped.length}개의 첨부물을 시도했으나 형식/크기 문제로 AI 분석 불가했습니다. 본문 텍스트만으로 분석하되, 답변 말미에 "첨부물을 직접 분석할 수 없었으니 변호사 상담 시 함께 제출해 주세요" 안내를 포함하세요.

---

`;
  }

  /* 하위호환: 기존 summary 필드 유지 */
  const summary = files.length > 0
    ? `\n\n[첨부 자료 ${files.length}개 — 위 inlineData 참조]`
    : (skipped.length > 0 ? `\n\n[첨부 자료 ${skipped.length}개 미지원 형식 스킵]` : "");

  return { files, skipped, summary, instructionPrefix, fileIndex };
}