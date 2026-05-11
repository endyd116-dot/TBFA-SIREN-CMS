/**
 * Phase 21 R4 — 활동 피드 자연어 매핑 모듈 (v1)
 *
 * 피드 항목(actionType)을 사람이 읽을 수 있는 문장으로 변환.
 * workspace.js, workspace-kanban.js에서 공용 사용.
 *
 * window.WorkspaceActivityRender = {
 *   toNaturalText(feedItem)  → string (HTML 안전)
 *   relativeTime(isoStr)     → string
 *   groupKey(isoStr)         → 'today' | 'yesterday' | 'thisweek' | 'older'
 *   GROUP_LABEL              → { today, yesterday, thisweek, older }
 *   GROUP_ORDER              → ['today', 'yesterday', 'thisweek', 'older']
 * }
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function toNaturalText(f) {
    const actor = esc(f.actorName || '시스템');
    const title = f.targetTitle ? `"${esc(f.targetTitle)}"` : '';
    const meta  = f.metadata || {};

    switch (f.actionType) {
      case 'task.created':
        return `${actor}이 작업 ${title}을 만들었어요`;
      case 'task.updated':
        return `${actor}이 작업 ${title}을 수정했어요`;
      case 'task.deleted':
        return `${actor}이 작업 ${title}을 삭제했어요`;
      case 'task.status.changed':
        return `${actor}이 작업 ${title} 상태를 변경했어요`;
      case 'task.assigned':
        return `${actor}이 작업 ${title}을 지시했어요`;
      case 'task.completed':
        return `${actor}이 작업 ${title}을 완료했어요`;
      case 'task.checklist.toggle':
        return `${actor}이 작업 ${title} 체크리스트를 업데이트했어요`;
      case 'task.transfer': {
        const to = esc(meta.toName || meta.assigneeName || '');
        return `${actor}이 작업 ${title}을 ${to ? to + '에게 ' : ''}토스했어요`;
      }
      case 'task.assign': {
        const to = esc(meta.toName || meta.assigneeName || '');
        return `${actor}이 작업 ${title}을 ${to ? to + '에게 ' : ''}배정했어요`;
      }
      case 'service.assignee_change': {
        const newName = esc(meta.newName || meta.toName || '');
        const kind = esc(meta.serviceKind || '');
        const id = f.targetId || '';
        return `${actor}이 ${kind} 신고 #${id} 담당을 ${newName ? newName + '에게 ' : ''}인계했어요`;
      }
      case 'service.closed': {
        const kind = esc(meta.serviceKind || '');
        const id = f.targetId || '';
        return `${actor}이 ${kind} 신고 #${id}를 종결 처리했어요`;
      }
      case 'memo.created':
        return `${actor}이 메모 ${title}를 작성했어요`;
      case 'memo.updated':
        return `${actor}이 메모 ${title}를 수정했어요`;
      case 'memo.pinned':
        return `${actor}이 메모 ${title}를 상단 고정했어요`;
      case 'event.created':
        return `${actor}이 일정 ${title}을 등록했어요`;
      case 'event.updated':
        return `${actor}이 일정 ${title}을 수정했어요`;
      default:
        return `${actor} — ${esc(f.actionType || '활동')}`;
    }
  }

  function relativeTime(isoStr) {
    if (!isoStr) return '';
    try {
      const diff = Date.now() - new Date(isoStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1)  return '방금 전';
      if (mins < 60) return `${mins}분 전`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24)  return `${hrs}시간 전`;
      return `${Math.floor(hrs / 24)}일 전`;
    } catch (_) { return ''; }
  }

  function groupKey(isoStr) {
    if (!isoStr) return 'older';
    try {
      const now   = new Date();
      const todayYmd = now.toISOString().slice(0, 10);
      const d     = new Date(isoStr);
      const dYmd  = d.toISOString().slice(0, 10);
      if (dYmd === todayYmd) return 'today';
      const yest  = new Date(now);
      yest.setDate(yest.getDate() - 1);
      if (dYmd === yest.toISOString().slice(0, 10)) return 'yesterday';
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      if (d >= weekAgo) return 'thisweek';
    } catch (_) {}
    return 'older';
  }

  window.WorkspaceActivityRender = {
    toNaturalText,
    relativeTime,
    groupKey,
    GROUP_LABEL: { today: '오늘', yesterday: '어제', thisweek: '이번 주', older: '이전' },
    GROUP_ORDER: ['today', 'yesterday', 'thisweek', 'older'],
  };
})();
