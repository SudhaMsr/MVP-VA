# Vision Assist (MVP)

A voice-first walking companion for blind and low-vision people. It uses the phone camera to spot hazards, speaks short alerts ("Person, front left"), and gives spoken walking directions.

> **Safety notice:** This is a test version, not a validated mobility aid. It can miss obstacles and lose GPS. Always use a cane or guide dog as well.

## What the MVP does
- Detects street hazards on the phone (people, vehicles, bikes, poles, cones, bins, tactile paving, crossings, traffic lights and more).
- **One screen, two main controls:** a big **Start** button that becomes **Talk** while running, and **Stop**. Everything else (repeat, how much I say, voice on/off, tap anywhere to talk, distances, typing a destination, session log) is inside **More options**, so a screen-reader user meets three things, not nine.
- **Talk:** tap the Talk button (or empty screen, if "tap anywhere to talk" is on). The app goes quiet, plays a rising tone and listens for about 9 seconds. Four sounds, one meaning each: listening (rising), understood (single), not understood (falling), urgent (sharp beep plus a buzz).
- **How much I say:** quiet (default), normal or detailed. Quiet speaks turns, urgent vehicles, stairs, red lights, barriers, and people or vehicles very close ahead. Things a cane finds anyway (poles, bins, benches) are only spoken in detailed. Say "less talk", "more detail", "quiet mode", "normal mode" or "detailed mode".
- **Calm alerts:** repeats of the same alert wait longer unless the thing got clearly closer; at most 3 routine alerts per 10 seconds (urgent ones are exempt); things to the side are only mentioned when close.
- **Spoken walking directions:** type or say "navigate to ...", turns announced about 40 m ahead and at the turn, "keep going, you are on the route" on long quiet stretches. Turn prompts go ahead of hazard chatter. Say "cancel" to stop. Needs internet and location permission.
- **Ask the app:**
  - "What is in front of me?" describes what the camera sees now, by side and distance, and says plainly when it sees nothing it recognises.
  - "Where am I?" says the street and area (free OpenStreetMap lookup).
  - "Save this place as home" (uses where you are now), or "save my home address as 25 Lakeside BS16 3EE" (the app reads back what it found and asks yes or no; it warns if the postcode differs). Then "take me home" (or any name). Places are kept on the phone only, never in the code.
  - Distances are in **miles by default** ("50 yards", "a quarter of a mile"). Say "use metres" or "use steps", or tap the units button in More options. Steps: one step is taken as 70 cm; say "my step is 60 centimetres" or tap the step button to change it. Step counts are approximate.
  - Distances and times are rounded on purpose ("about 8 minutes", "three quarters of a mile") so they are easy to take in.
  - "Battery" tells the charge. The app also warns once at 20, 10 and 5 percent while not charging, and logs battery level in the session log.
- Voice commands: start, stop, repeat, help, plus the ones above.
- Spoken errors: no silent failures.
- Text reading (built, switched off until the core is tested; add ?read=1 to try it): say "read" or tap Read, runs on the phone.

## Not in the MVP
Text reading switched on by default, accounts, payments, kerb and steps detection (needs footage and training), iPhone, spatial audio, crossing warnings.

## Test device
Poco M2 Pro (Android, Chrome).

## Detection models (two lanes)
- **Fast lane, every frame:** `wotr` (20 classes: people, cars, trucks, buses, bicycles, poles, cones, bins, traffic lights, crossings, tactile paving...). Validation: precision 0.83, recall 0.69, mAP50 0.77. On our own street footage it found about twice as many people as the ROD model.
- **Slow lane, every 4th frame:** `rod` (25 classes) used only for what the fast lane lacks: **stairs, manholes, benches, chairs, guard rails, electrical boxes, plant pots, bicycle racks**. Validation: precision 0.87, recall 0.84, mAP50 0.91 (on its own dataset). Its stairs and manhole accuracy on UK footage is not yet measured.
- Dataset source and licence: _to be added._
- Original weights are in `weights/`. ONNX files for the browser are in `docs/models/`.

## How to try it
The app is a web page in `docs/`, published with GitHub Pages at https://sudhamsr.github.io/MVP-VA/ (turn on once: Settings > Pages > Deploy from a branch > `main` / `docs`).
Open it in Chrome on the phone, tap **Start**, allow camera and microphone.
- One link is enough: https://sudhamsr.github.io/MVP-VA/ . Supervisor tools (camera view with boxes, recording, saving the session log) are under More options > Supervisor tools. The `?debug` and `?debug&record` links still work and just switch those on at start.
- `coi-sw.js` is a helper file for the optional speed experiment (`?mt=1`). It is not a page; ignore it.
- `?size=416` uses the larger fast-lane model (slower, sees smaller things).
- `?lane=off` turns the stairs/manhole lane off (for speed tests). `?model=rod` runs the ROD model alone.
- The line "Speed check" on screen shows frame time on the phone. Send it to the developer.

## Recording a test session (supervisor)
Open the app, then More options > Supervisor tools > turn on **Record session** (or open `…/?debug&record`), tap **Start**, do the walk, say or tap **Stop**, then tap **Save recording**.
Two files download: the raw camera video and a log of what the app saw, said and how fast it ran. Send both to the developer.
Collect training frames: `python3 tools/extract_frames.py frames VIDEO... --every 15`. Training recipe: `tools/train_steps_colab.py`.
Offline review: `python3 tools/analyze_session.py VIDEO LOG.json` replays the video through both models and writes `analysis/summary.txt` and `analysis/annotated.mp4`.
(Recording adds some load on the phone, so leave it off for speed tests.)

## Tests
`npm test` (Node 20+) runs the unit tests: model output decoding checked against a Python reference, tracker, alert wording, priority and talkativeness levels, speech queue and priorities, voice-command parser, navigation (including simulated walks), sounds, scene description, saved places, units, battery.

## Layout
- `docs/` the app (`js/` modules, `models/` ONNX models)
- `weights/` original trained weights; `tests/` unit tests

## Phone position
Hold or mount the phone at chest height with the camera facing forward and **your arm out of the picture**. In our demo video the tester's own arm in view was detected as a person. A chest lanyard is the recommended mount for tests.

## Status
Built: two-lane hazard detection, calm spoken alerts, spoken walking navigation (Google when available, OpenStreetMap as the fallback), the one-screen interface, and the ask-the-app features above. Not yet tested outdoors with blind testers. A known-limits list and a tester guide are still to be written.

## Security
Never commit API keys or service-account files. Use environment variables.

## Privacy note
The session log now includes location fixes (about every 3 seconds while navigating) so walks can be reviewed. Treat saved logs as personal data and delete them after review. Saved places stay in the phone's own storage.

## Navigation trust
Route data comes from Google (checked: spoken distances match Google's own figures). Position is the phone's raw GPS, so it can be 10 to 50 m out. The app says when the signal is weak or has stopped, ignores very imprecise fixes, and tolerates more drift before calling "off route". The voice wizard waits 40 seconds for a yes or no.
