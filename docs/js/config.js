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
export const CLASSES = WOTR_NAMES; // kept for older imports

export const MODELS = {
  wotr: { names: WOTR_NAMES, url: (size) => `models/best${size}.onnx` },
  rod: { names: ROD_NAMES, url: (size) => `models/rod${size}.onnx` },
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
  model: 'rod', size: 416, everyMs: 2000, conf: 0.40, maxAgeMs: 2500, // field log: one pass costs ~430 ms on the Poco
  classes: ['stairs', 'manhole', 'bench', 'chair', 'guard_rail', 'electrical_box', 'plant_pot', 'bicycle_rack'],
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
  approachSpeedMps: 2.5, // closing speed above this counts as "approaching"
  approachMinHits: 3, // frames a vehicle must be tracked before we trust its speed
  personNearMetres: 4,
  dogNearMetres: 3,
  staticNearFraction: 0.45, // object box height / frame height above this = "close"

  // Cooldowns per priority (ms)
  urgentGapMs: 8000,
  cooldownMs: { 0: 6000, 1: 6000, 2: 6000, 3: 12000, 4: 15000 },
  // The walker's path: a trapezoid on the ground in front of the camera (fractions of the picture). Things outside it
  // stay quiet unless very close, because a blind walker only needs to hear about what is on the way.
  corridor: { topY: 0.4, topHalf: 0.12, bottomHalf: 0.32 },
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
export const FEATURES = { read: false }; // ?read=1 turns reading on for testing
