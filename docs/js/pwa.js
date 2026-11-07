// Installed app and no signal (Package B, 7 Nov). Pure logic with injected say/storage, so it is tested without a browser.
export const OFFLINE_TEXT = 'No internet. I can still spot obstacles, but directions and Google listening need signal.';
export const ONLINE_TEXT = 'Internet is back.';
export const UPDATED_TEXT = 'Vision Assist has updated.';

// Says when the internet goes and comes back: once per drop (a flapping signal is not repeated within repeatMs), and
// "back" only after the walker was told it had gone.
export class OnlineWatch {
  constructor({ say, now = () => Date.now(), repeatMs = 60000 }) {
    Object.assign(this, { say, now, repeatMs });
    this.online = true; this.saidOffline = false; this.lastSaidAt = -Infinity;
  }
  // At start: say it if there is no signal now.
  start(online) { this.online = !!online; if (!this.online) this._offline(); }
  update(online) {
    online = !!online;
    if (online === this.online) return;
    this.online = online;
    if (!online) this._offline();
    else if (this.saidOffline) { this.saidOffline = false; this.say(ONLINE_TEXT, 'status'); }
  }
  _offline() {
    if (this.now() - this.lastSaidAt < this.repeatMs) { this.saidOffline = true; return; }
    this.lastSaidAt = this.now(); this.saidOffline = true;
    this.say(OFFLINE_TEXT, 'status');
  }
}

// "Vision Assist has updated." once, on the first start of a new version. Nothing on the very first start ever, and
// nothing when storage is unavailable (no way to know).
export function updateNotice(version, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    if (!storage || !version) return '';
    const was = storage.getItem('va.version');
    storage.setItem('va.version', version);
    return was && was !== version ? UPDATED_TEXT : '';
  } catch (_) { return ''; }
}
