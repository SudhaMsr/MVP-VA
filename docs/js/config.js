// Class lists for each trained model. Model 'wotr' = original 20-class model; 'rod' = 25-class model
// that also knows stairs, manholes, benches, chairs, guard rails. Order must match the training yaml.
export const WOTR_NAMES = [
  'tree', 'red_light', 'green_light', 'crosswalk', 'blind_road', 'sign', 'person', 'bicycle', 'bus',
  'truck', 'car', 'motorcycle', 'reflective_cone', 'ashcan', 'warning_column', 'roadblock', 'pole', 'dog',
  'tricycle', 'fire_hydrant',
];
export const ROD_NAMES = [
  'Bike', 'Building', 'Car', 'Person', 'Stairs', 'Traffic sign', 'Electrical Pole', 'Road', 'Motorcycle',
  'Dustbin', 'Dog', 'Manhole', 'Tree', 'Guard rail', 'Pedestrian crosswalk', 'Truck', 'Bus', 'Bench',
  'Traffic Cone', 'Fire hydrant', 'Teraffic Barrel', 'Plant Pot', 'Electrical Box', 'Chair', 'Bicycle Rack',
];
// Phase 2: rod_best.pt fine-tuned on more images. The first 25 classes are unchanged; five are added at the end.
export const ROD2_NAMES = [...ROD_NAMES, 'Bollard', 'Downstairs', 'Upstairs', 'Red light', 'Green light'];
// Phase 5 (rod3, tools/phase5/label_map.json): rod2's 30 classes unchanged, ten new ones at the end. NONE of the ten is
// spoken: they are only logged (WATCH_CLASSES.rod3) until each passes the walk gate. See HANDOFF.md, Phase 5.
export const ROD3_NEW = ['kerb', 'kerb_drop', 'dropped_kerb', 'pothole', 'pavement_crack', 'e_scooter', 'construction_barrier',
  'tactile_paving', 'ped_signal', 'a_board'];
export const ROD3_NAMES = [...ROD2_NAMES, ...ROD3_NEW];

// Third lane: the standard COCO model (80 classes). Only the classes below are ever used; the file is optional.
export const COCO_NAMES = ['person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'];
export const CLASSES = WOTR_NAMES; // kept for older imports

// sizes: the input sizes whose .onnx file is on the site. best416, rod416 and rod640 were removed on 7 Nov (Package B,
// about 38 MB nobody loaded); they are in git history at commit 352ec39 (see HANDOFF.md).
export const MODELS = {
  wotr: { names: WOTR_NAMES, url: (size) => `models/best${size}.onnx`, sizes: [320] },
  rod: { names: ROD_NAMES, url: (size) => `models/rod${size}.onnx`, sizes: [] },
  rod2: { names: ROD2_NAMES, url: (size) => `models/rod2_${size}.onnx`, sizes: [416] },
  // sizes stays empty (never a main model); rod3 only runs in the slow lane when a supervisor asks with ?slow=rod3.
  rod3: { names: ROD3_NAMES, url: (size) => `models/rod3_${size}.onnx`, sizes: [] },
  coco: { names: COCO_NAMES, url: (size) => `models/coco${size}.onnx`, sizes: [320] },
};
// ?model= and ?size= for supervisors: only a model and size whose file exists; anything else falls back to the default.
export function pickModel(modelParam, sizeParam, fallbackSize) {
  const key = MODELS[modelParam] && MODELS[modelParam].sizes.length ? modelParam : DEFAULT_MODEL;
  const want = Number(sizeParam) || fallbackSize;
  const sizes = MODELS[key].sizes;
  return { key, size: sizes.includes(want) ? want : sizes.includes(fallbackSize) ? fallbackSize : sizes[0] };
}
// The slow lane's model: rod2, unless a supervisor tests rod3 with ?slow=rod3. Any other value keeps rod2.
export function slowModelKey(slowParam) { return slowParam === 'rod3' ? 'rod3' : SECONDARY.model; }
export const DEFAULT_MODEL = 'wotr'; // switch to 'rod' once the rod*.onnx files are in docs/models

// Different datasets name the same thing differently; the alert code only sees these names.
const ALIAS = {
  bike: 'bicycle', electrical_pole: 'pole', dustbin: 'ashcan', traffic_cone: 'reflective_cone',
  teraffic_barrel: 'roadblock', pedestrian_crosswalk: 'crosswalk', traffic_sign: 'sign',
};
export function canonical(name) {
  const key = String(name).toLowerCase().trim().replace(/\s+/g, '_');
  return ALIAS[key] || key;
}

// Slow lane: a second model run every few frames, contributing only these classes.
export const SECONDARY = {
  model: 'rod2', size: 416, everyMs: 2000, conf: 0.40, maxAgeMs: 2500, // field log: one pass costs ~430 ms on the Poco
  classes: ['stairs', 'manhole', 'bench', 'chair', 'guard_rail', 'electrical_box', 'plant_pot', 'bicycle_rack'],
  // Stairs give a spoken fall-hazard warning, so they must be sure: score 0.80+ and seen in two slow runs in a row.
  // (Phone footage, 31 Oct: plain paving scored up to 0.77 as stairs.) Retune once real stairs have been filmed.
  confirm: { stairs: { minScore: 0.80, runs: 2 } },
};
// The fast model's "blind_road" (tactile paving) fired on ordinary block paving in 51 of 178 phone frames (31 Oct).
// Wrong information about tactile paving misleads a blind walker, so it is not used until a model passes on UK footage.
export const IGNORE_FAST = ['blind_road'];

export const TERTIARY = {
  model: 'coco', size: 320, everyMs: 3500, conf: 0.50, maxAgeMs: 4500, clsOffset: 1000, // offset keeps its class numbers apart from the other lanes
  // everything COCO knows except what the first two models already cover (person, car, bench, chair, hydrant ...)
  // Outdoor things only. Indoor classes (microwave, oven, fridge, sink, tv, bed, cup...) were dropped on 31 Oct: on street footage
  // it called a shop front "microwave" for 26 frames in a row.
  classes: ['traffic_light', 'stop_sign', 'parking_meter', 'bird', 'cat', 'horse', 'sheep', 'cow', 'backpack', 'umbrella', 'handbag', 'suitcase',
    'skateboard', 'sports_ball', 'potted_plant'],
};

// Hazard lane (7 Nov): an open-vocabulary detector (YOLOE, set by text to RNIB's obstacle list; no training) made by
// tools/phase4/export_hazard_model.py. Optional: the app runs without the file. Every sighting is a 'hazard-detect'
// session-log event, and "is there an e-scooter?" can answer from it with a hedge. A class is spoken as a warning only when
// it is in speakClasses, which needs it to pass tools/phase4/graduate.mjs (and then the walk gate, tools/score_walk.mjs).
// names must match tools/phase4/hazard_vocab.json (a test checks).
export const HAZARD = {
  file: 'models/hazard320.onnx', size: 320, everyMs: 4000, conf: 0.35, maxAgeMs: 6000,
  // Package E: the classes allowed to speak, each only after it graduates (tools/phase4/graduate.mjs on hazard_eval.json).
  // Empty until there is an evaluation: then everything from this lane stays log and on-request only.
  speakClasses: [],
  names: ['e_scooter', 'bicycle', 'a_board', 'bollard', 'wheelie_bin', 'rubbish_bag', 'traffic_cone', 'road_barrier', 'low_branch',
    'kerb', 'stairs', 'pothole', 'ped_signal', 'bench', 'lamp_post'],
};

// The hazard lane loads by default only once a class may speak; until then only with ?hazard=on (see app.js hazardWanted).
export function hazardOnByDefault(hazard) { return (hazard.speakClasses || []).length > 0; }

// Step C: classes a model already sees but no alert speaks. rod2's five (SECONDARY.classes does not list them, so they
// never reach the tracker) and coco's traffic_light/stop_sign (in TERTIARY.classes, reach the tracker, but alerts.js has
// no wording for them). Logged every time the slow or coco lane sees one (a new 'watch-detect' session-log event), so
// false-alarm rate can be checked on the Poco before CONFIG.speakWatchClasses is ever turned on.
export const WATCH_CLASSES = {
  rod2: ['bollard', 'upstairs', 'downstairs', 'red_light', 'green_light'],
  rod3: ['bollard', 'upstairs', 'downstairs', 'red_light', 'green_light', ...ROD3_NEW],
  coco: ['traffic_light', 'stop_sign'],
};

export const CONFIG = {
  // Input size of the main model. ?model=rod2 (416) is the only other main model on the site now; see pickModel.
  inputSize: 320,
  confThreshold: 0.45,
  nmsIou: 0.5,

  // Camera horizontal field of view (degrees) used for distance estimates. Calibrate per phone.
  hfovDeg: 66, // field of view along the long side of the picture

  // Loop pacing: minimum gap between frames (ms). 0 = as fast as the phone allows.
  minFrameGapMs: 0,

  // Tracker
  trackMaxAgeMs: 800,
  trackIouMin: 0.3,

  // Alert wording thresholds
  vehicleAlertMetres: 20,
  vehicleUrgentMetres: 6,
  approachSpeedMps: 2.5, // closing speed above this counts as "approaching" (bicycles and anything not listed below)
  // Vehicles warn only when they are coming fast, like the first Vision Assist (GOOGLE repo): car over 7 m/s (25 km/h),
  // bus and truck over 5 m/s, within vehicleAlertMetres. Parked and slow cars stay quiet.
  speedingMps: { car: 7, motorcycle: 7, bus: 5, truck: 5 },
  // ...except very close: inside this distance any vehicle closing faster than approachSpeedMps is urgent
  // (a car reversing out of a driveway or pulling out of a space is slow, but it is right there).
  closeVehicleMetres: 5,
  approachMinHits: 3, // frames a vehicle must be tracked before we trust its speed (tests and tracks without a sample count)
  approachMinSamples: 5, // speed samples in a row (about 0.6 s) before a vehicle can be called approaching
  // Parked or still vehicles are not announced. A vehicle is only mentioned when it is moving toward the walker (approaching),
  // moving across the walker's path (passing), or a still one is right in the path and very close (blocking the way).
  passLateralPerSec: 0.25, // sideways speed in frame-widths per second, after allowing for the camera turning
  passMinHits: 4, // frames a vehicle must be tracked before it can count as passing
  passMaxMetres: 15, // a passing vehicle further away than this is not mentioned
  parkedMinHits: 6, // seen in about 6 frames (about a second) first: a one-off misdetection is not a parked car
  parkedAheadMetres: 5, // a still vehicle is only mentioned when it is in the path and nearer than this; 0 = never
  personNearMetres: 4,
  dogNearMetres: 3,
  staticNearFraction: 0.45, // object box height / frame height above this = "close"

  // Cooldowns per priority (ms)
  urgentGapMs: 8000,
  cooldownMs: { 0: 6000, 1: 6000, 2: 6000, 3: 12000, 4: 15000 },
  // The walker's path: a trapezoid on the ground in front of the camera (fractions of the picture). Things outside it
  // stay quiet unless very close, because a blind walker only needs to hear about what is on the way.
  corridor: { topY: 0.4, topHalf: 0.12, bottomHalf: 0.32 },
  freeSpace: { nearMetres: 3.5, on: 0.6, off: 0.3, alpha: 0.4, clearFrames: 10 }, // free-space guidance: how near blocks a lane, smoothing, frames of calm before 'clear ahead'
  sideAlertMetres: 1.5, // things outside the path are only mentioned when closer than this // things to the left or right are only mentioned when closer than this
  repeatCloserMetres: 1.5, // a repeat alert is allowed straight away if the thing got this much closer
  forgetMs: 4000, // an object out of view this long counts as new if it comes back
  reminderMs: 30000, // fall hazards and red lights still in view are repeated this often (others only when closer)
  minuteMax: { quiet: 4, normal: 6, detailed: 10 }, // most routine alerts per minute
  budgetWindowMs: 10000, budgetMax: 3, // at most this many routine alerts per window; urgent ones are exempt
  heartbeatMs: 90000, // "still scanning" if nothing has been spoken for this long (never in quiet mode)
  staleMs: 2500, // routine alerts older than this are dropped instead of spoken late

  verbosity: 'quiet', // quiet | normal | detailed. New users start quiet; they can say "more detail" or "less talk"
  quietNearMetres: 2, // in quiet mode, people, dogs and vehicles are only mentioned this close and straight ahead
  reassureMs: 90000, // on a long straight stretch, say "you are on the route" if nothing has been said for this long
  reassureMetres: 80, // ...and the next turn is at least this far away
  speechRate: 0.95, // calm but not slow (HANDOFF rule); 1.0 is the voice default. Walkers can change it by voice or the button
  speechLang: 'en-GB',
  ttsVoice: 'en-GB-Neural2-C', // Google Cloud Text-to-Speech voice (cloudtts.js); the phone's voice is the fallback

  // Floor-based distance (Package F): camera's vertical field of view (degrees, portrait) for the ground geometry in
  // floordist.js. Calibrate per phone. Used for speech only with ?dist=floor; always logged next to the box estimate.
  floor: { vfovDeg: 60, edgeMargin: 0.02, minAngleDeg: 2, heightShare: 0.72 },

  speakWatchClasses: false, // Step C: WATCH_CLASSES are logged only. Turn on only after a Poco test shows no false alarms.
  // bollard/upstairs/downstairs/traffic_light/stop_sign have no alert wording yet, so this alone would not make them
  // speak; red_light/green_light already have wording (shared with the wotr model), which is exactly why rod2's two
  // must stay out of SECONDARY.classes until the Poco test is in: reaching the tracker would speak that old wording at once.
};

// Google key. A browser-only app on GitHub Pages cannot hide this key, so it is locked down in Google Cloud
// Console instead: restricted to https://sudhamsr.github.io/* and to the Places (New), Routes and
// Speech-to-Text APIs only. Empty string = use OpenStreetMap and Chrome's speech recogniser only.
export const GOOGLE_KEY = 'AIzaSyBkblGHKZibIQUbufndBeCK6TKQpjzuCyY';

// Features that are built but switched off until the core (hazards + navigation) is tested.
export const FEATURES = { read: true }; // ?read=1 turns reading on for testing
