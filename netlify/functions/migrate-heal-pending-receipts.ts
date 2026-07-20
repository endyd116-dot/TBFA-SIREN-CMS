// netlify/functions/migrate-heal-pending-receipts.ts
// 1회용 복구 — 증빙/영수증 업로드가 "완료 확정(blob-confirm)" 단계를 빠뜨려
//   blob_uploads.upload_status 가 'pending' 으로 굳은 기록을 되살린다.
//   파일 본문은 R2 에 정상 업로드돼 있으므로 HEAD 로 존재를 확인한 뒤 completed 로 전환.
//
// - GET            : 진단(인증 불필요) — 굳어있는 pending 증빙 건수만 리턴
// - GET ?run=1     : requireAdmin 후 실제 복구 (HEAD 확인 → completed, 실제 size/type 동기화)
// 호출 성공 후 파일 삭제 + 커밋 (1회용 보안 원칙 · CLAUDE §6.8)

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { and, eq, inArray } from "drizzle-orm";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { getR2Client, R2_BUCKET } from "../../lib/r2-client";

export const config = { path: "/api/migrate-heal-pending-receipts" };

// 확정 단계를 빠뜨린 프론트 경로가 쓰던 컨텍스트 (지출결재 증빙 + 지출관리 영수증 공통)
const CONTEXTS = ["expense-receipt"];

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    const pending = await db
      .select()
      .from(blobUploads)
      .where(
        and(
          eq(blobUploads.uploadStatus, "pending"),
          eq(blobUploads.storageProvider, "r2"),
          inArray(blobUploads.context, CONTEXTS),
        ),
      );

    if (!run) {
      return new Response(
        jsonKST({
          ok: true,
          mode: "diagnostic",
          pendingCount: pending.length,
          ids: pending.map((r: any) => r.id),
          hint: "복구하려면 어드민 로그인 상태에서 ?run=1 추가",
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    const client = getR2Client();
    const healed: number[] = [];
    const missing: number[] = [];
    const errored: { id: number; detail: string }[] = [];

    for (const row of pending as any[]) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: R2_BUCKET, Key: row.blobKey }),
        );
        const update: any = { uploadStatus: "completed" };
        if (head.ContentLength) update.sizeBytes = Number(head.ContentLength);
        if (head.ContentType) update.mimeType = head.ContentType;
        await db.update(blobUploads).set(update).where(eq(blobUploads.id, row.id));
        healed.push(row.id);
      } catch (e: any) {
        const code = e?.$metadata?.httpStatusCode;
        if (code === 404) {
          // 진짜로 R2 에 없는 건 = 업로드 자체 실패. 실패로 확정(더는 pending 로 매달리지 않게).
          await db.update(blobUploads).set({ uploadStatus: "failed" } as any).where(eq(blobUploads.id, row.id));
          missing.push(row.id);
        } else {
          errored.push({ id: row.id, detail: String(e?.message || e).slice(0, 200) });
        }
      }
    }

    return new Response(
      jsonKST({
        ok: true,
        mode: "run",
        healedCount: healed.length,
        healed,
        missingCount: missing.length,
        missing,
        erroredCount: errored.length,
        errored,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      jsonKST({ ok: false, error: "복구 실패", detail: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 1000) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
};
