/* ---- 유가족 이야기 갤러리 ---- */

const MOCK_STORIES = [
  {id:1,youtubeId:"xJLia-INHvI",title:"서이초 사건 그 이후... 교사유가족협의회란?",
   subtitle:"왜 우리가 모였는가",
   thumbnailUrl:"https://i.ytimg.com/vi/xJLia-INHvI/hqdefault.jpg",
   summary:"한 선생님의 죽음 이후, 유가족이 직접 만든 협의회의 시작과 약속.",
   duration:"5:38",category:"intro"},
  {id:2,youtubeId:"6DhgPY_c0Gw",title:"[1분 인터뷰] 유가족의 목소리... 함께 들어주세요",
   subtitle:"짧지만 깊은, 남겨진 이들의 한마디",
   thumbnailUrl:"https://i.ytimg.com/vi/6DhgPY_c0Gw/hqdefault.jpg",
   summary:"1분 남짓한 시간에 담긴 유가족의 진심. 가장 먼저 들어주세요.",
   duration:"1:22",category:"voice"},
  {id:3,youtubeId:"XY8cwu1wfZQ",title:"[유가족의 목소리] 교사 유가족의 인터뷰",
   subtitle:"긴 호흡으로 듣는 이야기",
   thumbnailUrl:"https://i.ytimg.com/vi/XY8cwu1wfZQ/hqdefault.jpg",
   summary:"16분, 유가족이 직접 들려주는 그날 이후의 삶과 바람.",
   duration:"16:51",category:"interview"},
  {id:4,youtubeId:"l97eBPM_d9E",title:"[유가족의 목소리] 교육공동체 헌정 영상",
   subtitle:"기억을 모아 만든 헌정",
   thumbnailUrl:"https://i.ytimg.com/vi/l97eBPM_d9E/hqdefault.jpg",
   summary:"먼저 떠난 선생님들과 교육공동체에 바치는 짧은 헌정 영상.",
   duration:"2:34",category:"tribute"},
];

var USE_MOCK = true;

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
  if (USE_MOCK) {
    renderStories(MOCK_STORIES);
    return;
  }

  if (typeof api !== 'function') {
    setTimeout(loadStories, 200);
    return;
  }

  api('/api/family-stories').then(function(res) {
    if (!res.ok) throw new Error(res.data && res.data.error || 'HTTP ' + res.status);
    var stories = (res.data && res.data.data && res.data.data.stories) ||
                  (res.data && res.data.stories) || [];
    renderStories(stories);
  }).catch(function(err) {
    console.error('[family-stories]', err);
    renderStories([]);
  });
}

document.addEventListener('DOMContentLoaded', loadStories);
