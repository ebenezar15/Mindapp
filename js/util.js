export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const COLORS = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'teal', 'gray'];

export const STATUSES = [
  { id: 'idea', name: 'Idea' },
  { id: 'exploring', name: 'Exploring' },
  { id: 'ready', name: 'Ready' },
  { id: 'done', name: 'Done' },
];

export function fmtDate(ts) {
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
}

export const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const modKey = (e) => (isApple ? e.metaKey : e.ctrlKey);

/** Highlight #tags inside already-escaped text. */
export function richText(s) {
  return esc(s).replace(/(^|\s)(#[\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu, '$1<span class="tag">$2</span>');
}
