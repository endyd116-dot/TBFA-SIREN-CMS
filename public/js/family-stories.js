/* ---- 유가족 이야기 갤러리 ---- */

var CAT_LABELS = {voice:'목소리',intro:'소개',tribute:'헌정',interview:'인터뷰'};

function catClass(cat) {
  var allowed = ['voice','intro','tribute','interview'];
  return allowed.indexOf(cat) >= 0 ? cat : 'default';
}

function catLabel(cat) {
  return CAT_LABELS[cat] || cat || '영상';
}

function renderCard(story) {
  var a = document.createElement('a');
  a.className = 'story-card';
  a.href = '/family-story.html?id=' + story.id;
  a.innerHTML =
    '<div class="story-thumb">' +
      '<img src="' + (story.thumbnailUrl || '') + '" alt="' + story.title + '" loading="lazy">' +
      (story.duration ? '<span class="story-duration">' + story.duration + '</span>' : '') +
    '</div>' +
    '<div class="story-body">' +
      '<span class="story-cat ' + catClass(story.category) + '">' + catLabel(story.category) + '</span>' +
      '<h2 class="story-title">' + story.title + '</h2>' +
      '<p class="story-summary">' + (story.summary || '') + '</p>' +
    '</div>';
  return a;
}

function renderStories(stories) {
  var grid = document.getElementById('storiesGrid');
  var empty = document.getElementById('storiesEmpty');
  var loading = document.getElementById('storiesLoading');

  loading.style.display = 'none';

  if (!stories || stories.length === 0) {
    empty.style.display = '';
    return;
  }

  grid.style.display = '';
  stories.forEach(function(s) {
    grid.appendChild(renderCard(s));
  });
}

function loadStories() {
  /* 공개 페이지엔 전역 api() 헬퍼가 없음 → fetch 직접 호출 */
  fetch('/api/family-stories', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var stories = (data && data.data && data.data.stories) ||
                    (data && data.stories) || [];
      renderStories(stories);
    })
    .catch(function(err) {
      console.error('[family-stories]', err);
      renderStories([]);
    });
}

document.addEventListener('DOMContentLoaded', loadStories);
