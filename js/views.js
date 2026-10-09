// Outline, Kanban, Cards and Document views. Views only render; app.js wires events.
import { esc, richText, STATUSES } from './util.js';
import { toHTML } from './export.js';

export function noteHTML(n, ctx) {
  const g = n.groupId ? ctx.groupMap.get(n.groupId) : null;
  const cls = ['note'];
  if (n.kind === 'heading') cls.push('heading');
  if (ctx.selection.has(n.id)) cls.push('selected');
  if (ctx.openId === n.id) cls.push('open');
  if (n.status === 'done') cls.push('status-done');
  const style = [`--gc:var(--c-${g ? g.color : 'gray'})`];
  if (n.color) style.push(`--nc:var(--c-${n.color})`);
  let text = richText(n.text);
  if (ctx.query) text = highlight(text, ctx.query);
  const meta = [];
  if (ctx.showStatus && n.status && n.status !== 'idea') meta.push(`<span class="badge">${esc(STATUSES.find(s => s.id === n.status)?.name || n.status)}</span>`);
  (n.tags || []).forEach(t => meta.push(`<span class="badge">#${esc(t)}</span>`));
  if (n.orig != null && n.text !== n.orig) meta.push('<span class="badge edited" title="You edited this sentence. The original is kept and can be restored.">edited</span>');
  if (ctx.dups.has(n.id)) meta.push('<span class="badge dup" title="Very similar to another note — nothing has been removed.">similar</span>');
  if (ctx.showGroup && g) meta.push(`<span class="badge">${esc(g.name)}</span>`);
  return `<div class="${cls.join(' ')}" data-drag="note" data-id="${n.id}" style="${style.join(';')}"${n.color ? ` data-color="${n.color}"` : ''}>
    <button class="check no-drag" data-action="toggle-select" aria-label="Select">✓</button>
    <div class="text">${n.marker && n.kind !== 'heading' ? `<span class="marker">${esc(n.marker)}</span>` : ''}${text}</div>
    <div class="meta">${meta.join('')}</div>
  </div>`;
}

function highlight(html, q) {
  const re = new RegExp('(' + esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  // only replace outside of tags
  return html.replace(/(^|>)([^<]*)/g, (m, a, b) => a + b.replace(re, '<mark>$1</mark>'));
}

const groupList = (ctx) => {
  const list = [];
  const inboxNotes = ctx.visible(null);
  if (inboxNotes.length || !ctx.board.groups.length) list.push({ id: null, name: 'Inbox', color: 'gray', inbox: true });
  ctx.board.groups.forEach(g => list.push(g));
  return ctx.filtering ? list.filter(g => ctx.visible(g.id).length) : list;
};

export function renderOutline(ctx) {
  const groups = groupList(ctx);
  if (!groups.length) return noResults();
  return `<div class="outline" data-drop="__groups" data-accept="group">${groups.map(g => {
    const notes = ctx.visible(g.id);
    return `<section class="ol-group${g.collapsed ? ' collapsed' : ''}" data-drop-proxy ${g.inbox ? '' : `data-drag="group" data-id="${g.id}"`} id="grp-${g.id || 'inbox'}" style="--gc:var(--c-${g.color})">
      <div class="ol-head">
        <button class="twisty no-drag" data-action="collapse" data-gid="${g.id || ''}" aria-label="Collapse">▾</button>
        <span class="dot"></span>
        ${g.inbox ? '<span class="gname">Inbox</span>' : `<input class="gname" data-gid="${g.id}" value="${esc(g.name)}" size="${Math.max(4, g.name.length)}" aria-label="Group name">`}
        <span class="count">${notes.length}</span>
        ${g.inbox ? '' : '<span class="grip" title="Drag to reorder">⋮⋮</span>'}
        <button class="icon-btn no-drag" data-action="group-menu" data-gid="${g.id || ''}" aria-label="Group options">⋯</button>
      </div>
      <div class="ol-notes" data-drop="${g.id || 'inbox'}">${notes.length ? notes.map(n => noteHTML(n, ctx)).join('') : '<div class="empty-drop">Drop notes here</div>'}</div>
    </section>`;
  }).join('')}</div>`;
}

export function renderKanban(ctx) {
  if (ctx.kanbanBy === 'status') {
    return `<div class="kanban">${STATUSES.map(s => {
      const notes = ctx.board.notes.filter(n => !n.trashed && (n.status || 'idea') === s.id && ctx.match(n));
      return `<div class="kb-col" data-drop-proxy>
        <div class="kb-head" style="cursor:default"><span class="gname" style="padding:2px 4px">${esc(s.name)}</span><span class="count">${notes.length}</span></div>
        <div class="kb-list" data-drop="status:${s.id}" data-drop-type="status">${notes.map(n => noteHTML({ ...n }, { ...ctx, showGroup: true, showStatus: false })).join('')}</div>
      </div>`;
    }).join('')}</div>`;
  }
  const groups = groupList(ctx);
  return `<div class="kanban" data-drop="__groups" data-accept="group" data-axis="x">${groups.map(g => {
    const notes = ctx.visible(g.id);
    return `<div class="kb-col" data-drop-proxy ${g.inbox ? '' : `data-drag="group" data-id="${g.id}"`} style="--gc:var(--c-${g.color})">
      <div class="kb-head"><span class="dot"></span>
        ${g.inbox ? '<span class="gname">Inbox</span>' : `<input class="gname" data-gid="${g.id}" value="${esc(g.name)}" aria-label="Group name">`}
        <span class="count">${notes.length}</span>
        <button class="icon-btn no-drag" data-action="group-menu" data-gid="${g.id || ''}" aria-label="Group options">⋯</button>
      </div>
      <div class="kb-list" data-drop="${g.id || 'inbox'}">${notes.map(n => noteHTML(n, { ...ctx, showStatus: true })).join('')}</div>
      <button class="kb-add" data-action="add-to-group" data-gid="${g.id || ''}">＋ Add a thought</button>
    </div>`;
  }).join('')}${ctx.filtering ? '' : '<button class="kb-newcol" data-action="new-group">＋ New group</button>'}</div>`;
}

export function renderCards(ctx) {
  const groups = groupList(ctx);
  if (!groups.length) return noResults();
  return `<div class="cards">${groups.map(g => {
    const notes = ctx.visible(g.id);
    return `<div class="cards-group" data-drop-proxy style="--gc:var(--c-${g.color})">
      <h2><span class="dot"></span>${esc(g.name)} <span class="count">${notes.length}</span>
        <button class="icon-btn" data-action="group-menu" data-gid="${g.id || ''}" aria-label="Group options">⋯</button></h2>
      <div class="cards-grid" data-drop="${g.id || 'inbox'}" data-axis="grid">${notes.map(n => noteHTML(n, ctx)).join('') || '<div class="empty-drop">Drop notes here</div>'}</div>
    </div>`;
  }).join('')}</div>`;
}

export function renderDocument(ctx) {
  const titles = ctx.settings.showGroupTitles;
  return `<div class="document">
    <div class="doc-tools">
      <button class="btn small" data-action="copy-doc">Copy text</button>
      <button class="btn small" data-action="mail-doc">✉︎ Mail</button>
      <button class="btn small" data-action="export-md">Markdown</button>
      <button class="btn small" data-action="print">Print / PDF</button>
      <label class="opt small-text muted" style="margin-left:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" data-action="toggle-titles" ${titles ? 'checked' : ''}> Group titles</label>
    </div>
    <article class="doc-body">${toHTML(ctx.board, { titles }) || '<p class="muted">Nothing here yet.</p>'}</article>
    <p class="small-text muted" style="text-align:center;margin-top:14px">Your sentences, in your sequence — exactly as written.</p>
  </div>`;
}

function noResults() {
  return '<div class="empty-state"><div class="big-emoji">🔍</div><h2>No matches</h2><p>Try a different search or clear the tag filter.</p></div>';
}

export function emptyBoard() {
  return `<div class="empty-state">
    <div class="hero-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 12C9.5 12 9 7.5 6 7.5M12 12C9.5 12 9 16.5 6 16.5M12 12c2.5 0 3-4.5 6-4.5M12 12c2.5 0 3 4.5 6 4.5"/><circle cx="12" cy="12" r="2.6" fill="#fff"/><circle cx="5" cy="7.5" r="1.7" fill="#fff"/><circle cx="5" cy="16.5" r="1.7" fill="#fff"/><circle cx="19" cy="7.5" r="1.7" fill="#fff"/><circle cx="19" cy="16.5" r="1.7" fill="#fff"/></svg></div>
    <h2>Bring your ideas in</h2>
    <p>Paste notes from Apple Notes (or any app), open text files, or just start writing below. Mindapp groups, sequences and maps them — without adding or removing a single sentence.</p>
    <div class="row">
      <button class="btn primary" data-action="import">⤓ Import notes</button>
      <button class="btn" data-action="brainstorm">⚡︎ Start brainstorming</button>
      <button class="btn ghost" data-action="sample">Try a sample</button>
    </div>
  </div>`;
}
