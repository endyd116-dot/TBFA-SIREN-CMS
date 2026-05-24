/* admin-org-news.js v=4-incidents — 여론·뉴스 분석 어드민 프론트 */

/* ── api 헬퍼 ── */
async function api(path, opts) {
  opts = opts || {};
  var fetchOpts = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (opts.body !== undefined) fetchOpts.body = JSON.stringify(opts.body);
  var res = await fetch(path, fetchOpts);
  var data;
  try { data = await res.json(); } catch(_) { data = {}; }
  return { ok: res.ok, status: res.status, data: data };
}

/* ── 토스트 ── */
var _toastTimer = null;
function showToast(msg, type) {
  var el = document.getElementById('toastEl');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.className = 'toast'; }, 3200);
}

/* ── 로딩 오버레이 ── */
function showLoading(v) {
  var el = document.getElementById('loadingOverlay');
  if (el) el.style.display = v ? 'flex' : 'none';
}

/* ── 탭 전환 ── */
function switchTab(name) {
  document.querySelectorAll('.adm-tab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.panel === name);
  });
  document.querySelectorAll('.adm-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'panel' + name.charAt(0).toUpperCase() + name.slice(1));
  });
  if (name === 'history' && !_historyLoaded) loadHistory();
  if (name === 'settings') loadSettings();
}

/* ── 긴급도 배지 ── */
function urgencyBadge(urgency) {
  var cls = { '높음': 'urg-high', '보통': 'urg-mid', '낮음': 'urg-low' };
  var label = urgency || '낮음';
  return '<span class="badge badge-' + (cls[label] || 'urg-low') + '">' + esc(label) + '</span>';
}

/* ── 🚨 교육계 사망·사건사고 카드 (협회 관심·지원 대상·빠른 파악용) ── */
function renderIncidentsCard(incidents) {
  var html = '<div class="card" style="border:1px solid #fecaca;background:#fff7f7">';
  html += '<div class="card-title">🚨 교육계 사망·사건사고 — 협회 관심·지원 대상</div>';
  if (!incidents || incidents.length === 0) {
    html += '<div style="text-align:center;padding:20px 0;color:#9ca3af;font-size:13px">최근 협회가 도울 만한 교육계 사건이 없습니다. (🔄 최신 재조사로 갱신)</div>';
    return html + '</div>';
  }
  var urgOrder = { '높음': 0, '보통': 1, '낮음': 2 };
  var sorted = incidents.slice().sort(function(a, b) {
    var ua = urgOrder[a.urgency] != null ? urgOrder[a.urgency] : 9;
    var ub = urgOrder[b.urgency] != null ? urgOrder[b.urgency] : 9;
    if (ua !== ub) return ua - ub;
    return (b.relevance || 0) - (a.relevance || 0);
  });
  sorted.forEach(function(inc) {
    html += '<div class="incident-card">';
    html += '<div class="incident-card-header">';
    html += urgencyBadge(inc.urgency);
    if (inc.incidentType) html += '<span class="stat-chip">' + esc(inc.incidentType) + '</span>';
    html += '<span class="incident-relevance">관련도 ' + (inc.relevance != null ? inc.relevance : '—') + '%</span>';
    html += '</div>';
    html += '<a class="incident-title" href="' + esc(inc.link || '#') + '" target="_blank" rel="noopener">' + esc(inc.title) + '</a>';
    var meta = [];
    if (inc.source) meta.push('#' + esc(inc.source));
    if (inc.pubDate) meta.push(esc(fmtDateShort(inc.pubDate)));
    if (meta.length) html += '<div class="incident-meta">' + meta.join(' · ') + '</div>';
    if (inc.affected) html += '<div class="incident-action" style="background:#fef2f2;color:#991b1b">🧑‍🤝‍🧑 도움 대상: <b>' + esc(inc.affected) + '</b></div>';
    if (inc.reason) html += '<div class="incident-reason">📌 ' + esc(inc.reason) + '</div>';
    if (inc.suggestedAction) html += '<div class="incident-action">💬 지원 방안: ' + esc(inc.suggestedAction) + '</div>';
    html += '</div>';
  });
  return html + '</div>';
}

/* ── 여론 배지 ── */
function sentimentBadge(label) {
  /* 백엔드 label은 영문(positive/neutral/negative/mixed), 설계 계약은 한글 — 양쪽 모두 수용해 한글로 표시 */
  var toKo = { positive: '긍정', neutral: '중립', negative: '부정', mixed: '혼조',
               '긍정': '긍정', '중립': '중립', '부정': '부정', '혼조': '혼조' };
  var cls  = { '긍정': 'pos', '중립': 'neu', '부정': 'neg', '혼조': 'mix' };
  var ko = toKo[label] || (label || '알 수 없음');
  return '<span class="badge badge-' + (cls[ko] || 'neu') + '">' + esc(ko) + '</span>';
}

/* ── HTML escape ── */
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── 날짜 포맷 ── */
function fmtDate(s) {
  if (!s) return '';
  var d = new Date(s);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
    + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function fmtDateShort(s) {
  if (!s) return '';
  var d = new Date(s);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/* ── 워드클라우드 렌더 ── */
var _wcRetryCount = 0;
function renderWordCloud(keywords, canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!keywords || keywords.length === 0) {
    canvas.parentElement.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:13px">키워드 데이터 없음</div>';
    return;
  }

  if (window._wcReady && window.WordCloud) {
    var list = keywords.map(function(k) { return [k.text, Math.max(12, Math.min(60, k.weight || 20))]; });
    try {
      WordCloud(canvas, {
        list: list,
        gridSize: 8,
        weightFactor: 1,
        fontFamily: 'Noto Sans KR, sans-serif',
        color: function() {
          var colors = ['#1d4ed8','#0369a1','#047857','#7c3aed','#b45309','#be185d'];
          return colors[Math.floor(Math.random() * colors.length)];
        },
        backgroundColor: '#f8fafc',
        rotateRatio: 0.3,
        minSize: 10
      });
    } catch(e) {
      _renderTagCloud(keywords, canvas.parentElement);
    }
  } else if (_wcRetryCount < 10 && !window._wcFailed) {
    _wcRetryCount++;
    setTimeout(function() { renderWordCloud(keywords, canvasId); }, 300);
  } else {
    _renderTagCloud(keywords, canvas.parentElement);
  }
}

function _renderTagCloud(keywords, container) {
  var max = 0;
  keywords.forEach(function(k) { if ((k.weight||0) > max) max = k.weight; });
  var html = '<div class="tag-cloud">';
  keywords.forEach(function(k) {
    var ratio = max > 0 ? (k.weight || 10) / max : 0.5;
    var sz = Math.round(11 + ratio * 10);
    html += '<span class="tag" style="font-size:' + sz + 'px">' + esc(k.text) + '</span>';
  });
  html += '</div>';
  container.innerHTML = html;
}

/* ── 보고서 HTML 렌더 ── */
function renderReport(report) {
  if (!report) {
    return '<div class="empty-state">보고서가 없습니다. "최신 재조사"를 눌러 생성하세요.</div>';
  }

  var kc = report.keywordCloud || report.keyword_cloud || [];
  var recs = report.recommendations || [];
  /* 서버(B)는 수집 기사를 items 로 반환. 계약 표기(sources)도 폴백 유지 */
  var sources = report.sources || report.items || [];
  /* incidents: 다중 fallback */
  var incidents = (report.incidents) ||
                  (report.data && report.data.incidents) ||
                  [];
  var sentiment = report.sentiment || {};
  var srcCount = report.sourceCount || report.source_count || report.collectedCount || 0;
  var genAt = report.generatedAt || report.generated_at || report.createdAt || report.created_at;
  var periodFrom = report.periodFrom || report.period_from;
  var periodTo = report.periodTo || report.period_to;

  var html = '';

  /* 상단 메타 */
  html += '<div class="card" style="margin-bottom:12px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">';
  html += '<div>';
  html += '<div style="font-size:13px;color:#6b7280;margin-bottom:6px">';
  if (periodFrom || periodTo) {
    html += '수집 기간: <b>' + esc(fmtDateShort(periodFrom)) + ' ~ ' + esc(fmtDateShort(periodTo)) + '</b> &nbsp;|&nbsp; ';
  }
  html += '수집 건수: <b>' + srcCount + '건</b>';
  html += ' &nbsp;|&nbsp; 생성: <b>' + esc(fmtDate(genAt)) + '</b>';
  var tt = report.triggerType || report.trigger_type;
  html += ' &nbsp;|&nbsp; <span class="stat-chip">' + (tt === 'cron' ? '자동(크론)' : '수동') + '</span>';
  html += '</div>';
  html += '</div>';
  html += '<div>' + sentimentBadge(sentiment.label) + '</div>';
  html += '</div>';
  html += '</div>';

  /* 활동·이슈 요약 */
  html += '<div class="card">';
  html += '<div class="card-title">📋 활동·이슈 요약</div>';
  html += '<p style="font-size:13.5px;line-height:1.8;color:#1e293b;margin:0;white-space:pre-wrap">' + esc(report.summary || '요약 없음') + '</p>';
  html += '</div>';

  /* 여론 상세 */
  if (sentiment.label) {
    html += '<div class="card">';
    html += '<div class="card-title">📊 여론 분석 ' + sentimentBadge(sentiment.label) + '</div>';
    if (sentiment.positive != null || sentiment.neutral != null || sentiment.negative != null) {
      html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">';
      html += '<span class="stat-chip">긍정 ' + (Math.round(sentiment.positive||0)) + '%</span>';
      html += '<span class="stat-chip">중립 ' + (Math.round(sentiment.neutral||0)) + '%</span>';
      html += '<span class="stat-chip">부정 ' + (Math.round(sentiment.negative||0)) + '%</span>';
      html += '</div>';
    }
    if (sentiment.reason) {
      html += '<p style="font-size:13px;color:#374151;margin:0;line-height:1.7">' + esc(sentiment.reason) + '</p>';
    }
    html += '</div>';
  }

  /* 🚨 교육계 사망·사건사고 — 상단 배치(긴 소스 목록에 묻히지 않게·빠른 파악) */
  html += renderIncidentsCard(incidents);

  /* 워드클라우드 */
  html += '<div class="card">';
  html += '<div class="card-title">☁️ 연관 키워드 클라우드</div>';
  html += '<canvas id="wc-canvas" width="600" height="260"></canvas>';
  html += '</div>';

  /* AI 추천 */
  if (recs.length) {
    html += '<div class="card">';
    html += '<div class="card-title">💡 AI 추천 액션</div>';
    recs.forEach(function(r) {
      html += '<div class="rec-card">';
      html += '<div class="rec-card-title">▶ ' + esc(r.title) + '</div>';
      html += '<div class="rec-card-detail">' + esc(r.detail) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  /* 변경점 */
  if (report.diffSummary || report.diff_summary) {
    html += '<div class="card">';
    html += '<div class="card-title">🔄 직전 보고서 대비 변경점</div>';
    html += '<div class="diff-block">' + esc(report.diffSummary || report.diff_summary) + '</div>';
    html += '</div>';
  }

  /* 소스 링크 — 길어서 기본 접힘(사건·사고는 위로 이동) */
  if (sources.length) {
    html += '<div class="card">';
    html += '<details><summary style="cursor:pointer;font-size:14px;font-weight:700;color:#111;outline:none">🔗 수집 소스 목록 (' + sources.length + '건) — 펼치기</summary>';
    html += '<div style="margin-top:10px">';
    sources.forEach(function(s) {
      html += '<div class="source-row">';
      html += '<a class="source-title" href="' + esc(s.link) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>';
      /* 서버(B) 항목은 scope·date 필드 — 계약 표기(sourceType·pubDate)도 폴백 유지 */
      var sType = s.sourceType || s.source_type || s.scope || '';
      var sDate = s.pubDate || s.pub_date || (s.date ? fmtDateShort(s.date) : '');
      html += '<span class="source-meta">' + esc(sType) + ' · ' + esc(sDate) + (s.keyword ? ' · #' + esc(s.keyword) : '') + '</span>';
      if (s.description) {
        html += '<span style="font-size:12.5px;color:#4b5563;line-height:1.5">' + esc(s.description) + '</span>';
      }
      html += '</div>';
    });
    html += '</div></details>';
    html += '</div>';
  }

  return html;
}

/* ── 응답 보고서 추출 ──
   서버(B)는 {ok,data:{...필드 직접}} 평면 구조로 반환하고, 일부는 {data:{report:{...}}} 계약 구조.
   둘 다 수용 — data.report 가 있으면 그것, 없으면 data 자체가 보고서(id 보유 시). */
function extractReport(res) {
  var d = (res && res.data) ? res.data : {};
  var inner = d.data || d;
  return inner.report || (inner && inner.id != null ? inner : null);
}

/* ── 최신 보고서 로드 ── */
var _currentReport = null;
function loadLatestReport() {
  api('/api/admin-org-news-get').then(function(res) {
    var report = extractReport(res);
    if (!res.ok && res.status !== 404) {
      if (res.status === 401 || res.status === 403) {
        document.getElementById('reportBody').innerHTML = '<div class="empty-state">권한이 없습니다.</div>';
        return;
      }
    }
    _currentReport = report;
    document.getElementById('reportBody').innerHTML = renderReport(report);
    if (report) {
      var at = report.generatedAt || report.generated_at || report.createdAt || report.created_at;
      document.getElementById('lastGenAt').textContent = at ? ('마지막 생성: ' + fmtDate(at)) : '';
      setTimeout(function() { renderWordCloud(report.keywordCloud || report.keyword_cloud || [], 'wc-canvas'); }, 100);
    }
  });
}

/* ── 히스토리 ── */
var _historyLoaded = false;
var _reports = [];
function loadHistory() {
  _historyLoaded = true;
  api('/api/admin-org-news-list?limit=60').then(function(res) {
    var reports = (res.data && (res.data.reports || (res.data.data && res.data.data.reports))) || [];
    _reports = reports;
    var cnt = document.getElementById('historyCount');
    if (cnt) cnt.textContent = reports.length + '개';
    var list = document.getElementById('historyList');
    if (!list) return;
    if (!reports.length) {
      list.innerHTML = '<div class="empty-state" style="padding:32px 0">보고서 없음</div>';
      return;
    }
    var html = '';
    reports.forEach(function(r, i) {
      var at = r.generatedAt || r.generated_at || r.createdAt || r.created_at;
      var label = r.sentimentLabel || (r.sentiment && r.sentiment.label) || '';
      var sc = r.sourceCount || r.source_count || r.collectedCount || 0;
      var tt = r.triggerType || r.trigger_type;
      html += '<div class="history-row" data-id="' + r.id + '" data-idx="' + i + '">';
      html += '<span style="font-size:13px;font-weight:600;color:#1d4ed8">#' + r.id + '</span>';
      html += '<span style="font-size:13px;color:#374151;flex:1">' + esc(fmtDate(at)) + '</span>';
      if (label) html += sentimentBadge(label);
      html += '<span class="stat-chip">' + sc + '건</span>';
      html += '<span style="font-size:11px;color:#9ca3af">' + (tt === 'cron' ? '자동' : '수동') + '</span>';
      html += '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.history-row').forEach(function(row) {
      row.addEventListener('click', function() {
        list.querySelectorAll('.history-row').forEach(function(r) { r.classList.remove('selected'); });
        row.classList.add('selected');
        loadHistoryDetail(row.dataset.id);
      });
    });
  });
}

function loadHistoryDetail(id) {
  var detail = document.getElementById('historyDetail');
  if (!detail) return;
  detail.style.display = 'block';
  detail.innerHTML = '<div class="empty-state">보고서 불러오는 중...</div>';
  api('/api/admin-org-news-get?id=' + id).then(function(res) {
    var report = extractReport(res);
    if (!res.ok || !report) {
      detail.innerHTML = '<div class="empty-state">보고서를 불러올 수 없습니다.</div>';
      return;
    }
    detail.innerHTML = '<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px">' + renderReport(report);
    setTimeout(function() { renderWordCloud(report.keywordCloud || report.keyword_cloud || [], 'wc-canvas'); }, 100);
  });
}

/* ── 재조사 ── */
function doRefresh() {
  var btn = document.getElementById('btnRefresh');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 조사 중...'; }
  showLoading(true);
  api('/api/admin-org-news-refresh', { method: 'POST' }).then(function(res) {
    showLoading(false);
    if (btn) { btn.disabled = false; btn.textContent = '🔄 최신 재조사'; }
    if (!res.ok) {
      var msg = (res.data && (res.data.error || (res.data.data && res.data.data.error))) || ('오류 ' + res.status);
      if (res.status === 403) msg = '슈퍼어드민만 재조사를 실행할 수 있습니다.';
      showToast(msg, 'error');
      return;
    }
    showToast('재조사가 완료됐습니다.', 'success');
    _currentReport = extractReport(res);
    if (_currentReport) {
      document.getElementById('reportBody').innerHTML = renderReport(_currentReport);
      var at = _currentReport.generatedAt || _currentReport.generated_at || _currentReport.createdAt || _currentReport.created_at;
      document.getElementById('lastGenAt').textContent = at ? ('마지막 생성: ' + fmtDate(at)) : '';
      setTimeout(function() { renderWordCloud(_currentReport.keywordCloud || _currentReport.keyword_cloud || [], 'wc-canvas'); }, 100);
    }
    /* 히스토리 새로고침 */
    _historyLoaded = false;
  }).catch(function(e) {
    showLoading(false);
    if (btn) { btn.disabled = false; btn.textContent = '🔄 최신 재조사'; }
    showToast('네트워크 오류: ' + e.message, 'error');
  });
}

/* ── 설정 로드/저장 ── */
var _settingsLoaded = false;
var _settings = { keywords: [], scopes: ['news','blog','webkr'], autoEnabled: true };

function loadSettings() {
  if (_settingsLoaded) return;
  api('/api/admin-org-news-settings').then(function(res) {
    _settingsLoaded = true;
    var s = (res.data && (res.data.settings || (res.data.data && res.data.data.settings))) || {};
    _settings = {
      keywords: s.keywords || [],
      scopes: s.scopes || ['news','blog','webkr'],
      autoEnabled: s.autoEnabled != null ? s.autoEnabled : (s.auto_enabled != null ? s.auto_enabled : true)
    };
    renderSettingsUI();
    document.getElementById('tabSettings').style.display = '';
  }).catch(function() {
    /* 403이면 설정 탭 숨김 유지 */
  });
}

function renderSettingsUI() {
  var kwList = document.getElementById('kwTagList');
  if (kwList) {
    kwList.innerHTML = _settings.keywords.map(function(kw) {
      return '<span class="kw-tag">' + esc(kw) + '<button data-kw="' + esc(kw) + '" title="삭제">×</button></span>';
    }).join('');
    kwList.querySelectorAll('button[data-kw]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _settings.keywords = _settings.keywords.filter(function(k) { return k !== btn.dataset.kw; });
        renderSettingsUI();
      });
    });
  }
  ['news','blog','webkr'].forEach(function(scope) {
    var el = document.getElementById('scope' + scope.charAt(0).toUpperCase() + scope.slice(1));
    if (el) el.checked = _settings.scopes.indexOf(scope) !== -1;
  });
  var ae = document.getElementById('autoEnabled');
  if (ae) ae.checked = !!_settings.autoEnabled;
}

function saveSettings() {
  var scopes = ['news','blog','webkr'].filter(function(scope) {
    var el = document.getElementById('scope' + scope.charAt(0).toUpperCase() + scope.slice(1));
    return el && el.checked;
  });
  var ae = document.getElementById('autoEnabled');
  _settings.scopes = scopes;
  _settings.autoEnabled = ae ? ae.checked : true;

  api('/api/admin-org-news-settings', { method: 'PUT', body: { keywords: _settings.keywords, scopes: _settings.scopes, autoEnabled: _settings.autoEnabled } })
    .then(function(res) {
      if (!res.ok) {
        var msg = (res.data && (res.data.error || (res.data.data && res.data.data.error))) || '저장 실패';
        showToast(msg, 'error');
        return;
      }
      showToast('설정이 저장됐습니다.', 'success');
    });
}

/* ── 초기화 ── */
document.addEventListener('DOMContentLoaded', function() {
  /* 탭 전환 */
  document.querySelectorAll('.adm-tab').forEach(function(btn) {
    btn.addEventListener('click', function() { switchTab(btn.dataset.panel); });
  });

  /* 재조사 버튼 */
  var btnRefresh = document.getElementById('btnRefresh');
  if (btnRefresh) btnRefresh.addEventListener('click', doRefresh);

  /* 설정 아이콘 버튼 → 설정 탭 열기 */
  var btnSettings = document.getElementById('btnSettings');
  if (btnSettings) btnSettings.addEventListener('click', function() { switchTab('settings'); });

  /* 설정 저장 */
  var btnSave = document.getElementById('btnSettingsSave');
  if (btnSave) btnSave.addEventListener('click', saveSettings);

  /* 설정 취소 → 최신 보고서 탭으로 */
  var btnCancel = document.getElementById('btnSettingsCancel');
  if (btnCancel) btnCancel.addEventListener('click', function() { switchTab('report'); });

  /* 키워드 추가 */
  function addKeyword() {
    var inp = document.getElementById('kwInput');
    if (!inp) return;
    var val = inp.value.trim();
    if (!val) return;
    if (_settings.keywords.indexOf(val) === -1) {
      _settings.keywords.push(val);
      renderSettingsUI();
    }
    inp.value = '';
  }
  var btnAddKw = document.getElementById('btnAddKw');
  if (btnAddKw) btnAddKw.addEventListener('click', addKeyword);
  var kwInput = document.getElementById('kwInput');
  if (kwInput) kwInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } });

  /* 최신 보고서 로드 */
  loadLatestReport();

  /* 설정 권한 확인 (admin-org-news-settings GET → 403이면 탭 숨김) */
  loadSettings();
});
