import { readFileSync } from 'node:fs';

const s = readFileSync('supabase/functions/ai-news-worker/index.ts', 'utf8');
const CP = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87],
  ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e], ['‘', 0x91],
  ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97], ['˜', 0x98],
  ['™', 0x99], ['š', 0x9a], ['›', 0x9b], ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
]);
const toByte = (c) => {
  const x = c.codePointAt(0);
  return x < 0x100 ? x : CP.has(c) ? CP.get(c) : null;
};

let i = 0;
let tried = 0;
let runs = 0;
let failures = 0;
while (i < s.length && tried < 6) {
  if (toByte(s[i]) === null) {
    i += 1;
    continue;
  }
  let j = i;
  const bytes = [];
  while (j < s.length) {
    const next = toByte(s[j]);
    if (next === null) break;
    bytes.push(next);
    j += 1;
  }
  runs += 1;
  if (j - i >= 2 && bytes.some((value) => value >= 0xc2)) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes));
      console.log('OK', JSON.stringify(s.slice(i, j).slice(0, 50)), '->', JSON.stringify(decoded.slice(0, 50)));
      tried += 1;
    } catch {
      failures += 1;
      console.log('FAIL', JSON.stringify(s.slice(i, j).slice(0, 30)), bytes.slice(0, 10).map((x) => x.toString(16)).join(' '));
      tried += 1;
    }
  }
  i = j;
}
console.log({ runs, failures, length: s.length });
