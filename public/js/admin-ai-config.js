/* admin-ai-config.js v3 */

// ── mock (B 머지 전 사용 · B 머지 완료로 실 API 전환) ──
const USE_RAG_MOCK = false;

const MOCK_RAG_STATUS = {
  ok: true,
  data: {
    total: 540,
    byType: { qna: 311, manual: 229 },
    lastIndexedAt: "2026-05-26T05:00:00Z",
    enabled: true
  }
};

const MOCK_RAG_SEARCH = {
  ok: true,
  data: {
    hits: [
      { title: "기부금 영수증 발급", sourceType: "qna", sourceRef: "qna#124", score: 0.91, snippet: "연말 1~2월 일괄 발급되며..." },
      { title: "영수증 재발급 방법",   sourceType: "qna", sourceRef: "qna#125", score: 0.87, snippet: "마이페이지 → 후원 내역..." },
      { title: "메뉴얼 — 기부금 영수증", sourceType: "manual", sourceRef: "manual#receipt", score: 0.82, snippet: "어드민 → 후원 → 영수증..." }
    ]
  }
};

const MOCK_RAG_REINDEX = {
  ok: true,
  data: { indexed: 540, qna: 311, manual: 229, elapsedMs: 42000 }
};
// ─────────────────────────────────────────────────────────────────────────────

const API         = "/api/admin-ai-config";
const FEATURE_API = "/api/admin-ai-features";
const RAG_STATUS_API  = "/api/admin-rag-status";
const RAG_REINDEX_API = "/api/admin-rag-reindex";

let originalPrompt  = "";
let currentCategory = "all";
let allTools        = [];

// ── 공통 유틸 ──────────────────────────────────────────────────────────────
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show " + type;
  setTimeout(() => el.classList.remove("show"), 2400);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );
}

async function apiFetch(url, opts = {}) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    ...(opts.body && typeof opts.body !== "string"
      ? { body: JSON.stringify(opts.body) }
      : {})
  });
  if (r.status === 401 || r.status === 403) {
    window.location.href = "/admin.html";
    throw new Error("auth");
  }
  return r.json();
}

// ── 기존 기능: AI 설정 로드 ─────────────────────────────────────────────────
async function loadConfig() {
  try {
    const data = await apiFetch(API);
    if (!data.ok) { toast("불러오기 실패: " + (data.error || ""), "error"); return; }

    originalPrompt = data.systemPrompt || "";
    document.getElementById("systemPrompt").value = originalPrompt;
    updatePromptStats();

    allTools = data.tools || [];
    renderTools();
  } catch (e) {
    if (e.message !== "auth") toast("네트워크 오류", "error");
  }
}

// ── 시스템 프롬프트 ─────────────────────────────────────────────────────────
const ta      = document.getElementById("systemPrompt");
const btnSave = document.getElementById("btnSavePrompt");
const btnReset = document.getElementById("btnReset");

ta.addEventListener("input", () => {
  updatePromptStats();
  btnSave.disabled = ta.value === originalPrompt;
});

function updatePromptStats() {
  const len   = ta.value.length;
  const stats = document.getElementById("promptStats");
  stats.textContent = `${len.toLocaleString()} 자 / 30~8,000자`;
  stats.style.color = (len < 30 || len > 8000) ? "#b91c1c" : "#64748b";
}

btnReset.addEventListener("click", () => {
  ta.value = originalPrompt;
  updatePromptStats();
  btnSave.disabled = true;
});

btnSave.addEventListener("click", async () => {
  const value = ta.value.trim();
  if (value.length < 30 || value.length > 8000) {
    toast("30~8,000자 범위에 맞춰주세요", "error"); return;
  }
  btnSave.disabled = true;
  try {
    const d = await apiFetch(API, { method: "POST", body: { systemPrompt: value } });
    if (d.ok) {
      toast("시스템 프롬프트 저장됨", "success");
      originalPrompt = value;
    } else {
      toast("저장 실패: " + (d.error || ""), "error");
      btnSave.disabled = false;
    }
  } catch (e) {
    if (e.message !== "auth") toast("네트워크 오류", "error");
    btnSave.disabled = false;
  }
});

// ── 도구 표 ─────────────────────────────────────────────────────────────────
document.getElementById("categoryTabs").addEventListener("click", e => {
  const btn = e.target.closest("button[data-cat]");
  if (!btn) return;
  document.querySelectorAll("#categoryTabs button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentCategory = btn.dataset.cat;
  renderTools();
});

function renderTools() {
  const tbody    = document.getElementById("toolsTbody");
  const filtered = currentCategory === "all"
    ? allTools
    : allTools.filter(t => t.category === currentCategory);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">해당 카테고리 도구 없음</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(t => `
    <tr data-name="${t.toolName}">
      <td>
        <div style="font-weight:500">${escapeHtml(t.toolName)}</div>
        <div style="font-size:11.5px;color:#94a3b8;margin-top:2px">${escapeHtml(t.description || "")}</div>
      </td>
      <td><span class="cat-badge ${t.category || ''}">${t.category || '-'}</span></td>
      <td>${t.isMutation ? '<span class="tool-mutation">변경</span>' : '읽기'}</td>
      <td>
        <select class="role-select">
          <option value="" ${!t.requiredRole ? 'selected' : ''}>모든 어드민</option>
          <option value="admin" ${t.requiredRole === 'admin' ? 'selected' : ''}>관리자</option>
          <option value="super_admin" ${t.requiredRole === 'super_admin' ? 'selected' : ''}>슈퍼관리자</option>
        </select>
      </td>
      <td style="text-align:center">
        <label class="toggle">
          <input type="checkbox" ${t.enabled ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("tr").forEach(tr => {
    const name   = tr.dataset.name;
    const toggle = tr.querySelector('input[type="checkbox"]');
    const sel    = tr.querySelector(".role-select");

    toggle.addEventListener("change", async () => {
      toggle.disabled = true;
      try {
        const d = await apiFetch(API, {
          method: "POST",
          body: { toolName: name, enabled: toggle.checked }
        });
        if (d.ok) {
          toast((toggle.checked ? "활성화 " : "비활성화 ") + name, "success");
          const t = allTools.find(x => x.toolName === name);
          if (t) t.enabled = toggle.checked;
        } else {
          toggle.checked = !toggle.checked;
          toast("변경 실패: " + (d.error || ""), "error");
        }
      } catch (e) {
        toggle.checked = !toggle.checked;
        if (e.message !== "auth") toast("네트워크 오류", "error");
      }
      toggle.disabled = false;
    });

    sel.addEventListener("change", async () => {
      const oldVal = sel.dataset.orig || "";
      sel.disabled = true;
      try {
        const d = await apiFetch(API, {
          method: "POST",
          body: { toolName: name, requiredRole: sel.value || null }
        });
        if (d.ok) {
          toast("권한 변경: " + name + " → " + sel.options[sel.selectedIndex].text, "success");
          sel.dataset.orig = sel.value;
          const t = allTools.find(x => x.toolName === name);
          if (t) t.requiredRole = sel.value || null;
        } else {
          sel.value = oldVal;
          toast("변경 실패: " + (d.error || ""), "error");
        }
      } catch (e) {
        sel.value = oldVal;
        if (e.message !== "auth") toast("네트워크 오류", "error");
      }
      sel.disabled = false;
    });

    sel.dataset.orig = sel.value;
  });
}

// ── RAG 검색 섹션 ────────────────────────────────────────────────────────────
const ragToggle  = document.getElementById("ragToggle");
const ragStatus  = document.getElementById("ragStatus");
const btnReindex = document.getElementById("btnReindex");
const reindexMsg = document.getElementById("reindexMsg");
const ragQuery   = document.getElementById("ragQuery");
const btnSearch  = document.getElementById("btnRagSearch");
const ragHits    = document.getElementById("ragHits");

// ① 페이지 진입 → 색인 현황 + 토글 상태 로드
async function loadRagStatus() {
  try {
    const d = USE_RAG_MOCK
      ? MOCK_RAG_STATUS
      : await apiFetch(RAG_STATUS_API);

    const data = d.data || d;
    ragToggle.checked = !!data.enabled;
    renderRagStatus(data);
  } catch (e) {
    if (e.message !== "auth") ragStatus.innerHTML = '<span style="color:#b91c1c">현황 불러오기 실패</span>';
  }
}

function renderRagStatus(data) {
  const qna     = data.byType?.qna    ?? "-";
  const manual  = data.byType?.manual ?? "-";
  const total   = data.total          ?? "-";
  const lastAt  = data.lastIndexedAt
    ? new Date(data.lastIndexedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "-";

  ragStatus.innerHTML = `
    <div class="rag-stat-row">
      <div class="rag-stat-item">
        <span class="rag-stat-label">Q&amp;A</span>
        <span class="rag-stat-value">${escapeHtml(String(qna))}개</span>
      </div>
      <div class="rag-stat-item">
        <span class="rag-stat-label">메뉴얼</span>
        <span class="rag-stat-value">${escapeHtml(String(manual))}개</span>
      </div>
      <div class="rag-stat-item">
        <span class="rag-stat-label">총 문서</span>
        <span class="rag-stat-value">${escapeHtml(String(total))}개</span>
      </div>
      <div class="rag-stat-item">
        <span class="rag-stat-label">최근 재색인</span>
        <span class="rag-stat-value" style="font-size:13px;font-weight:500">${escapeHtml(lastAt)}</span>
      </div>
    </div>
  `;
}

// ② RAG 토글 변경 → featureKey 저장
ragToggle.addEventListener("change", async () => {
  ragToggle.disabled = true;
  try {
    const d = await apiFetch(FEATURE_API, {
      method: "POST",
      body: { featureKey: "ai_rag_search", enabled: ragToggle.checked }
    });
    if (d.ok) {
      toast("RAG 검색 설정 저장됨", "success");
    } else {
      ragToggle.checked = !ragToggle.checked;
      toast("저장 실패: " + (d.error || d.detail || ""), "error");
    }
  } catch (e) {
    ragToggle.checked = !ragToggle.checked;
    if (e.message !== "auth") toast("네트워크 오류", "error");
  }
  ragToggle.disabled = false;
});

// ③ 전체 재색인 — 백그라운드 실행(즉시 시작 응답) 후 현황 폴링
let reindexPollTimer = null;

btnReindex.addEventListener("click", async () => {
  if (btnReindex.disabled) return;
  btnReindex.disabled = true;
  reindexMsg.textContent = "색인 중… (백그라운드 실행, 수십 초 소요·현황 자동 갱신)";

  try {
    const d = USE_RAG_MOCK
      ? await mockDelay(MOCK_RAG_REINDEX, 1200)
      : await apiFetch(RAG_REINDEX_API, { method: "POST" });

    if (d.ok) {
      toast("재색인을 시작했습니다 — 현황이 자동으로 갱신됩니다", "success");
      pollReindexProgress();
    } else {
      toast("재색인 시작 실패: " + (d.error || d.detail || ""), "error");
      reindexMsg.textContent = "";
      btnReindex.disabled = false;
    }
  } catch (e) {
    if (e.message !== "auth") toast("재색인 오류", "error");
    reindexMsg.textContent = "";
    btnReindex.disabled = false;
  }
});

// 백그라운드 색인 진행 폴링 — 문서 수가 안정될 때까지 현황 주기 갱신
function pollReindexProgress() {
  if (reindexPollTimer) clearInterval(reindexPollTimer);
  let lastTotal = -1;
  let stableCount = 0;
  let ticks = 0;

  reindexPollTimer = setInterval(async () => {
    ticks++;
    try {
      const d = await apiFetch(RAG_STATUS_API);
      const data = d.data || d;
      renderRagStatus(data);
      const total = data.total ?? 0;

      if (total === lastTotal && total > 0) {
        stableCount++;
      } else {
        stableCount = 0;
      }
      lastTotal = total;

      // 문서 수가 3회 연속 동일 + 0 초과 → 색인 완료로 간주
      if (stableCount >= 3) {
        clearInterval(reindexPollTimer);
        reindexPollTimer = null;
        reindexMsg.textContent = "";
        btnReindex.disabled = false;
        toast(`색인 완료 — 총 ${total}개 문서`, "success");
      }
    } catch (e) {
      // 폴링 실패는 다음 tick에서 재시도
    }

    // 안전 상한 — 최대 약 5분(60틱 × 5초) 후 폴링 중단
    if (ticks >= 60) {
      clearInterval(reindexPollTimer);
      reindexPollTimer = null;
      reindexMsg.textContent = "";
      btnReindex.disabled = false;
    }
  }, 5000);
}

// ④ 검색 테스트
btnSearch.addEventListener("click", () => runRagSearch());
ragQuery.addEventListener("keydown", e => { if (e.key === "Enter") runRagSearch(); });

async function runRagSearch() {
  const query = ragQuery.value.trim();
  if (!query) return;

  btnSearch.disabled = true;
  ragHits.innerHTML  = '<div style="font-size:13px;color:#64748b">검색 중…</div>';

  try {
    const d = USE_RAG_MOCK
      ? await mockDelay(MOCK_RAG_SEARCH, 600)
      : await apiFetch(RAG_STATUS_API, { method: "POST", body: { query } });

    const hits = d.data?.hits || [];
    if (hits.length === 0) {
      ragHits.innerHTML = '<div style="font-size:13px;color:#64748b">검색 결과가 없습니다</div>';
    } else {
      ragHits.innerHTML = '<div class="rag-hits">' + hits.map(h => `
        <div class="rag-hit">
          <div class="rag-hit-header">
            <span class="source-badge ${escapeHtml(h.sourceType)}">${escapeHtml(h.sourceType)}</span>
            <span class="rag-hit-title">${escapeHtml(h.title)}</span>
            <span class="rag-hit-score">유사도 ${escapeHtml(String(h.score))}</span>
          </div>
          <div class="rag-hit-snippet">${escapeHtml(h.snippet)}</div>
        </div>
      `).join("") + "</div>";
    }
  } catch (e) {
    if (e.message !== "auth") ragHits.innerHTML = '<div style="font-size:13px;color:#b91c1c">검색 오류</div>';
  }
  btnSearch.disabled = false;
}

// mock 딜레이 헬퍼 (B 머지 후 제거)
function mockDelay(data, ms) {
  return new Promise(resolve => setTimeout(() => resolve(data), ms));
}

// ── 초기 로드 ────────────────────────────────────────────────────────────────
loadConfig();
loadRagStatus();
