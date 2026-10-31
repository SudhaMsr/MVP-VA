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

// Third lane: the standard COCO model (80 classes). Only the classes below are ever used; the file is optional.
export const COCO_NAMES = ['person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'];
export const CLASSES = WOTR_NAMES; // kept for older imports

export const MODELS = {
  wotr: { names: WOTR_NAMES, url: (size) => `models/best${size}.onnx` },
  rod: { names: ROD_NAMES, url: (size) => `models/rod${size}.onnx` },
  rod2: { names: ROD2_NAMES, url: (size) => `models/rod2_${size}.onnx` },
  coco: { names: COCO_NAMES, url: (size) => `models/coco${size}.onnx` },
};
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
};

export const TERTIARY = {
  model: 'coco', size: 320, everyMs: 3500, conf: 0.50, maxAgeMs: 4500, clsOffset: 1000, // offset keeps its class numbers apart from the other lanes
  // everything COCO knows except what the first two models already cover (person, car, bench, chair, hydrant ...)
  // Outdoor things only. Indoor classes (microwave, oven, fridge, sink, tv, bed, cup...) were dropped on 31 Oct: on street footage
  // it called a shop front "microwave" for 26 frames in a row.
  classes: ['traffic_light', 'stop_sign', 'parking_meter', 'bird', 'cat', 'horse', 'sheep', 'cow', 'backpack', 'umbrella', 'handbag', 'suitcase',
    'skateboard', 'sports_ball', 'potted_plant'],
};

export const CONFIG = {
  // Input size: 320 is faster, 416 sees smaller objects. Override with ?size=416 (and ?model=rod or ?model=wotr)
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
  approachMinHits: 3, // frames a vehicle must be tracked before we trust its speed
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
  speechRate: 0.8, // calmer pace; 1.0 is the voice default
  speechLang: 'en-GB',
};

// Google Maps Platform key. Restricted in Google Cloud to https://sudhamsr.github.io/* and to the Places, Routes,
// Geocoding and Maps JavaScript APIs, so it is useless elsewhere. Empty string = use OpenStreetMap only.
export const GOOGLE_KEY = 'AIzaSyBkblGHKZibIQUbufndBeCK6TKQpjzuCyY';

// Features that are built but switched off until the core (hazards + navigation) is tested.
export const FEATURES = { read: true }; // ?read=1 turns reading on for testing
