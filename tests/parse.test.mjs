import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segment, splitSentences, verifyLossless, rtfToText } from '../js/parse.js';

const texts = {
  prose: 'Start a podcast about slow travel. Interview locals instead of tourists! Could each episode follow one train? Yes.',
  abbreviations: 'Meet Dr. Smith at 3 p.m. tomorrow. Bring e.g. the notes, slides etc. and the budget of $3.50 per head. J. R. R. Tolkien wrote it.',
  bullets: 'Garden plans\n- Plant tomatoes. Water daily.\n- Build a compost bin\n* Ask neighbours\n1. First step\n2) Second step\n[ ] todo item\n☐ checkbox item',
  headings: '# Big idea\nSome text here. More text.\n\n## Next\nAnother line\n\nIdeas For Later\nA thought without punctuation',
  urls: 'Read https://example.com/a.b?c=d. Then email me@test.io. Version 2.0.1 is out.',
  quotes: '"Is this it?" she asked. “Yes!” he said. (It was.) Then they left…  And came back.',
  cjk: '我们去公园。天气很好！你来吗？',
  emoji: '🚀 Launch day! 🎉 Party after. ✅ Done',
  messy: '  leading spaces.   Multiple   spaces inside.\r\nWindows line.\r\n\r\n\r\nTrailing   ',
  ellipsis: 'Wait... what? I think... maybe. OK!?',
};

for (const [name, t] of Object.entries(texts)) {
  for (const mode of ['sentence', 'line', 'paragraph']) {
    test(`lossless: ${name} / ${mode}`, () => {
      const segs = segment(t, { mode });
      assert.ok(verifyLossless(t, segs), JSON.stringify(segs));
      segs.forEach(s => assert.ok(s.text.length > 0));
    });
  }
}

test('sentence splitting', () => {
  assert.deepEqual(splitSentences(texts.prose), ['Start a podcast about slow travel.', 'Interview locals instead of tourists!', 'Could each episode follow one train?', 'Yes.']);
  assert.deepEqual(splitSentences(texts.abbreviations), ['Meet Dr. Smith at 3 p.m. tomorrow.', 'Bring e.g. the notes, slides etc. and the budget of $3.50 per head.', 'J. R. R. Tolkien wrote it.']);
  assert.equal(splitSentences(texts.cjk).length, 3);
  assert.equal(splitSentences(texts.quotes)[0], '"Is this it?" she asked.');
});

test('markers and headings are detected but kept', () => {
  const segs = segment(texts.bullets);
  assert.equal(segs[0].kind, 'heading');
  assert.equal(segs[1].marker, '-');
  assert.equal(segs[1].text, 'Plant tomatoes.');
  assert.equal(segs[2].text, 'Water daily.');
  assert.equal(segs[2].marker, '');
  assert.ok(segs.some(s => s.marker === '1.'));
  const h = segment(texts.headings);
  assert.deepEqual(h.filter(s => s.kind === 'heading').map(s => s.text), ['Big idea', 'Next', 'Ideas For Later']);
});

test('fuzz: random text is always lossless', () => {
  const alphabet = ['a', 'b', 'C', 'D', ' ', ' ', '.', '!', '?', '\n', '\n\n', '-', '- ', '1. ', '#', '"', '…', 'Dr.', 'e.g.', '🎉', '。', '  ', '\t', 'x', 'Y'];
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 2000; i++) {
    let t = '';
    const len = Math.floor(rnd() * 80);
    for (let j = 0; j < len; j++) t += alphabet[Math.floor(rnd() * alphabet.length)];
    for (const mode of ['sentence', 'line', 'paragraph']) {
      for (const detectHeadings of [true, false]) {
        const segs = segment(t, { mode, detectHeadings });
        assert.ok(verifyLossless(t, segs), `mode=${mode} text=${JSON.stringify(t)} segs=${JSON.stringify(segs)}`);
      }
    }
  }
});

test('rtf to text', () => {
  const t = rtfToText('{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\pard Hello world.\\par Second line.}');
  assert.match(t, /Hello world\./);
  assert.match(t, /Second line\./);
});
