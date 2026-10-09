// Balanced, two-sided mind map rendered in SVG with pan, zoom (wheel, trackpad
// pinch, touch pinch), collapsible branches and drag-a-note-onto-a-branch to regroup.
import { esc } from './util.js';

const views = new Map(); // boardId → {tx, ty, k}
let measureCtx = null;

function measure(text, font) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function wrap(text, maxW, font, maxLines = 4) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (measure(t, font) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  const used = lines.join(' ').length;
  if (used < String(text).length - 1) {
    let last = lines[lines.length - 1];
    while (last.length && measure(last + '…', font) > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  // hard-break very long single words
  return lines.map(l => {
    while (measure(l, font) > maxW && l.length > 3) l = l.slice(0, -2) + '…';
    return l;
  });
}

const FONT_NOTE = '13px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const FONT_GROUP = '700 15px ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif';
const FONT_ROOT = '700 18px ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif';

function box(text, font, maxW, lh, padX, padY, maxLines) {
  const lines = wrap(text, maxW, font, maxLines);
  const w = Math.max(...lines.map(l => measure(l, font))) + padX * 2;
  return { lines, w: Math.ceil(w), h: lines.length * lh + padY * 2, lh, padX, padY };
}

export function renderMindmap(ctx) {
  return `<div class="mindmap" id="mm"><svg id="mm-svg" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="mm-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset=".55" stop-color="#a855f7"/><stop offset="1" stop-color="#d946ef"/></linearGradient></defs><g id="mm-vp"></g></svg>
    <div class="mm-tools">
      <button data-mm="in" title="Zoom in" aria-label="Zoom in">＋</button>
      <button data-mm="out" title="Zoom out" aria-label="Zoom out">－</button>
      <button data-mm="fit" title="Fit to screen" aria-label="Fit">⤢</button>
      <button data-mm="toggle" title="Collapse / expand all" aria-label="Collapse or expand all">◎</button>
    </div>
    <div class="mm-hint">Drag a note onto a branch to regroup · tap a branch to fold</div>
  </div>`;
}

export function mountMindmap(ctx, actions) {
  const host = document.getElementById('mm');
  const vp = document.getElementById('mm-vp');
  if (!host) return;
  const b = ctx.board;

  // ---------- layout ----------
  const root = { kind: 'root', ...box(b.name || 'Ideas', FONT_ROOT, 220, 22, 18, 12, 3), x: 0, y: 0 };
  const branches = [];
  const inbox = ctx.visible(null);
  if (inbox.length) branches.push({ id: null, name: 'Inbox', color: 'gray', notes: inbox, collapsed: !!ctx.inboxCollapsed });
  b.groups.forEach(g => {
    const notes = ctx.visible(g.id);
    if (ctx.filtering && !notes.length) return;
    branches.push({ id: g.id, name: g.name, color: g.color, notes, collapsed: g.collapsed });
  });
  branches.forEach(br => {
    Object.assign(br, box(br.name, FONT_GROUP, 180, 19, 14, 9, 2));
    br.leaves = br.collapsed ? [] : br.notes.map(n => ({ note: n, ...box((n.marker && n.kind !== 'heading' ? n.marker + ' ' : '') + n.text, FONT_NOTE, 230, 17, 11, 7, 4) }));
    const GAP = 8;
    br.leafH = br.leaves.reduce((s, l) => s + l.h, 0) + Math.max(0, br.leaves.length - 1) * GAP;
    br.block = Math.max(br.h, br.leafH);
  });
  // balance left / right by block height
  const right = [], left = [];
  let rh = 0, lh = 0;
  branches.forEach(br => { if (rh <= lh) { right.push(br); rh += br.block + 28; } else { left.push(br); lh += br.block + 28; } });
  const place = (list, side) => {
    const total = list.reduce((s, br) => s + br.block, 0) + Math.max(0, list.length - 1) * 28;
    let y = -total / 2;
    const gx = side * (root.w / 2 + 90);
    list.forEach(br => {
      br.side = side;
      br.y = y + br.block / 2;
      br.x = side > 0 ? gx : gx - br.w; // left edge x
      let ly = br.y - br.leafH / 2;
      const lx = side > 0 ? br.x + br.w + 60 : br.x - 60;
      br.leaves.forEach(l => {
        l.y = ly + l.h / 2;
        l.x = side > 0 ? lx : lx - l.w;
        ly += l.h + 8;
      });
      y += br.block + 28;
    });
  };
  place(right, 1); place(left, -1);

  // ---------- draw ----------
  const curve = (x1, y1, x2, y2) => { const mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };
  const text = (bx, lines, x, y, h) => {
    const top = y - h / 2 + bx.padY;
    return `<text>${lines.map((l, i) => `<tspan x="${x + bx.padX}" y="${top + bx.lh * (i + 0.78)}">${esc(l)}</tspan>`).join('')}</text>`;
  };
  let links = '', nodes = '';
  branches.forEach(br => {
    const col = `var(--c-${br.color})`;
    const rx = br.side > 0 ? root.w / 2 : -root.w / 2;
    const bx = br.side > 0 ? br.x : br.x + br.w;
    links += `<path class="mm-link" stroke="${col}" stroke-width="3" d="${curve(rx, 0, bx, br.y)}"/>`;
    br.leaves.forEach(l => {
      const sx = br.side > 0 ? br.x + br.w : br.x;
      const ex = br.side > 0 ? l.x : l.x + l.w;
      links += `<path class="mm-link" stroke="${col}" d="${curve(sx, br.y, ex, l.y)}"/>`;
      const sel = ctx.selection.has(l.note.id) || ctx.openId === l.note.id;
      const fill = l.note.color ? ` style="fill:color-mix(in srgb, var(--c-${l.note.color}) 18%, var(--panel))"` : '';
      nodes += `<g class="mm-node${sel ? ' selected' : ''}" data-drag="note" data-id="${l.note.id}">
        <rect x="${l.x}" y="${l.y - l.h / 2}" width="${l.w}" height="${l.h}" rx="8"${fill}/>
        ${text(l, l.lines, l.x, l.y, l.h)}</g>`;
    });
    const hidden = br.collapsed && br.notes.length ? br.notes.length : 0;
    nodes += `<g class="mm-node mm-group" data-drop="${br.id || 'inbox'}" data-no-order data-branch="${br.id || ''}" data-label="${esc(br.name)}">
      <rect x="${br.x}" y="${br.y - br.h / 2}" width="${br.w}" height="${br.h}" rx="${br.h / 2}" style="fill:color-mix(in srgb, ${col} 20%, var(--panel));stroke:${col};stroke-width:2"/>
      ${text(br, br.lines, br.x, br.y, br.h)}
      ${hidden ? `<g><circle cx="${br.side > 0 ? br.x + br.w + 14 : br.x - 14}" cy="${br.y}" r="12" fill="${col}"/><text x="${br.side > 0 ? br.x + br.w + 14 : br.x - 14}" y="${br.y + 4}" text-anchor="middle" style="fill:#fff;font-size:11px;font-weight:700">${hidden}</text></g>` : ''}
    </g>`;
  });
  nodes += `<g class="mm-node mm-root" data-drop="inbox" data-no-order>
    <rect x="${-root.w / 2}" y="${-root.h / 2}" width="${root.w}" height="${root.h}" rx="14"/>
    ${text(root, root.lines, -root.w / 2, 0, root.h)}</g>`;
  vp.innerHTML = links + nodes;

  // ---------- pan & zoom ----------
  let v = views.get(b.id);
  const fit = () => {
    const bb = vp.getBBox();
    const W = host.clientWidth, H = host.clientHeight;
    if (!bb.width || !W) return;
    const k = Math.min(1.4, Math.max(0.15, Math.min((W - 60) / bb.width, (H - 80) / bb.height)));
    v = { k, tx: W / 2 - (bb.x + bb.width / 2) * k, ty: H / 2 - (bb.y + bb.height / 2) * k };
    apply();
  };
  const apply = () => { vp.setAttribute('transform', `translate(${v.tx},${v.ty}) scale(${v.k})`); views.set(b.id, v); };
  const zoomAt = (f, cx, cy) => {
    const k = Math.min(3, Math.max(0.12, v.k * f));
    const r = host.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    v = { k, tx: px - (px - v.tx) * (k / v.k), ty: py - (py - v.ty) * (k / v.k) };
    apply();
  };
  if (!v) fit(); else apply();

  host.querySelector('.mm-tools').addEventListener('click', (e) => {
    const t = e.target.closest('[data-mm]')?.dataset.mm;
    const r = host.getBoundingClientRect();
    if (t === 'in') zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2);
    if (t === 'out') zoomAt(0.8, r.left + r.width / 2, r.top + r.height / 2);
    if (t === 'fit') fit();
    if (t === 'toggle') { actions.toggleAll(); views.delete(b.id); }
  });

  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else { v = { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }; apply(); }
  }, { passive: false });

  // Safari trackpad pinch
  let gScale = 1;
  host.addEventListener('gesturestart', (e) => { e.preventDefault(); gScale = 1; });
  host.addEventListener('gesturechange', (e) => { e.preventDefault(); zoomAt(e.scale / gScale, e.clientX, e.clientY); gScale = e.scale; });

  const pts = new Map();
  let pan = null, pinch = null, moved = false;
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.mm-tools')) return;
    const onNote = e.target.closest('[data-drag]');
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, c] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - c.x, a.y - c.y), cx: (a.x + c.x) / 2, cy: (a.y + c.y) / 2 };
      pan = null;
      return;
    }
    if (onNote && e.pointerType === 'mouse') return; // mouse drag on a note = move note
    pan = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty, onNote: !!onNote };
    moved = false;
  });
  host.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, c] = [...pts.values()];
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      zoomAt(d / pinch.d, (a.x + c.x) / 2, (a.y + c.y) / 2);
      pinch.d = d;
      return;
    }
    if (!pan || document.body.classList.contains('dragging')) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true;
    host.classList.add('panning');
    v = { ...v, tx: pan.tx + dx, ty: pan.ty + dy };
    apply();
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) { pan = null; host.classList.remove('panning'); }
  };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
  host.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); moved = false; return; }
    const br = e.target.closest('[data-branch]');
    if (br) { e.stopPropagation(); actions.toggleBranch(br.dataset.branch || null); }
  }, true);
  host.addEventListener('dblclick', (e) => {
    const br = e.target.closest('[data-branch]');
    if (br && br.dataset.branch) { e.stopPropagation(); actions.renameGroup(br.dataset.branch); }
    else if (e.target.closest('.mm-root')) actions.renameBoard();
  });
}

export function resetMindmapView(boardId) { views.delete(boardId); }
