/**
 * lib/memorial-letter-photo-image.ts — 편지 사진을 저장하기 전에 다시 그린다
 *
 * ★ 2026-11-12 기억의 편지 사진 첨부 (lib/memorial-letter-photo.ts 참고)
 *
 * 왜 다시 그리나
 *   · 휴대전화 사진에는 찍은 곳의 위치(GPS)·기기 정보가 숨어 있다. 로그인 없이 누구나 올리고
 *     공개되면 누구나 원본을 받을 수 있으므로, 그 정보를 지운 새 사진으로 저장한다.
 *   · 사진처럼 보이게 꾸민 다른 파일(머리 바이트만 사진인 파일)을 걸러낸다 — 실제로 그려지는 사진만 남는다.
 *   · 너무 큰 사진은 긴 변 2400px 안으로 줄인다(화면에서 크게 보기에 충분하다).
 *   · 휴대전화의 «돌려 찍기» 표시를 실제 방향으로 돌려 놓는다.
 *
 * 결과는 늘 JPEG 한 가지다(투명한 부분은 흰 바탕).
 * sharp 는 이미 설치돼 있고(package.json·netlify.toml external_node_modules),
 * 근로계약서·급여 문서 도장 처리에서 운영 중이다. 이 파일은 사진 올리기 API만 불러온다
 * (편지 보내기·목록 쪽은 이 파일을 부르지 않아 영향이 없다).
 */
// @ts-ignore — sharp는 runtime 의존성 (Netlify 빌드 시 자동 설치 + external_node_modules)
import sharp from "sharp";

const MAX_EDGE = 2400;
const MIN_EDGE = 16;
const MAX_INPUT_PIXELS = 100_000_000;   // 1억 화소 — 그보다 큰 사진은 받지 않는다
/* 경고 정도는 넘기고 실제로 깨진 파일만 거절한다(멀쩡한 휴대전화 사진이 사소한 경고로 막히지 않게) */
const SHARP_OPTS = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const };

export type CleanPhotoResult =
  | { ok: true; bytes: Uint8Array; mime: "image/jpeg"; ext: "jpg"; width: number; height: number }
  | { ok: false; error: string };

export async function cleanLetterPhoto(input: Uint8Array): Promise<CleanPhotoResult> {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let meta: any;
  try {
    meta = await sharp(buf, SHARP_OPTS).metadata();
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/pixel limit/i.test(msg)) return { ok: false, error: "사진이 너무 큽니다. 크기를 줄여서 다시 붙여 주세요." };
    return { ok: false, error: "사진 파일을 읽을 수 없습니다. 다른 사진으로 다시 붙여 주세요." };
  }
  const w = Number(meta?.width || 0), h = Number(meta?.height || 0);
  if (!w || !h) return { ok: false, error: "사진 파일을 읽을 수 없습니다. 다른 사진으로 다시 붙여 주세요." };
  if (w < MIN_EDGE || h < MIN_EDGE) return { ok: false, error: "너무 작은 사진입니다. 다른 사진을 붙여 주세요." };

  try {
    const { data, info } = await sharp(buf, SHARP_OPTS)
      .rotate()                                                    // 돌려 찍기 표시대로 바로 세움
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })                          // 투명한 부분은 흰 바탕
      .jpeg({ quality: 86, mozjpeg: true })                        // 위치·기기 정보는 따라가지 않는다(기본 동작)
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      mime: "image/jpeg",
      ext: "jpg",
      width: Number(info?.width || 0),
      height: Number(info?.height || 0),
    };
  } catch (e) {
    console.warn("[memorial-letter-photo-image] 다시 그리기 실패", e);
    return { ok: false, error: "사진 파일을 읽을 수 없습니다. 다른 사진으로 다시 붙여 주세요." };
  }
}
