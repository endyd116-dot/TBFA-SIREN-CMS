// lib/memorial-bgm.ts
/* =========================================================
   추모관 배경 음악 — 트랙 주소 판별 + 음원 파일 올리기 규칙 (서버 쪽 단일 출처)
   (2026-11-12 대표 결정: 관리자가 음원 파일을 직접 올리거나, 유튜브 주소를 넣으면 그 노래가 나오게)

   - 트랙 모양은 그대로 [{ title, url }] (memorial_settings.bgm_tracks · 공개 API bgmTracks)
   - url 종류
       음원 파일 : 올린 파일 주소(/api/blob-image?id=N) 또는 .mp3·.m4a·.mp4·.aac·.ogg·.oga·.wav 로 끝나는 주소
       유튜브    : youtu.be/ID · youtube.com/watch?v=ID · youtube.com/shorts/ID · music.youtube.com/watch?v=ID 등
                   (list= 같은 다른 매개변수는 무시하고 영상 번호 11자만 쓴다)
       그 밖     : 재생할 수 없는 주소 → 저장을 막는다
   - 같은 판별 규칙이 화면 쪽 두 곳에도 있다. 바꿀 때는 세 곳을 함께 바꾼다.
       public/js/memorial-bgm.js    공개 추모관 재생
       public/js/admin-memorial.js  관리자 «BGM 트랙 목록» 표시·저장 검사
   ========================================================= */

export type BgmUrlKind = "audio" | "youtube" | "invalid" | "empty";

/* 올린 음원 파일의 업로드 기록 구분값(blob_uploads.context) */
export const BGM_UPLOAD_CONTEXT = "memorial_bgm";
/* 음원 파일 한 개 크기 상한 — 30MB (함수 본문 한도 6MB와 무관: 브라우저가 R2로 바로 올린다) */
export const BGM_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
/* 트랙 개수·글자 수 상한 (지나치게 큰 값이 저장되지 않게) */
export const BGM_MAX_TRACKS = 50;
const TITLE_MAX = 100;
const URL_MAX = 2000;

/* 올릴 수 있는 음원: 확장자 → 내줄 때 쓰는 표준 형식 */
const AUDIO_EXT_TYPE: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",   // 음성만 든 mp4
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
};

/* 브라우저가 알려 주는 형식 이름 — 운영체제마다 다르게 부르는 별칭까지 받는다
   (예: 윈도우는 .aac 를 audio/vnd.dlna.adts, .m4a 를 audio/x-m4a 로 알려 준다) */
const AUDIO_MIME_ALIASES = new Set<string>([
  "audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg", "audio/x-mpeg-3", "audio/x-mp3",
  "audio/mp4", "audio/x-m4a", "audio/m4a",
  "audio/aac", "audio/x-aac", "audio/aacp", "audio/vnd.dlna.adts",
  "audio/ogg", "audio/x-ogg", "application/ogg",
  "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
]);

export function fileExtOf(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || "").trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * 올리려는 파일이 음원인지 확인하고, 저장·재생에 쓸 표준 형식을 정한다.
 * 확장자가 허용 목록에 있어야 하고, 브라우저가 알려 준 형식이 음원과 어긋나면(이미지·문서 등) 막는다.
 * 형식을 비워 보내거나(일부 운영체제) application/octet-stream 이면 확장자로 정한다.
 */
export function resolveBgmUploadType(originalName: string, mimeType: string): {
  ok: boolean; contentType?: string; error?: string;
} {
  const ext = fileExtOf(originalName);
  const contentType = AUDIO_EXT_TYPE[ext];
  if (!contentType) {
    return { ok: false, error: "mp3 · m4a · mp4(음성) · aac · ogg · wav 파일만 올릴 수 있습니다" };
  }
  const mime = String(mimeType || "").trim().toLowerCase().split(";")[0].trim();
  const neutral = !mime || mime === "application/octet-stream";
  /* .mp4·.m4a 를 video/mp4 로, .ogg 를 video/ogg 로 알려 주는 운영체제가 있다 — 확장자 기준으로 음성 파일로 받는다 */
  const containerAlias =
    (mime === "video/mp4" && (ext === "mp4" || ext === "m4a")) ||
    (mime === "video/ogg" && (ext === "ogg" || ext === "oga"));
  if (!neutral && !AUDIO_MIME_ALIASES.has(mime) && !containerAlias) {
    return { ok: false, error: `음원 파일이 아닙니다 (${mime.slice(0, 60)})` };
  }
  return { ok: true, contentType };
}

/* ── 유튜브 주소 → 영상 번호(11자) ── */
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];

export function parseYouTubeId(raw: string): string | null {
  let s = String(raw || "").trim();
  if (!s) return null;
  /* «youtu.be/…» 처럼 https:// 없이 붙여 넣은 주소도 받는다 */
  if (!/^https?:\/\//i.test(s) && /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(s)) {
    s = "https://" + s;
  }
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") {
    id = u.pathname.split("/")[1] || "";
  } else if (YT_HOSTS.indexOf(host) >= 0) {
    if (/^\/watch\/?$/.test(u.pathname)) id = u.searchParams.get("v") || "";
    else {
      const m = /^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/.exec(u.pathname);
      if (m) id = m[1];
    }
  }
  return YT_ID_RE.test(id) ? id : null;
}

/** 트랙 주소 종류: 음원 파일 / 유튜브 / 재생할 수 없는 주소 / 빈 칸 */
export function classifyBgmUrl(raw: string): BgmUrlKind {
  const s = String(raw || "").trim();
  if (!s) return "empty";
  if (s.length > URL_MAX) return "invalid";
  if (parseYouTubeId(s)) return "youtube";
  const isRootPath = /^\/(?!\/)/.test(s);          // /assets/audio/a.mp3 · /api/blob-image?id=3
  const isAbsolute = /^https?:\/\//i.test(s);
  if (!isRootPath && !isAbsolute) return "invalid";
  let u: URL;
  try { u = new URL(s, "https://tbfa.co.kr"); } catch { return "invalid"; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  /* 영상 번호가 없는 유튜브 주소(재생목록·채널 등)는 재생할 수 없다 */
  if (isAbsolute && (host === "youtu.be" || YT_HOSTS.indexOf(host) >= 0)) return "invalid";
  if (u.pathname === "/api/blob-image" && /^\d+$/.test(u.searchParams.get("id") || "")) return "audio";
  if (AUDIO_EXT_TYPE[fileExtOf(u.pathname)]) return "audio";
  return "invalid";
}

/**
 * 관리자 저장 직전 검사·정리 — 빈 줄은 버리고, 재생할 수 없는 주소가 하나라도 있으면 저장을 막는다.
 * 반환 tracks 는 [{ title, url }] 모양 그대로.
 */
export function normalizeBgmTracksForSave(input: unknown): {
  ok: boolean; tracks?: { title: string; url: string }[]; error?: string; invalidRows?: number[];
} {
  const arr: any[] = Array.isArray(input) ? input : [];
  const tracks: { title: string; url: string }[] = [];
  const invalidRows: number[] = [];
  arr.forEach((it: any, i: number) => {
    const url = String((it && it.url) ?? "").trim();
    if (!url) return;                                   // 빈 줄은 무시
    if (classifyBgmUrl(url) === "invalid") { invalidRows.push(i + 1); return; }
    const title = String((it && it.title) ?? "").trim().slice(0, TITLE_MAX) || "추모 음악";
    tracks.push({ title, url });
  });
  if (invalidRows.length) {
    return { ok: false, error: `재생할 수 없는 주소가 있습니다 (${invalidRows.join(", ")}번째 트랙)`, invalidRows };
  }
  if (tracks.length > BGM_MAX_TRACKS) {
    return { ok: false, error: `트랙은 ${BGM_MAX_TRACKS}개까지 등록할 수 있습니다`, invalidRows: [] };
  }
  return { ok: true, tracks };
}
