/**
 * 이미지 자동 압축 헬퍼 — 카카오/MMS 발송 시 300KB 제한 자동 충족.
 *
 * 단계적 압축:
 *   1) 이미 maxBytes 이하면 그대로 반환
 *   2) JPEG quality 80 → 60 → 40 → 20 단계적 시도
 *   3) 그래도 크면 가로 폭 1200 → 800 → 600 → 400 축소 + quality 60
 *   4) 모두 실패 시 null 반환 (이미지가 너무 복잡)
 *
 * 사용:
 *   const compressed = await compressToMaxBytes(buffer, 300 * 1024);
 *   if (!compressed) return { ok: false, error: "압축 한계 초과" };
 */

// @ts-ignore — sharp는 runtime 의존성 (Netlify 빌드 시 자동 설치 + external_node_modules).
// 로컬 npm install 없이도 타입 체크 통과시키기 위해 ignore.
import sharp from "sharp";

export interface CompressResult {
  buffer: Buffer;
  originalBytes: number;
  finalBytes: number;
  mode: "skipped" | "quality" | "resize";
  meta: { quality?: number; width?: number };
}

const QUALITY_STEPS = [80, 60, 40, 20];
const WIDTH_STEPS = [1200, 800, 600, 400];

export async function compressToMaxBytes(
  input: Buffer | ArrayBuffer,
  maxBytes: number,
): Promise<CompressResult | null> {
  const inputBuf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const originalBytes = inputBuf.byteLength;

  if (originalBytes <= maxBytes) {
    return { buffer: inputBuf, originalBytes, finalBytes: originalBytes, mode: "skipped", meta: {} };
  }

  /* 1단계: JPEG quality 단계적 시도 */
  for (const quality of QUALITY_STEPS) {
    try {
      const out = await sharp(inputBuf).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (out.byteLength <= maxBytes) {
        return { buffer: out, originalBytes, finalBytes: out.byteLength, mode: "quality", meta: { quality } };
      }
    } catch {
      /* sharp가 입력 형식을 못 읽으면 다음 단계로 */
    }
  }

  /* 2단계: 가로 폭 축소 + quality 60 */
  for (const width of WIDTH_STEPS) {
    try {
      const out = await sharp(inputBuf)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 60, mozjpeg: true })
        .toBuffer();
      if (out.byteLength <= maxBytes) {
        return { buffer: out, originalBytes, finalBytes: out.byteLength, mode: "resize", meta: { width, quality: 60 } };
      }
    } catch {
      /* 다음 단계 */
    }
  }

  return null;
}
