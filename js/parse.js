// Lossless text segmentation.
//
// The golden rule of Mindapp: never add or remove a sentence. Every segment
// produced here is an exact slice of the input, and the concatenation of all
// segments (markers + text) reproduces the input character-for-character once
// whitespace is ignored. `verifyLossless` proves it and is run on every import.

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'eg', 'ie',
  'e.g', 'i.e', 'approx', 'appt', 'apt', 'dept', 'est', 'fig', 'inc', 'ltd', 'co',
  'corp', 'no', 'nos', 'vol', 'p', 'pp', 'ca', 'cf', 'al', 'jan', 'feb', 'mar',
  'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mon', 'tue',
  'wed', 'thu', 'fri', 'sat', 'sun', 'a.m', 'p.m', 'u.s', 'u.k', 'min', 'max',
  'ref', 'gen', 'gov', 'rev', 'hon', 'av', 'ave', 'rd', 'blvd', 'ft', 'in',
]);

// List / checklist / heading markers we keep separately so cards read cleanly,
// while still being preserved verbatim for export and integrity checks.
const MARKER_RE = /^(\s*(?:#{1,6}\s+|[-*+•◦▪▫‣●○■□–—]\s+|\d{1,3}[.)]\s+|[a-zA-Z][.)]\s+(?=\S)|\[[ xX]\]\s+|[-*]\s+\[[ xX]\]\s+|[☐☑✓✔✗✘]\s*))/u;

const TERMINAL = /[.!?…:;,)"'”’\]]$/u;

export function normalizeNewlines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/\u2028|\u2029/g, '\n');
}

export function stripWs(s) {
  return String(s).replace(/\s+/gu, '');
}

/** Split a single run of prose into sentences. Returns exact trimmed slices. */
export function splitSentences(text) {
  const out = [];
  const s = text;
  let start = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const ch = s[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…' && ch !== '。' && ch !== '！' && ch !== '？') continue;
    // absorb runs like "?!", "...", and closing quotes / brackets
    let j = i + 1;
    while (j < n && /[.!?…。！？]/u.test(s[j])) j++;
    while (j < n && /["'”’)\]»]/u.test(s[j])) j++;
    const isCJK = /[。！？]/u.test(ch);
    if (!isCJK) {
      // must be followed by whitespace (or end)
      if (j < n && !/\s/u.test(s[j])) { i = j - 1; continue; }
      // look at the next non-space char
      let k = j;
      while (k < n && /\s/u.test(s[k])) k++;
      // trailing #tags belong to the sentence before them ("…readers. #merch")
      if (/^(#[\p{L}\p{N}_][\p{L}\p{N}_-]*\s*)+$/u.test(s.slice(k))) { i = j - 1; continue; }
      if (k < n) {
        const next = s[k];
        // a lowercase continuation means this was not a sentence end ("e.g. this")
        if (/\p{Ll}/u.test(next)) { i = j - 1; continue; }
      }
      if (ch === '.') {
        // word immediately before the period
        const before = s.slice(start, i);
        const m = before.match(/([\p{L}.]+)$/u);
        const word = m ? m[1].toLowerCase() : '';
        if (word && (ABBREVIATIONS.has(word) || ABBREVIATIONS.has(word.replace(/\./g, '')))) { i = j - 1; continue; }
        // single initials like "J. R. Smith"
        if (/^\p{Lu}$/u.test(m ? m[1] : '') ) { i = j - 1; continue; }
      }
    }
    const piece = s.slice(start, j).trim();
    if (piece) out.push(piece);
    start = j;
    i = j - 1;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function looksLikeHeading(line, nextLine, prevBlank) {
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,6}\s+/.test(t)) return true;
  if (t.length > 70) return false;
  const words = t.split(/\s+/u).length;
  if (/:$/.test(t) && words <= 10) return true;
  if (!prevBlank) return false;
  if (TERMINAL.test(t)) return false;
  if (words > 7) return false;
  if (!nextLine || !nextLine.trim()) return false;
  // Title Case or ALL CAPS short line followed by content
  const caps = t.split(/\s+/u).filter(w => /^\p{Lu}/u.test(w)).length;
  return /^\p{Lu}/u.test(t) && (caps / words >= 0.5 || t === t.toUpperCase());
}

/**
 * Segment text into note-sized pieces.
 * mode: 'sentence' | 'line' | 'paragraph'
 * Returns [{ text, marker, kind: 'heading'|'item'|'text', para, line }]
 */
export function segment(input, { mode = 'sentence', detectHeadings = true } = {}) {
  const text = normalizeNewlines(input);
  const lines = text.split('\n');
  const segs = [];
  let para = 0;
  let prevBlank = true;

  if (mode === 'paragraph') {
    let buf = [];
    let bufStart = 0;
    const flush = () => {
      const joined = buf.join('\n').trim();
      if (joined) segs.push({ text: joined, marker: '', kind: 'text', para, line: bufStart });
      if (buf.length) para++;
      buf = [];
    };
    lines.forEach((l, idx) => {
      if (!l.trim()) { flush(); return; }
      if (!buf.length) bufStart = idx;
      buf.push(l);
    });
    flush();
    return segs;
  }

  lines.forEach((raw, idx) => {
    if (!raw.trim()) { if (!prevBlank) para++; prevBlank = true; return; }
    const next = lines.slice(idx + 1).find(l => l.trim()) ?? '';
    const nextImmediate = lines[idx + 1] ?? '';
    const mm = raw.match(MARKER_RE);
    let marker = mm ? mm[1] : '';
    let content = raw.slice(marker.length);
    marker = marker.trim();
    let kind = marker ? (marker.startsWith('#') ? 'heading' : 'item') : 'text';
    if (!content.trim()) {
      // a bare marker line ("-") — keep it verbatim as its own text
      segs.push({ text: raw.trim(), marker: '', kind: 'text', para, line: idx });
      prevBlank = false;
      return;
    }
    if (detectHeadings && kind === 'text' && looksLikeHeading(raw, nextImmediate || next, prevBlank)) kind = 'heading';
    if (!detectHeadings && kind === 'heading') kind = 'text';

    if (mode === 'line' || kind === 'heading') {
      segs.push({ text: content.trim(), marker, kind, para, line: idx });
    } else {
      const sentences = splitSentences(content);
      sentences.forEach((sent, k) => {
        segs.push({ text: sent, marker: k === 0 ? marker : '', kind: k === 0 ? kind : 'text', para, line: idx });
      });
    }
    prevBlank = false;
  });
  return segs;
}

/** Reassemble segments as they would read in the source (markers included). */
export function reassemble(segs) {
  return segs.map(s => (s.marker ? s.marker + ' ' : '') + s.text).join('\n');
}

/** True when the segments contain exactly the source's characters, nothing more, nothing less. */
export function verifyLossless(source, segs) {
  return stripWs(normalizeNewlines(source)) === stripWs(segs.map(s => (s.marker || '') + s.text).join(''));
}

/** Convert pasted/imported HTML (e.g. Apple Notes export) to text with line structure. */
export function htmlToText(html) {
  if (typeof DOMParser === 'undefined') {
    return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style').forEach(n => n.remove());
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out.push(child.textContent.replace(/\s*\n\s*/g, ' ')); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') { out.push('\n'); continue; }
      const block = /^(p|div|li|h[1-6]|tr|blockquote|pre|ul|ol|section|article|header|footer)$/.test(tag);
      if (block) out.push('\n');
      if (tag === 'li') out.push('- ');
      if (/^h[1-6]$/.test(tag)) out.push('#'.repeat(+tag[1]) + ' ');
      walk(child);
      if (block) out.push('\n');
    }
  };
  walk(doc.body);
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Rough RTF → text (Notes on Mac can save RTF via TextEdit). */
export function rtfToText(rtf) {
  if (!/^\{\\rtf/.test(rtf)) return rtf;
  let s = rtf.replace(/\\par[d]?\b ?/g, '\n').replace(/\\line\b ?/g, '\n').replace(/\\tab\b ?/g, '\t');
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\??/g, (_, d) => String.fromCharCode(d < 0 ? 65536 + +d : +d));
  s = s.replace(/\{\\\*[^{}]*\}/g, '').replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\s*\}/g, '');
  s = s.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
