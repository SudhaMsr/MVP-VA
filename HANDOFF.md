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
- **Google setup:** key restricted to the `https://sudhamsr.github.io/*` referrer and to the Places (New), Routes, Speech-to-Text and Text-to-Speech APIs only (Text-to-Speech must be added in Cloud Console, 8 Nov); it lives in `docs/js/config.js` and is intentionally committed (a browser app cannot hide it). Check Cloud Console quota/billing occasionally for unexpected use.

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
- **Safety:** "I can't see clearly" when the camera is dark or covered for 3 s (`camcheck.js`); first-start line "Ready. Hold the phone at chest height, camera facing forward." (`WELCOME_TEXT`; the cane and "tap the screen" sentences were removed on 9 Nov at the owner's request, the cane reminder stays in "what can't you see" and the nothing-recognised line); "I lost your location signal" at most once a minute.
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

## Field test fixes (8 Nov, branch fix/field-test-nov8)
- **Live detection felt slow:** the hazard lane (40 MB YOLOE, Package E) ran in the same loop as the main detector every 4 s and
  speaks nothing yet. It is now off unless `?hazard=on` (or a class is in `HAZARD.speakClasses`). Not yet measured on the Poco:
  compare the `perf` events of a walk with and without `?hazard=on`.
- **No street names in directions:** `cleanStreetNames` (nav.js) now drops every name ("walk along Church Rd towards Southey Ave"
  became "walk straight"); "on the right", "at the roundabout / end / top / bottom", stairs and crossings stay.
- **Route preview:** "I do not know of any road crossings on it." and the crossing count are gone; the per-crossing warning at the
  step is unchanged.
- **Wrong place:** "Lakeside" matched Lakeside Shopping Centre, Thurrock ("about 49 hours"). Routes over `MAX_WALK_M` (10 km) are
  never refused: the app says the distance and asks yes or no before starting.
- **"Are there cars in front of me":** where-words are stripped before the object lookup (it said "I cannot recognise cars in front
  of me").
- Tests: `tests/field_test_nov8.test.js`.
- **Google voice and listening (8 Nov, same branch):** `cloudtts.js` (Cloud Text-to-Speech, voice `en-GB-Neural2-C`, kept in memory,
  common lines fetched at Start) drives `Speaker` through `opts.cloud`/`opts.player`; the phone voice is the fallback per line and
  is always used for an urgent line not already fetched. `cloudstt.js` no longer turns Google listening off after 2 failures: 6 s
  timeout, one retry on network/5xx/429, off only on 401/403. Tests: `tests/google_speech.test.js`.
  Cost: Neural2 voices are free for the first 1 million characters a month, then about $16 per million.

## Reading, describe this and near me (12 Nov, branch feat/vision-and-nearby)
- `cloudvision.js`: `CloudVision.annotate(base64, 'read' | 'look')` (images:annotate, 9 s timeout; 401/403 switches it off for
  the page). `parseRead` feeds Google's text blocks through `reader.js` `pickText`, so wording is unchanged. `sceneSpeech`:
  objects (score 0.6+, grouped, left/ahead/right thirds), up to 3 labels (0.72+, dull ones dropped), a logo (0.6+), up to 2
  pieces of writing. Never says anything is clear or safe (safetext test). `?vision=phone` keeps everything on the phone.
- `nearby.js`: `searchNearby` (Places API New, searchNearby 120 m by distance, or searchText with the asked kind, 800 m bias),
  `WalkHeading` (walking direction from fixes 8 m+ apart with accuracy 30 m or better, or the GPS heading when moving over
  0.6 m/s), `sideOf`, `nearbySpeech` (up to 4, nearest first, "Map positions can be a few steps out.").
- Commands: `look` and `nearby` (commands.js); "what is around me" moved from describe to nearby; "where is the nearest X" is
  no longer a note lookup. Privacy line and privacy.html say when a photo and the location leave the phone.
- **Google only (12 Nov, owner's choice: Google credits):** navigation `makeProviders({ googleOnly: true })` uses Google
  Places and Routes with one retry and no OpenStreetMap backup (`?maps=osm` still tests it). "Where am I" uses Google
  Places (`places.js` `googleReverse`): the street most of the 5 nearest places are on, and the nearest named place that is
  not a holiday flat or an office. Geocoding is not used: Google refuses website-locked keys for it (checked live 12 Nov).
  The page libraries (onnxruntime, Tesseract) still load from jsDelivr: they are code, not a map or speech service.
- **Needs Cloud Vision API allowed on the Google key (done 12 Nov; checked live: read "BUS STOP" in 0.4 s)** (Cloud Console, Credentials, the Maps Platform key). Until then the key
  is refused (403) and reading and describing quietly use the phone. Places (New) is already allowed.
- Tested: tests/vision_nearby.test.js (16 tests); a headless walk with Google replies faked, with Vision working and refused.
  Not yet tried with real Google Vision or on the Poco.

## Live check on the real site (12 Nov, branch fix/live-check-nov12)
- Run in the owner's Chrome on https://sudhamsr.github.io/MVP-VA/ with a street frame from the 30 Oct walk as the camera,
  Google's own voice (Text-to-Speech) played into the microphone, and a GPS fix walking north from the Centre.
- Worked with the real Google services: detection tracked 3 parked cars (7.8, 10.3 and 18.6 m); Google listening heard
  "navigate to University of Bristol" (2.7 s round trip); Places and Routes gave "Going to University of Bristol, Beacon House.
  About 10 minutes."; the Google voice played the replies.
- Fixed: the first turn prompt ("In 40 steps, turn right") was spoken before the route summary, because the summary was a
  status message and turn prompts go first. The summary is now a direction ('nav'), so the order is kept.
- Also checked live: "where am I" ("You are on Colston Street, in Bristol. Close by is ..."), "what is near me", "is there a
  cafe nearby" (4 cafes with distance and side), "read" ("It says: TESCO. Express Open 7am - 11pm.", Vision 0.3 s) and
  "describe this" ("The logo looks like Tesco PLC. Writing says: ...", Vision 1.5 s).
- Fixed: "what is near me" listed holiday flats and offices; those types are now left out (`SKIP_NEARBY`), unless the walker
  asks for that kind of place.
- Fixed: the end of speech is now measured on the audio thread with the audio clock. A page timer can be slowed to once a
  second (battery saver, a busy phone, a background tab); in the live check one command recorded the full 7.6 s.

## VIP-Mobility360 dataset on Kaggle (13 Nov)
- Source: VIP-Mobility360, Liverpool John Moores University, UK, classes from RNIB interviews (e-scooters, bollards, wheelie
  bins, construction barriers, pavement cracks), CC BY 4.0, DOI 10.24377/LJMU.d.00000226. One 110 GB zip, 450,486 files:
  150,161 images (train 91,689 / val 29,901 / test 28,571) with YOLO `.txt` and Pascal VOC `.xml` labels, 816 sequences.
- `tools/datasets/vip_mobility360_kaggle.py` runs in a Kaggle notebook (Internet on): reads the zip's file list once, fetches
  48 MB blocks with HTTP range requests (the server answers range GETs fast; HEAD on the big file hangs), resizes every image
  to 640 px on the long side, keeps every label, resumes on re-run. About 15.5 GB out, about 17 to 19 MB/s.
- Running as Kaggle notebook `sudharanimsr/notebook92709d38b0`, Version 1 ("VIP-Mobility360 at 640 px"). When it finishes, its
  output becomes a private Kaggle dataset "VIP-Mobility360 640px". Train with the YOLO labels; the XML boxes are in the
  original pixel size. Full list of candidate datasets: the "Vision Assist: Datasets for Missing Objects" doc.

## Mapillary Vistas v2.0 subset on Kaggle (13 Nov)
- Source: Mapillary Vistas v2.0 (street-level photos worldwide, polygon labels), CC BY-NC-SA 4.0: non-commercial only, keep
  the Kaggle copy private. The download link is a signed, expiring URL from mapillary.com (logged-in "Copy download links");
  it is set as `VISTAS_URL` in the notebook cell only and must never be committed.
- `tools/datasets/vistas_kaggle.py` reads only train/val images and v2.0 polygons from the 32.3 GB zip (40,000 of 165,009
  files, 18.6 GB read) with HTTP range requests, keeps 9 pavement classes (kerb, dropped_kerb, pothole, manhole, bin, bench,
  street_light, bike_rack, ped_signal), turns polygons into YOLO boxes and resizes images to 640 px. Writes `data.yaml`.
- Running as Kaggle notebook `sudharanimsr/notebook101d1def84`, Version 1 ("Vistas v2.0 YOLO 640"); the output becomes a
  private dataset "Vistas VA YOLO640".
- These datasets are added to the existing training data, not used alone: fine-tune from the current weights on old plus new
  data so no class is lost, and replace a model only if it scores at least as well on the old test set.

## Roboflow kerb sets on Kaggle (13 Nov)
- `tools/datasets/roboflow_kerbs_kaggle.py` downloads five CC BY 4.0 Roboflow Universe sets in a Kaggle notebook and merges them
  into one YOLO set with two classes, `kerb` and `dropped_kerb` ("road" dropped; polygons and keypoint boxes become boxes).
  The Roboflow key is a Kaggle Secret `ROBOFLOW_API_KEY` added by the owner; it is never in code or the notebook.
- Result (notebook `sudharanimsr/notebookc79aa1d10e`, Version 1 "Kerbs YOLO 640"): 3,539 images, 3,968 boxes.
  Ming Chuan curb-detection v47 1,000 / 1,048 (grayscale, tiled, rotated copies: drop it if it lowers scores; files start
  `curb_detection__`), Curbs curb v2 1,432 / 1,666, sayan CurbDetect v1 357 / 693, alpharomeo911 curb-road v5 312 / 393,
  van-tuyen sloped-curb v3 438 / 168 dropped kerbs. Credit each author (CC BY 4.0); links in the set's SOURCE.txt.

## Kaggle output limit: save datasets as one zip (13 Nov)
- Kaggle keeps only the first 500 files of a notebook version's output (the first VIP, Vistas and kerb runs saved 500 of
  tens of thousands). Each dataset cell now ends with `tools/datasets/zip_output.py` (set `ZIP_SRC` to the output folder):
  it writes one stored zip and deletes each file once zipped, so the 19.5 GB disk never holds two copies. Unzip before training.

## Project Sidewalk tagger crops on Kaggle (13 Nov)
- `tools/datasets/sidewalk_tagger_kaggle.py` reads the validated sidewalk-tagger-ai set from Hugging Face (4 zips, 71 GB:
  CurbRamp 10,857, SurfaceProblem 9,092, Obstacle 2,432, Crosswalk 1,627 PNG crops of Google Street View, plus tag CSVs)
  with range requests, re-encodes crops as JPEG at most 640 px and saves one zip (notebook `sudharanimsr/notebook61a7601dcc`).
- Labels are 33 tags per crop and the label point, not boxes: use them to train a tag classifier (for example "missing
  tactile warning" on dropped kerbs) or to check YOLO auto-labels. Licence not stated (code is Apache-2.0): research only.

## Status 13 Nov 12:20: training datasets on Kaggle (account sudharanimsr, all PRIVATE)
| Kaggle dataset | Contents | Made by notebook |
|---|---|---|
| VIP-Mobility360 640px | 450,487 files in one zip (150,161 images, YOLO + XML labels), 12.35 GB, CC BY 4.0 | notebook92709d38b0 v2 |
| Vistas VA YOLO640 | 40,000 files, 9 classes (kerb, dropped_kerb, pothole, manhole, bin, bench, street_light, bike_rack, ped_signal), CC BY-NC-SA | notebook101d1def84 v2 |
| Kerbs YOLO640 | 3,539 images, 3,968 boxes (kerb, dropped_kerb), CC BY 4.0 | notebookc79aa1d10e v2 |
| Potholes YOLO640 | 6,346 images, 7,703 boxes (pothole), CC BY 4.0 | notebookf4ce35ca28 |
| Project Sidewalk Tagger 640 | 24,010 crops + tag CSVs (tags + point, no boxes), licence not stated | notebook61a7601dcc |
- Each is one zip (Kaggle keeps only 500 loose output files); Kaggle unzips most of them in the dataset view.
- Secrets in Kaggle: `ROBOFLOW_API_KEY` (rotate it: it was pasted in a chat). The Vistas signed link is only in its notebook cell.
- Next: Phase 5 training = extend `rod2` (30 classes kept as 0-29) with about 8 new classes at 30+ (kerb, dropped kerb, pothole,
  e-scooter, construction barrier, pavement crack, street light, pedestrian signal); fine-tune from `weights/rod_best.pt`
  lineage on OLD Phase 2 data + new data, pseudo-label the old classes on new images with rod2, reject the model if any old
  class drops more than about 2 mAP50 points, then walk-test. Needs the Phase 2 training set (`phase2_data` zip from
  `tools/phase2/prepare.py`) uploaded to Kaggle first. Fast lane `best320` and `coco320` are not touched.
- Still no data: A-boards, step-down drops, low branches, cafe furniture (need Bristol footage); glass (GDD), tactile paving
  (GuideTWSI), mobility aids (MAID), pedestrian light state (ImVisible) not downloaded yet.

## Kaggle notebook names (renamed 14 Nov)
The Kaggle notebooks were renamed so their purpose is clear. Renaming changes the notebook's web address, so the old
`notebookXXXXXXXXXX` links in this file no longer open. Find a notebook by name at kaggle.com/sudharanimsr/code.
"VA data ..." = a dataset download; "VA P5 NN ..." = Phase 5 step NN (see `tools/phase5/PLAN.md`).

| Old id | New name | Made |
|---|---|---|
| 92709d38b0 | VA data VIP-Mobility360 download (main) | vip-mobility360-640px |
| b5b54e4f8b | VA data VIP download first try (stopped, not used) | nothing |
| 101d1def84 | VA data Mapillary Vistas download (private, link expires) | vistas-va-yolo640 |
| c79aa1d10e | VA data Kerbs download (Roboflow) | kerbs-yolo640 |
| f4ce35ca28 | VA data Potholes download (Roboflow) | potholes-yolo640 |
| ebe5e794df | VA data E-scooters bollards download | e-scooters-bollards-yolo640 |
| 9577fb43a2 | VA data Barcelona streets kerbs drops download | barcelona-streets-kerbs-drops-yolo640 |
| 431554d298 | VA data Open Images VA classes download | open-images-va-classes |
| 61a7601dcc | VA data Project Sidewalk tagger crops download | project-sidewalk-tagger-640 |
| fa69b1707a, 1a1df391f4 | VA data ImVisible download (failed, Drive limit) 1 and 2 | nothing |
| 0b8b9d488c | VA data BLV navigation check (not usable) | nothing |
| 0cb2790b56 | VA P5 01 Dataset audit | audit report |
| 2e2f33e042 | VA P5 03 Bristol Mapillary test set download | Bristol test set |
| 904222913a | VA P5 03 SANPO walker view download (trial) | SANPO subset |
| 157ecb54b7 | VA P5 03 SANPO masks to YOLO test boxes | SANPO test boxes |
| d23831b0e6 | VA P5 03 Bristol pre-labels with YOLO-World | Bristol pre-labels |
| aec775cd58 | VA P5 04 rod2 baseline score on SANPO | baseline table |
| a5c7cafeaa | VA P5 05 Build check and VIP class names | check only |
| 49e80e8218 | VA P5 06 rod3 training 40 classes | rod3 (Version 2) |
| 969ca6531d | VA P5 07 Weak class diagnosis and pedestrian lights download | `pedlights640.zip`: 5 Roboflow CC BY 4.0 sets, 18,917 images, 19,549 boxes (not yet a dataset) |
| db1627d23d | VA zz empty draft (can delete) | nothing |

## Phase 5 (final MVP training): RESUME HERE (13 Nov, 16:15)
Plan: `tools/phase5/PLAN.md` (needs, scope, release gates G1-G6, steps). Class list and every source-name map:
`tools/phase5/label_map.json` (classes 0-29 = rod2 unchanged, 30-38 new). All tools run in a Kaggle notebook as one line:
`import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/<path>").read())`.
A Kaggle "Save & Run All (Commit)" run cannot attach a dataset: attach it first in an interactive session with
`kagglehub.dataset_download('<slug>')`. Save every output as one zip (`tools/datasets/zip_output.py`, set `ZIP_SRC`).

All Kaggle datasets are PRIVATE on account `sudharanimsr` (slug = `sudharanimsr/<title in lower-case with dashes>`):

| Dataset | Use | Made by |
|---|---|---|
| phase2-rod2-training-data | old training data (6,184 train pictures; 11 rod2 classes have 0 boxes) | uploaded by Sudha |
| rod2-phase2-best-pt | `rod2_best.pt`, 30 classes, the model to extend | uploaded by Sudha |
| vip-mobility360-640px | UK pavements, 150k pictures, YOLO + XML | `vip_mobility360_kaggle.py` |
| vistas-va-yolo640 | kerb, dropped kerb, pothole, manhole, bin, bench, street light, bike rack, ped signal (CC BY-NC-SA) | `vistas_kaggle.py` |
| kerbs-yolo640, potholes-yolo640, e-scooters-bollards-yolo640 | Roboflow sets | `roboflow_kerbs_kaggle.py` (RF_SETS etc. set in each notebook cell) |
| barcelona-streets-kerbs-drops-yolo640 | kerb, kerb going down, stairs up/down, pothole (14,859 pictures) | its Kaggle notebook |
| open-images-va-classes | stairs, pole, bin, bench, fire hydrant, plant pot | `tools/fetch_openimages.py` |
| project-sidewalk-tagger-640 | crops with tags, no boxes (not used for boxes) | `sidewalk_tagger_kaggle.py` |
| sanpo-walker-view-test-subset / sanpo-test-boxes-phase5 | TEST ONLY: 584 chest-camera frames, boxes | `sanpo_subset_kaggle.py`, `sanpo_to_yolo.py` |
| bristol-mapillary-test-set / bristol-prelabels-yolo-world | TEST ONLY: 937 Bristol photos, YOLO-World pre-labels | `mapillary_bristol_testset.py`, `prelabel_world.py` |
| guidedogrobot/guidetwsi (public, CC0) | tactile paving | already on Kaggle |

Steps (PLAN.md section 10):
- [x] 2 class list decided (in label_map.json).
- [x] 3 test sets built; Bristol is for people, vehicles and false alarms only (pre-labels found no kerbs, see below).
- [x] 4 baseline of rod2 (`tools/phase5/baseline_eval.py`, table below).
- [x] 1 audit done (notebook `notebook0cb2790b56` Version 3; its "failed" mark is only the Barcelona attach cell). Findings:
  VIP-Mobility360 ids 0-7 = Board (A-board), Bollard, EScooter, Pothole, Puddle, RoadWork, TrashBag, WheelieBin (from its
  XML names, checked by eye; about one box per picture). GuideTWSI = polygons: RBar-22k bar paving ('braille'), RDome-2k
  real domes, SDome-15k synthetic (left out). Vistas has 125k street-light boxes (Electrical Pole). All mapped in
  label_map.json; **class 39 `a_board` added** (RNIB obstacle, 14k VIP examples), so Phase 5 has 40 classes.
- [ ] 5 build the training set: `tools/phase5/build_trainset.py` with all sources attached (`PSEUDO=True` on a GPU adds
  rod2 boxes for old classes on new pictures). Read `/kaggle/working/p5/report.json`: boxes per class, dropped names,
  duplicates, classes with no train boxes. Sources still `_todo` are skipped, not guessed.
- [ ] 6 train: fine-tune `rod2_best.pt` to 40 classes on `p5/data.yaml` (Ultralytics, 640 px, GPU T4).
- [ ] 7 gates: rerun `baseline_eval.py` with `MODEL_PATH` = the new best.pt and `TAG` = 'rod3'; G1 = no old class drops more
  than 2 AP50 points (person and vehicle: 1) on Phase 2 val and SANPO; G2 per new class on `p5/images/test`.
- [ ] 8 export to ONNX at 416 and add to the app silently (new classes never spoken until walk-tested), with tests and stamp.
- Known limits: images from sources that don't label kerbs (Phase 2 etc.) contain unlabelled kerbs, which can teach "not a
  kerb"; check kerb recall after training, and if it's low, pseudo-label kerbs on Phase 2 with the new model and retrain once.

## Phase 5 rod3 training result (run notebook49e80e8218 Version 2, finished 14 Nov ~01:30, 5.5 h on T4)
- Outputs in that run's Kaggle output: rod3/best.pt, rod3/rod3_416.onnx, gate_g1.json, baseline_rod3.json, report_build.json.
- **G1 FAIL on one class only: Truck** (Phase 2 val AP50 10.8 -> 7.2, limit 1 point; only 37 val boxes). Motorcycle -1.0 (at the
  limit). Every other old class held or improved (Person +2.3, Bike +5.8, Stairs +2.1, Dustbin +2.0, Bollard +2.5).
- SANPO walking video (never trained on): Person AP50 0.454 -> 0.490, near recall 56% -> 61%, precision 89% -> 92%;
  vehicles AP50 0.260 -> 0.304, near recall 34% -> 36%; kerb (new) AP50 0.061, near recall 9%.
- New classes on held-out val pictures (P / R / mAP50): construction_barrier .96/.99/.98, a_board .78/.97/.96,
  tactile_paving .70/.80/.79, e_scooter .89/.65/.76, pothole .77/.58/.63, kerb .65/.24/.30, kerb_drop .60/.24/.29,
  **dropped_kerb ~0, ped_signal ~0 (failed)**. G2 (P>=0.9 and R>=0.6) passes only for construction_barrier.
- Found: Electrical Pole is still ~0 on SANPO. Vistas `street_light` is the lamp head, not the pole, so the map
  `street_light -> Electrical Pole` taught the wrong thing. Fix: map Vistas pole classes instead (check the Vistas converter).
- Not added to the app. Next: fix the pole map, look at why dropped_kerb and ped_signal fail (label conflict between
  sources?), more Truck data, retrain; then walk tests.

## Phase 5 step 3 and 4 results (13 Nov)
- Test sets (never trained on): "SANPO test boxes Phase5" (584 chest-camera frames, `tools/datasets/sanpo_to_yolo.py`) and
  "Bristol Mapillary test set" (937 photos). Bristol pre-labels from YOLO-World (`tools/datasets/prelabel_world.py`, dataset
  "Bristol prelabels YOLO-World"): good for cars, people, poles; **0 kerbs found** although kerbs are visible, and some photos
  are junk (through a window). So Bristol is used for people, vehicles and false alarms only; new classes are tested on SANPO
  kerbs and held-out sequences of the training sources.
- Baseline, `tools/phase5/baseline_eval.py` (rod2_best.pt alone, 416 px, score 0.40 as in the app) on SANPO:

  | Class | Test boxes | AP50 | Precision | Recall | Near recall (box >= 15% of height) |
  |---|---|---|---|---|---|
  | Person | 1123 | 0.454 | 0.89 | 0.29 | 0.56 (553) |
  | Vehicle (Car/Truck/Bus/Motorcycle pooled) | 1628 | 0.260 | 0.91 | 0.11 | 0.34 (360) |
  | Pedestrian crosswalk | 154 | 0.154 | 0.60 | 0.02 | 0.04 |
  | Stairs | 46 | 0.044 | 0.20 | 0.04 | 0.11 |
  | Traffic sign, Electrical Pole, Tree, Guard rail, Bicycle Rack | 2000+ | ~0 | – | 0 | 0 |
  | Traffic light (pooled) | 110 | 0.001 | – | 0 | 0 |

  The ~0 classes are among the 11 rod2 classes with no boxes at all in the Phase 2 training data. This is rod2 only; the app
  also runs the COCO and hazard lanes. SANPO is US/Japan footage. These are the G1 "before" numbers.

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

### Package G: navigation you can rely on (`feat/nav-robust`)
#### Audit of navigation before Package G (7 Nov)
- **Off-route detection:** each usable fix (accuracy 60 m or better) is compared with the current and previous route legs; more than
  max(40 m, 1.5 x the fix's accuracy) away on 2 fixes in a row counts as off route. Tested indirectly (interface tests).
- **Rerouting:** at most every 15 s; "Off route. Finding a new way." then a new route from Google/OSM ("New route. ..."). A recorded
  route is never rerouted ("walk back toward the path you took"). The reroute timer uses `Date.now()`, not the injected clock, so it is
  awkward to test; **untested** end to end.
- **Arrival:** within 16 m of the arrival point: "You have arrived at X." and navigation ends. Tested, but the wording over-claimed:
  GPS can be 10 to 50 m out.
- **Google to OSM fallback:** `makeProviders` tries Google for place search and route; any error (HTTP error or network) falls back to
  OpenStreetMap and is logged as `nav-fallback`, **but the walker was not told**. Only a 403 was tested; **429 and network errors
  were untested.**
- **Weak GPS:** fixes worse than 60 m were ignored and "My location signal is weak..." said after 15 s. Fixes between 25 and 60 m
  were used without warning, and could trigger "turn now" on a single jump. **Untested:** turn prompts under weak GPS.
- **Also untested:** route preview (none existed), crossings count, orientation check after reroute.

#### What changed
- **Route preview** (`routePreview`): "About 6 minutes. This route crosses 2 roads." (steps instead of minutes under 250 m). With no
  crossing found: "I do not know of any road crossings on it." (OSRM does not report every crossing, so never "no crossings").
  Said at the start of every new route, before the first instruction.
- **Weak GPS:** accuracy worse than 25 m for 10 s: "GPS is weak here, so directions may be late." once; "Location signal is back." when
  it improves. While weak, "turn now" waits for a second fix that agrees. Fixes worse than 60 m are still not used.
- **Arrival:** "You should be near your destination. It may be a few steps either way." "you have arrived" is now a banned phrase
  (safetext.js); route step texts say "your destination".
- **Fallback:** "Google directions are not available, using backup maps." once a minute at most (one request can fall back twice),
  through `makeProviders({ notify })`. Tested for 429, 403 and a network error.

## Package I: iPhone Safari (branch `feat/ios-safari-package-i`, 9 Nov)
Based on B0 `a80cfbe` (main after PR #11 was merged), not stacked on `fix/field-test-nov8`. The work was first written,
uncommitted, on a local `fix/ios-safari` folder; its files were copied unchanged onto B0 (the two bases have identical trees).
**Not tried on a real iPhone.** Written from Safari's documented behaviour; a friend's iPhone test is planned (test script in the chat of 9 Nov).
- `docs/js/output.js`: `effectiveMode(mode, canVibrate)` and `routeOutput(..., { canVibrate })`. On a phone without `navigator.vibrate`
  vibration only becomes speech and vibration, so a hazard alert is never left silent. `setOutput` refuses vibration only there and
  says `NO_VIBRATE_TEXT`. Test: no mode on any phone gives an alert with neither speech nor vibration.
- `docs/js/platform.js` (new): `requestMotionAccess()` (iPhone's DeviceOrientation/DeviceMotion `requestPermission`, called from the
  Start tap before any await), `unlockAudio()` (silent utterance + silent WAV in the Google voice player, once per page),
  `WakeNotice` (says once when the screen cannot be kept on). "calibrate" says `MOTION_DENIED_TEXT` if motion access was refused.
- `docs/js/cloudstt.js`: `pickRecording()` picks WebM Opus, then Ogg Opus, else raw samples (ScriptProcessor) sent as 16 kHz
  `LINEAR16` (`downsample`, `toLinear16`). Google STT v1 does not accept AAC/MP4, which is all older iPhones record. The audio
  context is now created before the first await so Safari does not keep it suspended.
- Motion access only from a tap (F-I1): `MotionGate` (platform.js) asks only when `start({ fromTap: true })` runs from the Start
  or Talk button. The automatic restart when the page is visible again and the spoken "start" pass `fromTap: false`: they never
  ask, and a refusal caused by having no tap is never recorded as "denied" (it was before: Safari refuses a question with no tap).
  A real "no" is kept, and calibrate still explains how to allow it.
- Tests: `tests/ios_safari.test.js` (14), including a check that every `start(`/`talk(` call in app.js says whether it is a tap.
- Checked: `npm test`, `npm run check:offline` and `npm run check:a11y` pass in **headless Chrome**. Chrome can vibrate and has no
  iPhone permission prompts, so those runs do not exercise the iPhone-specific paths and do not show iPhone compatibility. A
  one-off headless run also confirmed the real automatic restart makes no motion-permission request (the code before F-I1 made two).
- **12 Nov fixes (iPhone simulation in headless Chromium: Safari's missing features removed and its tap rules faked; WebKit itself
  could not be installed here):**
  - Microphone let go after every command on iPhone (`CloudListener` `keepMic: !isIOS()`, `prime()` at Start, Safari 17
    `navigator.audioSession` set to play-and-record while listening and playback after). Holding it all walk makes Safari play
    every sound as a phone call (quieter, sometimes from the earpiece) with the microphone indicator on. Android unchanged.
  - Android regression found and fixed: Chrome 153 has `DeviceOrientationEvent.requestPermission` and answers "prompt" without
    asking, which was stored as "denied", so "calibrate" on Android said "Motion access is off". Now only iPhone asks, and only
    a real "denied" counts as no.
  - Simulated walk, five spoken commands each way: iPhone sends 16 kHz LINEAR16 (real sound, 2 to 7 s), route starts, "vibration
    only" refused, battery not available said, motion asked only from the Start tap, no microphone open between commands, no page
    errors. Android sends WebM Opus as before. Script: `iphone.py` in the 12 Nov session scratchpad. 333 tests pass.
- Not validated: the iPhone-specific app.js wiring in Safari; any real iPhone; the LINEAR16 recording path in `CloudListener.listen()`
  (no automated test: it needs a real microphone); whether Safari's own speech recogniser fallback works.
