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

export function template(log, name = '') {
  const ev = log.events || [];
  const start = ev.find((e) => e.type === 'record-start') || ev[0];
  const end = ev.length ? ev[ev.length - 1].t : start?.t;
  return {
    log: name, walk_minutes: start ? Math.round(((end - start.t) / 60000) * 10) / 10 : null,
    alerts: alertsFromLog(log).map((a) => ({ ...a, verdict: '?' })),
    reported_wrong: ev.filter((e) => e.type === 'wrong-alert').map((e) => e.detail),
    missed: [],
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
  if (r.commonFalse.length) lines.push('Most common false warnings: ' + r.commonFalse.map(([t, n]) => `"${t}" x${n}`).join('; '));
  lines.push(r.pass ? 'GATE: PASS' : 'GATE: FAIL - ' + r.failures.join('; '));
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...files] = process.argv.slice(2);
  if (cmd === 'template' && files[0]) {
    process.stdout.write(JSON.stringify(template(JSON.parse(fs.readFileSync(files[0], 'utf8')), files[0]), null, 2) + '\n');
  } else if (cmd === 'score' && files.length) {
    const r = score(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
    console.log(report(r));
    process.exit(r.pass ? 0 : 1);
  } else {
    console.log('Usage:\n  node tools/score_walk.mjs template session-log.json > walk.labels.json\n  node tools/score_walk.mjs score walk1.labels.json [walk2.labels.json ...]');
    process.exit(2);
  }
}
