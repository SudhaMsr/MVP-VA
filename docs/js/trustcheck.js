// Trust features (7 Nov): the walker can always find out why the app said something, and whether it is working.
// Blind users told us silence and unexplained warnings are what make them stop trusting an app.
import { nearDistance } from './units.js';
import { LIMITS_TEXT } from './safetext.js';

const LABEL = { car: 'car', truck: 'lorry', bus: 'bus', motorcycle: 'motorbike', bicycle: 'bicycle', person: 'person', dog: 'dog' };
const mph = (mps) => Math.max(1, Math.round(mps * 2.237));
const where = (dir) => (dir === 'ahead' ? 'straight ahead' : `on your ${dir}`);

// "Why did you say that?" Plain words, from what the alert engine actually saw. Never invents a reason.
export function explainAlert(a) {
  if (!a) return 'I have not given a warning yet.';
  const name = LABEL[a.name] || (a.name ? a.name.replace(/_/g, ' ') : 'something');
  const dist = a.d != null && a.d > 0 ? `, ${nearDistance(a.d)}` : '';
  let why;
  if (a.key === 'clear') why = 'I no longer saw anything in your way, after it had been blocked. That is not a promise, so keep using your cane.';
  else if (a.crowd) why = `I could see ${a.count || 'several'} people close together in your walking path${dist}. People usually move aside, so I did not say stop.`;
  else if (a.priority === 0) why = `I saw a ${name} ${where(a.dir)}${dist}, coming towards you${a.sp != null ? ` at about ${mph(a.sp)} miles an hour` : ''}. Moving vehicles that close always get a warning.`;
  else if (a.key && a.key.endsWith(':pass')) why = `I saw a ${name} moving across in front of you${dist}.`;
  else if (a.parked) why = `I saw a ${name} that was not moving, in your walking path${dist}. Parked vehicles are only mentioned when they are in your way.`;
  else if (a.name === 'stairs') why = 'I saw stairs low in the picture, clearly, two times in a row. Check with your cane.';
  else if (a.kind === 'static') why = `I saw a ${name} close to you, in your walking path.`;
  else why = `I saw a ${name} ${where(a.dir)}${dist}${a.inPath ? ', in your walking path' : ''}.`;
  if (/No clear way\. Stop\./.test(a.text || '')) why += ' Both sides looked blocked, so I said stop.';
  else if (/Clearer on the (left|right)/.test(a.text || '')) why += ` The ${RegExp.$1} side looked more open.`;
  if (a.score != null) why += a.score >= 0.75 ? ' I was fairly sure.' : ' I was not very sure, so check with your cane.';
  return why;
}

// One spoken line about what is and is not working. On a normal start only problems are spoken; asked directly
// ("are you working?") or on the very first start, everything is, followed by what the app cannot see (Package A):
// "working" must never be heard as "sees everything".
export function selfCheckText({ camera = true, location, internet, listening, battery = null, charging = false }, full = false) {
  const problems = [];
  if (!camera) problems.push('the camera is not working, so I cannot warn you about anything');
  if (location === false) problems.push('location is off, so directions will not work');
  if (internet === false) problems.push('there is no internet, so directions and Google listening will not work, but warnings still do');
  else if (listening === false) problems.push('Google listening is not working, so I am using the phone\'s own listening');
  if (battery != null && battery <= 0.2 && !charging) problems.push(`the battery is at ${Math.round(battery * 100)} percent`);
  const limits = full ? ` ${LIMITS_TEXT}` : '';
  if (!problems.length) return full ? `Check done. Camera, location and internet are all working.${limits}` : '';
  const s = problems.join('; and ');
  return `Check done. ${s.charAt(0).toUpperCase()}${s.slice(1)}.${limits}`;
}
