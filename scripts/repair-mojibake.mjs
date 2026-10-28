// Tek seferlik onarım: cp1252 olarak yanlış çözülmüş UTF-8 dizilerini geri çevirir.
// Yalnızca "Ã¼", "Ä±", "ÅŸ" gibi çok baytlı bozuk dizilere dokunur; tek baytlık
// doğru Türkçe karakterleri (ç, ö, ü...) olduğu gibi bırakır.
import { readFileSync, writeFileSync } from 'node:fs';

const CP1252 = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87],
  ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e], ['‘', 0x91],
  ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97], ['˜', 0x98],
  ['™', 0x99], ['š', 0x9a], ['›', 0x9b], ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
]);

const toByte = (char) => {
  const code = char.codePointAt(0);
  if (code < 0x100) return code;
  return CP1252.has(char) ? CP1252.get(char) : null;
};

export function repair(text) {
  let out = '';
  let i = 0;
  let fixes = 0;
  while (i < text.length) {
    const lead = toByte(text[i]);
    if (lead !== null && lead >= 0xc2 && lead <= 0xf4) {
      const length = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
      const bytes = [lead];
      let j = i + 1;
      while (bytes.length < length && j < text.length) {
        const next = toByte(text[j]);
        if (next === null || next < 0x80 || next > 0xbf) break;
        bytes.push(next);
        j += 1;
      }
      if (bytes.length === length) {
        try {
          const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes));
          out += decoded;
          fixes += 1;
          i = j;
          continue;
        } catch {
          // geçersiz dizi: olduğu gibi bırak
        }
      }
    }
    out += text[i];
    i += 1;
  }
  return { text: out, fixes };
}

if (process.argv[2] === '--write') {
  for (const file of process.argv.slice(3)) {
    const source = readFileSync(file, 'utf8');
    const result = repair(source);
    writeFileSync(file, result.text, 'utf8');
    console.log(`${file}: repaired ${result.fixes} sequences`);
  }
}
