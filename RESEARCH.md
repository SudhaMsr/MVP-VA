# Competitor and reference video report (12 videos)

Method: for each link I read the title, channel and description, and stepped through the video frame by frame (on-screen text, UI, overlays). I could not hear audio, so spoken explanations are not covered. Where a claim comes from the description rather than the footage, it says so.

## Summary table

| # | Video | Type | How it works (as seen) | Walking directions? | Needs extra hardware? |
|---|-------|------|------------------------|---------------------|-----------------------|
| 1 | Kanan Vyas, obstacle detection (12 s) | Laptop demo | YOLO person boxes; red "WARNING person is near"; green "MOVE LEFT" | No | No |
| 2 | NETRA (SIH 2026, 106 s) | Prototype + phone app | Phone app: boxes with percentages, TTS "three persons, three laptops". Debug panel shows 0.2-0.3 FPS, 3.5-10.8 s per frame. Description: glasses, Raspberry Pi, distance sensors, OCR, SOS | No | Yes (glasses, Pi, sensors) |
| 3 | BlindSight (5 min) | Wearable | Raspberry Pi box with ultrasonic sensor; YOLOv8 plus a depth map shown on screen; voice and vibration (from description) | No | Yes |
| 4 | OKO (Blind on the Move, 17 s) | iPhone app | Phone held at a crossing; banner turns red "Don't Walk Signal" then green "Walk Signal" | No | No |
| 5 | Aakha (37 s) | Android phone app | A cyan "walking corridor" is drawn on the ground; objects inside or touching it get red boxes; short cue such as "on your right". Description: free-space direction, zebra crossings, traffic light colours, OCR, spoken only when useful | No | No |
| 6 | "3 apps to use as a blindie" (52 s) | Creator review | A blind creator shows a "Features" app (image reader, PDF reader, notepad, text translator) and a text-to-speech idea | No | No |
| 7 | Kapsys SmartVision phone (37 s) | Physical-key phone | Large keys, big text, "Book reader" app | No | Special phone |
| 8 | Smart Vision indoor navigation (24 min) | Research talk | See below: the most technical of the set | Indoor only | No |
| 9 | Object detection with text recognition (3 min) | Laptop demo | Generic YOLO window: cup 0.55, chair 0.76, dining table 0.36, potted plant 0.33; blurry, no speech guidance | No | No |
| 10 | Obstacle Detector (BHIT, 12 min) | iPhone app | Fixed yellow box in the centre with a distance readout ("2.03 Meter", "1.97 Meter") from the LIDAR sensor; side buttons for detection, tone/vibration, image and text; "No Text Recognized" message | No | iPhone with LIDAR |
| 11 | Blind Navigation System (RAYS, 3 min) | Android app | Plain camera view with a swipe-up bar; voice commands "start detecting", "stop detecting", "navigate" (description) | Claimed, not shown | No |
| 12 | NAVI AI (5 min) | Android app | See below: closest to Vision Assist | Route recording, "navigate to home" | No |

## The three that matter most

### NAVI AI (#12)
- Voice agent with visible states: Listening, Processing, Speaking. A chat log shows what you said and what it replied.
- "NAVI, what is surrounding me?" returns a spoken room description, including the title of a book it read.
- Features panel (all by voice): scene understanding, text reading, object search, memory ("I put the key in the drawer", later "what memory have you stored?"), route recording, navigation.
- Route recording screen: elapsed time, points recorded, GPS accuracy (+/- 4 m). Retracing is by recorded GPS points, not by map directions.
- Obstacle card: name, distance ("about less than 1 m"), confidence 62%, tracking ID, movement ("stationary"), risk badge (Safe / High risk). A "Checking a possible obstacle" step appears before some alerts.
- Echo protection: "NAVI is speaking, the mic is paused so it doesn't hear itself." (We already have this.)
- Runs at 1-2 frames per second. Description: YOLOv8n with NCNN on the phone, some features need the internet, safety functions work offline.

### Smart Vision indoor navigation (#8)
- Two lanes: a segmentation model finds the walkable floor (shown as a green overlay); YOLOv8n (COCO, 320 px) overrides it for objects that blend into the floor, such as a backpack on a carpet.
- Free space is measured in left, centre and right thirds (for example L 95%, C 99%, R 51%) and turned into one instruction: "Go ahead".
- Speed shown: 27.7 FPS (segmentation 12.6 ms, detection 9.4 ms), on their own hardware.
- Key slide: "Accuracy is not usability. High accuracy with high latency is unusable (stale data causes collisions). High accuracy with unstable output is unusable (oscillating commands cause disorientation). Danger zone above about 150 ms." This supports smoothing and holding a decision before changing it.

### Aakha (#5)
- The walking corridor is the core idea: only things in the user's path matter. Objects outside the corridor are ignored or kept quiet.
- Speaks only when useful and puts collision warnings first (description).

## What we do better
- No hardware: an ordinary phone and browser.
- Real walking directions (Google routes to the nearest entrance, spoken in left/right words). No other video shows this working.
- Calm speech with priorities, per-encounter limits and an echo guard.
- Speed: about 14 frames per second on a laptop, against NETRA's 0.2-0.3 and NAVI AI's 1-2.

## What they do that we do not yet
1. **Walking corridor filter** (Aakha): only alert about things in the path. Reduces chatter and false alarms.
2. **Free-space guidance** (Smart Vision): "clear path ahead", "clearer to the right".
3. **Route recording and retracing** (NAVI AI): record a regular walk, replay it later, works offline.
4. **Risk levels and a "what is around me" answer** (NAVI AI): safe, caution, danger.
5. **Vibration** for urgent alerts (BlindSight, Obstacle Detector).
6. **Crossing signal help** (OKO).
7. **Memory notes** ("remember I put the keys in the drawer") (NAVI AI).
8. **Hold decisions steady** (Smart Vision talk): do not flip a spoken instruction frame to frame.

## What to avoid
- Counting objects aloud ("three persons, three laptops"): NETRA's approach is chatty and not useful to a walker.
- Slow frames: at 0.2-3 FPS an alert describes something already passed.
- Showing low-confidence labels (#9): "potted plant 0.33" would be noise in speech.

## Suggested build order
1. Walking corridor filter on the existing tracker (quickest, biggest effect on chatter).
2. Free-space guidance in thirds, with a hold time so the advice does not flicker.
3. Vibration pattern for urgent alerts.
4. Route recording and retracing.
5. Crossing signal state and "what is around me" improvements.

## Not covered
No audio was heard. Descriptions were used for claims about offline mode, LIDAR and Raspberry Pi hardware. The GitHub repositories linked in videos #3 and #11 could not be opened from this environment.

## Source links (in the order you shared them)
1. https://youtu.be/KfTfhyQ2exA
2. https://youtu.be/7J2e8aBksF0
3. https://youtu.be/8FhNYJAvp90
4. https://youtu.be/fr_74Bo98A8
5. https://youtu.be/-_-2K9LM0G4
6. https://youtu.be/IOh8brzF_VA
7. https://youtu.be/D6UMeWgt7g0
8. https://youtu.be/l-pl55BKvW4
9. https://youtu.be/mzhQErvSDi0
10. https://youtu.be/z9_Pl7ml_8E
11. https://youtu.be/7sE1K2r3KfI
12. https://youtu.be/Q6I2QeXMuKg

The table above is numbered by topic, not by this order, and I did not keep a reliable link-to-row mapping, so match a row to its link by title when you open them.

## What we took from them, and where it is now
| Learning | Source idea | Status in Vision Assist |
|----------|-------------|-------------------------|
| Walking corridor, only alert on what is in the path | Aakha | Built (`alerts.js`, drawn in ?debug view) |
| Free-space left/centre/right, hold decisions steady | Smart Vision talk | Built (`freespace.js`) |
| Vibration for urgent alerts | BlindSight, Obstacle Detector | Built (`haptics.js`) |
| Route recording and retracing | NAVI AI | Built (`routes.js`) |
| "What is around me" with path status | NAVI AI | Built (`describe.js`) |
| Crossing signal help | OKO | Built (`notes.js`, "can I cross?") |
| Memory notes | NAVI AI | Built (`notes.js`) |
| Do not count objects aloud | NETRA | Followed: grouped, short, capped |
| Pretrained object lane (more classes) | General | Built 31 Oct (`coco320.onnx`, outdoor classes only) |
| Object search ("is there a bench", "find a bin") | NAVI AI | Built 31 Oct (`describe.js` `findObject`) |
| "Checking a possible obstacle" before alerting | NAVI AI | Followed: vehicles need 3 to 6 sightings before a warning |
| Latency under about 150 ms (Smart Vision talk) | Smart Vision | Desktop 92 ms per frame; Poco about 250 ms (HANDOFF): still to decide on the street walk |
| Visible Listening / Speaking states and a chat log | NAVI AI | Built 31 Oct: a state chip (Ready, Watching, Listening, Thinking, Speaking, hidden from screen readers) and a Conversation section with the last 30 lines |
| Risk badges (safe / high risk) per object | NAVI AI | Built 31 Oct in the supervisor camera view: red HIGH (fast vehicle), orange CAUTION (in the path within 3 m), green LOW, plus moving / still. Spoken: urgent warnings start with "Caution" and vibrate |
