# Vision Assist: Final MVP Training Plan

13 November 2026 · Sudha Maddala

## 1. Summary

This is the plan for the last model-training phase before the MVP is put in front of blind testers and funders. It was written from published evidence (listed in Sources) and from the current state of the repo and the Kaggle datasets. Anything that could not be checked is listed as an open question rather than assumed.

**Recommendation in one paragraph.** Build one "pavement model" that replaces the current every-2-seconds model (`rod2`, 30 classes) and keeps all 30 of its classes, adding 8 new ones that blind and partially sighted people report as their main street problems: kerb, dropped kerb, pothole, pavement crack, e-scooter, construction barrier, tactile paving and pedestrian signal (the box only, never its colour). Leave the every-frame model (vehicles and people) and the COCO model untouched. Before any training, do three things: audit the datasets, build a small hand-checked Bristol test set, and measure today's `rod2` on it. Release the new model only through strict gates (no old class gets worse, phone speed holds, new classes stay silent until supervised walks show no false alarms), then run sessions with blind testers. For funding, the model is not the weakest point: evidence from blind testers, a safety and regulatory position, and clean data licences are.

## 2. What blind and partially sighted people need on the street

**Scale (RNIB):** more than two million people in the UK live with sight loss, and around 320,000 are registered sight impaired or severely sight impaired.

**What gets in their way (UK surveys):**

| Finding | Number | Source |
|---|---|---|
| Vehicles parked on the pavement are a barrier | 82% | RNIB *In My Way*, 2025 (1,197 respondents, Feb 2025) |
| Poor pavements (uneven, cracked, potholes) are a barrier | 71% | RNIB 2025 |
| Temporary or moveable obstacles (A-boards, bikes and e-scooters, bin bags) are a barrier | 56% | RNIB 2025 |
| Bikes or e-scooters left on pavements make journeys harder | 81% | RNIB 2025 |
| Lack of accessible crossings is a barrier | 44%; 89% say accessible crossings are vital | RNIB 2025 |
| Collided with a street obstacle in the last three months | 34% | RNIB 2025 |
| Have had to walk into the road to pass an obstacle | 92% | RNIB 2025 |
| Strongly agree they feel safe walking alone in their area | 9% | RNIB 2025 |
| Want to go out more than they do | 57% | RNIB 2025 |
| Most frequent sources of injury | overhanging greenery and temporary obstructions (no percentage given) | RNIB 2025 |
| Obstacles collided with (2014 survey): cars on pavements, bins, permanent street furniture, temporary street furniture, A-boards | 70%, 64%, 59%, 55%, 49% | RNIB *Who put that there*, 2015 (over 500 respondents) |
| Encountered an e-scooter / mobility aid or cane hit by one / worried that they are silent | 78% / 12% / 74% | Guide Dogs *Scoot Aware*, 2022 |

**Which objects matter most (research):** a study that built a list of 90 navigation objects with blind, low-vision and orientation-and-mobility experts found the most important groups to be obstructions a white cane is likely to miss (barrier posts, fold-out signs, benches), overhanging branches, and things that should not be on the pavement. None of the seven detection models it tested recognised these groups well (arXiv 2408.13175).

**What people want from the technology:** in interviews with 24 blind and low-vision people, text recognition was the most wanted task, obstacle detection got the most first-place votes, and asking questions about the surroundings came second. Twenty-three of 24 wanted voice input and all 24 wanted speech output. They did not want to be overwhelmed, wanted only relevant information said briefly, and found steps easier than metres. Hands-free use mattered (one hand is often on a guide dog or cane). Ease of use, including battery life and reliability, was the top concern (16 of 24), followed by looking conspicuous and cost; some preferred one app on a phone they already have; several wanted to try a device with training first (arXiv 2505.19325).

**Errors and trust:** in a study of 12 blind and low-vision users of a recognition app, participants caught fewer than half of the errors, and were certain or very certain in 84% of the trials where the app was wrong. Different answers for the same object lowered trust (arXiv 2408.03303). For a walking aid this means a wrong confident warning is likely to be believed, so the app must stay cautious, consistent and able to explain itself.

**What this means for the MVP:**
1. The model should first cover what people actually report: pavement surface problems, kerbs and crossings, e-scooters and bikes, bins, street furniture, temporary obstacles. That is the basis of the class list in section 4.
2. Saying less, and only what is in the path, is a requirement, not a preference.
3. Some of the highest-injury items (overhanging branches, A-boards, fold-out signs) have no usable open data. They need our own footage, and until then the app must keep saying it cannot see them.

## 3. Where Vision Assist is today

**On the phone now (from `docs/js/config.js` and HANDOFF.md):**

| Model | Runs | Classes |
|---|---|---|
| `best320` (WOTR) | every frame | 20: tree, red/green light, crosswalk, blind road, sign, person, bicycle, bus, truck, car, motorcycle, reflective cone, ashcan, warning column, roadblock, pole, dog, tricycle, fire hydrant |
| `rod2_416` | every 2 s | 30: Bike, Building, Car, Person, Stairs, Traffic sign, Electrical pole, Road, Motorcycle, Dustbin, Dog, Manhole, Tree, Guard rail, Pedestrian crossing, Truck, Bus, Bench, Traffic cone, Fire hydrant, Traffic barrel, Plant pot, Electrical box, Chair, Bicycle rack, Bollard, Downstairs, Upstairs, Red light, Green light |
| `coco320` | every 3.5 s | COCO, outdoor classes only |
| `hazard320` (YOLOE) | off unless `?hazard=on`, never speaks | 15 hazard words incl. e-scooter, A-board, wheelie bin, low branch, kerb, pothole |

**Already built and matching user needs:** voice-first use with short, prioritised alerts and an alert budget; walking corridor (only what is in the path); steps by default; "read this" and "describe this" (Google Vision); "what is near me" (Google Places); walking directions; "why did you say that?"; "what can't you see?"; banned unsafe phrases (`safetext.js`); vibration; a session log and a walk scorer (`tools/score_walk.mjs`).

**Measured speed:** about 250 ms per frame for the fast lane and about 680 ms with the slow lane on the Poco M2 Pro test phone (HANDOFF). On a desktop, `rod2` takes about 127 ms.

**Gaps against the evidence:**

| Need (section 2) | Today |
|---|---|
| Kerbs, dropped kerbs | Not detected; the app says it cannot see kerbs |
| Potholes, cracks, uneven paving | Not detected |
| E-scooters and bikes on the pavement | Bikes yes; e-scooters only in the silent hazard lane |
| Bins, bollards, street furniture | Yes (Dustbin, Bollard, Bench, Electrical pole and others) |
| Temporary obstacles: A-boards, barriers, road works | Traffic barrel, cone, guard rail yes; A-boards no |
| Crossings | Pedestrian crossing yes; light colour deliberately never spoken |
| Overhanging branches | No (no open data; camera height and angle also limit it) |
| Cars parked on the pavement | Cars are detected, but the app cannot tell a car on the pavement from one on the road |

**One finding from the Phase 2 data.** `phase2_data.zip` (7,149 pictures) has no boxes at all for 11 of the 30 classes: Building, Traffic sign, Electrical pole, Road, Manhole, Tree, Guard rail, Traffic cone, Traffic barrel, Electrical box, Bicycle rack (its own `report.txt`). Those were learned from the original data behind `rod_best.pt`, which is not in the repo or on Kaggle. This matters twice: those classes must be protected with pseudo-labels during training, and there is currently no labelled test data to prove they did not get worse.

## 4. MVP model scope

**Keep unchanged:** the 20-class every-frame model and the COCO model. The new model replaces only `rod2`.

**Classes 0 to 29:** exactly as in `rod2`, same numbers, so the alert code keeps working.

**New classes (30 to 37), each tied to the evidence:**

| # | Class | Why (section 2) | Box data on Kaggle |
|---|---|---|---|
| 30 | kerb | 71% poor pavements; RNIB asks for detectable kerbs | Vistas, Kerbs |
| 31 | dropped_kerb | crossings vital to 89% | Vistas, Kerbs (sloped curb) |
| 32 | pothole | 71% poor pavements | Potholes, Vistas |
| 33 | pavement_crack | 71% poor pavements | VIP-Mobility360 (name to confirm) |
| 34 | e_scooter | 81% e-scooters left on pavements; 78% encountered | VIP-Mobility360, E-scooters set |
| 35 | construction_barrier | 56% temporary obstacles; road works | VIP-Mobility360 (name to confirm) |
| 36 | tactile_paving | crossings: a barrier for 44%, vital for 89% (blister paving marks UK crossing points) | GuideTWSI (boxes in SDome-15K; masks elsewhere) |
| 37 | ped_signal | crossings: a barrier for 44%, vital for 89%; only its position, its colour is never spoken | Vistas, Open Images |

**Folded into existing classes (more examples, no new class):** wheelie bins and trash cans into Dustbin; bollards into Bollard; manholes into Manhole; benches into Bench; bike racks into Bicycle rack; street lights and lamp posts into Electrical pole (a decision for you: see open questions).

**Kept out of this MVP model, and why:**
- A-boards, fold-out signs, overhanging branches, step-down drops, café tables: real needs, but no usable open box data. Plan: record and label Bristol footage (the hazard model can pre-label), next phase.
- Wheelchairs, doors, prams: data exists (Open Images) but they are not in the reported top problems. Keep the data for later.
- Glass doors, mobility aids (MAID), SideGuide, MicroVision: access not yet granted.
- Pedestrian light colour: never spoken (safety rule), so no colour classes are added.
- "Car parked on the pavement": needs reasoning about where the pavement is, not just a new class. Out of scope for the model; noted for later.

The app's "what can't you see?" line must be updated to match exactly what the released model can and cannot do, and no more.

## 5. Data plan

**Sources and licences:**

| Dataset (Kaggle, private) | Use | Licence | Note |
|---|---|---|---|
| Phase2 rod2 training data | replay of old classes; regression test | mixed sources, see its manifest.csv | 11 classes have no boxes |
| VIP-Mobility360 640px | e-scooter, bollard, bins, barrier, crack | CC BY 4.0 | UK footage; video frames, many near-duplicates |
| Vistas VA YOLO640 | kerb, dropped kerb, pothole, manhole, bin, bench, street light, bike rack, ped signal | CC BY-NC-SA 4.0 | non-commercial; model inherits it |
| Kerbs YOLO640 | kerb, dropped kerb | CC BY 4.0 (each set) | Ming Chuan set is grayscale with rotated copies |
| Potholes YOLO640 | pothole | CC BY 4.0 | histogram-equalised, augmented |
| E-scooters Bollards YOLO640 | e-scooter, bollard | CC BY 4.0 | 1,330 images |
| Open Images VA classes | extra examples (stairs, poles, bins, benches, ped signal) | boxes CC BY 4.0, images mostly CC BY 2.0 | keep manifest.csv |
| GuideTWSI (authors' Kaggle copy) | tactile paving | CC0 | 46.5 GB; real and synthetic |
| Project Sidewalk Tagger 640 | not for detector training; evaluation and a later tag model | not stated | research only |

**Licence rule.** A model trained with Vistas is non-commercial. That is fine for a free research MVP; a paid version needs Mapillary's permission or a retrain without Vistas. Datasets with no stated licence are not used to train the release model.

**Steps, in order:**
1. **Audit** every dataset: real class names (VIP-Mobility360's list is not published in full), boxes per class, image sizes, splits, corrupt files. Output: one table, checked by hand.
2. **One label map** (a single reviewed YAML) from every source class to our 38 classes or "drop". Nothing is mapped by guess: ambiguous names (Open Images "Scooter" can be a kick scooter) are dropped.
3. **Fill missing labels.** Each dataset only labels its own objects, so every other object would be learned as background. The published fix is pseudo-labelling: run the current models on every picture and keep only confident boxes, ignoring uncertain ones (Zhao et al., ECCV 2020). Here: `rod2` for its 30 classes and the every-frame model for people and vehicles, mapped into our classes. Thresholds are set on a hand-checked sample of 200 pictures.
4. **Remove near-duplicates.** VIP-Mobility360 is video: keep a sample per sequence and split train, validation and test **by sequence**, never by frame, so the test is not a copy of training.
5. **Balance.** Cap pictures per source so 150k video frames do not drown the smaller sets; check boxes per class after capping.
6. **Negatives.** Add plain Bristol pavements with nothing on them (the earlier kerb model failed without them; HANDOFF).
7. **Test sets, never trained on:** (a) Phase 2 validation split; (b) held-out sequences or images from each new dataset; (c) a **Bristol test set**: frames from our own recorded walks, labelled by hand, including the 11 classes with no other test data.

## 6. Training plan

How a senior engineer would run it: measure first, change one thing at a time, keep every run reproducible, and stop when the gates say stop.

1. **Baseline.** Evaluate today's `rod2` on all three test sets: per-class AP50, precision and recall. These are the numbers the new model must not fall below.
2. **Starting weights.** Best: the Phase 2 `best.pt` (the trainable `rod2`), if it can be found in Google Drive. Otherwise start from `weights/rod_best.pt` (25 classes, in the repo) and train on Phase 2 data plus new data, which repeats Phase 2 and adds the new classes in one run. The app's `.onnx` file cannot be trained further, but it can still be used to make pseudo-labels.
3. **Same size, same input.** YOLOv8n at 416 px, like `rod2`, so phone speed stays known. A bigger model only if a Poco measurement shows room.
4. **Few runs, each with a purpose:** E1 the full recipe; E2 the same with the backbone frozen for the first epochs, if E1 shows old classes slipping. Seeds, data versions and settings recorded for each.
5. **Compute.** Kaggle's free GPU has a weekly quota and each session stops after a fixed time (commonly reported as 30 hours a week and 12 hours a session; the exact figures are on your Kaggle account page), so training saves checkpoints and can resume. Expect about 6 to 10 GPU hours for one full run; this is an estimate to confirm with the first epochs.
6. **Thresholds.** Pick a confidence threshold per class on the validation set for the precision the gates need, not one global value.
7. **Export.** ONNX at 416 px with the same settings as now; check the output shape; update `ROD2_NAMES` (or a new `ROD3_NAMES`) in `config.js`; tests and the version stamp as CLAUDE.md requires. INT8 quantisation and WebGPU (supported in recent Chrome on Android by ONNX Runtime Web) are speed options to measure afterwards, not assume.

## 7. Evaluation and release gates

The model goes into the app only after each gate passes, in this order:

| Gate | Pass rule | Source of the rule |
|---|---|---|
| G1 No regression | No old class drops more than 2 AP50 points on the Phase 2 validation set and the Bristol set; person and vehicle classes no more than 1 point (within measurement noise) | this plan |
| G2 New class works | precision ≥ 0.9 and recall ≥ 0.6 on held-out and Bristol data before a class may ever speak | existing rule in HANDOFF |
| G3 Phone speed | measured on the Poco; slow-lane time no worse than `rod2`, and the app stays out of slow mode (under 4 fps) | `perf.js`, HANDOFF |
| G4 Walk gate | across 10 recorded Bristol walks: every warning reviewed, 0 missed moving vehicles, under 1 false warning per minute | `tools/score_walk.mjs` |
| G5 Silent start | new classes only logged at first; spoken only after supervised walks show no false alarms | existing watch-list approach |
| G6 Blind testers | seated session, then supervised walks, using the existing Tester Pack (consent, known limits, interview); record task success and testers' own words | HANDOFF, Tester Pack |

If a gate fails, the current model stays in the app. The banned-phrase list does not change.

## 8. Safety, ethics and regulation

- **Wording.** Keep the safety rules: never imply something is safe, say what the app cannot see, keep using a cane or guide dog.
- **Medical device question.** UK guidance says equipment that compensates for a disability "may or may not" be a medical device, lists "mobility aids for the visually impaired" among products that are, and decides by the intended purpose the maker claims (MHRA borderlines guidance; MHRA software guidance v1.10g). Most assistive devices that are medical devices are likely Class I (MHRA assistive technology guidance). So how Vision Assist describes itself matters. Action: ask the MHRA borderlines team (devices.borderlines@mhra.gov.uk) before applying for funding or launching; do not claim either way until they answer.
- **Data protection.** The ICO requires a data protection impact assessment for innovative technology including AI combined with other risk factors, and always for large-scale systematic monitoring of public areas. Action: write a DPIA covering recorded walks, photos sent to Google Vision, and location. Blur faces and number plates in our own footage before sharing or training on it. Consent from testers (Tester Pack).
- **Licences.** Keep each dataset's licence and credits with the model (a model card listing data, licences, metrics and known limits).

## 9. Funding readiness

**What is open now (checked 13 November 2026):** no Innovate UK competition for accessibility or assistive technology is listed. The two BridgeAI Deployment Catalyst competitions close on 8 December 2026 but need a consortium of two or three organisations, an AI SME lead with a solution at TRL 5 to 6, and a medium or large deployer. Smart grants are reported closed. Fight for Sight's Acceleration and Digital Inclusion funds are for charities and community interest companies and are currently closed.

**What funders look at** (from the criteria of the calls above): evidence of need, feasibility, track record, potential impact, partnerships, and how mature the technology is.

**Evidence pack to build (in this order):**
1. The need: the RNIB and Guide Dogs figures in section 2.
2. Tester results: how many blind testers, what they did, success rates, their words.
3. Model metrics per class, the gates and the results.
4. Safety case: known limits, safe wording, how errors are handled.
5. Regulatory position: the MHRA answer.
6. DPIA and data licences, including the Vistas restriction.
7. Running costs per user (Google APIs) and a roadmap.
8. Partners: a sight-loss charity or CIC (VI Talk and the Bristol Sight Loss Council are already contacts in HANDOFF) opens charity funding routes.

## 10. Step-by-step plan

| Step | What | Who | Effort |
|---|---|---|---|
| 1 | Data audit and one label map | Claude | half a day |
| 2 | Sign off the class list (section 4) | Sudha | an hour |
| 3 | Bristol test set: record walks, extract frames, label about 500 frames incl. the 11 classes | Sudha, Claude tools | 2 to 3 days |
| 4 | Baseline of today's `rod2` on all test sets | Claude | about 1 GPU hour |
| 5 | Pseudo-labels, merge, de-duplicate, balance; hand-check 200 pictures | Claude, Sudha checks | 1 day |
| 6 | Train E1 (and E2 only if needed) | Claude on Kaggle | 6 to 20 GPU hours |
| 7 | Gates G1 and G2, error analysis | Claude | half a day |
| 8 | Export and add to the app silently (PR, tests, stamp) | Claude | half a day |
| 9 | Poco speed and 10 recorded walks (G3, G4) | Sudha | 2 to 3 days |
| 10 | Blind tester sessions (G6) | Sudha, testers | 1 to 2 weeks |
| 11 | MHRA borderline question and DPIA | Sudha (Claude drafts) | 1 day |
| 12 | Funding evidence pack | Claude drafts, Sudha reviews | 2 days |

**Open questions:**
1. Is the Phase 2 `best.pt` in your Google Drive? It saves repeating Phase 2.
2. What was the original data behind `rod_best.pt` (the source of the 11 classes)? If it can be found, it becomes a test set for them.
3. VIP-Mobility360's exact class names: answered by the audit in step 1.
4. Street lights: fold into Electrical pole (recommended) or a separate class?
5. Commercial plans: if a paid version is planned soon, decide now whether to train a second model without Vistas.
6. Which funder to aim for first, and with which partner.

## 11. Sources

- RNIB, *In My Way: Navigating pedestrian journeys with sight loss* (2025): https://media.rnib.org.uk/documents/In_My_Way_-_Navigating_pedestrian_journeys_with_sight_loss_2025_PDF.pdf
- RNIB, *Who put that there?* (2015): https://media.rnib.org.uk/documents/Who_put_that_there_Report_February_2015.pdf
- RNIB, key information and statistics on sight loss: https://rnib.org.uk/knowledge-and-research-hub/key-information-and-statistics
- Guide Dogs, *Scoot Aware* executive summary (2022): https://www.guidedogs.org.uk/-/media/project/guidedogs/guidedogsdotorg/files/how-you-can-help/campaigning/executive-summary---scoot-aware.pdf
- Identifying Crucial Objects in Blind and Low-Vision Individuals' Navigation (arXiv 2408.13175): https://arxiv.org/pdf/2408.13175
- What do Blind and Low-Vision People Really Want from Assistive Smart Devices? (arXiv 2505.19325): https://arxiv.org/html/2505.19325v1
- Understanding How Blind Users Handle Object Recognition Errors (arXiv 2408.03303): https://arxiv.org/pdf/2408.03303
- Zhao et al., Object Detection with a Unified Label Space from Multiple Datasets, ECCV 2020 (arXiv 2008.06614): https://arxiv.org/abs/2008.06614
- YOLO-IOD: Towards Real Time Incremental Object Detection (arXiv 2512.22973): https://arxiv.org/html/2512.22973v2
- ONNX Runtime, Using the WebGPU Execution Provider: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- MHRA, Borderlines with medical devices and other products in Great Britain: https://www.gov.uk/government/publications/borderlines-with-medical-devices/borderlines-with-medical-devices-and-other-products-in-great-britain
- MHRA, Medical device stand-alone software including apps (v1.10g): https://assets.publishing.service.gov.uk/media/6abf6c8c943e890cb55e5e52/Medical_device_stand-alone_software_including_apps__including_IVDMDs.pdf
- MHRA, Assistive technology: definition and safe use: https://www.gov.uk/government/publications/assistive-technology-definition-and-safe-use/assistive-technology-definition-and-safe-use
- ICO, When do we need to do a DPIA?: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/
- Innovation Funding Service, competition search: https://apply-for-innovation-funding.service.gov.uk/competition/search
- Fight for Sight, The Acceleration Fund: https://www.fightforsight.org.uk/apply-for-funding/social-change-funding/the-acceleration-fund
- Fight for Sight, The Digital Inclusion Fund: https://www.fightforsight.org.uk/apply-for-funding/apply-for-social-change-funding/the-digital-inclusion-fund/
- LJMU, VIP-Mobility360: https://opendata.ljmu.ac.uk/id/eprint/226/
- GuideTWSI: https://github.com/DARoSLab/GuideTWSI and https://www.kaggle.com/datasets/guidedogrobot/guidetwsi
- Project repo files: `docs/js/config.js`, `HANDOFF.md`, `README.md`, `RESEARCH.md`, `phase2_data/report.txt`
