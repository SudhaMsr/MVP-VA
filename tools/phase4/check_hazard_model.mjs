#!/usr/bin/env node
// Package E: does docs/models/hazard320.onnx load, and does its output have the shape the app decodes?
// Runs one blank frame through it with the app's own onnxruntime-web build, in headless Chrome, and prints the output shape.
// Expected: [1, 4 + classes + 32, N] (YOLOE-seg: box, one score per class in tools/phase4/hazard_vocab.json, 32 mask
// coefficients the app ignores). Exit code 1 if the file is missing, will not load, or has the wrong shape.
//   node tools/phase4/check_hazard_model.mjs          (needs: npm install; CHROME=/path/to/chrome to use another Chrome)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../lib/serve.mjs';

const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
const nc = JSON.parse(fs.readFileSync(new URL('hazard_vocab.json', import.meta.url))).classes.length;
if (!fs.existsSync(`${docs}models/hazard320.onnx`)) { console.log('FAIL: docs/models/hazard320.onnx is missing. Run tools/phase4/export_hazard_model.py.'); process.exit(1); }
const site = await serve(docs);
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let ok = false;
try {
  const page = await browser.newPage();
  await page.goto(site.url + 'privacy.html');
  await page.addScriptTag({ url: site.url + 'vendor/ort/ort.min.js' });
  const r = await page.evaluate(async () => {
    const ort = window.ort; ort.env.wasm.wasmPaths = new URL('vendor/ort/', location.href).href; ort.env.wasm.numThreads = 1;
    const t0 = performance.now();
    const s = await ort.InferenceSession.create('models/hazard320.onnx', { executionProviders: ['wasm'] });
    const load = performance.now() - t0;
    const x = new ort.Tensor('float32', new Float32Array(3 * 320 * 320).fill(0.45), [1, 3, 320, 320]);
    const t1 = performance.now();
    const out = await s.run({ [s.inputNames[0]]: x });
    return { inputs: s.inputNames, outputs: s.outputNames.map((n) => ({ n, dims: out[n].dims })), loadMs: Math.round(load), runMs: Math.round(performance.now() - t1) };
  });
  const dims = r.outputs[0].dims;
  console.log(`Loaded in ${r.loadMs} ms; one frame in ${r.runMs} ms (desktop; the phone is slower).`);
  console.log(`Input ${r.inputs[0]}; outputs ${r.outputs.map((o) => `${o.n} [${o.dims.join(', ')}]`).join('; ')}`);
  ok = dims.length === 3 && dims[0] === 1 && dims[1] === 4 + nc + 32;
  console.log(ok ? `PASS: first output is [1, 4 + ${nc} + 32, ${dims[2]}]` : `FAIL: expected [1, ${4 + nc + 32}, N]`);
} catch (e) {
  console.log('FAIL:', e.message.split('\n')[0]);
} finally { await browser.close(); site.close(); }
process.exit(ok ? 0 : 1);
