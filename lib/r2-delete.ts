// lib/r2-delete.ts
// Phase 3-extra Step 8: R2 객체 삭제 유틸 (회귀 방지용 분리 모듈)
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, R2_BUCKET } from "./r2-client";

/**
 * R2에서 단일 객체 삭제
 * 실패해도 throw 안 하고 결과 객체 반환 (cron/일괄 처리에서 사용)
 */
export async function deleteFromR2(blobKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!blobKey) return { success: false, error: "blobKey가 비어있음" };
    const client = getR2Client();
    await client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: blobKey,
    }));
    return { success: true };
  } catch (err: any) {
    console.warn("[r2-delete] failed:", blobKey, err?.message);
    return { success: false, error: err?.message || "unknown" };
  }
}
