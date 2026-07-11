/* ---- 유가족 이야기 상세 ---- */

var CAT_LABELS = {voice:'목소리',intro:'소개',tribute:'헌정',interview:'인터뷰'};

function catClass(cat) {
  var allowed = ['voice','intro','tribute','interview'];
  return allowed.indexOf(cat) >= 0 ? cat : 'default';
}
function catLabel(cat) {
  return CAT_LABELS[cat] || cat || '영상';
}

function getStoryId() {
  var params = new URLSearchParams(window.location.search);
  return parseInt(params.get('id'), 10) || 0;
}

function renderStory(story) {
  if (!story) {
    document.getElementById('storyNotFound').style.display = '';
    return;
  }

  var heroCat = document.getElementById('heroCat');
  heroCat.textContent = catLabel(story.category);
  heroCat.className = 'story-hero-cat ' + catClass(story.category);

  document.getElementById('heroTitle').textContent = story.title || '';
  document.getElementById('heroSubtitle').textContent = story.subtitle || '';
  document.getElementById('storyHero').style.display = '';

  if (story.youtubeId) {
    document.getElementById('ytIframe').src =
      'https://www.youtube.com/embed/' + story.youtubeId + '?rel=0';
    document.getElementById('ytEmbed').style.display = '';
  }

  /* R41 Q2-048: 관리자/AI 작성 HTML — script·이벤트핸들러·javascript: 경량 제거 */
  var safeDetail = String(story.detailHtml || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
  document.getElementById('detailHtml').innerHTML = safeDetail;

  document.title = (story.title || '유가족 이야기') + ' | 교사유가족협의회';

  document.getElementById('storyContent').style.display = '';
}

function loadStory(id) {
  if (!id) {
    document.getElementById('storyNotFound').style.display = '';
    return;
  }

  /* 공개 페이지엔 전역 api() 헬퍼가 없음 → fetch 직접 호출 */
  fetch('/api/family-story?id=' + id, { credentials: 'include' })
    .then(function(r) {
      if (r.status === 404) return null;
      return r.json();
    })
    .then(function(data) {
      if (!data || data.ok === false) { renderStory(null); return; }
      var story = (data.data && data.data.story) || data.story || null;
      renderStory(story);
    })
    .catch(function(err) {
      console.error('[family-story]', err);
      renderStory(null);
    });
}

document.addEventListener('DOMContentLoaded', function() {
  loadStory(getStoryId());
});
