// Export your board as Markdown, plain text, OPML (opens in MindNode, iThoughts…) or HTML.
// Exports contain your sentences exactly as they are — the only additions are
// optional group titles, which you can switch off.
import { esc } from './util.js';
import { live } from './store.js';

/** Ordered sections: [{ group|null, notes: [...] }] */
export function sections(b) {
  const notes = live(b);
  const out = [];
  const inbox = notes.filter(n => !n.groupId || !b.groups.some(g => g.id === n.groupId));
  if (inbox.length) out.push({ group: null, notes: inbox });
  b.groups.forEach(g => {
    const ns = notes.filter(n => n.groupId === g.id);
    if (ns.length) out.push({ group: g, notes: ns });
  });
  return out;
}

/** Split a section's notes into paragraphs: consecutive sentences of the same source paragraph stay together. */
export function paragraphs(notes) {
  const paras = [];
  let cur = null, prev = null;
  notes.forEach(n => {
    const joins = prev && cur && n.kind === 'text' && !n.marker && prev.kind !== 'heading' && !prev.marker
      ? (n.sourceId && n.sourceId === prev.sourceId && n.para === prev.para && n.srcIndex > prev.srcIndex && n.srcIndex - prev.srcIndex <= 1.0001)
      : false;
    const contItem = prev && cur && cur.type === 'item' && n.kind === 'text' && !n.marker && n.sourceId && n.sourceId === prev.sourceId && n.srcIndex - prev.srcIndex <= 1.0001 && n.para === prev.para;
    if (joins || contItem) { cur.notes.push(n); }
    else {
      cur = { type: n.kind === 'heading' ? 'heading' : n.marker ? 'item' : 'text', notes: [n] };
      paras.push(cur);
    }
    prev = n;
  });
  return paras;
}

const line = (n) => (n.marker && n.kind !== 'heading' ? n.marker + ' ' : '') + n.text;

export function toMarkdown(b, { titles = true } = {}) {
  const out = [`# ${b.name}`, ''];
  sections(b).forEach(({ group, notes }) => {
    if (titles) out.push(`## ${group ? group.name : 'Inbox'}`, '');
    paragraphs(notes).forEach(p => {
      if (p.type === 'heading') out.push(`### ${p.notes[0].text}`, '');
      else if (p.type === 'item') { out.push(p.notes.map(line).join(' ')); }
      else out.push(p.notes.map(n => n.text).join(' '), '');
    });
    if (out[out.length - 1] !== '') out.push('');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function toText(b, { titles = true } = {}) {
  const out = [];
  sections(b).forEach(({ group, notes }) => {
    if (titles) out.push((group ? group.name : 'Inbox').toUpperCase(), '');
    paragraphs(notes).forEach(p => {
      if (p.type === 'item') out.push(p.notes.map(line).join(' '));
      else out.push(p.notes.map(n => n.text).join(' '), '');
    });
    if (out[out.length - 1] !== '') out.push('');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function toOPML(b) {
  const a = (s) => esc(s).replace(/\n/g, '&#10;');
  const body = sections(b).map(({ group, notes }) =>
    `    <outline text="${a(group ? group.name : 'Inbox')}">\n` +
    notes.map(n => `      <outline text="${a(line(n))}"${n.tags?.length ? ` _tags="${a(n.tags.join(','))}"` : ''}/>`).join('\n') +
    `\n    </outline>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${a(b.name)}</title></head>\n  <body>\n  <outline text="${a(b.name)}">\n${body}\n  </outline>\n  </body>\n</opml>\n`;
}

export function toHTML(b, { titles = true } = {}) {
  const parts = [];
  sections(b).forEach(({ group, notes }) => {
    if (titles) parts.push(`<h2>${esc(group ? group.name : 'Inbox')}</h2>`);
    let list = [];
    const flushList = () => { if (list.length) parts.push(`<ul>${list.join('')}</ul>`); list = []; };
    paragraphs(notes).forEach(p => {
      const spans = p.notes.map(n => `<span class="s${n.kind === 'heading' ? ' h' : ''}" data-open="${n.id}">${esc(n.text)}</span>`).join(' ');
      if (p.type === 'item') { list.push(`<li>${spans}</li>`); return; }
      flushList();
      parts.push(`<p>${spans}</p>`);
    });
    flushList();
  });
  return parts.join('\n');
}

export function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(s) { return String(s).replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') || 'Mindapp'; }
