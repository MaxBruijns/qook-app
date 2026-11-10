// Draait alle tests: zet de TypeScript-bestanden om naar JavaScript in tests/.build en voert
// elke *.test.mjs uit met nagebootste Cloudflare (D1 via node:sqlite) en een nagebootste Gemini.
//   npm test            (alles)
//   npm test -- rechten (alleen tests waarvan de naam "rechten" bevat)
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(here, '.build');
fs.mkdirSync(out, { recursive: true });

const compile = (file) => {
  const r = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    reportDiagnostics: true, fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  if (r.diagnostics?.length) throw new Error(`${file}: ${r.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
  return r.outputText;
};
const write = (name, code) => fs.writeFileSync(path.join(out, name), code);

// Worker: elk bestand, met lokale imports naar .mjs
const workerModules = fs.readdirSync(path.join(root, 'worker')).filter(f => f.endsWith('.ts')).map(f => f.slice(0, -3));
const fixImports = (code) => code.replace(/from '\.\/([\w-]+)'/g, (m, n) => (workerModules.includes(n) ? `from './${n}.mjs'` : m));
for (const name of workerModules) {
  let code = fixImports(compile(`worker/${name}.ts`));
  if (name === 'index') {
    code += '\nexport const __t = { isDuplicate, buildVariety, conflictReason, canonMain, canonCuisine, cleanTitle, aggregateShopping, canonDietList, seedRound, bankStats, hasAllergen };\n';
    write('worker.mjs', code);
  } else write(`${name}.mjs`, code);
}
// App-onderdelen die de tests gebruiken
write('taste.mjs', compile('utils/tasteProfile.ts'));
write('history.mjs', compile('utils/mealHistory.ts'));
write('account.mjs', compile('utils/account.ts'));
write('pdf.mjs', compile('utils/shoppingPdf.ts'));
write('service.mjs', compile('services/geminiService.ts')
  .replace(/from ['"]\.\.\/utils\/tasteProfile['"]/, 'from "./taste.mjs"')
  .replace(/from ['"]\.\.\/utils\/mealHistory['"]/, 'from "./history.mjs"'));

const filter = process.argv[2] || '';
const tests = fs.readdirSync(here).filter(f => f.endsWith('.test.mjs') && f.includes(filter)).sort();
let failed = 0;
for (const t of tests) {
  fs.copyFileSync(path.join(here, t), path.join(out, t));
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(out, t)], { cwd: out, encoding: 'utf8', timeout: 120000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${t.replace('.test.mjs', '')}`);
  if (!ok) console.log((r.stderr || r.stdout || '').split('\n').filter(l => !/^\s*at /.test(l)).slice(-25).join('\n'));
}
console.log(`\n${tests.length - failed} van ${tests.length} geslaagd`);
process.exit(failed ? 1 : 0);
