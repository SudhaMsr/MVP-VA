# Vision Assist: project rules for Claude Code

Vision Assist is a browser-only, voice-first walking aid for blind and low-vision users. It is a static site served by
GitHub Pages from `/docs`. ES modules live in `docs/js`, ONNX models in `docs/models`, tests in `tests/`
(`node --test`, run with `npm test`).

## Rules

- **Safety first.** Never add speech that implies something is safe ("safe to cross", "clear path", "all clear").
  When unsure, say so and tell the user to check with their cane or guide dog.
- Never weaken vehicle alerts, the alert budget, or the encounter memory without a test proving the change.
- Every behaviour change needs tests. `npm test` must pass before any commit.
- After changing any file in `docs/js`, run `python3 tools/stamp.py` so `docs/index.html` gets the new version stamp
  (a test fails otherwise).
- Spoken text: short, plain British English, distances in steps by default.
- Work on a branch per task and open a PR to main. Never push to main directly. Never force-push.
- Never commit secrets, service-account files, or new API keys. The Google key in `docs/js/config.js` is intentionally
  public and restricted in Google Cloud; do not move or rotate it.
- Do not touch the `phase2-nav-fixes` branch.
- Keep the app working with no build step: plain JS modules, no bundler, no framework.
- Update `README.md` and `HANDOFF.md` when behaviour changes.
- At the end of each task report: branch, PR link, tests passing count, version stamp, and anything not done.
