#!/usr/bin/env node
// AI 비서 도구 21 묶음 라이브 검증 — 순차 실행, 묶음별 conversationId 유지
// Usage: AI_COOKIE='siren_admin_token=...' node scripts/ai-verify-all.mjs

const COOKIE = process.env.AI_COOKIE;
if (!COOKIE) { console.error("AI_COOKIE env not set"); process.exit(1); }
const BASE = process.env.AI_BASE || "https://tbfa.co.kr/api/admin-ai-agent";

const bundles = [
  { id: 1,  name: "회원",            cmds: ["회원 통계 보여줘", "박새로이 찾아줘"] },
  { id: 2,  name: "후원",            cmds: ["후원 통계", "최근 후원 5건"] },
  { id: 3,  name: "SIREN 신고",      cmds: ["사건 신고 목록", "악성민원 목록"] },
  { id: 4,  name: "법률상담",        cmds: ["법률 상담 목록"] },
  { id: 5,  name: "게시판·공지",     cmds: ["공지 목록", "게시글 목록"] },
  { id: 6,  name: "캠페인",          cmds: ["캠페인 목록"] },
  { id: 7,  name: "콘텐츠·자료",     cmds: ["FAQ 보여줘", "자료실 목록"] },
  { id: 8,  name: "알림 템플릿",     cmds: ["발송 템플릿 목록", "수신자 그룹"] },
  { id: 9,  name: "잠재 후원자",     cmds: ["잠재 후원자 목록"] },
  { id: 10, name: "예산·후원정책",   cmds: ["올해 예산", "후원 정책 보여줘"] },
  { id: 11, name: "재정 22-A",       cmds: ["수입 카테고리", "매출 내역 이번달"] },
  { id: 12, name: "지출 22-C",       cmds: ["지출 카테고리", "이번 달 지출"] },
  { id: 13, name: "손익",            cmds: ["운영성과 보고서"] },
  { id: 14, name: "예산안·전표",     cmds: ["차년도 예산안", "전표 목록"] },
  { id: 15, name: "통장 대사",       cmds: ["통장 대사 현황"] },
  { id: 16, name: "채팅",            cmds: ["미답변 채팅방 목록"] },
  { id: 17, name: "워크스페이스",    cmds: ["내 작업 목록", "내 메모"] },
  { id: 18, name: "캘린더·알림",     cmds: ["이번 주 일정", "최근 알림"] },
  { id: 19, name: "발송 (★ fix)",    cmds: ["박새로이에게 메일 보내줘. 제목 테스트, 내용 검증 메일"] },
  { id: 20, name: "종합 KPI",        cmds: ["대시보드 KPI"] },
  { id: 21, name: "보안·감사",       cmds: ["최근 감사 로그", "최근 로그인 24시간"] },
];

async function call(userMessage, conversationId) {
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": COOKIE },
      body: JSON.stringify({ userMessage, conversationId }),
    });
    text = await res.text();
  } catch (e) {
    return { error: "fetch-failed:" + String(e?.message || e), elapsedMs: Date.now() - t0 };
  }
  let j;
  try { j = JSON.parse(text); } catch { return { status: res.status, error: "non-json", raw: text.slice(0, 300), elapsedMs: Date.now() - t0 }; }
  return {
    status: res.status,
    elapsedMs: Date.now() - t0,
    conversationId: j.conversationId ?? null,
    reply: typeof j.reply === "string" ? j.reply : null,
    toolCalls: Array.isArray(j.toolCalls) ? j.toolCalls.map(tc => ({
      name: tc.name,
      ok: tc?.result?.ok,
      error: tc?.result?.error || null,
      preview: tc?.result?.preview || null,
      argsKeys: tc?.args ? Object.keys(tc.args) : [],
    })) : [],
    pendingApproval: !!j.pendingApproval,
    error: j.error || null,
  };
}

const allResults = [];
for (const b of bundles) {
  console.log(`\n=== [${b.id}] ${b.name} ===`);
  let convId = null;
  const bundleRes = { id: b.id, name: b.name, calls: [] };
  for (const cmd of b.cmds) {
    const r = await call(cmd, convId);
    if (r.conversationId) convId = r.conversationId;
    const toolSummary = (r.toolCalls || []).map(tc => `${tc.name}=${tc.ok ? "OK" : "FAIL"}${tc.error ? "[" + tc.error.slice(0,80) + "]" : ""}`).join(", ");
    console.log(`  "${cmd}" -> ${r.status} (${r.elapsedMs}ms) tools:[${toolSummary}] reply: ${(r.reply || "").slice(0, 100).replace(/\n/g, " ")}`);
    bundleRes.calls.push({ cmd, ...r });
  }
  allResults.push(bundleRes);
}

const fs = await import("node:fs");
fs.writeFileSync("scripts/ai-verify-results.json", JSON.stringify(allResults, null, 2));
console.log("\n=== 저장: scripts/ai-verify-results.json ===");

// 요약 표
const totalCalls = allResults.reduce((a, b) => a + b.calls.length, 0);
const totalTools = allResults.reduce((a, b) => a + b.calls.reduce((x, c) => x + (c.toolCalls?.length || 0), 0), 0);
const failedTools = [];
for (const b of allResults) {
  for (const c of b.calls) {
    for (const tc of (c.toolCalls || [])) {
      if (tc.ok !== true) failedTools.push({ bundle: b.name, cmd: c.cmd, tool: tc.name, error: tc.error });
    }
    if (c.toolCalls?.length === 0 && c.status === 200 && !c.error) {
      // no tool call - AI replied without invoking
      failedTools.push({ bundle: b.name, cmd: c.cmd, tool: "(no-tool-call)", error: "reply only: " + (c.reply || "").slice(0, 80) });
    }
  }
}
console.log(`\n=== 요약 ===`);
console.log(`묶음: ${allResults.length}, 명령: ${totalCalls}, 도구 호출: ${totalTools}, 이슈: ${failedTools.length}`);
if (failedTools.length) {
  console.log(`\n이슈 목록:`);
  for (const f of failedTools) console.log(` - [${f.bundle}] "${f.cmd}" → ${f.tool}: ${(f.error || "").slice(0, 120)}`);
}
