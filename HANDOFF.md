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

## Added after the video research
- Walking corridor filter, free-space hints ("Clearer on the left."), vibration for urgent alerts (voice: "vibration on/off"), route recording ("record this route as X", "stop recording", "follow route X", "take me back along route X"), and "what is around me" now opens with path status.
- Overwhelm audit (busy street, 2 min simulation): quiet 8 alerts, normal 17, detailed 18; navigation start message shortened to destination, distance, time, first step.
- Also built: memory notes, crossing help, text reading switched on (`FEATURES.read=true`). 165 tests pass. Latest commit is on main.
- Next: outdoor navigation test on the Poco, misidentified-object log, street-name cleanup, COCO third lane (needs a Colab ONNX export), kerb detection from footage.

## Added 30-31 Oct (Phase 2 model, field feedback, Phase 3)
- **Models now in the app:** fast lane `best320.onnx` (20 classes, every frame); slow lane `rod2_416.onnx` (Phase 2, 30 classes: stairs, manholes, bollards, lights, every 2 s, loads in the background after Start); third lane `coco320.onnx` (COCO, every 3.5 s, own phone / train / boat / airplane removed). Test-only: `depth_s_q.onnx` (Depth Anything V2 Small) with `?depth=1`, never speaks.
- **Not in the app:** `ground416.onnx` (Phase 3 kerb / tactile paving, `tools/phase3/phase3_colab.ipynb`, in Drive at `MyDrive/vision_assist_phase3`). Scored mAP50 0.94 on its own datasets but on our demo footage called plain and brick paving "tactile paving" at 0.84-0.93. Retrain with 100-200 labelled Bristol photos (including plain paving as background) before use.
- **Vehicles:** warn only when coming fast (car / motorbike over 7 m/s, bus / truck over 5 m/s, within 20 m), as in the first Vision Assist (GOOGLE repo); within 5 m any vehicle closing faster than 2.5 m/s; "Car passing ahead" for cars crossing the path (sideways speed, camera turning subtracted); a parked vehicle in the walking path is said once at 5 m ("Parked car ahead, about 4 metres. Clearer on the left." or "...It is blocking the path. Take care if you step into the road."), after about a second of sightings.
- **Safety:** "I can't see clearly" when the camera is dark or covered for 3 s (`camcheck.js`); first-start line about holding the phone at chest height and keeping the cane or guide dog; "I lost your location signal" at most once a minute.
- **Start-up:** location asked for as soon as the page opens (precise, so Android offers to turn location on); Running after the fast model only; models kept on the phone after the first download (`modelcache.js`, Cache Storage, refreshed in the background).
- **Voice:** "save 25 Lakeside BS16 3EE as home", stuttered "navigate to me to X", "how far", "what's next", "am I on the right route", "that was wrong" (logs the last warning), "less chatty".
- **Google APIs:** Places (New) and Routes in use and checked live; Geocoding, Speech-to-Text and Text-to-Speech enabled 30 Oct but unused (rule: only navigation may be paid); Directions (legacy) refused by Google for new projects.
- **Tests:** 196 Node tests; headless browser scripts covered start/stop, voice navigation, saved home, battery, camera check, cache with downloads blocked, demo-video playback.
- **Docs (claude.ai):** plan "Vision Assist: Plan to Real Use by Blind Walkers"; "Vision Assist: Tester Pack" (consent, known limits, quick guide, supervisor checklist, interview).
- **Next:** sighted street walk with Record session on (Poco speed, load time, car rules, "navigate me to this place" log); seated tester session; supervised walk with the tester pack; Bristol photos for kerbs and tactile paving; rotate the key in the old GOOGLE repo.
