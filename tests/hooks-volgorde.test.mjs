// Voorkomt een leeg scherm (React-fout #310): geen hooks ná een vroege return in een component.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const files = ['App.tsx', ...fs.readdirSync(path.join(root, 'components')).filter(f => f.endsWith('.tsx')).map(f => 'components/' + f)];
const problems = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
  let earlyReturnAt = -1;
  lines.forEach((line, i) => {
    // Een nieuw component (op het hoogste niveau) begint: opnieuw tellen.
    if (/^(export )?(const|function) [A-Z]\w*/.test(line)) earlyReturnAt = -1;
    // Vroege return op componentniveau (2 spaties inspringing), bv. "  if (!isOpen) return null;"
    if (/^ {2}if \(.*\) return\b/.test(line)) earlyReturnAt = i;
    if (earlyReturnAt >= 0 && /^ {2}(const|let) .*\buse[A-Z]\w*(<[^>]*>)?\(/.test(line)) problems.push(`${f}:${i + 1} hook na return op regel ${earlyReturnAt + 1}`);
  });
}
assert.deepEqual(problems, [], problems.join('\n'));
console.log('HOOKS-VOLGORDE: IN ORDE');
