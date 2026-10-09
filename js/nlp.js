// On-device text intelligence. No network, no AI service: your notes never
// leave the device. Everything here only *reads* text to decide grouping and
// order — it never rewrites, merges or drops a sentence.

const STOP = new Set(`a about above after again against all am an and any are aren't as at be because been
before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't
down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here
here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's
me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own
same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them
themselves then there there's these they they'd they'll they're they've this those through to too under until
up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while
who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself
yourselves also just like get got really thing things maybe might will shall one two lot lots much many
make made way ways need needs want wants could would should still even well yes ok okay etc via per use used
using new idea ideas think thought something someone anything everything every already always never now
today tomorrow yesterday good great better best ask asked asking try tried trying help start started every each
other another small big little simple sure kind sort bit actually probably definitely share shared sharing totally entirely completely basically literally quite rather`.split(/\s+/));

export function stem(w) {
  let s = w.toLowerCase().replace(/['’]s$/, '');
  if (s.length > 5 && s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('ly')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('es') && /(ss|x|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith('ment')) s = s.slice(0, -4);
  if (s.length > 5 && s.endsWith('ation')) s = s.slice(0, -5);
  if (s.length > 5 && s.endsWith('er') && !s.endsWith('eer')) s = s.slice(0, -2); // runner → runn
  if (/([b-df-hj-np-tv-z])\1$/.test(s) && !/(ll|ss|zz|ff)$/.test(s)) s = s.slice(0, -1); // runn → run
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1); // share / sharing → shar
  return s;
}

export function hashtags(text) {
  return [...String(text).matchAll(/(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu)].map(m => m[1].toLowerCase());
}

/** Tokens as [stem, surfaceWord] pairs. */
export function tokenize(text) {
  const out = [];
  for (const m of String(text).matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const raw = m[0].replace(/['’-]+$/, '');
    const low = raw.toLowerCase();
    if (low.length < 3 || STOP.has(low) || /^\d+$/.test(low)) continue;
    out.push([stem(low), low]);
  }
  return out;
}

/** Build normalised TF-IDF vectors for a list of texts. */
export function vectorize(texts, { sharedOnly = false } = {}) {
  const docs = texts.map(t => {
    const tf = new Map();
    for (const [st] of tokenize(t)) tf.set(st, (tf.get(st) || 0) + 1);
    for (const tag of hashtags(t)) tf.set('#' + tag, (tf.get('#' + tag) || 0) + 2);
    return tf;
  });
  const df = new Map();
  docs.forEach(tf => tf.forEach((_, k) => df.set(k, (df.get(k) || 0) + 1)));
  const N = docs.length;
  const vecs = docs.map(tf => {
    const v = new Map();
    let norm = 0;
    tf.forEach((c, k) => {
      if (sharedOnly && df.get(k) < 2) return; // a word used once can't connect two notes
      const w = (1 + Math.log(c)) * (Math.log((N + 1) / (df.get(k) + 1)) + 1);
      v.set(k, w);
      norm += w * w;
    });
    norm = Math.sqrt(norm) || 1;
    v.forEach((w, k) => v.set(k, w / norm));
    return v;
  });
  return { vecs, df, N };
}

export function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  a.forEach((w, k) => { const o = b.get(k); if (o) s += w * o; });
  return s;
}

function addInto(sum, v, f = 1) { v.forEach((w, k) => sum.set(k, (sum.get(k) || 0) + w * f)); return sum; }
function normalize(v) {
  let n = 0; v.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1;
  const o = new Map(); v.forEach((w, k) => o.set(k, w / n)); return o;
}

/** Most frequent surface form for each stem (for readable group names). */
function surfaceForms(texts) {
  const forms = new Map();
  texts.forEach(t => tokenize(t).forEach(([st, w]) => {
    const m = forms.get(st) || new Map();
    m.set(w, (m.get(w) || 0) + 1);
    forms.set(st, m);
  }));
  const best = new Map();
  forms.forEach((m, st) => best.set(st, [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]));
  return best;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Name a cluster from its strongest shared terms. */
export function nameCluster(memberVecs, forms, used = new Set()) {
  const sum = new Map();
  memberVecs.forEach(v => addInto(sum, v));
  // favour terms that appear in several members
  const count = new Map();
  memberVecs.forEach(v => v.forEach((_, k) => count.set(k, (count.get(k) || 0) + 1)));
  const ranked = [...sum.entries()]
    .map(([k, w]) => [k, w * (memberVecs.length > 1 ? Math.min(count.get(k), 4) : 1)])
    .sort((a, b) => b[1] - a[1]);
  const words = [];
  for (const [k] of ranked) {
    const word = k.startsWith('#') ? k : (forms.get(k) || k);
    if (words.some(w => w.startsWith(word) || word.startsWith(w))) continue;
    words.push(word);
    if (words.length === 2) break;
  }
  let name = words.length ? words.map(cap).join(' & ') : 'Other thoughts';
  let n = 2;
  const base = name;
  while (used.has(name.toLowerCase())) name = `${base} ${n++}`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * Cluster notes by topic.
 * notes: [{id, text}] ; granularity 0..1 (higher → more, smaller groups)
 * Returns [{ name, ids: [...] }] in a stable, readable order.
 */
export function clusterNotes(notes, { granularity = 0.5, useTags = true } = {}) {
  if (!notes.length) return [];
  const texts = notes.map(n => n.text);
  const { vecs } = vectorize(texts, { sharedOnly: notes.length > 3 });
  const forms = surfaceForms(texts);
  const threshold = 0.12 + granularity * 0.3; // merge while centroid similarity ≥ threshold

  // seed clusters: notes sharing their first hashtag start together
  let clusters = [];
  const tagSeed = new Map();
  notes.forEach((n, i) => {
    const tag = useTags ? hashtags(n.text)[0] : null;
    if (tag && tagSeed.has(tag)) { clusters[tagSeed.get(tag)].members.push(i); return; }
    if (tag) tagSeed.set(tag, clusters.length);
    clusters.push({ members: [i], tag });
  });
  clusters.forEach(c => { c.sum = new Map(); c.members.forEach(i => addInto(c.sum, vecs[i])); c.cent = normalize(c.sum); });

  // centroid-linkage agglomeration with a per-row best cache
  const sim = (a, b) => cosine(a.cent, b.cent);
  let alive = clusters.map((_, i) => i);
  for (;;) {
    let best = -1, bi = -1, bj = -1;
    for (let x = 0; x < alive.length; x++) {
      for (let y = x + 1; y < alive.length; y++) {
        const A = clusters[alive[x]], B = clusters[alive[y]];
        if ((A.tag || B.tag) && A.tag !== B.tag) continue; // #tags are your explicit grouping — keep them as you set them
        const s = sim(A, B);
        if (s > best) { best = s; bi = x; bj = y; }
      }
    }
    if (best < threshold || bi < 0) break;
    const A = clusters[alive[bi]], B = clusters[alive[bj]];
    A.members.push(...B.members);
    addInto(A.sum, B.sum);
    A.cent = normalize(A.sum);
    A.tag = A.tag || B.tag;
    alive.splice(bj, 1);
  }
  let result = alive.map(i => clusters[i]);

  // fold singletons into their nearest cluster when reasonably close; rest → "Other thoughts"
  const singles = result.filter(c => c.members.length === 1 && !c.tag);
  let groups = result.filter(c => c.members.length > 1 || c.tag);
  const leftovers = [];
  singles.forEach(sc => {
    const v = vecs[sc.members[0]];
    let best = 0, target = null;
    groups.forEach(g => { const s = cosine(v, g.cent); if (s > best) { best = s; target = g; } });
    if (target && best >= threshold * 0.6) target.members.push(sc.members[0]);
    else leftovers.push(sc.members[0]);
  });
  if (!groups.length) { groups = [{ members: leftovers.splice(0), tag: null }]; }

  const used = new Set();
  const out = groups.map(g => {
    g.members.sort((a, b) => a - b);
    const name = g.tag ? '#' + g.tag : nameCluster(g.members.map(i => vecs[i]), forms, used);
    return { name, ids: g.members.map(i => notes[i].id), first: g.members[0] };
  });
  out.sort((a, b) => a.first - b.first);
  if (leftovers.length) out.push({ name: 'Other thoughts', ids: leftovers.sort((a, b) => a - b).map(i => notes[i].id), first: Infinity });
  return out.map(({ name, ids }) => ({ name, ids }));
}

/**
 * Order notes. method: 'flow' | 'original' | 'alpha' | 'newest' | 'oldest' | 'length' | 'questions'
 * 'flow' starts from the most central note (the likely topic sentence) and then
 * always steps to the most related remaining note, so connected ideas sit together.
 */
export function sequenceNotes(notes, method = 'flow') {
  const arr = notes.slice();
  const orig = (a, b) => (a.srcOrder ?? 0) - (b.srcOrder ?? 0);
  switch (method) {
    case 'original': return arr.sort(orig);
    case 'alpha': return arr.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
    case 'newest': return arr.sort((a, b) => (b.created || 0) - (a.created || 0));
    case 'oldest': return arr.sort((a, b) => (a.created || 0) - (b.created || 0));
    case 'length': return arr.sort((a, b) => a.text.length - b.text.length);
    case 'questions': {
      const q = n => /\?\s*$/.test(n.text) ? 0 : 1;
      return arr.sort((a, b) => q(a) - q(b) || orig(a, b));
    }
    default: break;
  }
  if (arr.length < 3) return arr.sort(orig);
  // headings stay on top in their original order
  const heads = arr.filter(n => n.kind === 'heading').sort(orig);
  const rest = arr.filter(n => n.kind !== 'heading');
  if (rest.length < 3) return [...heads, ...rest.sort(orig)];
  const { vecs } = vectorize(rest.map(n => n.text));
  const cent = normalize(vecs.reduce((s, v) => addInto(s, v), new Map()));
  let cur = 0, best = -1;
  rest.forEach((n, i) => {
    const s = cosine(vecs[i], cent) - i * 1e-6; // tie → earlier original
    if (s > best) { best = s; cur = i; }
  });
  const used = new Array(rest.length).fill(false);
  const order = [cur]; used[cur] = true;
  while (order.length < rest.length) {
    let nb = -1, bs = -1;
    for (let i = 0; i < rest.length; i++) {
      if (used[i]) continue;
      const s = cosine(vecs[cur], vecs[i]) + 0.15 * cosine(vecs[i], cent) - i * 1e-6;
      if (s > bs) { bs = s; nb = i; }
    }
    used[nb] = true; order.push(nb); cur = nb;
  }
  return [...heads, ...order.map(i => rest[i])];
}

/** Pairs of near-identical notes — flagged for you, never auto-removed. */
export function findDuplicates(notes, threshold = 0.82) {
  const { vecs } = vectorize(notes.map(n => n.text));
  const pairs = [];
  for (let i = 0; i < notes.length; i++) {
    if (!vecs[i].size) continue;
    for (let j = i + 1; j < notes.length; j++) {
      const s = cosine(vecs[i], vecs[j]);
      if (s >= threshold) pairs.push([notes[i].id, notes[j].id, s]);
    }
  }
  return pairs;
}

/** Notes most related to `text`. */
export function related(text, notes, k = 5, excludeId = null) {
  const pool = notes.filter(n => n.id !== excludeId);
  if (!pool.length || !String(text).trim()) return [];
  const { vecs } = vectorize([text, ...pool.map(n => n.text)]);
  return pool.map((n, i) => ({ note: n, score: cosine(vecs[0], vecs[i + 1]) }))
    .filter(r => r.score > 0.08).sort((a, b) => b.score - a.score).slice(0, k);
}

/** Best existing group for a new thought. groups: [{id, name, notes:[{text}]}] */
export function suggestGroup(text, groups) {
  const tags = hashtags(text);
  if (tags.length) {
    const g = groups.find(g => g.name.toLowerCase().replace(/^#/, '') === tags[0]);
    if (g) return { id: g.id, score: 1 };
  }
  const withNotes = groups.filter(g => g.notes.length || g.name);
  if (!withNotes.length || !String(text).trim()) return null;
  const texts = [text, ...withNotes.map(g => [g.name, g.name, ...g.notes.map(n => n.text)].join('\n'))];
  const { vecs } = vectorize(texts, { sharedOnly: true });
  let best = null, bs = 0;
  withNotes.forEach((g, i) => { const s = cosine(vecs[0], vecs[i + 1]); if (s > bs) { bs = s; best = g; } });
  return best && bs >= 0.15 ? { id: best.id, score: bs } : null;
}

/** Top keywords across a set of texts (for tag clouds / mind map hints). */
export function keywords(texts, k = 12) {
  const forms = surfaceForms(texts);
  const { vecs } = vectorize(texts);
  const sum = new Map();
  vecs.forEach(v => addInto(sum, v));
  return [...sum.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([st]) => st.startsWith('#') ? st : forms.get(st) || st);
}

/**
 * File many notes into existing groups in one pass.
 * groupDocs: [{id, name, texts:[...]}]; returns Map(noteIndex → groupId) for confident matches.
 */
export function assignToGroups(noteTexts, groupDocs, minScore = 0.18) {
  const out = new Map();
  if (!groupDocs.length || !noteTexts.length) return out;
  const docs = groupDocs.map(g => [g.name, g.name, ...g.texts].join('\n'));
  const { vecs } = vectorize([...docs, ...noteTexts], { sharedOnly: true });
  noteTexts.forEach((t, i) => {
    const tags = hashtags(t);
    if (tags.length) {
      const g = groupDocs.find(g => g.name.toLowerCase().replace(/^#/, '') === tags[0]);
      if (g) { out.set(i, g.id); return; }
    }
    const v = vecs[docs.length + i];
    let best = -1, bs = 0;
    groupDocs.forEach((g, j) => { const s = cosine(v, vecs[j]); if (s > bs) { bs = s; best = j; } });
    if (best >= 0 && bs >= minScore) out.set(i, groupDocs[best].id);
  });
  return out;
}
