import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import { toMarkdown, toText, toOPML } from '../js/export.js';
import { SAMPLE } from '../js/sample.js';

function fresh() {
  const b = S.newBoard('Test');
  S._setState({ v: 1, boards: [b], currentBoardId: b.id, settings: {} });
  return S.board();
}
const texts = (b) => S.live(b).map(n => n.text).sort();

test('import keeps every sentence verbatim and integrity is complete', () => {
  const b = fresh();
  const r = S.importText(b, SAMPLE, { name: 'sample' });
  assert.ok(r.lossless);
  assert.ok(r.count > 15);
  const rep = S.integrity(b);
  assert.equal(rep.length, 1);
  assert.ok(rep[0].complete);
  assert.equal(rep[0].edited, 0);
  assert.equal(rep[0].present, rep[0].total);
});

test('organise only moves notes — same texts before and after', () => {
  const b = fresh();
  S.importText(b, SAMPLE, { name: 'sample' });
  const before = texts(b);
  const r = S.organise(b, { scope: 'all', keepHeadingGroups: false });
  assert.ok(r.groups >= 2, 'creates several groups');
  assert.deepEqual(texts(b), before);
  assert.ok(S.integrity(b)[0].complete);
  // every note is in an existing group
  S.live(b).forEach(n => assert.ok(b.groups.some(g => g.id === n.groupId)));
  // podcast sentences end up mostly together
  const podcast = S.live(b).filter(n => /podcast/i.test(n.text));
  const counts = {};
  podcast.forEach(n => { counts[n.groupId] = (counts[n.groupId] || 0) + 1; });
  assert.ok(Math.max(...Object.values(counts)) >= podcast.length / 2, JSON.stringify(b.groups.map(g => [g.name, S.notesIn(g.id, b).map(n => n.text)])));
});

test('inbox organise files new thoughts into existing groups', () => {
  const b = fresh();
  S.importText(b, SAMPLE, { name: 'sample' });
  S.organise(b, { scope: 'all', keepHeadingGroups: false });
  const groupsBefore = b.groups.length;
  S.addThought(b, 'Record a podcast episode about night trains.');
  const before = texts(b);
  const r = S.organise(b, { scope: 'inbox' });
  assert.equal(r.filed, 1);
  assert.equal(b.groups.length, groupsBefore);
  assert.deepEqual(texts(b), before);
});

test('sequence methods keep the same notes', () => {
  const b = fresh();
  S.importText(b, SAMPLE, { name: 'sample', headingsAsGroups: false });
  const before = texts(b);
  for (const m of ['flow', 'original', 'alpha', 'newest', 'oldest', 'length', 'questions']) {
    S.sequenceGroup(b, null, m);
    assert.deepEqual(texts(b), before, m);
  }
});

test('addThought with split is lossless', () => {
  const b = fresh();
  const made = S.addThought(b, 'One idea. Two ideas! Three?', { split: true });
  assert.deepEqual(made.map(n => n.text), ['One idea.', 'Two ideas!', 'Three?']);
});

test('trash and edits are reported by integrity', () => {
  const b = fresh();
  S.importText(b, 'A first. A second. A third.', { name: 'x' });
  const [n1, n2] = S.live(b);
  n1.text = 'Changed.';
  n2.trashed = true;
  const rep = S.integrity(b)[0];
  assert.equal(rep.edited, 1);
  assert.equal(rep.inTrash, 1);
  assert.ok(rep.complete, 'originals still kept');
  S.emptyTrash(b);
  assert.equal(S.integrity(b)[0].deleted, 1);
});

test('exports contain every sentence', () => {
  const b = fresh();
  S.importText(b, SAMPLE, { name: 'sample' });
  S.organise(b, { scope: 'all' });
  const md = toMarkdown(b), txt = toText(b), opml = toOPML(b);
  S.live(b).forEach(n => {
    assert.ok(md.includes(n.text), 'md: ' + n.text);
    assert.ok(txt.includes(n.text), 'txt: ' + n.text);
  });
  assert.match(opml, /<opml/);
});

test('merge backup: union of notes, newest edit wins, deletions respected', () => {
  const b = fresh();
  S.importText(b, 'Alpha one. Beta two. Gamma three.', { name: 'x' });
  const remote = JSON.parse(JSON.stringify(S.exportState()));
  const rb = remote.boards[0];
  rb.notes[0].text = 'Alpha edited remotely.'; rb.notes[0].updated = Date.now() + 1000;
  rb.notes.push({ ...rb.notes[1], id: 'n-remote', text: 'Delta from phone.', updated: Date.now() + 1000 });
  rb.updated = Date.now() + 1000;
  // local change on another note
  const local = S.board().notes[2]; local.text = 'Gamma edited locally.'; local.updated = Date.now() + 2000;
  const r = S.mergeBackup(remote);
  assert.equal(r.merged, 1);
  const t = S.live().map(n => n.text);
  assert.ok(t.includes('Alpha edited remotely.'));
  assert.ok(t.includes('Gamma edited locally.'));
  assert.ok(t.includes('Delta from phone.'));
  assert.ok(t.includes('Beta two.'));
  assert.equal(t.length, 4);
});

test('undo restores the board', () => {
  fresh();
  S.commit('import', (b) => S.importText(b, 'One. Two. Three.', { name: 'x' }));
  assert.equal(S.live().length, 3);
  S.commit('trash', (b) => { b.notes[0].trashed = true; });
  assert.equal(S.live().length, 2);
  S.undo();
  assert.equal(S.live().length, 3);
  S.redo();
  assert.equal(S.live().length, 2);
});
