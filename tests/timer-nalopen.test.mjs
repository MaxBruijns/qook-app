// Eenmalig nalopen: herschreven stap alleen accepteren als de tekst verder gelijk blijft.
import assert from 'node:assert/strict';
import { acceptStepRewrite } from './worker.mjs';
const oud = 'Haal het vlees uit de wok en laat het rusten op een bord.';
assert.ok(acceptStepRewrite(oud, 'Haal het vlees uit de wok en laat het 5 minuten rusten op een bord.'));
assert.ok(!acceptStepRewrite(oud, 'Laat 5 minuten rusten.'), 'te veel weggelaten');
assert.ok(!acceptStepRewrite(oud, oud + ' Snijd daarna in plakjes, serveer met rijst, sesamzaad, lente-ui, koriander, limoen en een flinke scheut sojasaus erover.'), 'te veel toegevoegd');
assert.ok(!acceptStepRewrite(oud, ''));
assert.ok(acceptStepRewrite('Breng water aan de kook en kook de rijst gaar.', 'Breng water aan de kook. Kook de rijst 12 minuten gaar.'));
console.log('TIMER NALOPEN: IN ORDE');
