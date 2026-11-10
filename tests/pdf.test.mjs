// Boodschappenlijst als PDF: geldige structuur, speciale tekens, meerdere pagina's.
import assert from 'node:assert/strict';
import { shoppingListPdf } from './pdf.mjs';
const latin1 = (b) => Buffer.from(b).toString('latin1');
const one = latin1(shoppingListPdf('Weekboodschappen', 'Qook · 7 gerechten · €', [
  { title: 'Groente & fruit', items: [{ name: 'Crème fraîche (zuur)', amount: '½ beker' }, { name: 'Ui', amount: '3 stuks', checked: true }] },
]));
assert.ok(one.startsWith('%PDF-1.4')); assert.ok(one.trimEnd().endsWith('%%EOF'));
assert.match(one, /\/Count 1 /);
assert.ok(one.includes('Cr\xe8me fra\xeeche \\(zuur\\)'), 'accenten in WinAnsi en haakjes ontsnapt');
assert.ok(one.includes('\xbd beker')); assert.ok(one.includes('\x80'), 'euroteken');
// xref-verwijzingen kloppen
const xref = Number(one.match(/startxref\n(\d+)/)[1]);
assert.equal(one.slice(xref, xref + 4), 'xref');
for (const m of one.matchAll(/(\d{10}) 00000 n /g)) assert.match(one.slice(Number(m[1]), Number(m[1]) + 12), /^\d+ 0 obj/);
const many = latin1(shoppingListPdf('Lijst', '', [{ title: 'Veel', items: Array.from({ length: 80 }, (_, i) => ({ name: `Product ${i}`, amount: '' })) }]));
assert.match(many, /\/Count [23] /, 'lange lijst op meerdere pagina\'s');
console.log('PDF: ALLE TESTS GESLAAGD');
