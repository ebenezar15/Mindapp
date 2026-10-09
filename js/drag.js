// Pointer-based drag & drop that works with mouse, trackpad, Apple Pencil and touch.
// Touch: press-and-hold (~300ms) to pick a card up, so normal scrolling still works.
//
// Draggables: elements with [data-drag="note|group"] and [data-id].
// Drop zones: elements with [data-drop="<groupId>|inbox"] and optional
// [data-axis="x|y"] describing how children are laid out (default y).

let active = null;
let suppressClick = false;

document.addEventListener('click', (e) => {
  if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
}, true);

document.addEventListener('touchmove', (e) => { if (active?.dragging) e.preventDefault(); }, { passive: false });

export function initDrag(root, { onDrop, canDrag = () => true, label = (el) => el.textContent }) {
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || active) return;
    const el = e.target.closest('[data-drag]');
    if (!el || !root.contains(el)) return;
    if (e.target.closest('input,textarea,select,button:not([data-drag]),[contenteditable="true"],.no-drag')) return;
    if (!canDrag(el, e)) return;
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    active = { el, id: el.dataset.id, type: el.dataset.drag, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch, dragging: false, pid: e.pointerId };
    if (touch) {
      active.timer = setTimeout(() => { if (active && !active.dragging) start(); }, 300);
    }
    const move = (ev) => {
      if (!active || ev.pointerId !== active.pid) return;
      active.x = ev.clientX; active.y = ev.clientY;
      const dist = Math.hypot(ev.clientX - active.x0, ev.clientY - active.y0);
      if (!active.dragging) {
        if (active.touch) { if (dist > 10) cancel(); return; } // it's a scroll
        if (dist > 6) start(); else return;
      }
      update();
    };
    const up = (ev) => {
      if (!active || ev.pointerId !== active.pid) return;
      if (active.dragging) finish(); else cancel();
    };
    const cancel = () => {
      if (!active) return;
      clearTimeout(active.timer);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', onCancel);
      active?.ghost?.remove();
      active?.marker?.remove();
      active?.el.classList.remove('drag-source');
      document.body.classList.remove('dragging');
      document.querySelectorAll('.drop-hover').forEach(z => z.classList.remove('drop-hover'));
      cancelAnimationFrame(active?.raf);
      active = null;
    };
    const onCancel = () => { if (active?.dragging) return; cancel(); };
    const start = () => {
      active.dragging = true;
      try { navigator.vibrate?.(10); } catch { /* ignore */ }
      const r = active.el.getBoundingClientRect();
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = label(active.el);
      ghost.style.width = Math.min(Math.max(r.width, 160), 320) + 'px';
      document.body.appendChild(ghost);
      active.ghost = ghost;
      active.offX = Math.min(active.x0 - r.left, 40);
      active.offY = Math.min(active.y0 - r.top, 24);
      const marker = document.createElement('div');
      marker.className = 'drop-marker';
      document.body.appendChild(marker);
      active.marker = marker;
      active.el.classList.add('drag-source');
      document.body.classList.add('dragging');
      window.getSelection?.()?.removeAllRanges();
      autoscroll();
      update();
    };
    const autoscroll = () => {
      if (!active) return;
      // scroll the nearest container that can move in the direction the finger is pushing,
      // falling back to the list the card came from (e.g. when over the capture bar)
      const under = document.elementFromPoint(active.x, active.y);
      const edge = 50, sp = 14;
      const push = (axis, pos) => {
        const el = scrollerFor(under, axis) || scrollerFor(active.el, axis);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const [lo, hi] = axis === 'y' ? [r.top, r.bottom] : [r.left, r.right];
        if (pos < lo + edge) el[axis === 'y' ? 'scrollTop' : 'scrollLeft'] -= sp;
        else if (pos > hi - edge) el[axis === 'y' ? 'scrollTop' : 'scrollLeft'] += sp;
      };
      push('y', active.y);
      push('x', active.x);
      active.raf = requestAnimationFrame(autoscroll);
    };
    const update = () => {
      const a = active;
      a.ghost.style.transform = `translate(${a.x - a.offX}px, ${a.y - a.offY}px)`;
      const hit = target(a);
      document.querySelectorAll('.drop-hover').forEach(z => { if (z !== hit?.zone) z.classList.remove('drop-hover'); });
      a.hit = hit;
      if (!hit) { a.marker.style.display = 'none'; return; }
      hit.zone.classList.add('drop-hover');
      if (hit.rect) {
        a.marker.style.display = 'block';
        const m = hit.rect;
        if (hit.axis !== 'y') Object.assign(a.marker.style, { left: m.x - 2 + 'px', top: m.top + 'px', width: '4px', height: m.h + 'px' });
        else Object.assign(a.marker.style, { left: m.left + 'px', top: m.y - 2 + 'px', width: m.w + 'px', height: '4px' });
      } else a.marker.style.display = 'none';
    };
    const finish = () => {
      const a = active;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 50);
      const hit = a.hit;
      cleanup();
      if (hit) onDrop({ id: a.id, type: a.type, zone: hit.zone.dataset.drop, zoneType: hit.zone.dataset.dropType || 'group', beforeId: hit.beforeId });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', onCancel);
  });
}

function scrollerFor(el, axis) {
  while (el && el !== document.body) {
    const st = getComputedStyle(el);
    if (axis === 'y' && /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
    if (axis === 'x' && /(auto|scroll)/.test(st.overflowX) && el.scrollWidth > el.clientWidth + 1) return el;
    el = el.parentElement;
  }
  return null;
}

function target(a) {
  const under = document.elementFromPoint(a.x, a.y);
  if (!under) return null;
  // groups are dropped onto group-level zones; notes onto note zones
  const sel = a.type === 'group' ? '[data-drop][data-accept~="group"]' : '[data-drop]:not([data-accept="group"])';
  let zone = under.closest(sel);
  // anywhere on a column / group section counts as dropping into its list
  if (!zone && a.type !== 'group') zone = under.closest('[data-drop-proxy]')?.querySelector(sel) || null;
  if (!zone) return null;
  if (zone.dataset.drop === a.id) return null;
  const axis = zone.dataset.axis || 'y';
  const kids = [...zone.querySelectorAll(`:scope [data-drag="${a.type}"]`)].filter(k => k !== a.el && closestZone(k, sel) === zone);
  if (zone.dataset.noOrder !== undefined || !kids.length) {
    if (!kids.length && zone.dataset.noOrder === undefined) {
      const zr = zone.getBoundingClientRect();
      return { zone, beforeId: null, axis, rect: axis !== 'y' ? { x: zr.left + 8, top: zr.top, h: zr.height } : { left: zr.left + 8, y: zr.top + 12, w: zr.width - 16 } };
    }
    return { zone, beforeId: null, axis };
  }
  let before = null;
  for (const k of kids) {
    const r = k.getBoundingClientRect();
    if (axis === 'grid') {
      if (a.y < r.top || (a.y <= r.bottom && a.x < r.left + r.width / 2)) { before = k; break; }
      continue;
    }
    const mid = axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
    if ((axis === 'x' ? a.x : a.y) < mid) { before = k; break; }
  }
  const ref = before || kids[kids.length - 1];
  const r = ref.getBoundingClientRect();
  const rect = axis !== 'y'
    ? { x: before ? r.left - 5 : r.right + 5, top: r.top, h: r.height }
    : { left: r.left, y: before ? r.top - 4 : r.bottom + 4, w: r.width };
  return { zone, beforeId: before ? before.dataset.id : null, afterLast: !before, axis, rect };
}

function closestZone(el, sel) { return el.parentElement?.closest(sel); }
