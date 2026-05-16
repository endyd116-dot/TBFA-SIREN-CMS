#!/usr/bin/env node
// A안 전화 인증 흐름 라이브 검증
// Usage: node scripts/phone-verify-test.mjs <send|check|signup|raw> <body-json>

const BASE = "https://tbfa.co.kr";
const endpoint = process.argv[2];
const bodyJson = process.argv[3] || "{}";

const pathMap = {
  send: "/api/auth/phone-verify-send",
  check: "/api/auth/phone-verify-check",
  signup: "/api/auth/signup",
};

const path = pathMap[endpoint] || endpoint;
const url = BASE + path;

(async () => {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyJson,
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { j = { _raw: text.slice(0, 400) }; }
  console.log(`[${res.status}] ${ms}ms ${url}`);
  console.log(JSON.stringify(j, null, 2));
})().catch(e => { console.error("FETCH ERR:", e); process.exit(1); });
