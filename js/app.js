import * as S from './store.js';
import { board, commit } from './store.js';
import { $, $$, esc, h, debounce, COLORS, STATUSES, fmtDate, modKey, uid } from './util.js';
import { segment, verifyLossless, htmlToText, rtfToText, splitSentences } from './parse.js';
import { findDuplicates, related, suggestGroup, hashtags, keywords } from './nlp.js';
import { initDrag } from './drag.js';
import { renderOutline, renderKanban, renderCards, renderDocument, emptyBoard } from './views.js';
import { renderMindmap, mountMindmap, resetMindmapView } from './mindmap.js';
import { toMarkdown, toText, toOPML, download, safeName } from './export.js';
import { SAMPLE, SAMPLE_NAME } from './sample.js';

// ---------- UI state (not persisted) ----------
const ui = {
  selection: new Set(),
  selectMode: false,
  openId: null,
  query: '',
  tag: null,
  captureTarget: 'auto',
  suggestion: null,
  inboxCollapsed: false,
  lastView: null,
  lastBoard: null,
};
let dupCache = { key: '', set: new Set(), pairs: [] };

const viewEl = () => $('#view');

// ---------- boot ----------
(async function boot() {
  await S.load();
  applyTheme();
  S.subscribe(() => render());
  wire();
  render();
  $('#app').classList.remove('loading');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

function applyTheme() {
  const t = S.state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  // tint the iOS / macOS window chrome to match
  const chrome = { light: '#f7f5ff', dark: '#12052a', sepia: '#f1e8d6' }[t];
  $$('meta[name="theme-color"]').forEach((m, i) => {
    if (chrome) { m.content = chrome; m.removeAttribute('media'); }
    else { m.content = i ? '#12052a' : '#f7f5ff'; m.media = `(prefers-color-scheme: ${i ? 'dark' : 'light'})`; }
  });
}

// ---------- context for views ----------
function buildCtx() {
  const b = board();
  const q = ui.query.trim().toLowerCase();
  const tag = ui.tag;
  const groupMap = new Map(b.groups.map(g => [g.id, g]));
  const match = (n) => (!q || n.text.toLowerCase().includes(q) || (n.tags || []).some(t => t.toLowerCase().includes(q)))
    && (!tag || (n.tags || []).includes(tag) || hashtags(n.text).includes(tag));
  const byGroup = new Map();
  b.notes.forEach(n => {
    if (n.trashed || !match(n)) return;
    const gid = n.groupId && groupMap.has(n.groupId) ? n.groupId : null;
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(n);
  });
  return {
    board: b, settings: S.state.settings, groupMap, match,
    visible: (gid) => byGroup.get(gid || null) || [],
    filtering: !!(q || tag), query: ui.query.trim(),
    selection: ui.selection, openId: ui.openId, dups: duplicates().set,
    kanbanBy: S.state.settings.kanbanBy, inboxCollapsed: ui.inboxCollapsed,
  };
}

function duplicates() {
  const notes = S.live();
  const key = board().id + ':' + notes.map(n => n.id + n.text.length).join('|');
  if (key === dupCache.key) return dupCache;
  if (notes.length > 1500) { dupCache = { key, set: new Set(), pairs: [] }; return dupCache; }
  const pairs = findDuplicates(notes);
  const set = new Set();
  pairs.forEach(([a, b]) => { set.add(a); set.add(b); });
  dupCache = { key, set, pairs };
  return dupCache;
}

// ---------- render ----------
function render() {
  const b = board();
  // drop stale UI references
  ui.selection.forEach(id => { const n = S.noteById(id); if (!n || n.trashed) ui.selection.delete(id); });
  if (ui.openId) { const n = S.noteById(ui.openId); if (!n || n.trashed) ui.openId = null; }
  if (ui.captureTarget !== 'auto' && ui.captureTarget !== 'inbox' && !S.groupById(ui.captureTarget)) ui.captureTarget = 'auto';
  renderSidebar();
  const nameEl = $('#board-name');
  if (document.activeElement !== nameEl) nameEl.value = b.name;
  document.title = b.name ? `${b.name} — Mindapp` : 'Mindapp';
  $$('#views button').forEach(x => x.classList.toggle('on', x.dataset.view === S.state.settings.view));
  $('[data-action="undo"]').disabled = !S.canUndo();
  $('[data-action="redo"]').disabled = !S.canRedo();
  renderView();
  renderSelbar();
  renderInspector();
  updateCaptureChip();
}

function renderView() {
  const el = viewEl();
  const b = board();
  const view = S.state.settings.view;
  const same = ui.lastView === view && ui.lastBoard === b.id;
  const scroll = same ? { top: el.scrollTop, left: el.scrollLeft, lists: $$('[data-drop]', el).map(z => [z.dataset.drop, z.scrollTop]) } : null;
  const ctx = buildCtx();
  el.classList.toggle('select-mode', ui.selectMode);
  if (!S.live().length && !b.sources.length) {
    el.innerHTML = emptyBoard();
  } else if (view === 'kanban') el.innerHTML = renderKanban(ctx);
  else if (view === 'mindmap') el.innerHTML = renderMindmap(ctx);
  else if (view === 'cards') el.innerHTML = renderCards(ctx);
  else if (view === 'document') el.innerHTML = renderDocument(ctx);
  else el.innerHTML = renderOutline(ctx);
  if (view === 'mindmap' && $('#mm')) {
    mountMindmap(ctx, {
      toggleBranch: (gid) => {
        if (!gid) ui.inboxCollapsed = !ui.inboxCollapsed;
        else { const g = S.groupById(gid); g.collapsed = !g.collapsed; S.save(); }
        render();
      },
      toggleAll: () => toggleAllGroups(),
      renameGroup: (gid) => renameGroup(gid),
      renameBoard: () => $('#board-name').focus(),
    });
  }
  if (scroll) {
    el.scrollTop = scroll.top; el.scrollLeft = scroll.left;
    scroll.lists.forEach(([k, t]) => { const z = el.querySelector(`[data-drop="${CSS.escape(k)}"]`); if (z) z.scrollTop = t; });
  }
  ui.lastView = view; ui.lastBoard = b.id;
}

function renderSidebar() {
  const b = board();
  $('#board-list').innerHTML = S.state.boards.map(x =>
    `<li class="${x.id === b.id ? 'active' : ''}" data-board="${x.id}"><span>▤</span><span class="name">${esc(x.name)}</span><span class="count">${x.notes.filter(n => !n.trashed).length}</span></li>`).join('');
  const inboxCount = S.live().filter(n => !n.groupId || !S.groupById(n.groupId)).length;
  $('#group-list').innerHTML =
    `<li data-gsec-go="inbox"><span class="dot" style="--gc:var(--c-gray)"></span><span class="name">Inbox</span><span class="count">${inboxCount}</span></li>` +
    b.groups.map(g => `<li data-gsec-go="${g.id}"><span class="dot" style="--gc:var(--c-${g.color})"></span><span class="name">${esc(g.name)}</span><span class="count">${S.notesIn(g.id).length}</span></li>`).join('');
  const tags = S.allTags();
  $('#tag-section').hidden = !tags.length;
  $('#tag-list').innerHTML = tags.slice(0, 30).map(([t, c]) => `<button class="${ui.tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)} <span class="count">${c}</span></button>`).join('');
  const rep = S.integrity();
  const total = S.live().length;
  $('#integrity').innerHTML = rep.length ? rep.map(r => {
    const issues = [];
    if (r.edited) issues.push(`${r.edited} edited by you`);
    if (r.inTrash) issues.push(`${r.inTrash} in Trash`);
    if (r.deleted) issues.push(`${r.deleted} deleted by you`);
    const ok = r.complete && !r.edited && !r.inTrash && !r.deleted;
    return `<div class="integrity-row" title="Imported ${esc(fmtDate(r.src.importedAt))}"><b>${esc(r.src.name)}</b>
      <span class="${ok ? 'ok' : 'warn'}">${ok ? `✓ All ${r.total} pieces present, word-for-word` : `${r.present}/${r.total} as imported · ${issues.join(', ')}`}</span></div>`;
  }).join('') + `<div class="small-text muted" style="padding:0 8px">${total} notes on this board. Organising only moves notes — it never adds or removes text.</div>`
    : '<div class="small-text muted" style="padding:0 8px">Imported notes are checked here, sentence by sentence, so you can see nothing was lost.</div>';
  $('#trash-count').textContent = S.trashed().length || '';
}

function renderSelbar() {
  const n = ui.selection.size;
  $('#selbar').hidden = !n && !ui.selectMode;
  $('#sel-count').textContent = n ? `${n} selected` : 'Tap notes to select';
  $$('#selbar .btn:not(.ghost)').forEach(bn => { bn.disabled = !n; });
}

// ---------- inspector ----------
let inspectorFor = null;
function renderInspector() {
  const el = $('#inspector');
  const n = ui.openId ? S.noteById(ui.openId) : null;
  if (!n) { el.hidden = true; inspectorFor = null; return; }
  el.hidden = false;
  if (inspectorFor === n.id + ':' + n.updated && el.contains(document.activeElement)) return;
  inspectorFor = n.id + ':' + n.updated;
  const b = board();
  const src = n.sourceId ? b.sources.find(s => s.id === n.sourceId) : null;
  const edited = n.orig != null && n.text !== n.orig;
  const rel = related(n.text, S.live(), 5, n.id);
  el.innerHTML = `
    <div class="insp-head"><h2>${n.kind === 'heading' ? 'Heading' : 'Note'}</h2><button class="icon-btn" data-action="close-inspector" aria-label="Close">✕</button></div>
    <div class="insp-body">
      <label>Text<textarea id="insp-text" spellcheck="true">${esc(n.text)}</textarea></label>
      ${edited ? `<label>Original, word-for-word<div class="orig-box">${esc(n.orig)}</div><button class="btn small" data-action="revert-note">Restore original</button></label>` : ''}
      <label>Group<select class="field" id="insp-group"><option value="">Inbox</option>${b.groups.map(g => `<option value="${g.id}" ${g.id === n.groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="__new">＋ New group…</option></select></label>
      <label>Status<select class="field" id="insp-status">${STATUSES.map(s => `<option value="${s.id}" ${s.id === (n.status || 'idea') ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>
      <label>Highlight<div class="swatches">${['', ...COLORS].map(c => `<button class="swatch ${c ? '' : 'none'} ${(n.color || '') === c ? 'on' : ''}" style="--sc:var(--c-${c || 'gray'})" data-action="note-color" data-color="${c}" aria-label="${c || 'No colour'}"></button>`).join('')}</div></label>
      <label>Tags<input class="field" id="insp-tags" value="${esc((n.tags || []).join(', '))}" placeholder="e.g. urgent, podcast"></label>
      <div class="row">
        <button class="btn small" data-action="split-note" title="Split into one card per sentence — nothing is added or removed">Split sentences</button>
        <button class="btn small" data-action="copy-note">Copy</button>
        <button class="btn small danger" data-action="trash-note">Move to Trash</button>
      </div>
      ${rel.length ? `<label>Related notes<div class="rel-list">${rel.map(r => `<button data-open="${r.note.id}">${esc(r.note.text)}<small>${esc(S.groupById(r.note.groupId)?.name || 'Inbox')} · ${Math.round(r.score * 100)}% related</small></button>`).join('')}</div></label>` : ''}
      <div class="small-text muted">Added ${esc(fmtDate(n.created))}${src ? ` · from “${esc(src.name)}”` : ''}${n.updated !== n.created ? ` · changed ${esc(fmtDate(n.updated))}` : ''}</div>
    </div>`;
  const ta = $('#insp-text');
  ta.addEventListener('change', () => {
    const v = ta.value.trim();
    if (!v) { ta.value = n.text; toast('A note can’t be empty — use Move to Trash instead.'); return; }
    if (v !== n.text) commit('Edit note', () => { n.text = v; n.updated = Date.now(); });
  });
  $('#insp-group').addEventListener('change', async (e) => {
    let gid = e.target.value;
    if (gid === '__new') {
      const name = await ask('New group', '', 'Group name');
      if (!name) { e.target.value = n.groupId || ''; return; }
      commit('New group', (b) => { const g = S.makeGroup(b, name); S.moveNotes(b, [n.id], g.id); });
      return;
    }
    commit('Move note', (b) => S.moveNotes(b, [n.id], gid || null));
  });
  $('#insp-status').addEventListener('change', (e) => commit('Set status', () => { n.status = e.target.value; n.updated = Date.now(); }));
  $('#insp-tags').addEventListener('change', (e) => commit('Edit tags', () => {
    n.tags = [...new Set(e.target.value.split(/[,\s]+/).map(t => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))];
    n.updated = Date.now();
  }));
}

// ---------- capture bar ----------
function updateCaptureChip() {
  const chip = $('#capture-target');
  const t = ui.captureTarget;
  chip.classList.remove('suggested');
  if (t === 'auto') {
    const g = ui.suggestion ? S.groupById(ui.suggestion.id) : null;
    if (g) { chip.innerHTML = `<span class="dot" style="--gc:var(--c-${g.color})"></span>✨ ${esc(g.name)}`; chip.classList.add('suggested'); chip.title = 'Suggested group — tap to choose another'; }
    else { chip.textContent = '✨ Auto · Inbox'; chip.title = 'New thoughts are filed into the best-matching group, or the Inbox'; }
  } else if (t === 'inbox') chip.textContent = 'Inbox';
  else { const g = S.groupById(t); chip.innerHTML = g ? `<span class="dot" style="--gc:var(--c-${g.color})"></span>${esc(g.name)}` : 'Inbox'; }
}

const onCaptureInput = debounce(() => {
  const v = $('#capture-input').value;
  const b = board();
  const groups = b.groups.map(g => ({ id: g.id, name: g.name, notes: S.notesIn(g.id) }));
  ui.suggestion = v.trim() ? suggestGroup(v, groups) : null;
  updateCaptureChip();
  const rel = v.trim().length > 3 ? related(v, S.live(), 4) : [];
  $('#capture-related').innerHTML = rel.length ? '<span class="lbl">Related:</span>' + rel.map(r => `<button class="rel" data-open="${r.note.id}">${esc(r.note.text)}</button>`).join('') : '';
}, 180);

function captureAdd() {
  const ta = $('#capture-input');
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  let gid = null;
  if (ui.captureTarget === 'auto') gid = ui.suggestion?.id || null;
  else if (ui.captureTarget !== 'inbox') gid = ui.captureTarget;
  const made = commit('Add thought', (b) => S.addThought(b, text, { groupId: gid, split: S.state.settings.captureSplit !== false }));
  ta.value = ''; autosize(ta);
  ui.suggestion = null;
  $('#capture-related').innerHTML = '';
  updateCaptureChip();
  const g = S.groupById(gid);
  toast(`Added ${made.length > 1 ? made.length + ' thoughts' : 'thought'} to ${g ? g.name : 'Inbox'}`, 'Undo', () => S.undo());
  setTimeout(() => document.querySelector(`[data-id="${made[0]?.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
  ta.focus();
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }

function chooseTarget() {
  const b = board();
  menu('New thoughts go to…', [
    { icon: '✨', label: 'Auto', sub: 'Best-matching group as you type, else Inbox', run: () => { ui.captureTarget = 'auto'; onCaptureInput(); updateCaptureChip(); } },
    { icon: '📥', label: 'Inbox', run: () => { ui.captureTarget = 'inbox'; updateCaptureChip(); } },
    ...b.groups.map(g => ({ icon: `<span class="dot" style="--gc:var(--c-${g.color})"></span>`, label: esc(g.name), run: () => { ui.captureTarget = g.id; updateCaptureChip(); } })),
    { icon: '＋', label: 'New group…', run: async () => { const name = await ask('New group', '', 'Group name'); if (name) { const g = commit('New group', (bb) => S.makeGroup(bb, name)); ui.captureTarget = g.id; updateCaptureChip(); } } },
  ], { html: true });
}

// ---------- note interactions ----------
function noteClick(id, e) {
  if (ui.selectMode || modKey(e) || e.shiftKey || ui.selection.size) {
    if (e.shiftKey && ui.selection.size) {
      // range select in board order
      const order = S.live().map(n => n.id);
      const last = [...ui.selection].pop();
      const [a, z] = [order.indexOf(last), order.indexOf(id)].sort((x, y) => x - y);
      order.slice(a, z + 1).forEach(x => ui.selection.add(x));
    } else toggleSelect(id);
    render();
    return;
  }
  openNote(id);
}
function toggleSelect(id) { if (ui.selection.has(id)) ui.selection.delete(id); else ui.selection.add(id); }
function openNote(id) {
  ui.openId = id;
  render();
  const n = S.noteById(id);
  if (n) setTimeout(() => document.querySelector(`#view [data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 20);
}
function selectedIds() { const order = board().notes.map(n => n.id); return [...ui.selection].sort((a, b) => order.indexOf(a) - order.indexOf(b)); }

function trashNotes(ids) {
  commit('Move to Trash', (b) => ids.forEach(id => { const n = S.noteById(id, b); if (n) { n.trashed = true; n.updated = Date.now(); } }));
  ids.forEach(id => ui.selection.delete(id));
  if (ids.includes(ui.openId)) ui.openId = null;
  toast(`${ids.length} moved to Trash`, 'Undo', () => S.undo());
  render();
}

// ---------- organise ----------
function organiseOneClick() {
  const b = board();
  const inbox = S.live().filter(n => (!n.groupId || !S.groupById(n.groupId)) && n.kind !== 'heading');
  if (!S.live().length) { toast('Add or import some notes first.'); return; }
  let r;
  if (b.groups.length && inbox.length) {
    r = commit('Organise inbox', (bb) => S.organise(bb, { scope: 'inbox' }));
    toast(`Organised ${inbox.length} notes${r.filed ? ` · ${r.filed} into existing groups` : ''}${r.created ? ` · ${r.created} new groups` : ''}`, 'Undo', () => S.undo());
  } else {
    r = commit('Organise', (bb) => S.organise(bb, { scope: 'all' }));
    toast(`Organised ${r.notes} notes into ${r.groups} topic groups and sequenced them`, 'Undo', () => S.undo());
  }
  resetMindmapView(b.id);
}

function organiseDialog() {
  const sel = selectedIds();
  const body = h(`<div class="body">
    <p class="muted small-text" style="margin:0">Organising only moves your notes into groups and orders them. Every sentence stays exactly as written — and you can undo.</p>
    <label class="opt"><input type="radio" name="scope" value="inbox"> Only the Inbox — file new notes into existing groups, cluster the rest</label>
    <label class="opt"><input type="radio" name="scope" value="all" checked> Everything on this board</label>
    ${sel.length ? `<label class="opt"><input type="radio" name="scope" value="sel"> Only the ${sel.length} selected notes</label>` : ''}
    <label class="small-text">Group size<input type="range" id="gran" min="0" max="1" step="0.05" value="0.5"><span class="row muted small-text" style="justify-content:space-between"><span>Fewer, broader groups</span><span>More, focused groups</span></span></label>
    <label class="small-text">Sequence notes within each group
      <select class="field" id="seq"><option value="flow">Flow — related sentences next to each other</option><option value="original">Original order — as you wrote them</option><option value="questions">Questions first</option><option value="alpha">A → Z</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="length">Shortest first</option></select></label>
    <label class="opt"><input type="checkbox" id="keep-h" checked> Keep sections that came from headings in your notes</label>
    <label class="opt"><input type="checkbox" id="use-tags" checked> Keep notes with the same #tag together</label>
  </div>`);
  modal({
    title: '✨ Organise options', body, actions: [
      { label: 'Cancel' },
      { label: 'Organise', primary: true, run: () => {
        const scope = $('input[name=scope]:checked', body).value;
        const opts = { granularity: +$('#gran', body).value, sequence: $('#seq', body).value, keepHeadingGroups: $('#keep-h', body).checked, useTags: $('#use-tags', body).checked };
        const r = commit('Organise', (b) => S.organise(b, scope === 'sel' ? { ...opts, scope: 'all', ids: sel, keepHeadingGroups: false } : { ...opts, scope }));
        resetMindmapView(board().id);
        toast(`Organised ${r.notes + (r.filed || 0)} notes${r.groups ? ` into ${r.groups} groups` : ''}`, 'Undo', () => S.undo());
      } },
    ],
  });
}

const SEQ_METHODS = [
  ['flow', 'Flow', 'Related sentences next to each other'],
  ['original', 'Original order', 'As you first wrote or imported them'],
  ['questions', 'Questions first', ''],
  ['alpha', 'A → Z', ''],
  ['oldest', 'Oldest first', ''],
  ['newest', 'Newest first', ''],
  ['length', 'Shortest first', ''],
];

function groupMenu(gid) {
  const g = gid ? S.groupById(gid) : null;
  const items = [
    { icon: '✎', label: 'Add a thought here', run: () => { ui.captureTarget = gid || 'inbox'; updateCaptureChip(); $('#capture-input').focus(); } },
  ];
  if (g) items.push({ icon: 'Aa', label: 'Rename', run: () => renameGroup(gid) }, { icon: '🎨', label: 'Colour', run: () => colourGroup(gid) });
  items.push(
    { icon: '⇅', label: 'Sequence notes…', sub: 'Flow, original order, A→Z, newest…', run: () => menu('Sequence notes in ' + (g ? g.name : 'Inbox'), SEQ_METHODS.map(([m, l, s]) => ({ label: l, sub: s, run: () => { commit('Sequence', (b) => S.sequenceGroup(b, gid || null, m)); toast('Sequenced', 'Undo', () => S.undo()); } }))) },
    { icon: '✨', label: 'Split into sub-topics', sub: 'Cluster this group’s notes into smaller groups', run: () => { const ids = S.notesIn(gid || null).map(n => n.id); if (ids.length < 2) return toast('Not enough notes to split.'); const r = commit('Split group', (b) => S.organise(b, { scope: 'all', ids, keepHeadingGroups: false })); toast(`Split into ${r.groups} groups`, 'Undo', () => S.undo()); } },
    { icon: '☑︎', label: 'Select all notes in group', run: () => { S.notesIn(gid || null).forEach(n => ui.selection.add(n.id)); ui.selectMode = true; render(); } },
  );
  if (g) {
    items.push(
      { icon: '▾', label: g.collapsed ? 'Expand' : 'Collapse', run: () => { g.collapsed = !g.collapsed; S.save(); render(); } },
      { icon: '↑', label: 'Move group up', run: () => commit('Move group', (b) => { const i = b.groups.findIndex(x => x.id === gid); if (i > 0) S.moveGroup(b, gid, b.groups[i - 1].id); }) },
      { icon: '↓', label: 'Move group down', run: () => commit('Move group', (b) => { const i = b.groups.findIndex(x => x.id === gid); if (i < b.groups.length - 1) S.moveGroup(b, gid, b.groups[i + 2]?.id || null); }) },
      { icon: '⇲', label: 'Ungroup', sub: 'Notes go back to the Inbox — none are deleted', run: () => { commit('Ungroup', (b) => { S.notesIn(gid, b).forEach(n => { n.groupId = null; n.updated = Date.now(); }); b.notes.filter(n => n.trashed && n.groupId === gid).forEach(n => { n.groupId = null; }); b.groups = b.groups.filter(x => x.id !== gid); }); toast('Group removed; notes are in the Inbox', 'Undo', () => S.undo()); } },
    );
  }
  menu(g ? g.name : 'Inbox', items, { html: true });
}

async function renameGroup(gid) {
  const g = S.groupById(gid);
  if (!g) return;
  const name = await ask('Rename group', g.name, 'Group name');
  if (name && name !== g.name) commit('Rename group', () => { g.name = name; g.updated = Date.now(); });
}

function colourGroup(gid) {
  const g = S.groupById(gid);
  const body = h(`<div class="body"><div class="swatches">${COLORS.map(c => `<button class="swatch ${g.color === c ? 'on' : ''}" style="--sc:var(--c-${c});width:40px;height:40px" data-c="${c}" aria-label="${c}"></button>`).join('')}</div></div>`);
  const m = modal({ title: 'Colour', body, actions: [{ label: 'Done' }] });
  body.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (c) { commit('Colour group', () => { g.color = c; g.updated = Date.now(); }); m.close(); }
  });
}

function toggleAllGroups() {
  const b = board();
  const anyOpen = b.groups.some(g => !g.collapsed) || !ui.inboxCollapsed;
  b.groups.forEach(g => { g.collapsed = anyOpen; });
  ui.inboxCollapsed = anyOpen;
  S.save(); render();
}

// ---------- drag & drop ----------
function onDrop({ id, type, zone, zoneType, beforeId }) {
  if (type === 'group') {
    if (zone === '__groups') commit('Reorder groups', (b) => S.moveGroup(b, id, beforeId));
    return;
  }
  const ids = ui.selection.has(id) ? selectedIds() : [id];
  if (zoneType === 'status') {
    const st = zone.slice(7);
    commit('Set status', (b) => {
      ids.forEach(x => { const n = S.noteById(x, b); n.status = st; n.updated = Date.now(); });
      if (beforeId && !ids.includes(beforeId)) {
        const moving = ids.map(x => S.noteById(x, b));
        b.notes = b.notes.filter(n => !ids.includes(n.id));
        b.notes.splice(b.notes.findIndex(n => n.id === beforeId), 0, ...moving);
      }
    });
    return;
  }
  const gid = zone === 'inbox' ? null : zone;
  if (beforeId && ids.includes(beforeId)) return;
  commit('Move', (b) => S.moveNotes(b, ids, gid, beforeId));
  const g = S.groupById(gid);
  if (S.state.settings.view === 'mindmap') toast(`Moved to ${g ? g.name : 'Inbox'}`, 'Undo', () => S.undo());
}

// ---------- import ----------
function importDialog(prefill = '', prefillName = '') {
  const body = h(`<div class="body">
    <div class="tabs seg" style="align-self:start"><button class="on" data-tab="paste">Paste text</button><button data-tab="files">Open files</button></div>
    <div data-pane="paste">
      <textarea class="big" id="imp-text" placeholder="Paste one or many notes here.\n\nIn Apple Notes: open a note → ⌘A (or Select All) → Copy, then paste here.">${esc(prefill)}</textarea>
    </div>
    <div data-pane="files" hidden>
      <div class="drop-zone" id="imp-drop">Drop .txt, .md, .html, .rtf or .opml files here<br><br><button class="btn" id="imp-pick">Choose files…</button></div>
      <div id="imp-files" class="small-text muted"></div>
    </div>
    <div class="row">
      <label class="small-text" style="flex:1;min-width:160px">Name<input class="field" id="imp-name" value="${esc(prefillName || 'Notes ' + new Date().toLocaleDateString())}"></label>
      <label class="small-text" style="flex:1;min-width:160px">One card per
        <select class="field" id="imp-mode"><option value="sentence">Sentence</option><option value="line">Line</option><option value="paragraph">Paragraph</option></select></label>
    </div>
    <label class="opt"><input type="checkbox" id="imp-heads" checked> Turn headings in my notes into groups</label>
    <label class="opt"><input type="checkbox" id="imp-org" checked> ✨ Organise into topic groups after import</label>
    <label class="opt"><input type="checkbox" id="imp-new"> Put into a new board</label>
    <div id="imp-check"></div>
    <div class="preview-list" id="imp-preview" hidden></div>
  </div>`);
  let files = [];
  const modeSel = $('#imp-mode', body);
  modeSel.value = S.state.settings.splitMode || 'sentence';
  const texts = () => {
    const pasteOn = !$('[data-pane="paste"]', body).hidden;
    if (pasteOn) { const t = $('#imp-text', body).value; return t.trim() ? [{ name: $('#imp-name', body).value || 'Pasted notes', text: t }] : []; }
    return files;
  };
  const preview = () => {
    const list = texts();
    const box = $('#imp-preview', body), chk = $('#imp-check', body);
    if (!list.length) { box.hidden = true; chk.innerHTML = ''; return; }
    const mode = modeSel.value, heads = $('#imp-heads', body).checked;
    let count = 0, hcount = 0, ok = true;
    const rows = [];
    list.forEach(f => {
      const segs = segment(f.text, { mode, detectHeadings: heads });
      ok = ok && verifyLossless(f.text, segs);
      count += segs.length;
      segs.forEach(s => { if (s.kind === 'heading') hcount++; if (rows.length < 80) rows.push(`<div class="pv ${s.kind === 'heading' ? 'h' : ''}">${s.marker ? `<span class="muted">${esc(s.marker)} </span>` : ''}${esc(s.text)}</div>`); });
    });
    chk.innerHTML = ok
      ? `<div class="ok-banner">✓ ${count} ${mode === 'sentence' ? 'sentences' : mode + 's'}${hcount && heads ? ` · ${hcount} headings → groups` : ''} — word-for-word, nothing added or removed</div>`
      : '<div class="err-banner">Safety check failed for this text — try “Line” or “Paragraph”.</div>';
    box.hidden = false;
    box.innerHTML = rows.join('') + (count > rows.length ? `<div class="muted small-text" style="padding:4px 8px">…and ${count - rows.length} more</div>` : '');
  };
  const dp = debounce(preview, 150);
  body.addEventListener('input', dp);
  body.addEventListener('change', dp);
  $$('[data-tab]', body).forEach(t => t.addEventListener('click', () => {
    $$('[data-tab]', body).forEach(x => x.classList.toggle('on', x === t));
    $$('[data-pane]', body).forEach(p => { p.hidden = p.dataset.pane !== t.dataset.tab; });
    preview();
  }));
  const addFiles = async (fl) => {
    for (const f of fl) {
      const r = await readImportFile(f);
      if (r.backup) { m.close(); backupChoice(r.backup); return; }
      files.push(r);
    }
    $('#imp-files', body).innerHTML = files.map(f => `📄 ${esc(f.name)} — ${f.text.length.toLocaleString()} characters`).join('<br>');
    if (files.length === 1) $('#imp-name', body).value = files[0].name;
    preview();
  };
  $('#imp-pick', body).addEventListener('click', () => pickFiles(addFiles));
  const dz = $('#imp-drop', body);
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('hover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('hover'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('hover'); addFiles([...e.dataTransfer.files]); });

  const m = modal({
    title: '⤓ Import notes', body, wide: true, actions: [
      { label: 'Cancel' },
      { label: 'Import', primary: true, run: () => {
        const list = texts();
        if (!list.length) { toast('Nothing to import yet.'); return false; }
        const mode = modeSel.value, heads = $('#imp-heads', body).checked, org = $('#imp-org', body).checked;
        if ($('#imp-new', body).checked) S.addBoard(list.length === 1 ? list[0].name : $('#imp-name', body).value || 'Imported');
        S.setSetting('splitMode', mode);
        try {
          const before = new Set(board().notes.map(n => n.id));
          const res = commit('Import', (b) => {
            let count = 0, groups = 0;
            list.forEach(f => { const r = S.importText(b, f.text, { name: list.length === 1 ? ($('#imp-name', body).value || f.name) : f.name, mode, headingsAsGroups: heads }); count += r.count; groups += r.groups; });
            let organised = null;
            if (org) {
              const ids = b.notes.filter(n => !before.has(n.id) && !n.groupId && n.kind !== 'heading').map(n => n.id);
              if (ids.length > 1) organised = S.organise(b, { scope: 'all', ids, keepHeadingGroups: false });
            }
            return { count, groups, organised };
          });
          resetMindmapView(board().id);
          toast(`Imported ${res.count} pieces word-for-word${res.groups ? ` · ${res.groups} heading groups` : ''}${res.organised ? ` · ${res.organised.groups} topic groups` : ''}`, 'Undo', () => S.undo());
        } catch (err) { toast(err.message); return false; }
      } },
    ],
    onMount: () => { preview(); if (!prefill) $('#imp-text', body).focus(); },
  });
}

async function readImportFile(f) {
  const raw = await f.text();
  const name = f.name.replace(/\.[^.]+$/, '');
  if (/\.(json|mindapp)$/i.test(f.name) || /^\s*\{\s*"app"\s*:\s*"mindapp"/.test(raw)) {
    try { const data = JSON.parse(raw); if (data.app === 'mindapp') return { backup: data }; } catch { /* treat as text */ }
  }
  let text = raw;
  if (/\.html?$/i.test(f.name) || /^\s*<(!doctype|html|div|p)\b/i.test(raw)) text = htmlToText(raw);
  else if (/\.rtf$/i.test(f.name) || raw.startsWith('{\\rtf')) text = rtfToText(raw);
  else if (/\.opml$/i.test(f.name)) text = opmlToText(raw);
  return { name, text };
}

function opmlToText(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out = [];
  const walk = (node, depth) => {
    [...node.children].filter(c => c.tagName === 'outline').forEach(o => {
      const t = o.getAttribute('text') || o.getAttribute('title') || '';
      const kids = [...o.children].filter(c => c.tagName === 'outline');
      if (kids.length && depth > 0) { out.push('', '# ' + t); walk(o, depth + 1); }
      else if (kids.length) walk(o, depth + 1);
      else out.push('- ' + t);
    });
  };
  const body = doc.querySelector('body');
  if (body) walk(body, 0);
  return out.join('\n').trim();
}

function pickFiles(cb) {
  const inp = $('#file-input');
  inp.value = '';
  inp.onchange = () => cb([...inp.files]);
  inp.click();
}

// ---------- sync & export ----------
function backupFileName() { return `Mindapp-backup-${new Date().toISOString().slice(0, 10)}.mindapp.json`; }

async function emailBackup() {
  const json = JSON.stringify(S.exportState());
  const name = backupFileName();
  const file = new File([json], name, { type: 'application/json' });
  const text = 'My Mindapp backup. On your other device: save this attachment, then open Mindapp → Sync → “Open a backup” and choose Merge.';
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Mindapp backup', text });
      S.setSetting('lastBackup', Date.now());
      toast('Backup shared — choose Mail in the share sheet to email it');
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  download(name, json, 'application/json');
  S.setSetting('lastBackup', Date.now());
  setTimeout(() => { location.href = `mailto:?subject=${encodeURIComponent('Mindapp backup ' + new Date().toLocaleDateString())}&body=${encodeURIComponent(text + '\n\n(Attach the file “' + name + '” that was just downloaded.)')}`; }, 400);
  toast('Backup downloaded — attach it to the email that opens');
}

function mailDocument() {
  const b = board();
  const text = toText(b, { titles: S.state.settings.showGroupTitles });
  if (navigator.share && /iPhone|iPad|Mac/.test(navigator.userAgent) && text.length > 1800) {
    navigator.share({ title: b.name, text }).catch(() => {});
    return;
  }
  location.href = `mailto:?subject=${encodeURIComponent(b.name)}&body=${encodeURIComponent(text)}`;
}

function backupChoice(data) {
  const boards = data.boards?.length || 0;
  const notes = (data.boards || []).reduce((s, b) => s + (b.notes || []).filter(n => !n.trashed).length, 0);
  modal({
    title: 'Open backup',
    body: h(`<div class="body"><p>This backup from <b>${esc(fmtDate(data.exportedAt))}</b> has ${boards} board${boards === 1 ? '' : 's'} and ${notes} notes.</p>
      <p class="muted small-text"><b>Merge</b> keeps everything on this device and brings in what’s new or changed — the newest edit of each note wins. <b>Replace</b> makes this device an exact copy of the backup.</p></div>`),
    actions: [
      { label: 'Cancel' },
      { label: 'Replace', danger: true, run: () => { if (!confirm('Replace everything on this device with the backup?')) return false; S.mergeBackup(data, { replace: true }); applyTheme(); toast('Replaced with backup'); } },
      { label: 'Merge', primary: true, run: () => { const r = S.mergeBackup(data); toast(`Synced: ${r.merged} board${r.merged === 1 ? '' : 's'} merged, ${r.added} added`); } },
    ],
  });
}

function syncDialog() {
  const last = S.state.settings.lastBackup;
  const body = h(`<div class="body">
    <div class="menu-list">
      <p class="muted small-text" style="margin:0 2px 4px">Sync between iPhone, iPad and Mac by Mail${last ? ` · last backup ${esc(fmtDate(last))}` : ''}</p>
      <button data-x="email-backup"><span>✉︎</span><span>Email a backup<small>Opens the share sheet — choose Mail. On your other device, open the attachment and Merge.</small></span></button>
      <button data-x="open-backup"><span>⤒</span><span>Open a backup…<small>From Mail, Files or iCloud Drive. Merge keeps both devices’ changes.</small></span></button>
      <button data-x="download-backup"><span>⤓</span><span>Save backup file<small>Keep it in iCloud Drive / Files for safekeeping.</small></span></button>
      <p class="muted small-text" style="margin:12px 2px 4px">Share your writing</p>
      <button data-x="mail-doc"><span>✉︎</span><span>Email as text<small>Your notes in their current order and groups.</small></span></button>
      <button data-x="copy-md"><span>⧉</span><span>Copy as Markdown<small>Paste back into Apple Notes, Pages, Bear…</small></span></button>
      <button data-x="export-md"><span>M↓</span><span>Export Markdown (.md)</span></button>
      <button data-x="export-txt"><span>T</span><span>Export plain text (.txt)</span></button>
      <button data-x="export-opml"><span>✺</span><span>Export OPML<small>Open your groups as a mind map in MindNode, iThoughts or OmniOutliner.</small></span></button>
      <button data-x="print"><span>⎙</span><span>Print / Save as PDF</span></button>
    </div></div>`);
  const m = modal({ title: 'Sync & export', body, actions: [{ label: 'Close' }] });
  body.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    const b = board();
    if (x === 'email-backup') emailBackup();
    if (x === 'open-backup') pickFiles(async (fl) => { const r = await readImportFile(fl[0]); m.close(); if (r.backup) backupChoice(r.backup); else toast('That file isn’t a Mindapp backup — use Import for notes.'); });
    if (x === 'download-backup') { download(backupFileName(), JSON.stringify(S.exportState()), 'application/json'); S.setSetting('lastBackup', Date.now()); }
    if (x === 'mail-doc') mailDocument();
    if (x === 'copy-md') copy(toMarkdown(b, { titles: S.state.settings.showGroupTitles }), 'Markdown copied');
    if (x === 'export-md') download(safeName(b.name) + '.md', toMarkdown(b, { titles: S.state.settings.showGroupTitles }), 'text/markdown');
    if (x === 'export-txt') download(safeName(b.name) + '.txt', toText(b, { titles: S.state.settings.showGroupTitles }));
    if (x === 'export-opml') download(safeName(b.name) + '.opml', toOPML(b), 'text/x-opml');
    if (x === 'print') { m.close(); S.setSetting('view', 'document'); setTimeout(() => window.print(), 300); }
  });
}

async function copy(text, msg = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { const ta = h('<textarea></textarea>'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(msg); }
}

// ---------- brainstorm ----------
const PROMPTS = [
  'What problem does this really solve?', 'Who would love this most — and why?', 'What’s the opposite approach?',
  'What if you had 10× the time? Or just one day?', 'What could make this fail?', 'Combine two ideas you already have.',
  'What’s the smallest version you could try this week?', 'How would you explain it to a child?', 'What would a competitor do?',
  'What’s missing from your notes so far?', 'Substitute — what could you swap out?', 'Adapt — what else is like this?',
  'Eliminate — what can you remove?', 'Reverse — what if you did it backwards?', 'What question haven’t you asked yet?',
  'What’s the very next step?', 'Who could help you with this?', 'What would make this delightful?', 'What do you already know that’s relevant?',
];

function brainstorm() {
  const session = [];
  let sessionGroup = null;
  let timer = null, endAt = 0;
  const el = h(`<div class="bs" role="dialog" aria-label="Brainstorm">
    <div class="bs-main">
      <div class="bs-top">
        <h2>⚡︎ Brainstorm</h2>
        <span class="bs-timer" id="bs-timer"></span>
        <select class="field" id="bs-sprint" style="width:auto"><option value="0">No timer</option><option value="5">5-min sprint</option><option value="10">10-min sprint</option><option value="15">15-min sprint</option><option value="25">25-min sprint</option></select>
        <button class="btn" id="bs-prompt-btn">💡 Prompt me</button>
        <button class="btn primary" id="bs-done">Finish</button>
      </div>
      <div class="bs-prompt" id="bs-prompt">Write whatever comes to mind. Press Enter after each thought — don’t edit, just keep going.</div>
      <textarea class="bs-input" id="bs-input" rows="2" placeholder="Type a thought and press Enter…" autofocus></textarea>
      <div class="bs-hint"><span>Enter = save thought · ⇧Enter = new line · Esc = finish</span>
        <label class="opt" style="font-size:12.5px"><input type="checkbox" id="bs-auto" checked> File into matching groups</label>
        <span id="bs-count"></span></div>
      <div class="bs-stream" id="bs-stream"></div>
    </div>
    <aside class="bs-side">
      <h4>Related in your board</h4><div class="rel-list" id="bs-rel"><p class="muted small-text">Start typing to see connected ideas you’ve already written.</p></div>
      <h4>Themes this session</h4><div class="tag-cloud" id="bs-kw" style="padding:0;margin-bottom:20px"><span class="muted small-text">—</span></div>
      <h4>Tips</h4><p class="muted small-text">Quantity first, judge later. Add #tags to keep ideas together. Everything you type is saved exactly as written, and you can organise it with one click afterwards.</p>
    </aside>
  </div>`);
  document.body.appendChild(el);
  const input = $('#bs-input', el);
  input.focus();
  const groupsForSuggest = () => board().groups.filter(g => g.id !== sessionGroup).map(g => ({ id: g.id, name: g.name, notes: S.notesIn(g.id) }));
  const updateRel = debounce(() => {
    const v = input.value;
    const rel = v.trim().length > 3 ? related(v, S.live(), 6) : [];
    $('#bs-rel', el).innerHTML = rel.length ? rel.map(r => `<button data-ins="${r.note.id}">${esc(r.note.text)}<small>${esc(S.groupById(r.note.groupId)?.name || 'Inbox')}</small></button>`).join('') : '<p class="muted small-text">No related notes yet.</p>';
  }, 200);
  input.addEventListener('input', () => { updateRel(); });
  const renderStream = () => {
    $('#bs-stream', el).innerHTML = session.slice().reverse().map(s => {
      const n = S.noteById(s);
      if (!n || n.trashed) return '';
      const g = S.groupById(n.groupId);
      return `<div class="bs-item"><div class="t">${esc(n.text)}</div><button class="chip" data-bs-move="${n.id}" title="Change group"><span class="dot" style="--gc:var(--c-${g ? g.color : 'gray'})"></span>${esc(g ? g.name : 'Inbox')}</button></div>`;
    }).join('');
    $('#bs-count', el).textContent = session.length ? `${session.length} thought${session.length === 1 ? '' : 's'}` : '';
    const texts = session.map(id => S.noteById(id)?.text).filter(Boolean);
    $('#bs-kw', el).innerHTML = texts.length > 1 ? keywords(texts, 10).map(k => `<button>${esc(k)}</button>`).join('') : '<span class="muted small-text">—</span>';
  };
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    let gid = null;
    if ($('#bs-auto', el).checked) {
      const s = suggestGroup(text, groupsForSuggest());
      if (s && s.score >= 0.16) gid = s.id;
    }
    const made = commit('Brainstorm', (bb) => {
      if (!gid) {
        if (!sessionGroup || !S.groupById(sessionGroup, bb)) sessionGroup = S.makeGroup(bb, '⚡ Brainstorm ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), 'yellow').id;
        gid = sessionGroup;
      }
      return S.addThought(bb, text, { groupId: gid, split: false });
    });
    session.push(...made.map(n => n.id));
    input.value = '';
    $('#bs-rel', el).innerHTML = '';
    renderStream();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); add(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
  });
  $('#bs-prompt-btn', el).addEventListener('click', () => {
    $('#bs-prompt', el).textContent = '💡 ' + PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    input.focus();
  });
  $('#bs-sprint', el).addEventListener('change', (e) => {
    clearInterval(timer);
    const mins = +e.target.value;
    if (!mins) { $('#bs-timer', el).textContent = ''; return; }
    endAt = Date.now() + mins * 60000;
    const tick = () => {
      const left = Math.max(0, endAt - Date.now());
      $('#bs-timer', el).textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      if (!left) { clearInterval(timer); $('#bs-timer', el).textContent = 'Time! ✓'; try { navigator.vibrate?.(200); } catch { /* */ } }
    };
    tick(); timer = setInterval(tick, 1000);
    input.focus();
  });
  el.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-bs-move]');
    if (mv) {
      const id = mv.dataset.bsMove;
      menu('Move thought to…', [
        { label: 'Inbox', run: () => { commit('Move', (bb) => S.moveNotes(bb, [id], null)); renderStream(); } },
        ...board().groups.map(g => ({ label: esc(g.name), icon: `<span class="dot" style="--gc:var(--c-${g.color})"></span>`, run: () => { commit('Move', (bb) => S.moveNotes(bb, [id], g.id)); renderStream(); } })),
      ], { html: true });
    }
    const ins = e.target.closest('[data-ins]');
    if (ins) { const n = S.noteById(ins.dataset.ins); if (n) { $('#bs-prompt', el).textContent = '↪ Building on: “' + n.text + '”'; input.focus(); } }
  });
  const finish = () => {
    if (input.value.trim()) add();
    clearInterval(timer);
    el.remove();
    document.removeEventListener('keydown', escTrap, true);
    if (session.length) {
      const sg = sessionGroup && S.groupById(sessionGroup);
      const inSg = sg ? S.notesIn(sg.id).length : 0;
      toast(`Captured ${session.length} thought${session.length === 1 ? '' : 's'}`, inSg > 2 ? '✨ Organise them' : null, inSg > 2 ? () => {
        const ids = S.notesIn(sg.id).map(n => n.id);
        const r = commit('Organise brainstorm', (bb) => S.organise(bb, { scope: 'all', ids, keepHeadingGroups: false }));
        toast(`Organised into ${r.groups} groups`, 'Undo', () => S.undo());
      } : null, 8000);
    }
    render();
  };
  const escTrap = (e) => { if (e.key === 'Escape' && !$('.modal-wrap')) { e.stopPropagation(); finish(); } };
  document.addEventListener('keydown', escTrap, true);
  $('#bs-done', el).addEventListener('click', finish);
}

// ---------- dialogs ----------
function modal({ title, body, actions = [], wide = false, onMount }) {
  const wrap = h(`<div class="modal-wrap"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></header><footer></footer></div></div>`);
  const m = wrap.firstElementChild;
  if (typeof body === 'string') body = h(`<div class="body">${body}</div>`);
  m.insertBefore(body, m.querySelector('footer'));
  const foot = m.querySelector('footer');
  if (!actions.length) foot.remove();
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
  actions.forEach(a => {
    const bn = h(`<button class="btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}">${esc(a.label)}</button>`);
    bn.addEventListener('click', async () => { const r = a.run ? await a.run() : undefined; if (r !== false) close(); });
    foot.appendChild(bn);
  });
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && modKey(e)) { const p = actions.find(a => a.primary); if (p) { e.preventDefault(); foot.querySelector('.primary')?.click(); } }
  };
  document.addEventListener('keydown', onKey, true);
  $('#modal-root').appendChild(wrap);
  onMount?.(m);
  return { el: m, close };
}

function menu(title, items, { html = false } = {}) {
  const body = h(`<div class="body"><div class="menu-list">${items.map((it, i) => `<button data-i="${i}">${it.icon ? `<span style="width:22px;text-align:center;flex:none">${it.icon}</span>` : ''}<span>${html ? it.label : esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('')}</div></div>`);
  const m = modal({ title, body });
  body.addEventListener('click', (e) => {
    const i = e.target.closest('[data-i]')?.dataset.i;
    if (i != null) { m.close(); items[+i].run(); }
  });
}

function ask(title, value = '', placeholder = '') {
  return new Promise((resolve) => {
    const body = h(`<div class="body"><input class="field" value="${esc(value)}" placeholder="${esc(placeholder)}"></div>`);
    const inp = $('input', body);
    let done = false;
    const m = modal({ title, body, actions: [{ label: 'Cancel', run: () => { done = true; resolve(null); } }, { label: 'OK', primary: true, run: () => { done = true; resolve(inp.value.trim() || null); } }], onMount: () => { inp.focus(); inp.select(); } });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done = true; resolve(inp.value.trim() || null); m.close(); } });
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe($('#modal-root'), { childList: true });
  });
}

let toastTimer;
function toast(msg, actionLabel, action, ms = 4500) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) t.querySelector('button').onclick = () => { t.classList.remove('show'); action(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function trashDialog() {
  const list = S.trashed();
  const body = h(`<div class="body">${list.length ? `<p class="muted small-text" style="margin:0">Notes stay here until you empty the Trash. Restore puts them back where they were.</p>
    <div class="preview-list" style="max-height:50vh">${list.map(n => `<div class="pv row" style="justify-content:space-between;flex-wrap:nowrap"><span>${esc(n.text)}</span><button class="btn small" data-restore="${n.id}">Restore</button></div>`).join('')}</div>` : '<p class="muted">Trash is empty.</p>'}</div>`);
  const m = modal({
    title: '🗑 Trash', body, actions: list.length ? [
      { label: 'Empty Trash…', danger: true, run: () => {
        if (!confirm(`Permanently delete ${list.length} note${list.length === 1 ? '' : 's'}? This is the only way Mindapp ever removes your text, and it can only be undone right away with Undo.`)) return false;
        commit('Empty trash', (b) => S.emptyTrash(b)); toast('Trash emptied', 'Undo', () => S.undo());
      } },
      { label: 'Restore all', run: () => commit('Restore', (b) => b.notes.forEach(n => { if (n.trashed) restoreNote(n, b); })) },
      { label: 'Close', primary: true },
    ] : [{ label: 'Close', primary: true }],
  });
  body.addEventListener('click', (e) => {
    const id = e.target.closest('[data-restore]')?.dataset.restore;
    if (id) { commit('Restore', (b) => restoreNote(S.noteById(id, b), b)); e.target.closest('.pv').remove(); if (!S.trashed().length) m.close(); }
  });
}
function restoreNote(n, b) { n.trashed = false; n.updated = Date.now(); if (n.groupId && !S.groupById(n.groupId, b)) n.groupId = null; }

function duplicatesDialog() {
  const { pairs } = duplicates();
  const body = h(`<div class="body">${pairs.length ? `<p class="muted small-text" style="margin:0">These notes say nearly the same thing. Mindapp never removes them — you decide. Group them to keep them side by side.</p>
    ${pairs.slice(0, 60).map(([a, c, s]) => { const A = S.noteById(a), C = S.noteById(c); return `<div class="integrity-row" style="margin:0"><div>${esc(A.text)}</div><div style="margin-top:6px">${esc(C.text)}</div>
      <div class="row" style="margin-top:8px"><span class="muted small-text">${Math.round(s * 100)}% similar</span><button class="btn small" data-pair="${a},${c}">Group together</button><button class="btn small" data-open="${a}">Open</button></div></div>`; }).join('')}`
    : '<p class="muted">No near-duplicates found. 🎉</p>'}</div>`);
  const m = modal({ title: 'Similar notes', body, actions: [{ label: 'Close', primary: true }] });
  body.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pair]')?.dataset.pair;
    if (p) {
      const [a, c] = p.split(',');
      commit('Group similar', (b) => {
        const A = S.noteById(a, b), next = b.notes[b.notes.findIndex(n => n.id === a) + 1];
        if (next?.id === c) { next.groupId = A.groupId; next.updated = Date.now(); return; }
        S.moveNotes(b, [c], A.groupId, next?.id || null);
      });
      toast('Placed side by side', 'Undo', () => S.undo());
    }
    const o = e.target.closest('[data-open]')?.dataset.open;
    if (o) { m.close(); openNote(o); }
  });
}

function settingsDialog() {
  const st = S.state.settings;
  const body = h(`<div class="body">
    <label class="small-text">Appearance<select class="field" id="st-theme"><option value="auto">Match system</option><option value="light">Light — violet</option><option value="dark">Dark — violet night</option><option value="sepia">Sepia — warm paper</option></select></label>
    <label class="small-text">Imports: one card per<select class="field" id="st-split"><option value="sentence">Sentence</option><option value="line">Line</option><option value="paragraph">Paragraph</option></select></label>
    <label class="opt"><input type="checkbox" id="st-cap" ${st.captureSplit !== false ? 'checked' : ''}> Quick capture: split a multi-sentence thought into one card per sentence</label>
    <label class="opt"><input type="checkbox" id="st-titles" ${st.showGroupTitles ? 'checked' : ''}> Show group titles in Document view and exports</label>
    <p class="muted small-text">Your notes are stored only on this device (offline, private). Use Sync → Email a backup to move them between devices.</p>
    <button class="btn danger" id="st-reset" style="justify-self:start">Erase all data on this device…</button>
  </div>`);
  $('#st-theme', body).value = st.theme; $('#st-split', body).value = st.splitMode;
  modal({ title: 'Settings', body, actions: [{ label: 'Done', primary: true, run: () => {
    S.setSetting('theme', $('#st-theme', body).value); S.setSetting('splitMode', $('#st-split', body).value);
    S.setSetting('captureSplit', $('#st-cap', body).checked); S.setSetting('showGroupTitles', $('#st-titles', body).checked);
    applyTheme();
  } }] });
  $('#st-reset', body).addEventListener('click', async () => {
    if (!confirm('Erase every board and note on this device? Make a backup first if you might need them.')) return;
    if (!confirm('Really erase everything? This cannot be undone.')) return;
    S.wipe();
    setTimeout(() => location.reload(), 150);
  });
}

function helpDialog() {
  modal({ title: 'How Mindapp works', wide: true, body: `<div class="help">
    <h4>🔒 Your words, untouched</h4>
    <p>Mindapp never adds, rewrites or removes a sentence. Import splits your notes into cards at sentence (or line/paragraph) boundaries and proves nothing was lost — see <b>Verbatim check</b> in the sidebar. Organising only <i>moves</i> cards. If you edit a card yourself, the original is kept and can be restored.</p>
    <h4>✨ One-click organise</h4>
    <p>Groups related sentences by topic (and by #tags), then sequences each group so connected ideas sit together. New notes in the Inbox are filed into your existing groups. Everything can be undone (⌘Z). Use ⋯ → Organise options for group size and ordering.</p>
    <h4>⤓ Importing from Apple Notes</h4>
    <ul><li><b>iPhone / iPad:</b> open a note → tap ⋯ → Select All (or long-press → Select All) → Copy → in Mindapp tap Import and paste.</li>
    <li><b>Mac:</b> in Notes press ⌘A, ⌘C, then Import → paste. You can also drop .txt, .md, .html or .rtf files.</li>
    <li>Paste many notes at once — headings and bullet lists are recognised and kept.</li></ul>
    <h4>⚡︎ Brainstorm</h4>
    <p>A distraction-free page: type, press Enter, repeat. Thoughts are filed into matching groups as you go, related ideas appear on the side, and prompts help you keep going.</p>
    <h4>✉︎ Sync with Mail</h4>
    <p>Sync → <b>Email a backup</b> → Mail. On your other device, open the email, save/open the attachment, then Sync → <b>Open a backup</b> → <b>Merge</b>. The newest edit of each note wins and nothing is silently dropped. You can also keep backups in iCloud Drive.</p>
    <h4>📱 Install on every Apple device</h4>
    <ul><li><b>iPhone / iPad:</b> open this page in Safari → Share → <b>Add to Home Screen</b>.</li>
    <li><b>Mac:</b> Safari → File → <b>Add to Dock</b> (macOS Sonoma or later).</li>
    <li>Works offline once installed.</li></ul>
    <h4>⌨︎ Shortcuts</h4>
    <p><kbd>N</kbd> new thought · <kbd>B</kbd> brainstorm · <kbd>O</kbd> organise · <kbd>/</kbd> search · <kbd>1</kbd>–<kbd>5</kbd> switch view · <kbd>⌘Z</kbd> undo · <kbd>⇧⌘Z</kbd> redo · <kbd>⌘</kbd>/<kbd>⇧</kbd>-click to select · <kbd>⌫</kbd> trash selected · <kbd>Esc</kbd> close</p>
    <h4>✋ Moving things</h4>
    <p>Drag cards between groups and columns (on touch: press and hold, then drag). Drag group headers to reorder groups. In the mind map, drop a note on a branch to move it there.</p>
  </div>`, actions: [{ label: 'Got it', primary: true }] });
}

function moreMenu() {
  const b = board();
  menu('More', [
    { icon: '☑︎', label: ui.selectMode ? 'Stop selecting' : 'Select notes', run: () => { ui.selectMode = !ui.selectMode; if (!ui.selectMode) ui.selection.clear(); render(); } },
    { icon: '✨', label: 'Organise options…', sub: 'Group size, ordering, scope', run: organiseDialog },
    { icon: '⇅', label: 'Sequence groups…', run: () => menu('Order groups by', [
      { label: 'A → Z', run: () => commit('Sequence groups', (bb) => S.sequenceGroups(bb, 'alpha')) },
      { label: 'Largest first', run: () => commit('Sequence groups', (bb) => S.sequenceGroups(bb, 'size')) },
      { label: 'Original order', sub: 'By when their first note was written', run: () => commit('Sequence groups', (bb) => S.sequenceGroups(bb, 'original')) },
    ]) },
    { icon: '≈', label: 'Find similar notes', sub: `${duplicates().pairs.length} pairs`, run: duplicatesDialog },
    { icon: '▾', label: 'Collapse / expand all groups', run: toggleAllGroups },
    { icon: '▥', label: S.state.settings.kanbanBy === 'status' ? 'Kanban columns: by group' : 'Kanban columns: by status', sub: 'Idea → Exploring → Ready → Done', run: () => { S.setSetting('kanbanBy', S.state.settings.kanbanBy === 'status' ? 'group' : 'status'); S.setSetting('view', 'kanban'); } },
    { icon: '⤓', label: 'Import notes…', run: () => importDialog() },
    { icon: '✉︎', label: 'Sync & export…', run: syncDialog },
    { icon: '＋', label: 'New board', run: newBoard },
    { icon: '✕', label: `Delete board “${esc(b.name)}”`, run: () => {
      if (S.state.boards.length === 1) return toast('This is your only board.');
      if (!confirm(`Delete the board “${b.name}” and its ${S.live(b).length} notes from this device?`)) return;
      S.deleteBoard(b.id);
    } },
    { icon: '◐', label: 'Theme…', sub: 'Light, violet night, sepia or match system', run: () => menu('Theme', [
      ['auto', 'Match system'], ['light', 'Light — violet'], ['dark', 'Dark — violet night'], ['sepia', 'Sepia — warm paper'],
    ].map(([v, l]) => ({ label: (S.state.settings.theme === v ? '✓ ' : '') + l, run: () => { S.setSetting('theme', v); applyTheme(); } }))) },
    { icon: '⚙︎', label: 'Settings', run: settingsDialog },
    { icon: '？', label: 'Help', run: helpDialog },
  ], { html: true });
}

async function newBoard() {
  const name = await ask('New board', '', 'e.g. Book ideas');
  if (name) { S.addBoard(name); ui.selection.clear(); ui.openId = null; }
}

async function newGroup() {
  const name = await ask('New group', '', 'Group name');
  if (name) commit('New group', (b) => S.makeGroup(b, name));
}

// ---------- wiring ----------
const ACTIONS = {
  'toggle-sidebar': () => {
    const app = $('#app');
    if (matchMedia('(max-width: 860px)').matches) app.classList.toggle('side-open');
    else app.classList.toggle('side-collapsed');
  },
  'new-board': newBoard,
  'new-group': newGroup,
  undo: () => { const l = S.undo(); if (l) toast('Undid: ' + l); },
  redo: () => { const l = S.redo(); if (l) toast('Redid: ' + l); },
  import: () => importDialog(),
  sync: syncDialog,
  brainstorm,
  organise: organiseOneClick,
  more: moreMenu,
  trash: trashDialog,
  settings: settingsDialog,
  help: helpDialog,
  sample: () => {
    const res = commit('Import sample', (b) => { const r = S.importText(b, SAMPLE, { name: SAMPLE_NAME, mode: 'sentence', headingsAsGroups: true }); return r; });
    toast(`Imported ${res.count} sentences — now tap ✨ Organise`);
  },
  'capture-add': captureAdd,
  'close-inspector': () => { ui.openId = null; render(); },
  'toggle-select': (el) => { const id = el.closest('[data-id]').dataset.id; toggleSelect(id); render(); },
  collapse: (el) => {
    const gid = el.dataset.gid;
    if (!gid) ui.inboxCollapsed = !ui.inboxCollapsed;
    else { const g = S.groupById(gid); g.collapsed = !g.collapsed; S.save(); }
    el.closest('.ol-group')?.classList.toggle('collapsed');
  },
  'group-menu': (el) => groupMenu(el.dataset.gid || null),
  'add-to-group': (el) => { ui.captureTarget = el.dataset.gid || 'inbox'; updateCaptureChip(); $('#capture-input').focus(); },
  'copy-doc': () => copy(toText(board(), { titles: S.state.settings.showGroupTitles }), 'Document copied'),
  'mail-doc': mailDocument,
  'export-md': () => download(safeName(board().name) + '.md', toMarkdown(board(), { titles: S.state.settings.showGroupTitles }), 'text/markdown'),
  print: () => window.print(),
  'revert-note': () => { const n = S.noteById(ui.openId); if (n) commit('Restore original', () => { n.text = n.orig; n.updated = Date.now(); }); },
  'note-color': (el) => { const n = S.noteById(ui.openId); if (n) commit('Highlight', () => { n.color = el.dataset.color || null; n.updated = Date.now(); }); },
  'copy-note': () => { const n = S.noteById(ui.openId); if (n) copy(n.text); },
  'trash-note': () => { if (ui.openId) trashNotes([ui.openId]); },
  'split-note': () => {
    const n = S.noteById(ui.openId);
    if (!n) return;
    const parts = splitSentences(n.text);
    if (parts.length < 2) return toast('This note is already a single sentence.');
    // Unedited imported text: each piece keeps its own verbatim original.
    // Text you already edited: the first piece keeps the original for restoring; the rest become your own notes.
    const unedited = n.orig != null && n.orig === n.text;
    commit('Split note', (b) => {
      const i = b.notes.findIndex(x => x.id === n.id);
      const made = parts.map((p, k) => {
        const fromSource = n.orig != null && (unedited || k === 0);
        return S.makeNote(p, {
          orig: !fromSource ? null : unedited ? p : n.orig,
          marker: k === 0 ? n.marker : '', kind: 'text', groupId: n.groupId, status: n.status, tags: [...(n.tags || [])], color: n.color,
          sourceId: fromSource ? n.sourceId : null, srcIndex: fromSource ? n.srcIndex + k / 1000 : null, para: n.para, created: n.created + k / 1000,
        });
      });
      b.notes.splice(i, 1, ...made);
      ui.openId = made[0].id;
    });
    toast(`Split into ${parts.length} cards — same words, nothing removed`, 'Undo', () => S.undo());
  },
  'sel-group': async () => {
    const ids = selectedIds();
    const sug = keywords(ids.map(id => S.noteById(id).text), 2).map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(' & ');
    const name = await ask('Group together', sug || 'New group', 'Group name');
    if (!name) return;
    commit('Group selected', (b) => { const g = S.makeGroup(b, name); S.moveNotes(b, ids, g.id); });
    ui.selection.clear(); ui.selectMode = false; render();
  },
  'sel-move': () => {
    const ids = selectedIds();
    menu(`Move ${ids.length} notes to…`, [
      { icon: '📥', label: 'Inbox', run: () => { commit('Move', (b) => S.moveNotes(b, ids, null)); } },
      ...board().groups.map(g => ({ icon: `<span class="dot" style="--gc:var(--c-${g.color})"></span>`, label: esc(g.name), run: () => commit('Move', (b) => S.moveNotes(b, ids, g.id)) })),
    ], { html: true });
  },
  'sel-organise': () => {
    const ids = selectedIds();
    if (ids.length < 2) return toast('Select at least two notes.');
    const r = commit('Organise selected', (b) => S.organise(b, { scope: 'all', ids, keepHeadingGroups: false }));
    toast(`Organised into ${r.groups} groups`, 'Undo', () => S.undo());
    ui.selection.clear(); render();
  },
  'sel-status': () => {
    const ids = selectedIds();
    menu('Set status', STATUSES.map(s => ({ label: s.name, run: () => commit('Set status', (b) => ids.forEach(id => { const n = S.noteById(id, b); n.status = s.id; n.updated = Date.now(); })) })));
  },
  'sel-trash': () => trashNotes(selectedIds()),
  'sel-clear': () => { ui.selection.clear(); ui.selectMode = false; render(); },
};

function wire() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (a && a.tagName !== 'INPUT') {
      const fn = ACTIONS[a.dataset.action];
      if (fn) { e.preventDefault(); fn(a, e); }
      if (matchMedia('(max-width: 860px)').matches && a.closest('#sidebar') && !['new-board', 'new-group'].includes(a.dataset.action)) $('#app').classList.remove('side-open');
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) { openNote(open.dataset.open); return; }
  });

  // view interactions
  const v = viewEl();
  v.addEventListener('click', (e) => {
    if (e.target.closest('[data-action],[data-open],input,select,textarea')) return;
    const note = e.target.closest('[data-drag="note"]');
    if (note) noteClick(note.dataset.id, e);
    else if (!e.target.closest('.mm-tools') && ui.openId && !matchMedia('(max-width: 1100px)').matches) { /* keep inspector open on desktop */ }
  });
  v.addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList.contains('gname')) {
      const g = S.groupById(t.dataset.gid);
      const name = t.value.trim();
      if (g && name && name !== g.name) commit('Rename group', () => { g.name = name; g.updated = Date.now(); });
      else if (g) t.value = g.name;
    }
    if (t.dataset.action === 'toggle-titles') S.setSetting('showGroupTitles', t.checked);
  });
  v.addEventListener('keydown', (e) => { if (e.target.classList.contains('gname') && e.key === 'Enter') e.target.blur(); });
  v.addEventListener('input', (e) => { if (e.target.classList.contains('gname')) e.target.size = Math.max(4, e.target.value.length); });
  initDrag(v, {
    onDrop,
    label: (el) => {
      if (el.dataset.drag === 'group') return '▤ ' + (S.groupById(el.dataset.id)?.name || 'Group');
      const n = S.noteById(el.dataset.id);
      const extra = ui.selection.has(el.dataset.id) && ui.selection.size > 1 ? ` (+${ui.selection.size - 1} more)` : '';
      return (n ? n.text : '') + extra;
    },
    // groups are picked up by their header only
    canDrag: (el, e) => el.dataset.drag !== 'group' || !!e.target.closest('.ol-head, .kb-head'),
  });

  // views switcher
  $('#views').addEventListener('click', (e) => { const bn = e.target.closest('[data-view]'); if (bn) S.setSetting('view', bn.dataset.view); });

  // sidebar
  $('#board-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-board]');
    if (li) { ui.selection.clear(); ui.openId = null; ui.tag = null; S.switchBoard(li.dataset.board); if (matchMedia('(max-width: 860px)').matches) $('#app').classList.remove('side-open'); }
  });
  $('#group-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-gsec-go]');
    if (!li) return;
    const gid = li.dataset.gsecGo;
    let view = S.state.settings.view;
    if (view === 'document' || view === 'mindmap') { S.setSetting('view', 'outline'); view = 'outline'; }
    if (matchMedia('(max-width: 860px)').matches) $('#app').classList.remove('side-open');
    setTimeout(() => {
      const zone = document.querySelector(`#view [data-drop="${gid}"]`);
      const sec = zone?.closest('.ol-group, .kb-col, .cards-group') || zone;
      sec?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'start' });
      sec?.animate?.([{ boxShadow: '0 0 0 3px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200 });
    }, 30);
  });
  $('#tag-list').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tag]')?.dataset.tag;
    if (t) { ui.tag = ui.tag === t ? null : t; render(); }
  });

  // board name
  const bn = $('#board-name');
  bn.addEventListener('change', () => { const v2 = bn.value.trim(); if (v2) S.renameBoard(board().id, v2); else bn.value = board().name; });
  bn.addEventListener('keydown', (e) => { if (e.key === 'Enter') bn.blur(); });

  // search
  $('#search').addEventListener('input', debounce((e) => { ui.query = e.target.value; renderView(); }, 120));

  // capture
  const ta = $('#capture-input');
  ta.addEventListener('input', () => { autosize(ta); onCaptureInput(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); captureAdd(); }
    if (e.key === 'Escape') ta.blur();
  });
  $('#capture-target').addEventListener('click', chooseTarget);

  // paste a big chunk into the capture bar → offer import
  ta.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.split('\n').filter(l => l.trim()).length >= 4) {
      e.preventDefault();
      importDialog(text, 'Pasted notes ' + new Date().toLocaleDateString());
    }
  });

  // drop files anywhere
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const fl = [...e.dataTransfer.files];
    const first = await readImportFile(fl[0]);
    if (first.backup) return backupChoice(first.backup);
    importDialog(fl.length === 1 ? first.text : '', first.name);
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (modKey(e) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); (e.shiftKey ? ACTIONS.redo : ACTIONS.undo)(); return; }
    if (modKey(e) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); ACTIONS.redo(); return; }
    if (modKey(e) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); return; }
    if ($('.modal-wrap') || $('.bs')) return;
    if (e.key === 'Escape') {
      if (typing) { e.target.blur(); return; }
      if (ui.selection.size || ui.selectMode) { ui.selection.clear(); ui.selectMode = false; render(); return; }
      if (ui.openId) { ui.openId = null; render(); }
      return;
    }
    if (typing || modKey(e) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); ta.focus(); }
    else if (k === 'b') { e.preventDefault(); brainstorm(); }
    else if (k === 'o') { e.preventDefault(); organiseOneClick(); }
    else if (k === '/') { e.preventDefault(); $('#search').focus(); }
    else if ('12345'.includes(k)) S.setSetting('view', ['outline', 'kanban', 'mindmap', 'cards', 'document'][+k - 1]);
    else if ((k === 'backspace' || k === 'delete') && (ui.selection.size || ui.openId)) { e.preventDefault(); trashNotes(ui.selection.size ? selectedIds() : [ui.openId]); }
    else if (k === 'a' && ui.selectMode) { S.live().forEach(n => ui.selection.add(n.id)); render(); }
  });

  // save immediately when the app is backgrounded or closed (iOS may suspend it at any time)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.flush(); });
  window.addEventListener('pagehide', () => S.flush());

  window.addEventListener('resize', debounce(() => { if (S.state.settings.view === 'mindmap') renderView(); }, 200));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render());
}

// expose for debugging / tests
window.mindapp = { S, ui, uid };
