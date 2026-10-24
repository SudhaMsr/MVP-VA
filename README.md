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

## Status
In development. 10-day plan to a supervised test with blind and low-vision testers.

## Security
Never commit API keys or service-account files. Use environment variables.
