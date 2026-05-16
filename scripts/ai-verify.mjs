#!/usr/bin/env node
// AI 비서 도구 라이브 검증 헬퍼
// Usage: node scripts/ai-verify.mjs "<사용자메시지>" [conversationId]
const COOKIE = process.env.AI_COOKIE;
if (!COOKIE) { console.error("AI_COOKIE env not set"); process.exit(1); }
const userMessage = process.argv[2];
const conversationId = process.argv[3] || null;
if (!userMessage) { console.error("usage: node ai-verify.mjs <msg> [convId]"); process.exit(1); }

(async () => {
  const start = Date.now();
  const res = await fetch("https://tbfa.co.kr/api/admin-ai-agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": COOKIE,
    },
    body: JSON.stringify({ userMessage, conversationId }),
  });
  const elapsed = Date.now() - start;
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { j = { _raw: text.slice(0, 500) }; }
  const summary = {
    status: res.status,
    elapsedMs: elapsed,
    conversationId: j.conversationId || null,
    reply: typeof j.reply === "string" ? j.reply.slice(0, 220) : null,
    toolCalls: Array.isArray(j.toolCalls) ? j.toolCalls.map(tc => ({
      name: tc.name,
      ok: tc?.result?.ok,
      error: tc?.result?.error || null,
      args: tc.args,
      preview: tc?.result?.preview || null,
    })) : [],
    pendingApproval: !!j.pendingApproval,
    error: j.error || null,
    raw: j._raw || null,
  };
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error("ERR", e); process.exit(2); });
