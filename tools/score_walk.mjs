#!/usr/bin/env node
// Score recorded walks against the Stage 1 gate: no missed moving vehicles, and under 1 false warning per minute.
//
// 1. Make a review sheet from a walk's session log (the app's "Save recording" gives the log and the video):
//      node tools/score_walk.mjs template session-log.json > walk1.labels.json
//    Every warning the app spoke is listed with its time in the video (seconds). Watch the video and set each
//    "verdict" to "correct" or "false". Under "missed", add anything the app should have warned about and did not:
//      { "t": 41.5, "kind": "vehicle", "note": "van reversing out of a drive" }
//    kind is one of: vehicle, person, stairs, kerb, obstacle, crossing, other.
//    Optional: give a correct warning "seen": the video time the hazard first became visible, to measure time to warn.
// 2. Score one or more walks (exit code 1 if the gate fails, so it can run before every release):
//      node tools/score_walk.mjs score walk1.labels.json walk2.labels.json ...
//    The report also gives speed (frames per second) and battery use per hour, from the app's 'perf' events (every 30 s).
// 3. Publish the numbers (Package C): writes docs/numbers.html, the "Our numbers" page, from the same sheets.
//      node tools/score_walk.mjs numbers sheets/*.json
import fs from 'node:fs';

const VEHICLE_WORDS = /\b(car|bus|lorry|truck|motorbike|motorcycle|vehicle|van)\b/i;

export function alertsFromLog(log) {
  const ev = log.events || [];
  const start = ev.find((e) => e.type === 'record-start') || ev[0];
  const t0 = start ? start.t : Date.parse(log.startedAt);
  return ev.filter((e) => e.type === 'alert').map((e) => {
    const [pr, ...rest] = String(e.detail).split('|');
    return { t: Math.round((e.t - t0) / 100) / 10, priority: Number(pr), text: rest.join('|') };
  }).filter((a) => a.t >= 0);
}

// Speed and battery for one walk, from the 'perf' events (Package C) and the 'walk-summary' event the app logs on stop.
// batteryPerHour: percent used per hour, from the first and last battery level while not charging (null if unknown).
export function perfFromLog(log) {
  const ev = log.events || [];
  const perf = ev.filter((e) => e.type === 'perf').map((e) => { try { return { t: e.t, ...JSON.parse(e.detail) }; } catch { return null; } }).filter(Boolean);
  const fps = perf.map((p) => p.fps).filter((x) => typeof x === 'number');
  const lanes = {};
  for (const p of perf) for (const [k, v] of Object.entries(p.ms || {})) if (typeof v === 'number') (lanes[k] = lanes[k] || []).push(v);
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const onBattery = perf.filter((p) => typeof p.battery === 'number' && !p.charging);
  let batteryPerHour = null;
  if (onBattery.length >= 2) {
    const a = onBattery[0], b = onBattery[onBattery.length - 1], hours = (b.t - a.t) / 3600000;
    if (hours > 0) batteryPerHour = Math.round(((a.battery - b.battery) * 100 / hours) * 10) / 10;
  }
  const ws = ev.filter((e) => e.type === 'walk-summary').map((e) => { try { return JSON.parse(e.detail); } catch { return null; } }).filter(Boolean);
  return {
    samples: perf.length, fps: avg(fps), minFps: fps.length ? Math.min(...fps) : null,
    laneMs: Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, avg(v)])),
    batteryPerHour, slowMode: ev.some((e) => e.type === 'slow-mode' && e.detail === 'on'), walks: ws,
  };
}

export function template(log, name = '') {
  const ev = log.events || [];
  const start = ev.find((e) => e.type === 'record-start') || ev[0];
  const end = ev.length ? ev[ev.length - 1].t : start?.t;
  return {
    log: name, walk_minutes: start ? Math.round(((end - start.t) / 60000) * 10) / 10 : null,
    alerts: alertsFromLog(log).map((a) => ({ ...a, verdict: '?' })),
    reported_wrong: ev.filter((e) => e.type === 'wrong-alert').map((e) => e.detail),
    missed: [],
    perf: perfFromLog(log),
  };
}

export function score(sheets, gate = { maxFalsePerMin: 1, maxMissedVehicles: 0 }) {
  let minutes = 0, correct = 0, falses = 0, unreviewed = 0; const missed = {}; const ttw = []; const falseTexts = [];
  for (const s of sheets) {
    minutes += s.walk_minutes || 0;
    for (const a of s.alerts || []) {
      if (a.verdict === 'correct') { correct++; if (a.seen != null) ttw.push(Math.max(0, a.t - a.seen)); }
      else if (a.verdict === 'false') { falses++; falseTexts.push(a.text); }
      else unreviewed++;
    }
    for (const m of s.missed || []) missed[m.kind || 'other'] = (missed[m.kind || 'other'] || 0) + 1;
  }
  const falsePerMin = minutes > 0 ? falses / minutes : null;
  const missedVehicles = missed.vehicle || 0;
  const vehicleWarnings = sheets.flatMap((s) => s.alerts || []).filter((a) => a.verdict === 'correct' && VEHICLE_WORDS.test(a.text)).length;
  ttw.sort((x, y) => x - y);
  const perfs = sheets.map((s) => s.perf).filter(Boolean);
  const fpsList = perfs.map((p) => p.fps).filter((x) => x != null);
  const bph = perfs.map((p) => p.batteryPerHour).filter((x) => x != null);
  const mean = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const failures = [];
  if (unreviewed) failures.push(`${unreviewed} warnings not reviewed yet`);
  if (!minutes) failures.push('walk length unknown');
  if (missedVehicles > gate.maxMissedVehicles) failures.push(`${missedVehicles} moving vehicles missed`);
  if (falsePerMin != null && falsePerMin >= gate.maxFalsePerMin) failures.push(`${falsePerMin.toFixed(2)} false warnings per minute`);
  return {
    walks: sheets.length, minutes: Math.round(minutes * 10) / 10, correct, false: falses, unreviewed,
    falsePerMin: falsePerMin == null ? null : Math.round(falsePerMin * 100) / 100,
    precision: correct + falses ? Math.round((correct / (correct + falses)) * 100) / 100 : null,
    missed, missedVehicles, vehicleWarnings,
    timeToWarnMedian: ttw.length ? ttw[Math.floor(ttw.length / 2)] : null,
    commonFalse: Object.entries(falseTexts.reduce((m, t) => ((m[t.split('.')[0]] = (m[t.split('.')[0]] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5),
    fps: mean(fpsList), batteryPerHour: mean(bph), slowModeWalks: perfs.filter((p) => p.slowMode).length,
    pass: failures.length === 0, failures,
  };
}

export function report(r) {
  const lines = [
    `Walks: ${r.walks}, ${r.minutes} minutes`,
    `Warnings: ${r.correct} correct, ${r.false} false${r.unreviewed ? `, ${r.unreviewed} not reviewed` : ''} (precision ${r.precision ?? '-'})`,
    `False warnings per minute: ${r.falsePerMin ?? '-'} (gate: under 1)`,
    `Missed: ${Object.entries(r.missed).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'} (gate: 0 moving vehicles)`,
    `Vehicle warnings that were right: ${r.vehicleWarnings}`,
    `Median time to warn: ${r.timeToWarnMedian == null ? '-' : r.timeToWarnMedian + ' s'}`,
  ];
  lines.push(`Speed: ${r.fps ?? '-'} frames per second on average${r.slowModeWalks ? ` (slow-phone mode on ${r.slowModeWalks} walk(s))` : ''}`);
  lines.push(`Battery: ${r.batteryPerHour ?? '-'} percent per hour`);
  if (r.commonFalse.length) lines.push('Most common false warnings: ' + r.commonFalse.map(([t, n]) => `"${t}" x${n}`).join('; '));
  lines.push(r.pass ? 'GATE: PASS' : 'GATE: FAIL - ' + r.failures.join('; '));
  return lines.join('\n');
}

// The "Our numbers" page (docs/numbers.html). Plain and accessible, the app's colours. With no walks scored it says
// "Not measured yet"; the gate is always stated, and a failed gate is shown as failed, never hidden.
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function numbersPage(r, date) {
  const cell = (v, unit = '') => (v == null ? 'Not measured' : `${v}${unit}`);
  const body = !r || !r.walks ? `<p class="box"><strong>Not measured yet.</strong></p>
<p>We publish how well Vision Assist works on real walks, including when it gets things wrong.
  No numbers are shown until they have been measured.</p>` : `<p class="box"><strong>${r.pass ? 'Stage 1 gate passed.' : 'Stage 1 gate not passed yet.'}</strong>
  Measured on ${esc(date)}.</p>
<table>
  <caption class="sr">Results from recorded walks</caption>
  <tr><th scope="row">Walks scored</th><td>${r.walks}</td></tr>
  <tr><th scope="row">Total minutes walked</th><td>${r.minutes}</td></tr>
  <tr><th scope="row">Moving vehicles missed</th><td>${r.missedVehicles}</td></tr>
  <tr><th scope="row">False warnings per minute</th><td>${cell(r.falsePerMin)}</td></tr>
  <tr><th scope="row">Warnings that were right</th><td>${r.correct} of ${r.correct + r.false}</td></tr>
  <tr><th scope="row">Average checks per second</th><td>${cell(r.fps)}</td></tr>
  <tr><th scope="row">Battery used per hour</th><td>${cell(r.batteryPerHour, ' percent')}</td></tr>
  <tr><th scope="row">Date</th><td>${esc(date)}</td></tr>
</table>${r.pass ? '' : `\n<p>Not passed because: ${esc(r.failures.join('; '))}.</p>`}`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<title>Our numbers - Vision Assist</title>
<style>
  :root { --bg:#000; --fg:#fff; --accent:#ffd400; }
  * { box-sizing: border-box; }
  html, body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui, sans-serif; }
  body { padding: 16px; max-width: 640px; margin: 0 auto; font-size: 1.3rem; line-height: 1.5; }
  h1 { font-size: 2rem; margin: 8px 0 16px; } h2 { font-size: 1.5rem; margin: 28px 0 8px; color: var(--accent); }
  a { color: var(--accent); } a:focus-visible { outline: 6px solid var(--accent); outline-offset: 3px; }
  a.back { display:flex; align-items:center; justify-content:center; min-height:72px; margin: 24px 0; border:3px solid var(--fg);
    border-radius:16px; background:#111; color:var(--fg); font-weight:700; text-decoration:none; font-size:1.4rem; }
  .box { border:2px solid var(--accent); border-radius:12px; padding:10px 14px; margin: 12px 0; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align:left; padding: 8px 6px; border-bottom: 1px solid #555; vertical-align: top; }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
  li { margin: 6px 0; }
</style>
</head>
<body>
<main>
<h1>Our numbers</h1>
${body}
<h2>The bar before blind testers use it</h2>
<p>Stage 1 gate: <strong>0 missed moving vehicles</strong> and <strong>fewer than 1 false warning per minute</strong>,
  across <strong>10 recorded walks</strong>.</p>
<h2>How the numbers are made</h2>
<p>A sighted tester walks with the app recording. Every warning is checked against the video and marked correct or false,
  and every moving vehicle the app missed is added. The scorer (tools/score_walk.mjs in the source code) adds them up.</p>
<a class="back" href="./">Back to Vision Assist</a>
</main>
</body>
</html>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...files] = process.argv.slice(2);
  if (cmd === 'template' && files[0]) {
    process.stdout.write(JSON.stringify(template(JSON.parse(fs.readFileSync(files[0], 'utf8')), files[0]), null, 2) + '\n');
  } else if (cmd === 'score' && files.length) {
    const r = score(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
    console.log(report(r));
    process.exit(r.pass ? 0 : 1);
  } else if (cmd === 'numbers') {
    const r = files.length ? score(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))) : null;
    const out = new URL('../docs/numbers.html', import.meta.url);
    fs.writeFileSync(out, numbersPage(r, new Date().toISOString().slice(0, 10)));
    console.log(r ? report(r) : 'No sheets: page says "Not measured yet".');
    console.log(`Wrote ${out.pathname}`);
  } else {
    console.log('Usage:\n  node tools/score_walk.mjs template session-log.json > walk.labels.json\n  node tools/score_walk.mjs score walk1.labels.json [walk2.labels.json ...]\n  node tools/score_walk.mjs numbers walk1.labels.json [...]   (writes docs/numbers.html)');
    process.exit(2);
  }
}
