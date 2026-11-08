# Vision Assist (MVP)

A voice-first walking companion for blind and low-vision people. It uses the phone camera to spot hazards, speaks short alerts ("Person, front left"), and gives spoken walking directions.

> **Safety notice:** This is a test version, not a validated mobility aid. It can miss obstacles and lose GPS. Always use a cane or guide dog as well.

## What the MVP does
- Detects street hazards on the phone (people, vehicles, bikes, poles, cones, bins, crossings, traffic lights and more).
- **One screen, two main controls (Package D):** **Start walking** (it becomes **Stop walking** while running) and **Talk**, the two biggest buttons, in the lower half of the screen and first in focus order. Everything else (repeat, how much I say, voice on/off, tap anywhere to talk, distances, typing a destination, session log) is inside **More options**, so a screen-reader user meets three things, not nine.
- **Talk:** tap the Talk button (or empty screen, if "tap anywhere to talk" is on). The app goes quiet, plays a rising tone, and records until you stop talking (or 7 s). The clip goes to Google Cloud Speech-to-Text. A failed request (signal blip, slow reply, Google hiccup) is sent once more; if it still fails the app says "I could not reach Google, the signal may be weak. Tap the screen and try again." and uses Google again on the next tap. Only a refused key or a blocked microphone switches to Chrome's built-in recogniser.
- **Voice (Google):** the app speaks in a Google Cloud Text-to-Speech voice (`CONFIG.ttsVoice`, en-GB Neural2). Each line is fetched once and kept for the session; common lines are fetched at Start. When Google cannot be reached the phone's own voice says the line instead, so nothing is lost. An urgent warning that is not already kept is always spoken by the phone's voice at once: a vehicle warning never waits for the network. `?voice=phone` uses the phone's voice only. Needs **Cloud Text-to-Speech API** allowed on the Google key; if it is not, the app says once "Google voice is not switched on for this app, so I am using the phone's voice." Tap to talk instead of always-on listening because Chrome's always-on recogniser on Android stops every few seconds and misses speech while the phone is talking. Four sounds, one meaning each: listening (rising), understood (single), not understood (falling), urgent (sharp beep plus a buzz).
- **How much I say:** quiet (default), normal or detailed. Quiet speaks turns, urgent vehicles, stairs, red lights, barriers, and people or vehicles very close ahead. Things a cane finds anyway (poles, bins, benches) are only spoken in detailed. Say "less talk", "more detail", "quiet mode", "normal mode" or "detailed mode".
- **Busy pavements:** three or more people close in the walking path are said once as "Busy ahead, people close." instead of a warning per person. "Stop" is kept for someone very close straight ahead, and anything moving very close straight ahead is never held back by the talk limits.
- **Trust:** say "why did you say that?" to hear what the app saw for the last warning (what, where, how far, how fast, how sure). Say "are you working?" for a check of camera, location, internet, listening and battery. The same check runs on every start: the full line the first time, afterwards only problems, so silence never hides a broken camera or lost location.
- **Location signal:** "I lost your location signal" is said only after 10 seconds with no location, and "Location signal is back" when it returns.
- **Calm alerts:** repeats of the same alert wait longer unless the thing got clearly closer; at most 3 routine alerts per 10 seconds (urgent ones are exempt); things to the side are only mentioned when close.
- **Spoken walking directions:** type or say "navigate to ...", turns announced about 40 m ahead and at the turn, in plain left / right / straight with **no street names** (a blind walker cannot read a street sign), "keep going, you are on the route" on long quiet stretches. Turn prompts go ahead of hazard chatter. Say "cancel" to stop. Needs internet and location permission.
- **Ask the app:**
  - "What is in front of me?" describes what the camera sees now, by side and distance, and says plainly when it sees nothing it recognises.
  - "Where am I?" says the street and area (free OpenStreetMap lookup).
  - "Save this place as home" (uses where you are now), or "save my home address as 25 Lakeside BS16 3EE" (the app reads back what it found and asks yes or no; it warns if the postcode differs). Then "take me home" (or any name). Places are kept on the phone only, never in the code.
  - "Slower" / "faster" changes how fast it speaks (7 notches from 60% to 110%, default 95%, saved on the phone; also a button).
  - "Share my location" gets a link ready (street plus a map link); then tap the empty screen and choose who to send it to. The browser only opens the share sheet from a real tap.
  - "I am lost" says where you are and what to do next.
  - Distances are spoken in **steps by default** ("about 4 steps", "in 60 steps, turn right"); walks longer than about 700 m are said in miles ("0.7 miles"). Say "use miles" (yards and miles) or "use metres", or tap the units button in More options. One step is taken as 70 cm; say "my step is 60 centimetres" or tap the step button to change it. Step counts are approximate.
  - Distances and times are rounded on purpose ("about 8 minutes", "0.7 miles") so they are easy to take in.
  - "Battery" tells the charge. The app also warns once at 20, 10 and 5 percent while not charging, and logs battery level in the session log.
- Voice commands: start, stop, repeat, help, plus the ones above. While it is asking a question you can answer at once, even over its voice. Talking over the app to interrupt it only works with "voice commands on" (the phone-listening fallback, always-on); with Google Cloud listening (the default) you tap Talk first, then speak.
- Spoken errors: no silent failures.
- **Screen off stops the app:** locking the phone or switching away stops detection and cancels speech at once (a Wake Lock keeps the screen on while running, when the phone allows it); coming back resumes automatically with "Vision Assist is resuming."
- **Walking corridor:** only things in the walker's path are spoken about; things to the side only when very close. The supervisor view (?debug) draws the corridor.
- **Free-space hints:** when the way ahead is blocked the alert adds "Clearer on the left." or "No clear way. Stop."; "I no longer see anything in your way." follows once it opens (never "clear ahead": see Safety honesty). Smoothed so it does not flicker.
- **Vibration:** urgent alerts, stairs, "Stop" and turns buzz the phone with different patterns. Say "vibration off" / "vibration on", or use the button.
- **Route recording:** "record this route as the bus stop", "stop recording", "follow route bus stop", "take me back along route bus stop", "list my routes". Routes are kept on the phone only.
- **What is around me:** starts with the state of the path ("I see nothing in your way, but check with your cane." / "Ahead is blocked. Clearer on the left."), then lists what the camera recognises.
- **Safety honesty (Package A):**
  - **Crossings:** the app cannot read traffic signals, so it never reports a light's colour. "Can I cross?", "is the light green?", "traffic light" and any route step that crosses a road (Google's instruction, or an OSM crossing name) all get: "Crossing ahead. I can't read the traffic signal. Listen for traffic before you cross." A close vehicle is mentioned first. Green lights from the model are never spoken.
  - **Limits:** "what can't you see?" answers "I can't reliably see kerbs, drops, potholes, low branches, ice, or traffic signals. Keep using your cane or guide dog." The same line ends the full "are you working?" check, and is in help.
  - **Banned phrases:** `docs/js/safetext.js` lists phrases the app must never say ("safe to cross", "all clear", "clear path", "green light", "no obstacles", ...). `tests/safetext.test.js` checks every string in `docs/js` against it. "Clearer on the left" and "No clear way. Stop." stay allowed.
  - **Privacy line:** said once, on the very first start; "privacy" repeats it.
  - **Recording consent:** turning on Record session (or `?record`) asks "Recording saves video and a log on this phone. Say yes to start, or no." Nothing is recorded until yes (spoken, or the Yes button). Consent lasts until the page is closed.
  - **Info pages:** `privacy.html`, `limits.html` ("What it cannot see") and `numbers.html` ("Our numbers": not measured yet; states the Stage 1 gate), linked from More options.
- **Memory notes:** "remember the keys are in the drawer", "what do you remember?".
- **Install and no signal (Package B):** Chrome offers "Install app" / "Add to Home screen" (manifest, icons, `sw.js`). After one start with signal, the app opens and starts detection with no internet: the page and scripts come from the offline app shell, the models from the phone's model cache. With no internet it says "No internet. I can still spot obstacles, but directions and Google listening need signal." and "Internet is back." when it returns. After an update it says "Vision Assist has updated." once on the next start; it never reloads itself mid-walk. Check with `npm install` then `npm run check:offline` (headless Chrome).
- **Walk measurements (Package C):** every 30 s while running the session log gets a `perf` event (main-lane frames per second, average inference ms per lane, battery, memory). If the main lane stays under 4 frames per second for 20 s, slow-phone mode makes the stairs and COCO lanes run half as often and skips the hazard lane, and says once "The phone is running slowly, so I am checking less often."; it goes back to normal after 30 s over 6. The main lane and vehicle warnings are never slowed. On stop a `walk-summary` event is logged; say "walk summary" to hear the time, warnings, vehicle warnings, speed and battery used.
- **Accessibility (Package D):** every button is named by its visible text. **Screen reader mode** (More options, or "screen reader mode on"): answers and notices go to a polite live region so TalkBack reads them in its own voice; warnings and turns are still spoken by the app so they never wait in TalkBack's queue. **Output** (More options, or say "speech and vibration", "vibration only", "speech only"): vibration only buzzes for things in your way instead of speaking them, but vehicle warnings and directions are still spoken. Distinct vibrations: vehicle (three long), obstacle in the path (three short), stairs, stop, turn left (one short), turn right (two short), near the destination, lost signal. Audit: `npm run check:a11y` (axe-core plus size and focus-order checks).
- **Hazard lane, class by class (Package E):** `docs/models/hazard320.onnx` (YOLOE set to RNIB's obstacle list) is **off by default** (it ran in the same loop as the main detector and held up live detection on the Poco); add `?hazard=on` to load it and log what it sees. It switches itself back on once a class may speak. A class is spoken only once it is in `HAZARD.speakClasses`, which needs it to pass `node tools/phase4/graduate.mjs hazard_eval.json` (precision at least 0.9, recall at least 0.6, at least 50 labelled examples). Spoken as a hedge with no distance ("Possible e-scooter ahead, left."), below vehicles and stairs, once per encounter, inside the alert budget. The list is empty for now, so nothing from this lane is spoken yet. A crossing light from this lane is never spoken.
- **Floor-based distance (Package F, experiment):** for every warning the session log gets both the box-size distance and a floor-based one (from where the object's box meets the ground, the phone's tilt and the walker's height). Say "calibrate" once: "Hold the phone at chest height, pointing straight ahead, and keep still.", then it asks your height. `?dist=floor` speaks the floor-based distance for everything except vehicles. It is switched on for everyone only if real walks show it is better (`node tools/score_walk.mjs compare`).
- **Navigation you can rely on (Package G):** every route starts with a short preview ("Going to 25 Lakeside. About 50 minutes. First, walk straight for 25 steps."); crossings are not counted up front but each one is warned about when the walker reaches it; a place more than 10 km away is never refused: the app says how far it is and asks "Shall I start? Say yes or no." (catches a wrong match without blocking a real trip); a weak GPS signal (worse than 25 m for 10 s) is said once ("GPS is weak here, so directions may be late.") and "turn now" then waits for a second fix; arrival is "You should be near your destination. It may be a few steps either way." (never "you have arrived"); if Google fails (quota, key, no connection) it says "Google directions are not available, using backup maps." and uses OpenStreetMap.
- **Text reading:** on. Say "read" or tap Read; runs on the phone.

See `RESEARCH.md` for the 12 reference videos, their links, and what we learned from each.

## Not in the MVP
Accounts, payments, kerb and steps detection (needs footage and training), more object classes (a pretrained COCO lane is planned), iPhone, spatial audio.

## Runtime
The detection runtime (onnxruntime-web 1.17.3) is served from `docs/vendor/ort`, so the app does not depend on a CDN (the CDN is only a fallback). Licence: MIT.

## Test device
Poco M2 Pro (Android, Chrome).

## Detection models (three lanes)
- **Fast lane, every frame:** `wotr` (`best320.onnx`, 20 classes: people, cars, trucks, buses, bicycles, poles, cones, bins, traffic lights, crossings, tactile paving...). Validation: precision 0.83, recall 0.69, mAP50 0.77. On our own street footage it found about twice as many people as the ROD model. Tactile paving ("blind_road") is detected but ignored (`IGNORE_FAST`): it fired on ordinary paving in 51 of 178 phone frames.
- **Slow lane, every 2 s:** `rod2` (`rod2_416.onnx`, 30 classes, Phase 2) used only for what the fast lane lacks: **stairs, manholes, benches, chairs, guard rails, electrical boxes, plant pots, bicycle racks**. Stairs are only confirmed, and spoken as a fall hazard, at score 0.80+ in two slow-lane runs in a row. Five more classes it can see (bollard, upstairs, downstairs, red light, green light) are not yet wired into any alert.
- **Third lane, every 3.5 s:** `coco` (`coco320.onnx`, standard COCO, outdoor classes only — traffic lights, stop signs, parking meters, animals, backpacks... — indoor classes like microwave and fridge were dropped after false hits on shop fronts). Also not yet spoken.
- **Test-only:** `depth_s_q.onnx` (Depth Anything V2 Small) runs behind `?depth=1` to measure phone speed; it never speaks and is not part of the normal app.
- Dataset source and licence: _to be added._
- Original weights are in `weights/`. ONNX files for the browser are in `docs/models/`.

## How to try it
The app is a web page in `docs/`, published with GitHub Pages at https://sudhamsr.github.io/MVP-VA/ (turn on once: Settings > Pages > Deploy from a branch > `main` / `docs`).
Open it in Chrome on the phone, tap **Start**, allow camera and microphone.
- One link is enough: https://sudhamsr.github.io/MVP-VA/ . Supervisor tools (camera view with boxes, recording, saving the session log) are under More options > Supervisor tools. The `?debug` and `?debug&record` links still work and just switch those on at start.
- `sw.js` is the offline service worker (it also serves the optional speed experiment, `?mt=1`). It is not a page; ignore it.
- `?model=rod2` runs the 416-pixel stairs model as the main model (slower). The old `?size=416` and `?model=rod` files were removed on 7 Nov; those options now fall back to the normal model.
- `?lane=off` turns the stairs/manhole lane off (for speed tests). `?model=rod` runs the ROD model alone.
- The line "Speed check" on screen shows frame time on the phone. Send it to the developer.

## Recording a test session (supervisor)
Open the app, then More options > Supervisor tools > turn on **Record session** (or open `…/?debug&record`), tap **Start**, do the walk, say or tap **Stop**, then tap **Save recording**.
Two files download: the raw camera video and a log of what the app saw, said and how fast it ran. Send both to the developer.
Collect training frames: `python3 tools/extract_frames.py frames VIDEO... --every 15`. Training recipe: `tools/train_steps_colab.py`.
Offline review: `python3 tools/analyze_session.py VIDEO LOG.json` replays the video through both models and writes `analysis/summary.txt` and `analysis/annotated.mp4`.
**Scoring walks (Stage 1 gate):** `node tools/score_walk.mjs template LOG.json > walk1.labels.json` lists every spoken warning at its time in the video. Watch the video, mark each `"verdict"` as `"correct"` or `"false"`, and add anything the app should have warned about to `"missed"` (kind: vehicle, person, stairs, kerb, obstacle, crossing, other). Then `node tools/score_walk.mjs score walk*.labels.json` prints false warnings per minute, misses, precision and time to warn, and fails unless no moving vehicle was missed and false warnings are under 1 per minute.
(Recording adds some load on the phone, so leave it off for speed tests.)

## Tests
`npm test` (Node 20+) runs the unit tests: model output decoding checked against a Python reference, tracker, alert wording, priority and talkativeness levels, speech queue and priorities, voice-command parser, navigation (including simulated walks), sounds, scene description, saved places, units, battery, busy pavements, lost signal, "why did you say that", the start-up check and the walk scorer (225 tests on 7 Nov).

## Layout
- `docs/` the app (`js/` modules, `models/` ONNX models)
- `weights/` original trained weights; `tests/` unit tests

## Phone position
Hold or mount the phone at chest height with the camera facing forward and **your arm out of the picture**. In our demo video the tester's own arm in view was detected as a person. A chest lanyard is the recommended mount for tests.

## Status
Built: three-lane hazard detection, calm spoken alerts, spoken walking navigation (Google when available, OpenStreetMap as the fallback), tap-to-talk voice (Google Cloud Speech-to-Text, Chrome as fallback), the one-screen interface, and the ask-the-app features above. Not yet tested outdoors with blind testers. The known-limits list is `docs/limits.html`; a tester guide is still to be written.

## Security
Never commit service-account files or an unrestricted API key. The Google key in `docs/js/config.js` is the exception: a browser-only app on GitHub Pages cannot hide a key from whoever loads the page, so it is restricted in Google Cloud Console instead of hidden — locked to the `https://sudhamsr.github.io/*` referrer and to the Places (New), Routes and Speech-to-Text APIs only. It is useless if copied elsewhere. Check the Google Cloud Console quota and billing page occasionally for unexpected use, and keep the API restriction list as narrow as the app actually needs (new paid API usage should extend that list deliberately, not by leaving it open).

## Privacy note
The walker-facing version is `docs/privacy.html` and the spoken "privacy" answer. Each time you tap Talk, that recording is sent to Google Cloud Speech-to-Text and is not stored by the app. Place searches and routes also go to Google (OpenStreetMap as the fallback). Camera pictures never leave the phone. The session log includes location fixes (about every 3 seconds while navigating) and the words heard and spoken, so walks can be reviewed. Treat saved logs as personal data and delete them after review. Saved places stay in the phone's own storage.

## Navigation trust
Route data comes from Google (checked: spoken distances match Google's own figures). Position is the phone's raw GPS, so it can be 10 to 50 m out. The app says when the signal is weak or has stopped, ignores very imprecise fixes, and tolerates more drift before calling "off route". The voice wizard waits 40 seconds for a yes or no.

## Updating the live site
After changing anything in `docs/js`, run `python3 tools/stamp.py` (a test fails if you forget). GitHub Pages lets browsers reuse scripts for up to 10 minutes, so without the stamp a phone can run old code right after an update. The stamp gives each script a version in its address. The version shows under More options > Supervisor tools, so a tester can confirm they have the latest.

## More training pictures (Open Images V7)
`python3 tools/fetch_openimages.py --out oi_vision --per-class 600` (run on your own computer or in Colab; the sandbox this was written in cannot reach those hosts). It picks the classes that matter for walking (stairs, bollards, poles and street lights, bins, benches, hydrants, post boxes, wheelchairs, prams, scooters, barriers, cones, doors and gates, pedestrian signals, plant pots, parking meters), drops groups and drawings and tiny boxes, and writes a YOLO dataset with a `manifest.csv` of licences (CC BY: keep it). Add `--dry-run` first to see how many pictures each class would give. It reports which classes Open Images does not have. Kerbs, step-downs, A-boards and e-scooters still need your own footage. Train with `tools/train_steps_colab.py` as a template, starting from `weights/rod_best.pt`.

## Fewer repeats

A hazard is spoken once when it first comes into view. It is spoken again only if it gets clearly closer, or (for stairs and red lights) as a reminder every 30 seconds. Vehicle warnings are never closer together than 8 seconds. Each talkativeness level has a per-minute cap (quiet 4, normal 6, detailed 10, not counting vehicle warnings). The same sentence is not spoken twice within 30 seconds. "Keep going" reassurance comes after 90 seconds of quiet, and the periodic status check is off in quiet mode.

## Running and scoring a test walk (Stage 1 gate)
1. More options > Supervisor tools > **Record session: on**, say yes. Tap Start, hold the phone at chest height, walk.
2. Tap Stop, then **Save recording**: you get the video and the session log (`vision-assist-log-*.json`).
3. Make a review sheet: `node tools/score_walk.mjs template vision-assist-log-123.json > sheets/walk1.json`.
   Watch the video; set each warning's `verdict` to `correct` or `false`; add anything missed under `missed`
   (`{ "t": 41.5, "kind": "vehicle", "note": "van reversing" }`). The sheet also carries the walk's speed and battery figures.
4. Score: `node tools/score_walk.mjs score sheets/*.json` (exit code 1 if the gate fails).
5. Distances (optional): add `"true_m": 3.5` (the real distance, in metres) to some warnings, then
   `node tools/score_walk.mjs compare sheets/*.json` prints the median and 90th-percentile error of the box and floor methods.
6. Publish: `node tools/score_walk.mjs numbers sheets/*.json` rewrites `docs/numbers.html` with walks, minutes, missed moving
   vehicles, false warnings per minute, average speed, battery per hour and the date. Commit it on a branch and open a PR.
