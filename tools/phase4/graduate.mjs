#!/usr/bin/env node
// Package E: which hazard-lane classes may speak? Reads hazard_eval.json (from eval_hazard_model.py) and prints, per class,
// whether it passes: precision >= 0.9, recall >= 0.6, and at least 50 labelled examples (tp + fn). Then copy the passing
// names into HAZARD.speakClasses in docs/js/config.js. A class that passes still has to pass the walk gate on real walks
// (tools/score_walk.mjs) before it is trusted. Exit code 1 when no class passes.
//   node tools/phase4/graduate.mjs [hazard_eval.json]
import fs from 'node:fs';
import { graduate, GRADUATION } from '../../docs/js/hazardalerts.js';

const file = process.argv[2] || 'hazard_eval.json';
if (!fs.existsSync(file)) { console.log(`No ${file}. Run tools/phase4/eval_hazard_model.py first. HAZARD.speakClasses stays empty.`); process.exit(2); }
const rows = graduate(JSON.parse(fs.readFileSync(file, 'utf8')));
console.log(`Rule: precision >= ${GRADUATION.precision}, recall >= ${GRADUATION.recall}, at least ${GRADUATION.minExamples} labelled examples`);
for (const r of rows) console.log(`${r.pass ? 'PASS' : 'no  '}  ${r.name.padEnd(14)} precision ${r.precision ?? '-'}  recall ${r.recall ?? '-'}  examples ${r.examples}${r.why.length ? '  (' + r.why.join('; ') + ')' : ''}`);
const pass = rows.filter((r) => r.pass).map((r) => r.name);
console.log(pass.length ? `\nspeakClasses: ${JSON.stringify(pass)}` : '\nNo class passes: HAZARD.speakClasses stays empty.');
process.exit(pass.length ? 0 : 1);
