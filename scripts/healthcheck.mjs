#!/usr/bin/env node
/**
 * SIREN 핵심 API 헬스체크 스크립트 (Phase 19)
 *
 * 사용법:
 *   HC_BASE_URL=https://tbfa-siren-cms.netlify.app \
 *   HC_ADMIN_ID=admin@example.com \
 *   HC_ADMIN_PW=secret \
 *   node scripts/healthcheck.mjs
 *
 * 종료 코드: 실패 1건 이상 시 1, 모두 통과 시 0.
 */

const RESPONSE_TIME_LIMIT_MS = 3000;

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(msg) {
  process.stdout.write(msg + "\n");
}

function err(msg) {
  process.stderr.write(msg + "\n");
}

/* ───────── 환경변수 검증 ───────── */
const BASE_URL = process.env.HC_BASE_URL;
const ADMIN_ID = process.env.HC_ADMIN_ID;
const ADMIN_PW = process.env.HC_ADMIN_PW;

if (!BASE_URL || !ADMIN_ID || !ADMIN_PW) {
  err(`${COLORS.red}❌ 환경변수가 누락되었습니다.${COLORS.reset}`);
  err("");
  err("필수 환경변수:");
  err("  HC_BASE_URL  — 라이브 URL (예: https://tbfa-siren-cms.netlify.app)");
  err("  HC_ADMIN_ID  — 어드민 이메일");
  err("  HC_ADMIN_PW  — 어드민 비밀번호");
  err("");
  err("실행 예시:");
  err('  HC_BASE_URL=https://tbfa-siren-cms.netlify.app \\');
  err('  HC_ADMIN_ID=admin@example.com \\');
  err('  HC_ADMIN_PW=secret \\');
  err("  node scripts/healthcheck.mjs");
  process.exit(1);
}

const baseUrl = BASE_URL.replace(/\/+$/, "");

/* ───────── 체크 대상 ───────── */
// 각 항목의 path는 해당 함수가 export const config = { path } 로 등록한 실제 경로.
// 함수마다 슬래시(/api/admin/X) 또는 하이픈(/api/admin-X) 스타일이 섞여 있으므로 구현부 기준으로 맞춤.
const PROTECTED_ENDPOINTS = [
  { name: "GET /api/admin/me",                  path: "/api/admin/me" },
  { name: "GET /api/admin/members",             path: "/api/admin/members" },
  { name: "GET /api/admin/donations",           path: "/api/admin/donations" },
  { name: "GET /api/admin/donation-dashboard",  path: "/api/admin/donation-dashboard" },
  { name: "GET /api/admin-members-source-kpi",  path: "/api/admin-members-source-kpi" },
  { name: "GET /api/admin/incident-reports",    path: "/api/admin/incident-reports" },
  { name: "GET /api/admin/harassment-reports",  path: "/api/admin/harassment-reports" },
  { name: "GET /api/admin/support",             path: "/api/admin/support" },
  { name: "GET /api/admin-agency-list",         path: "/api/admin-agency-list" },
  { name: "GET /api/admin-expert-profile-get",  path: "/api/admin-expert-profile-get?all=true" },
  { name: "GET /api/admin-dashboard-kpi",       path: "/api/admin-dashboard-kpi" },
  { name: "GET /api/admin-audit-list",          path: "/api/admin-audit-list" },
  { name: "GET /api/admin-send-jobs-list",      path: "/api/admin-send-jobs-list" },
];

/* ───────── HTTP 헬퍼 ───────── */
async function timedFetch(url, options = {}) {
  const start = Date.now();
  let res;
  let error = null;
  try {
    res = await fetch(url, { ...options, redirect: "manual" });
  } catch (e) {
    error = e;
  }
  const elapsed = Date.now() - start;
  return { res, elapsed, error };
}

function extractCookies(setCookieHeader) {
  if (!setCookieHeader) return "";
  const parts = setCookieHeader.split(/,(?=[^;]+?=)/);
  return parts
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/* ───────── 결과 누적 ───────── */
const results = [];

function record(name, expected, actualCode, elapsed, ok, note = "") {
  results.push({ name, expected, actualCode, elapsed, ok, note });
}

/* ───────── 메인 ───────── */
const overallStart = Date.now();

log(`${COLORS.cyan}${COLORS.bold}SIREN 헬스체크 시작${COLORS.reset}`);
log(`대상: ${baseUrl}`);
log("");

/* 1) 인증 전 401 체크 */
log(`${COLORS.bold}[1/3] 인증 전 401 체크 (${PROTECTED_ENDPOINTS.length}건)${COLORS.reset}`);
for (const ep of PROTECTED_ENDPOINTS) {
  const { res, elapsed, error } = await timedFetch(`${baseUrl}${ep.path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (error) {
    record(`${ep.name} (인증전)`, 401, 0, elapsed, false, error.message);
    continue;
  }
  const code = res.status;
  const ok = code === 401;
  record(`${ep.name} (인증전)`, 401, code, elapsed, ok);
}

/* 2) 로그인 */
log("");
log(`${COLORS.bold}[2/3] 어드민 로그인${COLORS.reset}`);
const loginStart = Date.now();
let cookieHeader = "";
let loginOk = false;
try {
  const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    // 어드민 로그인 검증 스키마는 { id, password }를 받음 (id에는 어드민 이메일도 사용 가능)
    body: JSON.stringify({ id: ADMIN_ID, password: ADMIN_PW }),
    redirect: "manual",
  });
  const loginElapsed = Date.now() - loginStart;
  if (loginRes.status !== 200) {
    const body = await loginRes.text().catch(() => "");
    err(`${COLORS.red}❌ 로그인 실패 — status=${loginRes.status}${COLORS.reset}`);
    err(`응답 본문(요약): ${body.slice(0, 300)}`);
    record("POST /api/admin/login", 200, loginRes.status, loginElapsed, false, "로그인 실패");
    printSummary();
    process.exit(1);
  }
  cookieHeader = extractCookies(loginRes.headers.get("set-cookie"));
  if (!cookieHeader) {
    err(`${COLORS.red}❌ 로그인 응답에 쿠키가 없습니다.${COLORS.reset}`);
    record("POST /api/admin/login", 200, loginRes.status, loginElapsed, false, "쿠키 없음");
    printSummary();
    process.exit(1);
  }
  record("POST /api/admin/login", 200, loginRes.status, loginElapsed, loginElapsed <= RESPONSE_TIME_LIMIT_MS);
  loginOk = true;
  log(`  ${COLORS.green}✅ 로그인 성공 (${loginElapsed}ms)${COLORS.reset}`);
} catch (e) {
  err(`${COLORS.red}❌ 로그인 중 예외 — ${e.message}${COLORS.reset}`);
  process.exit(1);
}

/* 3) 인증 후 200 체크 */
log("");
log(`${COLORS.bold}[3/3] 인증 후 200 체크 (${PROTECTED_ENDPOINTS.length}건)${COLORS.reset}`);
for (const ep of PROTECTED_ENDPOINTS) {
  const { res, elapsed, error } = await timedFetch(`${baseUrl}${ep.path}`, {
    method: "GET",
    headers: { Accept: "application/json", Cookie: cookieHeader },
  });
  if (error) {
    record(`${ep.name} (인증후)`, 200, 0, elapsed, false, error.message);
    continue;
  }
  const code = res.status;
  const codeOk = code === 200;
  const timeOk = elapsed <= RESPONSE_TIME_LIMIT_MS;
  const ok = codeOk && timeOk;
  const note = codeOk ? (timeOk ? "" : `응답시간 ${RESPONSE_TIME_LIMIT_MS}ms 초과`) : "";
  record(`${ep.name} (인증후)`, 200, code, elapsed, ok, note);
}

/* 4) 로그아웃 (정리) */
if (loginOk) {
  try {
    const logoutStart = Date.now();
    const logoutRes = await fetch(`${baseUrl}/api/admin/logout`, {
      method: "POST",
      headers: { Accept: "application/json", Cookie: cookieHeader },
      redirect: "manual",
    });
    const logoutElapsed = Date.now() - logoutStart;
    const code = logoutRes.status;
    const ok = code === 200;
    record("POST /api/admin/logout", 200, code, logoutElapsed, ok);
  } catch (e) {
    record("POST /api/admin/logout", 200, 0, 0, false, e.message);
  }
}

printSummary();

/* ───────── 출력 ───────── */
function pad(s, w) {
  s = String(s);
  // 한글 폭 보정 (한글 한 글자 = 2칸)
  let visualLen = 0;
  for (const ch of s) {
    visualLen += /[ㄱ-힝]/.test(ch) ? 2 : 1;
  }
  if (visualLen >= w) return s;
  return s + " ".repeat(w - visualLen);
}

function printSummary() {
  log("");
  log(`${COLORS.bold}━━━━━━ 결과 요약 ━━━━━━${COLORS.reset}`);
  const headerName = "API";
  const headerCode = "Code";
  const headerTime = "Time";
  const headerNote = "결과";
  const wName = 50;
  const wCode = 6;
  const wTime = 9;
  const wNote = 8;

  log(
    "┌" + "─".repeat(wName) + "┬" + "─".repeat(wCode) + "┬" + "─".repeat(wTime) + "┬" + "─".repeat(wNote) + "┐"
  );
  log(
    "│" + pad(" " + headerName, wName) +
    "│" + pad(" " + headerCode, wCode) +
    "│" + pad(" " + headerTime, wTime) +
    "│" + pad(" " + headerNote, wNote) + "│"
  );
  log(
    "├" + "─".repeat(wName) + "┼" + "─".repeat(wCode) + "┼" + "─".repeat(wTime) + "┼" + "─".repeat(wNote) + "┤"
  );

  let pass = 0;
  let fail = 0;
  for (const r of results) {
    const codeStr = r.actualCode ? String(r.actualCode) : "ERR";
    const timeStr = r.elapsed ? `${r.elapsed}ms` : "-";
    const mark = r.ok ? `${COLORS.green}✅${COLORS.reset}` : `${COLORS.red}❌${COLORS.reset}`;
    log(
      "│" + pad(" " + r.name, wName) +
      "│" + pad(" " + codeStr, wCode) +
      "│" + pad(" " + timeStr, wTime) +
      "│" + pad(" " + mark, wNote + (r.ok ? COLORS.green.length + COLORS.reset.length : COLORS.red.length + COLORS.reset.length)) + "│"
    );
    if (r.note) {
      log("│" + pad("    └ " + r.note, wName + wCode + wTime + wNote + 3) + "│");
    }
    if (r.ok) pass++; else fail++;
  }
  log(
    "└" + "─".repeat(wName) + "┴" + "─".repeat(wCode) + "┴" + "─".repeat(wTime) + "┴" + "─".repeat(wNote) + "┘"
  );

  const totalElapsed = Date.now() - overallStart;
  const total = results.length;
  if (fail === 0) {
    log("");
    log(`${COLORS.green}${COLORS.bold}결과: ${pass}/${total} PASS${COLORS.reset} (총 소요: ${totalElapsed}ms)`);
    process.exit(0);
  } else {
    log("");
    log(`${COLORS.red}${COLORS.bold}결과: ${pass}/${total} PASS, ${fail}건 실패${COLORS.reset} (총 소요: ${totalElapsed}ms)`);
    process.exit(1);
  }
}
