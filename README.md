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

## Detection model
- YOLOv8n trained on 20 classes: tree, red_light, green_light, crosswalk, blind_road (tactile paving), sign, person, bicycle, bus, truck, car, motorcycle, reflective_cone, ashcan, warning_column, roadblock, pole, dog, tricycle, fire_hydrant.
- Validation results: precision 0.83, recall 0.69, mAP50 0.77.
- Dataset source and licence: _to be added._

## How to try it
The app is a web page in `docs/`, published with GitHub Pages at https://sudhamsr.github.io/MVP-VA/ (turn on once: Settings > Pages > Deploy from a branch > `main` / `docs`).
Open it in Chrome on the phone, tap **Start**, allow camera and microphone.
- `?debug` shows the camera view and boxes (for the supervisor).
- `?size=416` uses the larger model (slower, sees smaller things).
- The line "Speed check" on screen shows frame time on the phone. Send it to the developer.

## Tests
`npm test` (Node 20+) runs 24 unit tests: model output decoding checked against a Python reference, tracker, alert wording and priority, speech queue, voice-command parser.

## Layout
- `docs/` the app (`js/` modules, `models/` ONNX models)
- `best.pt` original trained weights; `tests/` unit tests

## Status
Day 1 of 10: live detection, spoken alerts, voice start/stop/repeat. Navigation is not built yet.

## Security
Never commit API keys or service-account files. Use environment variables.
