# Vision Assist: handoff for Phase 2

Paste this at the start of a new chat, together with the repo link.

## Project
- Voice-first walking companion web app for blind and low-vision people. Core feature: spoken walking navigation. Second feature: hazard detection with spoken alerts.
- Repo: github.com/SudhaMsr/MVP-VA (branch main). Live: https://sudhamsr.github.io/MVP-VA/ (GitHub Pages, served from `/docs`).
- Test phone: Poco M2 Pro (Android, Chrome). Team: the user and Claude. Deadline: 10 days. Blind testers are ready.
- Rules from the user:
  - Only navigation and speech-to-text may use paid APIs (both are Google, under the one restricted key). Everything else must be free or on-device.
  - Never say "prototype" anywhere in the app.
  - Guide blind users safely by voice. No compass words (north-west and so on); say left and right.
  - Speech should be calm and not too fast. Rate is now 0.95 (of 7 notches, 60% to 110%).

## What is built
- **Hazard detection:** three YOLOv8n/COCO ONNX models in the browser (onnxruntime-web WASM).
  - Fast lane every frame, `wotr` (20 classes).
  - Slow lane at most every 2 s, `rod2` (30 classes: stairs, manhole, bench and so on, plus five not yet wired into any alert — bollard, upstairs, downstairs, red light, green light).
  - Third lane every 3.5 s, `coco` (outdoor COCO classes: traffic lights, stop signs, animals... also not yet spoken).
  - IoU tracker with distance estimates. Alert engine with priorities and cooldowns. Urgent vehicle alerts need 5 speed samples in a row before the vehicle can be called approaching.
  - Test-only: `depth_s_q.onnx` (Depth Anything V2 Small) behind `?depth=1`, never speaks.
- **Navigation:**
  - Google Places (New) and Routes (WALK), called from the browser with a referrer-restricted key. Falls back to OpenStreetMap (Nominatim and routed-foot). `?maps=osm` forces OSM.
  - Wayfindr-style wording. Heading check after about 10 m. Off-route detection. Turn warning at 40 m, "now" at 8 m. Distances are spoken in steps by default (changed 7 Nov at the user's request; it was yards). A phone that already saved another unit keeps it until the walker says "use steps".
  - "Navigate me to ..." goes straight to the best match and aims at its nearest entrance, Google-Maps style.
- **Dialogue:** idle, choose and confirm states. Yes, no and number answers. 40 s timeout (75 s while choosing from a list). On-screen answer buttons.
- **Voice:** TTS is browser speechSynthesis (en-GB), rate 0.95. STT is tap-to-talk: the walker taps, the app goes quiet, records until they stop talking (or 7 s), and the clip goes to Google Cloud Speech-to-Text (same restricted key as navigation); Chrome's built-in recogniser is the fallback if Google fails. Repeated and chatty speech is capped: once per encounter, per-minute caps, no chatter in quiet mode.
- **Reading text:** built (built-in TextDetector, otherwise Tesseract.js) and switched on (`FEATURES.read=true`).
- **Screen off:** locking the phone or switching tabs stops detection and speech at once; a Wake Lock keeps the screen on while running (where the phone allows it); coming back resumes automatically.
- **Tools and tests:**
  - 209 Node tests pass (`npm test`).
  - `tools/` has frame extraction, Open Images and Colab training recipes (phase2/phase3), and a session-log analyser.
  - README documents everything.
- **Google setup:** key restricted to the `https://sudhamsr.github.io/*` referrer and to the Places (New), Routes and Speech-to-Text APIs only; it lives in `docs/js/config.js` and is intentionally committed (a browser app cannot hide it). Check Cloud Console quota/billing occasionally for unexpected use.

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

## Model test on the first field-walk videos (31 Oct, evening)
Phone screen recordings from 30 Oct (camera preview cut out, 15 fps, 45 s of Bristol pavements with parked cars) played through the app:
- Before: quiet mode said 8 things in 90 s, 7 false (4 "car approaching" for parked cars, "Stairs", 2 "Dog"); detailed mode also said "Tactile paving" 4 times on block paving.
- After: quiet mode 0 false; detailed only trees, bins, a pole.
- Fixes: closing speed is now a line fit over the last 1.2 s of distances (trusted only with a good fit, 5+ samples); no speed for boxes cut off by the picture edge; a one-step distance jump resets the speed (tracker swapping cars); slow-lane stairs need 0.80+ and two runs in a row (plain paving scored up to 0.77); the fast lane's "tactile paving" guess is ignored (51 of 178 frames on ordinary paving); people and dogs need 3 frames, anything filling 60%+ of the picture needs 5 (a blurred wall was "Dog, very close").
- Still to prove on the street: that a real approaching car is warned in time (synthetic test: about 0.6 s after it is fully in view), and that real stairs still pass the stricter stairs rule.


## State on 7 Nov (Stage 1 build: calmer, more honest, measurable)
Built and deployed to GitHub Pages; 225 tests pass; checked end to end in headless Chrome (fake camera, simulated GPS, faked Google replies). Not yet checked on the Poco or a real street.
- **Steps by default** for distances ("about 4 steps", "in 60 steps, turn right"; long walks still in miles).
- **Busy pavements:** 3+ people close in the path give one "Busy ahead, people close." (said once per encounter); "Stop" only for someone very close straight ahead; anything moving very close straight ahead skips the talk budget. `crowdMin: 0` in config turns the crowd rule off. In a 60 s simulated crowd, quiet mode said 4 things and never "Stop" for the crowd itself.
- **Lost signal:** only after 10 s with no fix, plus "Location signal is back." (a stray error between good fixes used to trigger it).
- **Trust features (trustcheck.js):** "why did you say that?" explains the last warning from what the engine saw; "are you working?" gives a full check; a start-up check speaks the full line on first start and afterwards only problems.
- **Watch log throttle:** watch-detect at most once per class every 2 s.
- **record-start event** marks video time zero in the session log.
- **Stage 1 gate scorer:** `tools/score_walk.mjs` (see README, "Scoring walks"). Gate: every warning reviewed, 0 missed moving vehicles, under 1 false warning per minute, across 10 recorded walks.

### What blind and partially sighted people have told us (sources used to set priorities)
- RNIB "In My Way" (2025, 1,197 respondents): top barriers are vehicles parked on pavements 82%, poor pavements 71%, temporary obstacles (A-boards, bikes, e-scooters, bin bags) 56%, paths shared with cyclists or e-scooters 52%, lack of accessible crossings 44%; overhanging branches named too; 92% have had to walk in the road.
- User studies: obstacle detection had the most first preferences; reading text was the most requested task; people want obstacle-free paths, route information, low cost and low effort.
- Forums (AppleVis): strong anger at apps that over-claim ("AI Guide Dog"); crossing apps get confused by red countdown timers and lose the light near the far kerb; people do not want to hold a phone out in crowds.
- To do: ask VI Talk (charity 1165629; podcast, Facebook group) and the Bristol Sight Loss Council for a feedback session and pilot testers. A draft message is in the chat of 7 Nov.

### Model plan that follows from this (needs walk footage; not started)
1. Bristol test set from Stage 1 walks, scored with score_walk.mjs, as the regression gate.
2. Hazard list in RNIB order: pavement-parked vehicles (done), parked bikes and e-scooters, A-boards and bins, overhanging branches and head-height signs, kerbs and step-downs, crossings (pedestrian signal state only, Oko-style, robust to countdown timers).
3. Training data: false alarms and misses from walk logs ("that was wrong", watch-detect), auto-labelled with an open-vocabulary detector and checked by hand; plain Bristol paving as negatives (the reason the kerb model failed).
4. One merged detector instead of three lanes, then INT8 and WebGPU for speed on the Poco.
5. Distance from ground geometry (box bottom + phone height and tilt) and the depth lane, not just box height.

### Hazard lane (7 Nov, later): prebuilt open-vocabulary model, no training
- **What:** YOLOE (Ultralytics) told by text to look for RNIB's obstacles: e-scooter, parked bicycle, A-board, bollard, wheelie bin, rubbish bag, traffic cone, roadworks barrier, low branch, kerb, stairs, pothole, crossing light, bench, lamp post (`tools/phase4/hazard_vocab.json`).
- **Make the file (on your computer; the build sandbox may not run downloaded model weights):** `pip install ultralytics onnx onnxslim`, then `python3 tools/phase4/export_hazard_model.py` → `docs/models/hazard320.onnx`. Run `python3 tools/stamp.py`, `npm test`, commit, push.
- **In the app:** loads in the background if the file is there (`?hazard=off` turns it off); runs every 4 s; LOG ONLY: `hazard-detect` events (name|score|side|box height), and "is there an e-scooter / a bollard / a kerb?" answers with a hedge ("I think there is... check with your cane"). `HAZARD.speak` is false: no class is spoken as a warning yet.
- **Evaluate before speaking anything:** download VIP-Mobility360 (LJMU open data, CC BY 4.0; UK footage of the RNIB obstacles) on your computer and run `python3 tools/phase4/eval_hazard_model.py DATASET --map "..."`. A class becomes a candidate only at precision >= 0.9 and recall >= 0.6, then it must pass the walk gate (`tools/score_walk.mjs`) on Bristol walks.
- **Next model step:** use the best open-vocabulary classes to auto-label VIP-Mobility360 and our walk frames, check the labels by hand, and fine-tune a small fixed-class YOLO (fast enough for every frame, unlike YOLOE every 4 s).

## Build plan packages (from "Vision Assist — Build Plan & Claude Code Playbook", 7 Nov)
Each package is one branch and one PR, stacked in order (each branch starts from the previous one), so merge them in order.
`CLAUDE.md` holds the project rules every Claude Code session reads first.

### Package A: safety honesty (`feat/safety-honesty`)
- `docs/js/safetext.js`: `BANNED` phrases, `isSafeText()`, and the shared `CROSSING_TEXT` and `LIMITS_TEXT`. `tests/safetext.test.js`
  scans every string and template literal in `docs/js` (comments and regexes skipped, model class names exempt) and fails on any banned phrase.
- Wording changed because it implied safety: "Clear ahead." is now "I no longer see anything in your way."; "The way ahead looks clear."
  is now "I see nothing in your way, but check with your cane."; the "Green light, ahead." alert is gone, and describe/find call a green
  light "a traffic light". `crossingAdvice()` no longer reports a colour (it used to say "The light looks red/green").
- Crossings: `crossesRoad(step)` in nav.js (Google instruction words, OSRM street names and intersection classes). OSRM does not pass on
  OSM `highway=crossing` nodes, so a crossing that is not named in the route is missed; querying Overpass along the route would fix that.
- New intents: `limits`, `privacy`; traffic-light questions all map to `cross`. `Dialogue.confirm()` is a generic yes/no used for
  recording consent (`privacy.js` `RecordingConsent`).
- Pages: `docs/privacy.html`, `docs/limits.html`, `docs/numbers.html`.

### Package B: installable and offline (`feat/pwa-offline`)
- `docs/manifest.webmanifest` + `docs/icons/` (made by `tools/make_icons.py`: a yellow eye on black, no text; maskable version
  kept inside the safe zone). Linked from index.html with an apple-touch-icon.
- `docs/sw.js`: one service worker. Pages network-first with the cached copy offline; scripts, the onnxruntime files, manifest and icons
  cache-first. Models are not touched (modelcache.js keeps them in `va-models-v1`). The cache name carries the version stamp, and
  `tools/stamp.py` now also writes the version and precache list into sw.js, so every release changes the worker.
  Precached: every page, every `docs/js` file at its stamped address, `ort.min.js` and `ort-wasm-simd.wasm` (what the phone uses);
  the other three runtime files are cached the first time they are fetched (about 30 MB nobody normally needs).
- **?mt=1 choice:** the cross-origin isolation headers from `coi-sw.js` are folded into sw.js and added only for pages opened with
  `?mt=1`. Two workers cannot share one scope, so registering coi-sw.js for mt=1 would have replaced the offline worker (and the
  other way round). `coi-sw.js` is deleted; phones that had it get sw.js on the next open. Checked: `?mt=1` is crossOriginIsolated,
  a plain open is not.
- `docs/js/pwa.js`: `OnlineWatch` (no-internet / back lines) and `updateNotice()` (compares the version with the last start).
- **Removed models:** `docs/models/best416.onnx`, `rod416.onnx`, `rod640.onnx` (about 37 MB). Nothing in the app loaded them except the
  supervisor options `?size=416` and `?model=rod`, which now fall back to the normal model (`pickModel` in config.js). They are in git
  history: `git show 352ec39:docs/models/best416.onnx > best416.onnx` (same for the other two). `tools/analyze_session.py` still
  expects best416 and rod416 in docs/models: restore them locally that way before running it. `du -sh docs`: 138 MB before, 102 MB after.
- `tools/offline_check.mjs` (`npm run check:offline`): installability from Chrome DevTools, then online start, offline reload,
  offline start, the spoken lines. Gotcha found while writing it: where /tmp is a RAM disk (WSL), headless Chrome refuses Cache
  Storage entries over about 10 MB, so the check keeps its profile in `node_modules/.cache/`.

### Package C: walk instrumentation (`feat/walk-metrics`)
- `docs/js/perf.js`: `PerfMeter` (counters only in the frame loop), `SlowMode` (under 4 fps for 20 s on, over 6 fps for 30 s off;
  doubles the rod2/coco intervals and skips the hazard lane; the main lane is never gated), `WalkStats` + `summaryText`.
- Session log events: `perf` every 30 s (JSON: fps, ms per lane, battery, charging, heapMB, slow), `slow-mode` on/off,
  `walk-summary` on stop. Voice: "walk summary".
- `tools/score_walk.mjs`: `perfFromLog()` adds a `perf` block to each review sheet (avg fps, ms per lane, battery per hour);
  the report prints speed and battery; `numbers SHEETS...` writes `docs/numbers.html` (`numbersPage()`; with no sheets it is the
  "Not measured yet" page, and a test checks the committed page matches). How to run and score a walk: README, last section.
- Headless check (fake camera, 34 s): one perf event (12.6 fps, main 68 ms, rod2 127 ms, coco 81 ms), walk summary spoken and logged.

### Package D: accessibility (`feat/a11y`)
- Controls: `#startBtn` is Start walking / Stop walking; `#talkBtn` is Talk (starts the app first if stopped). The old `#stopBtn` is gone.
  Both are at least 120 px tall (19% of the screen), in the lower half (flex column, controls pushed down), and first in focus order:
  Start/Stop, Talk, More options. Conversation, help text and speed stats moved inside More options so nothing pushes them up.
- axe found one serious issue (label-content-name-mismatch on level/mic/tap/units buttons): all `aria-label`s on buttons removed,
  hints moved to `aria-describedby`. `tools/a11y_check.mjs` (`npm run check:a11y`): axe on the home page, with menus open, while
  running, and on the three info pages; plus sizes (72x72 main, 48x48 others), lower half, focus order, "Stop walking" name. PASS.
- `docs/js/output.js`: `routeOutput(kind, {mode, screenReader})`. `docs/js/haptics.js`: named patterns VEHICLE, OBSTACLE, TURN_LEFT,
  TURN_RIGHT, ARRIVED, LOST_SIGNAL (+ STOP, STAIRS), all different (tested); `kindForNav()` for turns, arrival, lost signal. A vehicle
  buzz is never held back by the 1.5 s spacing. Settings saved as `va.output` and `va.sr` (old `va.haptics=0` becomes speech only).

#### TalkBack test script (15 minutes, for a blind tester; a sighted helper only watches and notes)
Before: Android phone with TalkBack on, Chrome, headphones optional. The helper writes down every point where the tester is stuck,
hears something unclear, or needs help. Do it indoors first, then on a quiet pavement.
1. **Install (3 min).** Open Chrome, go to `sudhamsr.github.io/MVP-VA`. Open the Chrome menu, choose "Install app" (or "Add to Home
   screen"). Find "Vision Assist" on the home screen and open it. *Check:* the icon is announced as "Vision Assist".
2. **Find the controls (2 min).** Swipe right from the top. *Check:* TalkBack reads the title, the status line, then "Start walking,
   button", "Talk, button", "More options". Explore by touch on the lower half of the screen: both big buttons are easy to find.
3. **Screen reader mode (2 min).** Open More options, find "Screen reader mode: off", double tap. *Check:* TalkBack reads "Screen
   reader mode on..." in its own voice. Close More options.
4. **Start (2 min).** Double tap "Start walking". Allow camera, microphone and location if asked. *Check:* the welcome and privacy
   lines are heard (first time only); the button is now "Stop walking".
5. **Ask for help (2 min).** Double tap "Talk", then say "help". *Check:* TalkBack reads the help text. Then Talk, "what can't you
   see?". Then Talk, "vibration only", and back with Talk, "speech and vibration".
6. **Start a route (3 min).** Talk, "navigate to" a place about 5 minutes away. *Check:* the route summary is read; walk a few steps
   outside with the helper; a turn prompt is spoken by the app even while TalkBack is reading something; a turn buzzes (one short = left,
   two short = right).
7. **Stop (1 min).** Talk, "cancel" (the route stops). Double tap "Stop walking". Talk, "walk summary".
Record for each step: done alone / needed help / could not do it, and the tester's own words. Fix anything "needed help" before the pilot.

### Package E: hazard lane, class by class (`feat/hazard-live`)
- **Model exported here** (ultralytics 8.4.175, yoloe-11s-seg, 320 px; onnx/onnxslim/CLIP in a throwaway venv): `docs/models/hazard320.onnx`,
  40.5 MB. `npm run check:hazard` (tools/phase4/check_hazard_model.mjs): loads with the app's onnxruntime-web; output0 is
  `[1, 51, 2100]` = 4 + 15 classes + 32 mask channels; 269 ms per frame on a desktop. In the app it runs every 4 s (skipped in
  slow-phone mode). The site grows from 102 MB to 142 MB.
- **Not evaluated:** no `hazard_eval.json` was given, so `HAZARD.speakClasses` is empty and nothing from this lane is spoken. In the
  headless run, Chrome's fake-camera test pattern was logged as an A-board at 0.43: this lane needs the evaluation before it speaks.
  Next: download VIP-Mobility360, run `python3 tools/phase4/eval_hazard_model.py DATASET --map "..."`, then
  `node tools/phase4/graduate.mjs hazard_eval.json`, copy the passing names into `HAZARD.speakClasses`, and walk-test them.
- `docs/js/hazardalerts.js`: `graduate()`, `hazardCandidates()`, `hazardText()`. Candidates: graduated class, seen in two hazard runs
  in a row (confirmSlow), in the walking path and near (box bottom below 55% of the picture). Priority 2 (below vehicles 0 and stairs 1),
  `once: true`, through `AlertEngine.next(..., extra)` so the budget and encounter memory apply; allowed at every talk level.
  No distance: none of these classes has a measured distance error. `ped_signal` is never spoken from this lane.
- `HAZARD.speak` (unused flag) replaced by `HAZARD.speakClasses`. The model is cached by Detector.load (modelcache.js) after first
  use; it is also warmed before Start once speakClasses is not empty (40 MB is not worth fetching early for a log-only lane).

### Package F: floor-based distance (`feat/floor-distance`)
- `docs/js/floordist.js`: `floorDistance()` = cameraHeight / tan(pitch + angleBelowCentre(yBottom)), vertical field of view from
  `CONFIG.floor.vfovDeg` (60, calibrate per phone); null when the box bottom touches the frame edge, pitch or height is missing, or the
  point is within 2 degrees of the horizon. Pitch = 90 - DeviceOrientationEvent beta (portrait, screen facing the walker).
- "calibrate": averages the tilt over 2 s (stored as `va.floor.pitch`; used when there is no live motion sensor), then asks
  "How tall are you, in feet and inches or centimetres?" once (`va.floor.heightCm`; camera height = 0.72 x height; 170 cm until asked).
  `Dialogue.askValue()` is the new free-answer question.
- Every alert logs `alert-dist` {box, floor, used, pitch}. `?dist=floor` feeds the floor estimate to the alert engine for everything
  except vehicles (their warnings depend on the box distance and its speed; not changed without walk evidence).
- `tools/score_walk.mjs`: sheets carry `box_m` and `floor_m` per warning; add `true_m` by hand; `compare` prints median and 90th
  percentile error per method and which is better. **Not measured yet: needs walks with true distances.**
- Tested with synthetic geometry (known height, pitch and field of view give the known distance to 1 cm).
