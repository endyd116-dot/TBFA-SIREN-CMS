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

  document.getElementById('detailHtml').innerHTML = story.detailHtml || '';

  document.title = (story.title || '유가족 이야기') + ' | 교사유가족협의회';

  document.getElementById('storyContent').style.display = '';
}

function loadStory(id) {
  if (!id) {
    document.getElementById('storyNotFound').style.display = '';
    return;
  }

  if (typeof api !== 'function') {
    setTimeout(function() { loadStory(id); }, 200);
    return;
  }

  api('/api/family-story?id=' + id).then(function(res) {
    if (res.status === 404 || (res.data && res.data.ok === false)) {
      renderStory(null);
      return;
    }
    if (!res.ok) throw new Error(res.data && res.data.error || 'HTTP ' + res.status);
    var story = (res.data && res.data.data && res.data.data.story) ||
                (res.data && res.data.story) || null;
    renderStory(story);
  }).catch(function(err) {
    console.error('[family-story]', err);
    renderStory(null);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  loadStory(getStoryId());
});
