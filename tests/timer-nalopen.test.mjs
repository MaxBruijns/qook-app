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
// Strenger: nieuwe tijd alleen bij vaste duur, niet bij "tot ..." of bakken op zicht.
assert.ok(acceptStepRewrite('Voeg de kokosmelk toe en laat de curry zachtjes sudderen.', 'Voeg de kokosmelk toe en laat de curry 15 minuten zachtjes sudderen.'));
assert.ok(acceptStepRewrite('Strooi de saffraan in de bouillon zodat deze kan trekken.', 'Strooi de saffraan in de bouillon zodat deze 10 minuten kan trekken.'));
assert.ok(!acceptStepRewrite('Bak hierin de shiitake in enkele minuten goudbruin.', 'Bak hierin de shiitake 5 minuten goudbruin.'));
assert.ok(!acceptStepRewrite('Bak hierin het gehakt rul met de ui.', 'Bak hierin het gehakt 8 minuten rul met de ui.'));
assert.ok(!acceptStepRewrite('Voeg steeds bouillon toe onder regelmatig roeren tot de rijst gaar is.', 'Voeg steeds bouillon toe onder regelmatig roeren 20 minuten tot de rijst gaar is.'));
assert.ok(acceptStepRewrite('Bak de venkel gedurende twintig minuten tot hij zacht is.', 'Bak de venkel gedurende 20 minuten tot hij zacht is.'), 'bestaande tijd in cijfers mag');
console.log('TIMER NALOPEN (streng): IN ORDE');
assert.ok(!acceptStepRewrite('Kook de noedels volgens de verpakking.', 'Kook de noedels 4 minuten volgens de verpakking.'), 'verpakking blijft leidend');
console.log('TIMER NALOPEN (verpakking): IN ORDE');
