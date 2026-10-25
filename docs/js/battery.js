// Battery warnings. A walking app with the camera on drains a phone, and a blind walker cannot glance at the screen.
// Speaks once as the charge falls to 20, 10 and 5 percent (not while charging), and answers "what is my battery".
// Uses the Battery Status API (Chrome on Android). Where it is missing, the app says so instead of staying silent.
export const BATTERY_STEPS = [20, 10, 5];

export function batteryText(level, charging) {
  const pct = Math.round(level * 100);
  if (charging) return `Battery is at ${pct} percent and charging.`;
  if (pct <= 5) return `Battery is very low, ${pct} percent. Plug in soon.`;
  if (pct <= 10) return `Battery is low, ${pct} percent.`;
  return `Battery is at ${pct} percent.`;
}

export class BatteryWatch {
  // getBattery: navigator.getBattery (or a fake in tests). say(text, kind). log(level) is called on every change.
  constructor({ getBattery, say, log = () => {}, steps = BATTERY_STEPS } = {}) {
    Object.assign(this, { getBattery, say, log, steps });
    this.supported = typeof getBattery === 'function';
    this.battery = null;
    this.announced = new Set();
  }

  async start() {
    if (!this.supported) return false;
    try { this.battery = await this.getBattery.call(typeof navigator !== 'undefined' ? navigator : undefined); } catch (_) { this.supported = false; return false; }
    const check = () => this._check();
    this.battery.addEventListener('levelchange', check);
    this.battery.addEventListener('chargingchange', check);
    this.log(this.battery.level, this.battery.charging);
    // Starting low is worth saying straight away (once).
    this._check();
    return true;
  }

  _check() {
    const b = this.battery; if (!b) return;
    this.log(b.level, b.charging);
    if (b.charging) { this.announced.clear(); return; } // plugged in: warnings start fresh next time
    const pct = Math.round(b.level * 100);
    // The lowest step reached that has not been announced. Higher steps skipped by a jump are marked as done.
    const reached = this.steps.filter((s) => pct <= s);
    if (!reached.length) return;
    const lowest = Math.min(...reached);
    if (this.announced.has(lowest)) return;
    for (const s of reached) this.announced.add(s);
    this.say(batteryText(b.level, false), lowest <= 5 ? 'nav' : 'status');
  }

  // For "what is my battery".
  ask() {
    if (!this.supported || !this.battery) return 'I cannot read the battery on this phone. Please check it on the screen.';
    return batteryText(this.battery.level, this.battery.charging);
  }
}
