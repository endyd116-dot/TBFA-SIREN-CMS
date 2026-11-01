// lib/form-blocks.ts — 응답폼·신청폼의 «이미지»·«자료» 블록 (2026-11-01 Swain: 관리자가 이미지·자료를 올려 폼에 배치)
//
// 블록은 질문(입력 칸)이 아니라 관리자가 올려 두는 «내용»이다 — 응답을 받지 않고, 필수·검증·응답 표·CSV에서 빠진다.
// 저장은 기존 form_fields 표 그대로(마이그 0): type = 'image' | 'attachment', label = 제목(선택·빈 글자 허용),
// help_text = 설명(선택), options(jsonb) = { size?, items: [{ blobId, name, mime, size }] }.
// 파일은 공용 업로드(/api/blob-presign → R2 → /api/blob-confirm·공개 파일)로 올리고, 화면 주소는 blobId로만 만든다
// (관리자가 보낸 임의 주소를 그대로 쓰지 않는다 — javascript: 같은 주소 주입 차단).

export const CONTENT_BLOCK_TYPES = ["image", "attachment"] as const;
export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

export function isContentBlock(type: unknown): type is ContentBlockType {
  return type === "image" || type === "attachment";
}

export const IMAGE_SIZES = ["full", "medium", "small"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** 블록 하나에 넣을 수 있는 최대 개수 */
export const BLOCK_MAX_ITEMS: Record<ContentBlockType, number> = { image: 12, attachment: 10 };

export const BLOCK_IMAGE_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export interface BlockItem {
  blobId: number;
  name: string;
  mime: string;
  size: number;
}

export interface BlockOptions {
  size?: ImageSize;
  items: BlockItem[];
}

/** 저장·화면 공용 정규화 — 배열(옛 모양)·객체 모두 받아 { size?, items } 로 */
export function sanitizeBlockOptions(type: ContentBlockType, raw: unknown): BlockOptions {
  const src: any =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : { items: Array.isArray(raw) ? raw : [] };
  const items: BlockItem[] = [];
  const seen = new Set<number>();
  for (const it of Array.isArray(src.items) ? src.items : []) {
    const blobId = Number(it && (it.blobId ?? it.id));
    if (!Number.isInteger(blobId) || blobId <= 0 || seen.has(blobId)) continue;
    const mime = String((it && (it.mime ?? it.mimeType)) || "").slice(0, 100);
    if (type === "image" && !BLOCK_IMAGE_MIME.includes(mime)) continue;
    seen.add(blobId);
    items.push({
      blobId,
      name: String((it && (it.name ?? it.originalName)) || "").slice(0, 200),
      mime,
      size: Math.max(0, Math.floor(Number(it && (it.size ?? it.sizeBytes)) || 0)),
    });
    if (items.length >= BLOCK_MAX_ITEMS[type]) break;
  }
  const out: BlockOptions = { items };
  if (type === "image") {
    const s = String(src.size || "");
    out.size = (IMAGE_SIZES as readonly string[]).includes(s) ? (s as ImageSize) : "full";
  }
  return out;
}

export function blobViewUrl(blobId: number): string {
  return `/api/blob-image?id=${Number(blobId)}`;
}

export function blobDownloadUrl(blobId: number): string {
  return `/api/blob-image?id=${Number(blobId)}&download=1`;
}

/** 공개 폼 응답용 — 화면이 쓸 주소(보기·내려받기)를 서버가 붙여 준다 */
export function toPublicBlockOptions(type: ContentBlockType, raw: unknown) {
  const o = sanitizeBlockOptions(type, raw);
  return {
    ...o,
    items: o.items.map((it) => ({ ...it, url: blobViewUrl(it.blobId), downloadUrl: blobDownloadUrl(it.blobId) })),
  };
}
