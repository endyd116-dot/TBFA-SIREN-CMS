import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { callGeminiJSON } from "../../lib/ai-gemini";

export const config = { path: "/api/admin-family-story-ai" };

// oEmbed로 제목 보강
async function fetchOembedTitle(youtubeUrl: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json() as { title?: string };
    return data.title || null;
  } catch {
    return null;
  }
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 지원합니다" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { youtubeUrl, title: inputTitle, adminNotes } = body;

  // oEmbed로 제목 보강
  let resolvedTitle = inputTitle || "";
  if (youtubeUrl && !resolvedTitle) {
    resolvedTitle = (await fetchOembedTitle(youtubeUrl)) || "";
  }

  if (!resolvedTitle && !adminNotes) {
    return new Response(JSON.stringify({ ok: false, error: "제목 또는 운영자 메모가 필요합니다" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const prompt = `당신은 (사)교사유가족협의회 공식 플랫폼의 콘텐츠 편집자입니다.
추모와 연대의 톤으로, 차분하고 존엄하게 작성하세요. 과장·허위 사실 금지.

[영상 정보]
제목: ${resolvedTitle || "(없음)"}
URL: ${youtubeUrl || "(없음)"}
운영자 메모: ${adminNotes || "(없음)"}

위 정보를 바탕으로 아래 3가지를 JSON 형식으로 생성하세요:
1. subtitle: 카드/히어로에 표시할 부제 (20~50자, 마침표 없이)
2. summary: 갤러리 카드용 요약 (1~2줄, 80자 이내)
3. detailHtml: 상세 본문 HTML (<p>, <h3> 태그만 사용, 200~500자)
   구성: 소개 단락 → 영상이 담은 이야기 단락 → <h3> 소제목 → 협회와의 연결 또는 헌사 단락

JSON 응답 형식 (다른 텍스트 없이 JSON만):
{"subtitle":"...","summary":"...","detailHtml":"..."}`;

  try {
    const result = await callGeminiJSON<{ subtitle: string; summary: string; detailHtml: string }>(
      prompt,
      { featureKey: "memorial_story_detail", mode: "pro", maxOutputTokens: 3000 }
    );

    if (!result.ok || !result.data) {
      // 폴백: 빈 초안 + 안내 메시지
      return new Response(JSON.stringify({
        ok: true,
        data: {
          draft: {
            subtitle: "",
            summary: "",
            detailHtml: "",
          },
        },
        warning: result.error || "AI 초안 생성에 실패했습니다. 직접 작성해 주세요.",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: true,
      data: { draft: result.data },
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    // 예외 시에도 폴백 초안 반환
    return new Response(JSON.stringify({
      ok: true,
      data: { draft: { subtitle: "", summary: "", detailHtml: "" } },
      warning: "AI 초안 생성 중 오류가 발생했습니다. 직접 작성해 주세요.",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
}
