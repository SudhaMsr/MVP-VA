# Vision Assist: handoff for Phase 2

Paste this at the start of a new chat, together with the repo link.

## Project
- Voice-first walking companion web app for blind and low-vision people. Core feature: spoken walking navigation. Second feature: hazard detection with spoken alerts.
- Repo: github.com/SudhaMsr/MVP-VA (branch main). Live: https://sudhamsr.github.io/MVP-VA/ (GitHub Pages, served from `/docs`). Latest commit: `9386756`.
- Test phone: Poco M2 Pro (Android, Chrome). Team: the user and Claude. Deadline: 10 days. Blind testers are ready.
- Rules from the user:
  - Only navigation may use paid APIs. Everything else must be free or on-device.
  - Never say "prototype" anywhere in the app.
  - Guide blind users safely by voice. No compass words (north-west and so on); say left and right.
  - Speech should be calm and not too fast. Rate is now 0.95.

## What is built
- **Hazard detection:** two YOLOv8n ONNX models in the browser (onnxruntime-web WASM).
  - Fast lane every frame (20 classes).
  - Slow lane at most every 2 s (stairs, manhole, bench and so on).
  - IoU tracker with distance estimates. Alert engine with priorities and cooldowns. Urgent vehicle alerts need 2 or more sightings.
- **Navigation:**
  - Google Places (New) and Routes (WALK), called from the browser with a referrer-restricted key. Falls back to OpenStreetMap (Nominatim and routed-foot). `?maps=osm` forces OSM.
  - Wayfindr-style wording. Heading check after about 10 m. Off-route detection. Turn warning at 40 m, "now" at 12 m.
- **Dialogue:** idle, choose and confirm states. Yes, no and number answers. 25 s timeout. On-screen answer buttons.
- **Voice:** TTS is browser speechSynthesis (en-GB). STT is Chrome Web Speech.
- **Reading text:** built (built-in TextDetector, otherwise Tesseract.js) but switched off by `FEATURES.read=false`. Turn on only after the core is finished.
- **Tools and tests:**
  - 56 Node tests pass (`node --test tests/*.test.js`).
  - Playwright e2e at `/home/claude/work/e2e/run.py` (may not persist).
  - `tools/` has frame extraction, a Colab training recipe for a steps/kerb detector, and a session-log analyser.
  - README documents everything.
- **Google setup:** project `vision-assist-512619` on account chandramukhi843@gmail.com, with the $300 trial credit (90 days). Key is restricted to `https://sudhamsr.github.io/*` and lives in `docs/js/config.js`. The old project and key in an older repo should be rotated, and that repo made private.

## Last retest (live, fake Bristol GPS, real Google APIs)
- Working: screen-reader double speaking fixed, no "test" labels, a short start message, "You are going the right way", and the 30 m turn warning.

## Open issues and next steps
1. **Street names:** Google gives odd names such as "Temple Meads - Castle Park/Temple Meads Ferry". Drop names with " - " or "/" (ferry or station stops) and say "walk straight".
2. **"Now" prompt:** it did not fire when I jumped straight to the turn point. Check the logic and simulate real walking in small steps.
3. **Steps/kerb detection:** unproven. The user will send footage. Then extract frames, label in Roboflow, train in Colab, and wire in `steps416.onnx`.
4. **Chattiness:** untested after the changes. Filter to near and in-path objects and add an alert budget.
5. **Walk questions:** "where am I", "how far", "what's next", "am I on the right route", save a place, "take me home".
6. **Voice settings by voice:** speak slower or faster, less chatty, steps or metres.
7. **Feedback sounds:** a tone when the app starts and stops listening, and a tap-anywhere area to talk.
8. **Speed on the Poco:** about 250 ms fast lane, about 680 ms with the slow lane. Decide whether that is acceptable.
9. **Testing and rollout:**
   - Outdoor navigation test on the phone, by voice.
   - Seated tester session, then a supervised walk.
   - Consent form, tester interview questions, known-limits list.
   - Self-host the runtime, check battery use, and test with a screen reader.

## Needed from the user
- A session log or recording from the first outdoor walk.
- Steps and kerb footage.
- Whether voice commands work on the phone.
- Confirmation that the speech pace now feels right.

## Roadmap (10 days)
- Days 3-4: speed decision and a seated tester session.
- Days 5-7: navigation and hazards together.
- Day 8: screen reader, battery, self-hosted runtime.
- Day 9: supervised walk.
- Day 10: guide, consent form, known-limits list.

## Gotchas
- GitHub Pages and Chrome cache old files for several minutes. Add `?v=N` to the address to force a refresh.
- The sandbox has no PyPI, npm or CDN access, but GitHub works.
