// Package A: the app never says anything that implies safety. Every string and template literal in docs/js is checked
// against BANNED, so a new message that says "all clear" or "safe to cross" fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BANNED, bannedIn, isSafeText, CROSSING_TEXT, LIMITS_TEXT } from '../docs/js/safetext.js';
import { OPEN_AGAIN } from '../docs/js/freespace.js';
import { pathSentence, NOTHING } from '../docs/js/describe.js';
import { HELP_TEXT } from '../docs/js/commands.js';
import { PRIVACY_TEXT, RECORD_ASK } from '../docs/js/privacy.js';
import { MODELS, HAZARD } from '../docs/js/config.js';

// Model class names ("Green light" in a model's label list) are data, never spoken as written.
const CLASS_NAMES = new Set([...Object.values(MODELS).flatMap((m) => m.names), ...HAZARD.names]);

// Every '...', "..." and `...` literal in a JS source, skipping comments and regular expressions. Template literals
// keep their text with each ${...} replaced by a space, so "Clear ${x}" and "ahead" are still caught when adjacent.
export function stringLiterals(src) {
  const out = [];
  let i = 0, prev = ''; // prev: last significant character, to tell a regex "/" from a division
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || /\b(?:return|typeof|case)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      i++; let cls = false;
      while (i < n) { const e = src[i]; if (e === '\\') { i += 2; continue; } if (e === '[') cls = true; else if (e === ']') cls = false; else if (e === '/' && !cls) break; i++; }
      i++; while (/[a-z]/i.test(src[i] || '')) i++;
      prev = '/'; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; } else s += src[j++]; }
      out.push(s); i = j + 1; prev = c; continue;
    }
    if (c === '`') {
      let j = i + 1, s = '', depth = 0;
      while (j < n) {
        if (depth === 0 && src[j] === '`') break;
        if (src[j] === '\\') { if (depth === 0) s += src[j + 1]; j += 2; continue; }
        if (depth === 0 && src[j] === '$' && src[j + 1] === '{') { depth = 1; s += ' '; j += 2; continue; }
        if (depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; continue; }
        s += src[j++];
      }
      out.push(s); i = j + 1; prev = '`'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

const dir = new URL('../docs/js/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'safetext.js'); // safetext.js holds the list itself

test('the literal scanner finds strings, templates and skips comments and regexes', () => {
  const lits = stringLiterals("// all clear\nconst a = 'one', b = \"two\"; const r = /safe to cross/i; say(`three ${x} four`); /* clear path */ x = 4 / 2; y = 'five';");
  assert.deepEqual(lits, ['one', 'two', 'three   four', 'five']);
});

test('the scanner sees the spoken strings of the app (sanity)', () => {
  const all = files.flatMap((f) => stringLiterals(fs.readFileSync(new URL(f, dir), 'utf8')));
  for (const known of ['Detection has paused. Retrying.', 'Stopped.', 'Already stopped.', 'No clear way. Stop.']) assert.ok(all.includes(known), known);
  assert.ok(all.length > 400, `found ${all.length} literals`);
});

test('no string in docs/js says or implies that something is safe', () => {
  const hits = [];
  for (const f of files) {
    for (const lit of stringLiterals(fs.readFileSync(new URL(f, dir), 'utf8'))) {
      if (CLASS_NAMES.has(lit)) continue;
      const b = bannedIn(lit);
      if (b.length) hits.push(`${f}: "${lit}" (${b.join(', ')})`);
    }
  }
  assert.deepEqual(hits, []);
});

test('BANNED matches case-insensitively, and the allowed phrases stay allowed', () => {
  for (const b of BANNED) assert.equal(isSafeText(b.toUpperCase()), false, b);
  assert.equal(isSafeText('All Clear!'), false);
  assert.equal(isSafeText("It’s safe now"), false, 'curly apostrophes are caught');
  assert.equal(isSafeText('Clearer on the left.'), true);
  assert.equal(isSafeText('No clear way. Stop.'), true);
  assert.equal(isSafeText('Person, ahead, very close. Clearer on the right.'), true);
});

test('the fixed messages pass, and the ones that used to imply safety have changed', () => {
  for (const t of [CROSSING_TEXT, LIMITS_TEXT, OPEN_AGAIN, pathSentence(null), NOTHING, HELP_TEXT, PRIVACY_TEXT, RECORD_ASK]) assert.ok(isSafeText(t), t);
  assert.notEqual(OPEN_AGAIN, 'Clear ahead.');
  assert.doesNotMatch(pathSentence(null), /clear/i);
});
