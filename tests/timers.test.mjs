// Timers alleen bij een vaste tijd in de tekst van de stap, met precies die tijd.
import assert from 'node:assert/strict';
import { stepTimers } from './timers.mjs';
const secs = (t) => stepTimers(t).map(x => [x.seconds, x.maxSeconds]);

// Vaste tijd: wel een timer, precies die tijd.
assert.deepEqual(secs('Kook de pasta 10 minuten in ruim gezouten water.'), [[600, 600]]);
assert.deepEqual(secs('Laat het vlees 30 minuten marineren.'), [[1800, 1800]]);
assert.deepEqual(secs('Bak de kip 8-10 minuten tot hij gaar is.'), [[480, 600]]);
assert.deepEqual(secs('Laat de saus 8 tot 10 minuten zachtjes sudderen.'), [[480, 600]]);
assert.deepEqual(secs('Rooster de aubergine 25 min in de oven.'), [[1500, 1500]]);
assert.deepEqual(secs('Laat een kwartier rusten.'), [[900, 900]]);
assert.deepEqual(secs('Stoof het geheel anderhalf uur.'), [[5400, 5400]]);
assert.deepEqual(secs('Roer 30 seconden door.'), [[30, 30]]);
assert.deepEqual(secs('Bak 4 minuten, keer om. Bak nog 3 minuten.'), [[240, 240], [180, 180]]);
assert.equal(stepTimers('Kook de pasta 10 minuten').at(0).label, '10 min');
assert.equal(stepTimers('Bak 8-10 minuten').at(0).label, '8–10 min');

// Hangt af van pan of fornuis: geen timer.
assert.deepEqual(secs('Breng een grote pan water aan de kook.'), []);
assert.deepEqual(secs('Verwarm de oven voor op 200 graden.'), []);
assert.deepEqual(secs('Fruit de ui tot hij glazig is.'), []);
assert.deepEqual(secs('Bak de aardappelen goudbruin.'), []);
assert.deepEqual(secs('Breng het water in ongeveer 10 minuten aan de kook.'), []);
assert.deepEqual(secs('Laat de oven 15 minuten voorverwarmen.'), []);
// Wel: wachten op de kook (geen timer) en daarna een vaste tijd (wel).
assert.deepEqual(secs('Breng water aan de kook. Kook de pasta 9 minuten.'), [[540, 540]]);
// Geen tijdseenheden: geen timer.
assert.deepEqual(secs('Snijd 2 uien en 1 paprika. Verwarm op 180 graden voor 4 personen.'), []);
console.log('TIMERS: IN ORDE');
