// State, persistence (IndexedDB with localStorage fallback), undo/redo and merge-sync.
import { uid, COLORS } from './util.js';
import { segment, verifyLossless, stripWs } from './parse.js';
import { clusterNotes, sequenceNotes, hashtags, assignToGroups } from './nlp.js';

const DB = 'mindapp', STORE = 'kv', KEY = 'state';
const listeners = new Set();
const undoStack = [], redoStack = [];

export let state = null;

export function newBoard(name = 'My Ideas') {
  const now = Date.now();
  return { id: uid('b'), name, created: now, updated: now, groups: [], notes: [], sources: [], deleted: {} };
}

function defaultState() {
  const b = newBoard('My Ideas');
  return { v: 1, boards: [b], currentBoardId: b.id, settings: { view: 'outline', theme: 'auto', splitMode: 'sentence', kanbanBy: 'group', showGroupTitles: true } };
}

export const board = () => state.boards.find(b => b.id === state.currentBoardId) || state.boards[0];

// ---------- persistence ----------
function idb() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return rej(new Error('no idb'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet() {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction(STORE).objectStore(STORE).get(KEY); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}
async function idbSet(v) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

export async function load() {
  let raw = null, mirror = null;
  try { raw = await idbGet(); } catch { /* fall back */ }
  try { mirror = JSON.parse(localStorage.getItem('mindapp:' + KEY) || 'null'); } catch { mirror = null; }
  if (mirror && (!raw || (mirror.savedAt || 0) > (raw.savedAt || 0))) raw = mirror;
  state = raw && raw.boards?.length ? migrate(raw) : defaultState();
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
  return state;
}

function migrate(s) {
  s.settings = { ...defaultState().settings, ...(s.settings || {}) };
  s.boards.forEach(b => { b.deleted ||= {}; b.sources ||= []; b.groups ||= []; b.notes ||= []; });
  if (!s.boards.some(b => b.id === s.currentBoardId)) s.currentBoardId = s.boards[0].id;
  return s;
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
/** Write now: IndexedDB (primary) plus a synchronous localStorage mirror so nothing is lost if the app is closed mid-save. */
export function flush() {
  clearTimeout(saveTimer);
  if (!state) return;
  state.savedAt = Date.now();
  const text = JSON.stringify(state);
  try { localStorage.setItem('mindapp:' + KEY, text); } catch { try { localStorage.removeItem('mindapp:' + KEY); } catch { /* */ } }
  idbSet(JSON.parse(text)).catch(() => {});
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(reason) { listeners.forEach(fn => fn(reason)); }

// ---------- mutations with undo ----------
export function commit(label, fn) {
  const b = board();
  undoStack.push({ boardId: b.id, snap: JSON.stringify(b), label });
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  const r = fn(b);
  b.updated = Date.now();
  save(); emit(label);
  return r;
}
function restore(from, to) {
  const e = from.pop();
  if (!e) return null;
  const i = state.boards.findIndex(b => b.id === e.boardId);
  if (i < 0) return null;
  to.push({ boardId: e.boardId, snap: JSON.stringify(state.boards[i]), label: e.label });
  state.boards[i] = JSON.parse(e.snap);
  state.currentBoardId = e.boardId;
  save(); emit('undo');
  return e.label;
}
export const undo = () => restore(undoStack, redoStack);
export const redo = () => restore(redoStack, undoStack);
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function setSetting(k, v) { state.settings[k] = v; save(); emit('settings'); }

// ---------- queries ----------
export const live = (b = board()) => b.notes.filter(n => !n.trashed);
export const trashed = (b = board()) => b.notes.filter(n => n.trashed);
export const notesIn = (gid, b = board()) => b.notes.filter(n => !n.trashed && (n.groupId || null) === (gid || null));
export const groupById = (id, b = board()) => b.groups.find(g => g.id === id);
export const noteById = (id, b = board()) => b.notes.find(n => n.id === id);
export function allTags(b = board()) {
  const m = new Map();
  live(b).forEach(n => [...(n.tags || []), ...hashtags(n.text)].forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------- note helpers (call inside commit) ----------
export function makeNote(text, extra = {}) {
  const now = Date.now();
  return { id: uid('n'), text, orig: null, marker: '', kind: 'text', groupId: null, status: 'idea', tags: [], color: null, sourceId: null, srcIndex: null, created: now, updated: now, trashed: false, ...extra };
}

export function makeGroup(b, name, color) {
  const g = { id: uid('g'), name, color: color || COLORS[b.groups.length % COLORS.length], collapsed: false, updated: Date.now() };
  b.groups.push(g);
  return g;
}

/** Move note(s) to a group, optionally before a given note id (sequence position). */
export function moveNotes(b, ids, groupId, beforeId = null) {
  const moving = ids.map(id => b.notes.find(n => n.id === id)).filter(Boolean);
  b.notes = b.notes.filter(n => !ids.includes(n.id));
  const now = Date.now();
  moving.forEach(n => { n.groupId = groupId || null; n.updated = now; });
  let at = beforeId ? b.notes.findIndex(n => n.id === beforeId) : -1;
  if (at < 0) {
    // after the last note of that group (or at end)
    let last = -1;
    b.notes.forEach((n, i) => { if ((n.groupId || null) === (groupId || null)) last = i; });
    at = last < 0 ? b.notes.length : last + 1;
  }
  b.notes.splice(at, 0, ...moving);
}

export function moveGroup(b, gid, beforeGid = null) {
  const g = b.groups.find(x => x.id === gid);
  if (!g) return;
  b.groups = b.groups.filter(x => x.id !== gid);
  const at = beforeGid ? b.groups.findIndex(x => x.id === beforeGid) : -1;
  b.groups.splice(at < 0 ? b.groups.length : at, 0, g);
  g.updated = Date.now();
}

/** Import text losslessly. Returns {count, lossless, groups}. */
export function importText(b, text, { name = 'Imported note', mode = 'sentence', headingsAsGroups = true } = {}) {
  const segs = segment(text, { mode, detectHeadings: headingsAsGroups });
  const lossless = verifyLossless(text, segs);
  if (!lossless) throw new Error('Import safety check failed — nothing was changed.');
  const now = Date.now();
  const src = { id: uid('s'), name, importedAt: now, text, mode, hash: stripWs(text).length };
  b.sources.push(src);
  let currentGroup = null;
  let groupsMade = 0;
  let endPara = Infinity; // a detected (non-#) heading only covers the block right under it
  segs.forEach((s, i) => {
    if (currentGroup && s.para > endPara) currentGroup = null;
    if (s.kind === 'heading' && headingsAsGroups) {
      currentGroup = makeGroup(b, s.text.replace(/:$/, ''));
      groupsMade++;
      const markdown = s.marker.startsWith('#');
      const alone = segs[i + 1] && segs[i + 1].para !== s.para;
      endPara = markdown ? Infinity : alone ? s.para + 1 : s.para;
    }
    b.notes.push(makeNote(s.text, {
      orig: s.text, marker: s.marker, kind: s.kind, groupId: currentGroup ? currentGroup.id : null,
      sourceId: src.id, srcIndex: i, para: s.para, created: now + i, updated: now,
    }));
  });
  return { count: segs.length, lossless, groups: groupsMade, sourceId: src.id };
}

/** Add a freshly written thought (brainstorm / quick capture). Optionally split into sentences losslessly. */
export function addThought(b, text, { groupId = null, split = false, beforeId = null } = {}) {
  const pieces = split ? segment(text, { mode: 'sentence', detectHeadings: false }) : [{ text: text.trim(), marker: '', kind: 'text' }];
  const now = Date.now();
  const made = pieces.filter(p => p.text).map((p, i) => makeNote(p.text, { marker: p.marker, groupId, created: now + i }));
  if (beforeId) {
    const at = b.notes.findIndex(n => n.id === beforeId);
    b.notes.splice(at < 0 ? b.notes.length : at, 0, ...made);
  } else {
    let last = -1;
    b.notes.forEach((n, i) => { if ((n.groupId || null) === (groupId || null) && !n.trashed) last = i; });
    b.notes.splice(last < 0 ? b.notes.length : last + 1, 0, ...made);
  }
  return made;
}

/**
 * One-click organise: cluster notes into topic groups and sequence each group.
 * scope: 'all' | 'inbox' | 'selected' (ids)
 */
export function organise(b, { scope = 'all', ids = null, granularity = 0.5, sequence = 'flow', keepHeadingGroups = true, useTags = true } = {}) {
  let pool = live(b);
  let filed = 0;
  if (scope === 'inbox') {
    // 1) file new notes into the groups you already have, 2) cluster the rest into new groups
    pool = pool.filter(n => !n.groupId || !b.groups.some(g => g.id === n.groupId)).filter(n => n.kind !== 'heading');
    const docs = b.groups.map(g => ({ id: g.id, name: g.name, texts: notesIn(g.id, b).map(n => n.text) }));
    const hits = assignToGroups(pool.map(n => n.text), docs);
    const rest = [];
    pool.forEach((n, i) => { if (hits.has(i)) { moveNotes(b, [n.id], hits.get(i)); filed++; } else rest.push(n); });
    pool = rest;
    keepHeadingGroups = false;
  }
  if (ids) pool = pool.filter(n => ids.includes(n.id));
  let headingGroups = new Set();
  if (scope === 'all' && keepHeadingGroups) {
    // notes that live under a heading from your own notes keep that structure
    headingGroups = new Set(pool.filter(n => n.kind === 'heading' && n.groupId).map(n => n.groupId));
    pool = pool.filter(n => !headingGroups.has(n.groupId));
  }
  const clusterable = pool.filter(n => n.kind !== 'heading');
  const clusters = clusterable.length ? clusterNotes(clusterable.map(n => ({ id: n.id, text: n.text })), { granularity, useTags }) : [];
  // leftovers that match one of your own heading sections go there
  const other = clusters.find(c => c.name === 'Other thoughts');
  if (other && headingGroups.size) {
    const docs = [...headingGroups].map(id => ({ id, name: groupById(id, b)?.name || '', texts: notesIn(id, b).map(n => n.text) }));
    const hits = assignToGroups(other.ids.map(id => noteById(id, b).text), docs);
    const keep = [];
    other.ids.forEach((id, i) => { if (hits.has(i)) { moveNotes(b, [id], hits.get(i)); filed++; } else keep.push(id); });
    other.ids = keep;
    if (!keep.length) clusters.splice(clusters.indexOf(other), 1);
  }

  // reuse groups that become empty (except heading groups), match by name
  const beforeGroupIds = new Set(pool.map(n => n.groupId).filter(Boolean));
  const usedGroupIds = new Set();
  const created = [];
  clusters.forEach(c => {
    let g = b.groups.find(x => x.name.toLowerCase() === c.name.toLowerCase() && !usedGroupIds.has(x.id));
    if (!g) { g = makeGroup(b, c.name); created.push(g.id); }
    usedGroupIds.add(g.id);
    const members = c.ids.map(id => b.notes.find(n => n.id === id));
    const ordered = sequenceNotes(members.map(n => ({ ...n, srcOrder: n.created })), sequence).map(x => x.id);
    moveNotes(b, ordered, g.id);
  });
  // drop groups emptied by organising (never notes — only empty containers)
  b.groups = b.groups.filter(g => usedGroupIds.has(g.id) || !beforeGroupIds.has(g.id) || notesIn(g.id, b).length);
  return { groups: clusters.length, notes: clusterable.length, created: created.length, filed };
}

export function sequenceGroup(b, gid, method) {
  const members = notesIn(gid, b);
  const ordered = sequenceNotes(members.map(n => ({ ...n, srcOrder: n.created })), method).map(x => x.id);
  moveNotes(b, ordered, gid);
}

export function sequenceGroups(b, method) {
  if (method === 'alpha') b.groups.sort((a, c) => a.name.localeCompare(c.name));
  else if (method === 'size') b.groups.sort((a, c) => notesIn(c.id, b).length - notesIn(a.id, b).length);
  else if (method === 'original') {
    const first = gid => Math.min(...notesIn(gid, b).map(n => n.created), Infinity);
    b.groups.sort((a, c) => first(a.id) - first(c.id));
  }
}

/** Verbatim integrity report for every source in the board. */
export function integrity(b = board()) {
  return b.sources.map(src => {
    const notes = b.notes.filter(n => n.sourceId === src.id).sort((a, c) => a.srcIndex - c.srcIndex);
    const deletedCount = Object.values(b.deleted || {}).filter(d => d && d.sourceId === src.id).length;
    const rebuilt = notes.map(n => (n.marker || '') + n.orig).join('');
    const complete = stripWs(src.text) === stripWs(rebuilt);
    const edited = notes.filter(n => !n.trashed && n.text !== n.orig).length;
    const inTrash = notes.filter(n => n.trashed).length;
    const present = notes.filter(n => !n.trashed).length;
    return { src, total: notes.length + deletedCount, present, edited, inTrash, deleted: deletedCount, complete };
  });
}

export function emptyTrash(b) {
  const now = Date.now();
  b.notes.filter(n => n.trashed).forEach(n => { b.deleted[n.id] = { at: now, sourceId: n.sourceId }; });
  b.notes = b.notes.filter(n => !n.trashed);
}

// ---------- sync / merge ----------
export function exportState() {
  return { app: 'mindapp', v: 1, exportedAt: Date.now(), boards: JSON.parse(JSON.stringify(state.boards)) };
}

/** Merge another device's backup: newest edit of each note/group wins; nothing is silently dropped. */
export function mergeBackup(data, { replace = false } = {}) {
  if (!data || data.app !== 'mindapp' || !Array.isArray(data.boards)) throw new Error('This file is not a Mindapp backup.');
  undoStack.length = 0; redoStack.length = 0;
  if (replace) {
    state.boards = data.boards;
    state.currentBoardId = data.boards[0]?.id;
    migrate(state);
    save(); emit('sync');
    return { added: data.boards.length, merged: 0 };
  }
  let added = 0, merged = 0;
  data.boards.forEach(inc => {
    const mine = state.boards.find(b => b.id === inc.id);
    if (!mine) { state.boards.push(inc); added++; return; }
    merged++;
    const newer = (inc.updated || 0) > (mine.updated || 0);
    mine.deleted = { ...(mine.deleted || {}), ...(inc.deleted || {}) };
    const mergeList = (a, b2) => {
      const map = new Map(a.map(x => [x.id, x]));
      b2.forEach(x => { const y = map.get(x.id); if (!y || (x.updated || 0) > (y.updated || 0)) map.set(x.id, x); });
      const primary = newer ? b2 : a, secondary = newer ? a : b2;
      const order = [...primary.map(x => x.id), ...secondary.map(x => x.id).filter(id => !primary.some(p => p.id === id))];
      return order.map(id => map.get(id)).filter(x => x && !mine.deleted[x.id]);
    };
    mine.notes = mergeList(mine.notes, inc.notes || []);
    mine.groups = mergeList(mine.groups, inc.groups || []);
    const srcIds = new Set(mine.sources.map(s => s.id));
    (inc.sources || []).forEach(s => { if (!srcIds.has(s.id)) mine.sources.push(s); });
    if (newer) mine.name = inc.name;
    mine.updated = Math.max(mine.updated || 0, inc.updated || 0);
  });
  migrate(state);
  save(); emit('sync');
  return { added, merged };
}

export function switchBoard(id) { state.currentBoardId = id; save(); emit('board'); }
export function addBoard(name) { const b = newBoard(name); state.boards.push(b); state.currentBoardId = b.id; save(); emit('board'); return b; }
export function deleteBoard(id) {
  if (state.boards.length === 1) return false;
  state.boards = state.boards.filter(b => b.id !== id);
  if (state.currentBoardId === id) state.currentBoardId = state.boards[0].id;
  save(); emit('board');
  return true;
}
export function renameBoard(id, name) { const b = state.boards.find(x => x.id === id); if (b) { b.name = name; b.updated = Date.now(); save(); emit('board'); } }

/** Erase everything on this device. */
export function wipe() {
  clearTimeout(saveTimer);
  state = null;
  try { localStorage.removeItem('mindapp:' + KEY); } catch { /* */ }
  try { indexedDB.deleteDatabase(DB); } catch { /* */ }
}

// test hook
export function _setState(s) { state = migrate(s); }
