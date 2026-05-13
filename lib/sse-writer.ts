/**
 * Server-Sent Events 헬퍼 — Netlify Functions v2 (Web Streams API)
 *
 * 사용:
 *   export default async (req: Request) => {
 *     return new Response(createSSEStream(async (write) => {
 *       write("text", { text: "안녕" });
 *       await new Promise(r => setTimeout(r, 500));
 *       write("text", { text: "하세요" });
 *       write("done", {});
 *     }), { headers: sseHeaders() });
 *   };
 */

export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",   /* nginx·CDN 버퍼링 방지 */
  };
}

export type SSEWrite = (event: string, data: any) => void;

export function createSSEStream(
  handler: (write: SSEWrite) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const write: SSEWrite = (event, data) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch (_) { /* controller 이미 닫힘 — 무시 */ }
      };

      /* 초기 keepalive 코멘트 — 프록시 즉시 flush */
      try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch (_) {}

      try {
        await handler(write);
      } catch (e: any) {
        write("error", { message: String(e?.message || e).slice(0, 500) });
      } finally {
        try { controller.close(); } catch (_) {}
      }
    },
  });
}
