// lib/att-evidence.ts
// 근태 수정 요청의 '증빙 자료' 공용 처리.
//
// 설계 의도:
//   증빙 파일을 근태 시스템 안에만 따로 쌓지 않고 **각자의 워크스페이스 파일함**에 넣는다.
//   그래야 ① 한 번 올린 서류를 다음 요청에서 다시 고를 수 있고 ② 본인이 파일함에서 직접
//   이름을 바꾸거나 지울 수 있고 ③ 파일이 두 군데로 흩어지지 않는다.
//   요청에는 '파일함의 어느 파일인지'만 적어둔다.
//
// 파일 종류 제한 없음 (한글·워드·PDF·이미지 등 무엇이든) · 용량 20MB.

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../db/index";
import { workspaceFiles, workspaceFolders } from "../db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getR2Client, R2_BUCKET } from "./r2-client";

/** 20MB — Swain 지정. 확장자 제한은 두지 않는다. */
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_FOLDER_NAME = "근태 증빙";
/** 요청 1건에 붙일 수 있는 첨부 수 */
export const EVIDENCE_MAX_FILES = 10;

export interface EvidenceFile {
  fileId: number;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

/** 본인 소유 '근태 증빙' 폴더 — 없으면 만든다 (첨부가 파일함 최상단에 흩어지지 않게) */
export async function ensureEvidenceFolder(meId: number): Promise<number | null> {
  try {
    const [found] = await db.select({ id: workspaceFolders.id })
      .from(workspaceFolders)
      .where(and(
        eq(workspaceFolders.ownerId, meId),
        eq(workspaceFolders.name, EVIDENCE_FOLDER_NAME),
        isNull(workspaceFolders.deletedAt),
      ))
      .limit(1);
    if (found) return found.id;

    const [made] = await db.insert(workspaceFolders).values({
      parentId: null,
      name: EVIDENCE_FOLDER_NAME,
      ownerId: meId,
      path: `/${EVIDENCE_FOLDER_NAME}`,
      depth: 0,
      isShared: false,
      description: "근태 수정 요청에 첨부한 증빙 자료",
    } as any).returning({ id: workspaceFolders.id });
    return made?.id ?? null;
  } catch (err) {
    /* 폴더를 못 만들어도 업로드는 되게 한다 — 폴더 없이 파일함 최상단에 올라간다 */
    console.warn("[att-evidence] 증빙 폴더 준비 실패(폴더 없이 계속):", err);
    return null;
  }
}

/**
 * 첨부 목록 정규화 — 요청에 저장할 값을 만든다.
 * 남의 파일 번호를 끼워 넣어도 여기서 걸러진다 (본인 소유 + 업로드가 끝난 파일만 통과).
 */
export async function normalizeEvidenceFiles(meId: number, raw: any): Promise<EvidenceFile[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const ids = Array.from(new Set(
    raw.map((f: any) => Number(f?.fileId ?? f?.id)).filter((n) => Number.isFinite(n) && n > 0)
  )).slice(0, EVIDENCE_MAX_FILES);
  if (ids.length === 0) return [];

  const rows = await db.select({
    id: workspaceFiles.id, name: workspaceFiles.name,
    sizeBytes: workspaceFiles.sizeBytes, mimeType: workspaceFiles.mimeType,
  })
    .from(workspaceFiles)
    .where(and(
      eq(workspaceFiles.ownerId, meId),
      eq(workspaceFiles.uploadStatus, "ready"),
      isNull(workspaceFiles.deletedAt),
      /* 배열 파라미터는 postgres-js 직렬화가 안 되므로 숫자 목록으로 펼친다 (위에서 숫자만 남겼다) */
      sql`${workspaceFiles.id} = ANY(ARRAY[${sql.raw(ids.join(","))}]::int[])`,
    ));

  return rows.map((r) => ({
    fileId: r.id,
    name: r.name,
    sizeBytes: Number(r.sizeBytes || 0),
    mimeType: String(r.mimeType || "application/octet-stream"),
  }));
}

/** 저장된 첨부 목록 읽기 — 옛 데이터(칸이 비어 있음)도 안전하게 빈 배열로 */
export function evidenceListOf(correction: any): EvidenceFile[] {
  const raw = correction?.evidenceFiles ?? correction?.evidence_files ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f: any) => Number.isFinite(Number(f?.fileId)))
    .map((f: any) => ({
      fileId: Number(f.fileId),
      name: String(f.name ?? "첨부파일"),
      sizeBytes: Number(f.sizeBytes || 0),
      mimeType: String(f.mimeType ?? "application/octet-stream"),
    }));
}

/** 내려받기 주소 발급 (5분 유효) — 호출부가 이미 권한을 확인한 파일에만 쓴다 */
export async function evidenceDownloadUrl(fileId: number): Promise<{ url: string; name: string } | null> {
  const [f] = await db.select({ r2Key: workspaceFiles.r2Key, name: workspaceFiles.name })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.id, fileId), isNull(workspaceFiles.deletedAt)))
    .limit(1);
  if (!f) return null;

  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: f.r2Key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    }),
    { expiresIn: 300 },
  );
  return { url, name: f.name };
}
