# Vision Assist (MVP)

A voice-first walking companion for blind and low-vision people. It uses the phone camera to spot hazards, speaks short alerts ("Person, front left"), and gives spoken walking directions.

> **Safety notice:** This is a test prototype, not a validated mobility aid. It can miss obstacles and lose GPS. Always use a cane or guide dog as well.

## What the MVP does
- Detects street hazards on the phone (people, vehicles, bikes, poles, cones, bins, tactile paving, crossings, traffic lights and more).
- Speaks alerts with direction (front left / front / front right) and an approximate distance for people and vehicles.
- Voice commands: start, stop, repeat, navigate to a place.
- Spoken walking directions: type or say "navigate to ...", turns announced about 40 m ahead and at the turn; says "cancel" to stop. Needs internet and location permission.
- Spoken errors: no silent failures.

## Not in the MVP
Text reading, accounts, payments, kerb detection, iPhone.

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
- `?debug` shows the camera view and boxes (for the supervisor).
- `?size=416` uses the larger fast-lane model (slower, sees smaller things).
- `?lane=off` turns the stairs/manhole lane off (for speed tests). `?model=rod` runs the ROD model alone.
- The line "Speed check" on screen shows frame time on the phone. Send it to the developer.

## Recording a test session (supervisor)
Open `https://sudhamsr.github.io/MVP-VA/?debug&record`, tap **Start**, do the walk, say or tap **Stop**, then tap **Save recording**.
Two files download: the raw camera video and a log of what the app saw, said and how fast it ran. Send both to the developer.
Collect training frames: `python3 tools/extract_frames.py frames VIDEO... --every 15`. Training recipe: `tools/train_steps_colab.py`.
Offline review: `python3 tools/analyze_session.py VIDEO LOG.json` replays the video through both models and writes `analysis/summary.txt` and `analysis/annotated.mp4`.
(Recording adds some load on the phone, so leave it off for speed tests.)

## Tests
`npm test` (Node 20+) runs 38 unit tests: model output decoding checked against a Python reference, tracker, alert wording and priority, speech queue, voice-command parser.

## Layout
- `docs/` the app (`js/` modules, `models/` ONNX models)
- `weights/` original trained weights; `tests/` unit tests

## Phone position
Hold or mount the phone at chest height with the camera facing forward and **your arm out of the picture**. In our demo video the tester's own arm in view was detected as a person. A chest lanyard is the recommended mount for tests.

## Status
Day 2 of 10: two-lane detection, spoken alerts, voice start/stop/repeat. Navigation is not built yet.

## Security
Never commit API keys or service-account files. Use environment variables.
