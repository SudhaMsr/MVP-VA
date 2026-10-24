# Vision Assist (MVP)

A voice-first walking companion for blind and low-vision people. It uses the phone camera to spot hazards, speaks short alerts ("Person, front left"), and gives spoken walking directions.

> **Safety notice:** This is a test prototype, not a validated mobility aid. It can miss obstacles and lose GPS. Always use a cane or guide dog as well.

## What the MVP does
- Detects street hazards on the phone (people, vehicles, bikes, poles, cones, bins, tactile paving, crossings, traffic lights and more).
- Speaks alerts with direction (front left / front / front right) and an approximate distance for people and vehicles.
- Voice commands: start, stop, repeat, navigate to a place.
- Spoken walking directions; hazard alerts interrupt directions, then directions resume.
- Spoken errors: no silent failures.

## Not in the MVP
Text reading, accounts, payments, stairs and kerb detection, iPhone.

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

## Tests
`npm test` (Node 20+) runs 28 unit tests: model output decoding checked against a Python reference, tracker, alert wording and priority, speech queue, voice-command parser.

## Layout
- `docs/` the app (`js/` modules, `models/` ONNX models)
- `weights/` original trained weights; `tests/` unit tests

## Phone position
Hold or mount the phone at chest height with the camera facing forward and **your arm out of the picture**. In our demo video the tester's own arm in view was detected as a person. A chest lanyard is the recommended mount for tests.

## Status
Day 2 of 10: two-lane detection, spoken alerts, voice start/stop/repeat. Navigation is not built yet.

## Security
Never commit API keys or service-account files. Use environment variables.
