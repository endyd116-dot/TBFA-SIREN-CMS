/**
 * POST /api/admin/potential-donor-ai-extract
 *
 * 사진(JPG·PNG·WEBP)·PDF·텍스트(엑셀 파싱 결과) → AI가 이름·연락처·주소·이벤트명 추출
 *
 * Body:
 *   { fileBase64?, mimeType?, parsedText?, eventNameHint?, entryPathHint? }
 *
 * Response:
 *   { ok: true, items: [{ name, phone, address, birthdate, eventName, entryPath, memo, confidence }] }
 */

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { callGeminiJSON } from "../../lib/ai-gemini";

export const config = { path: "/api/admin/potential-donor-ai-extract" };

const SUPPORTED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

interface ExtractedItem {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  birthdate?: string;
  eventName?: string;
  entryPath?: string;
  memo?: string;
  confidence?: number;
}

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "AI 추출 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
    }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonError("parse_body", "JSON 파싱 실패", 400);
  }

  const { fileBase64, mimeType, parsedText, eventNameHint, entryPathHint } = body;

  if (!fileBase64 && !parsedText) {
    return jsonError("validate", "파일(fileBase64) 또는 텍스트(parsedText) 중 하나는 필수입니다", 400);
  }

  /* 프롬프트 구성 */
  const eventHint = eventNameHint ? `\n참여한 이벤트·활동: ${eventNameHint}` : "";
  const pathHint = entryPathHint ? `\n유입 경로: ${entryPathHint}` : "";

  const prompt = `당신은 NPO(비영리단체) 잠재 후원자 명단을 정리하는 데이터 추출 전문가입니다.

아래 이미지·PDF·텍스트에서 사람 정보를 추출하여 JSON 배열로 반환하세요.

추출 규칙:
1. 사람마다 한 항목씩 (이름·연락처가 있는 경우만)
2. 이름이 없거나 명확하지 않으면 그 항목은 제외
3. 전화번호는 010-XXXX-XXXX 형식으로 정규화
4. 주소는 가능한 한 정제 (시·구·동까지)
5. 생년월일은 YYYY-MM-DD 형식 (불명확하면 생략)
6. confidence는 추출 확신도 (0.0 ~ 1.0)
${eventHint}${pathHint}

추가 텍스트 정보 (수기/엑셀 파싱 결과):
${parsedText || "(파일 첨부 본문 분석)"}

응답 형식 (JSON만, 설명 없이):
{
  "items": [
    {
      "name": "홍길동",
      "email": "hong@example.com",
      "phone": "010-1234-5678",
      "address": "서울특별시 강남구 ...",
      "birthdate": "1985-03-15",
      "eventName": "${eventNameHint || ""}",
      "entryPath": "${entryPathHint || ""}",
      "memo": "추가 메모",
      "confidence": 0.92
    }
  ]
}`;

  try {
    const inlineFiles =
      fileBase64 && mimeType && SUPPORTED_MIME.includes(mimeType)
        ? [{ data: fileBase64.replace(/^data:[^;]+;base64,/, ""), mimeType }]
        : undefined;

    const aiRes = await callGeminiJSON<{ items: ExtractedItem[] }>(prompt, {
      mode: "flash",
      temperature: 0.2,
      maxOutputTokens: 4096,
      inlineFiles,
    });

    if (!aiRes.ok || !aiRes.data) {
      return jsonError("ai_call", aiRes.error || "AI 응답 없음");
    }

    const items = Array.isArray(aiRes.data.items) ? aiRes.data.items : [];
    const cleaned = items
      .filter((i) => i.name && i.name.trim().length > 0)
      .map((i) => ({
        name: String(i.name).trim().slice(0, 50),
        email: i.email ? String(i.email).trim().slice(0, 200) : "",
        phone: i.phone ? String(i.phone).trim().slice(0, 30) : "",
        address: i.address ? String(i.address).trim().slice(0, 200) : "",
        birthdate: i.birthdate ? String(i.birthdate).trim().slice(0, 10) : "",
        eventName: (i.eventName || eventNameHint || "").trim().slice(0, 100),
        entryPath: (i.entryPath || entryPathHint || "").trim().slice(0, 50),
        memo: i.memo ? String(i.memo).trim().slice(0, 300) : "",
        confidence: typeof i.confidence === "number" ? i.confidence : 0.5,
      }));

    return new Response(
      JSON.stringify({ ok: true, items: cleaned, modelUsed: aiRes.modelUsed || null }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  } catch (err) {
    return jsonError("ai_extract", err);
  }
};
