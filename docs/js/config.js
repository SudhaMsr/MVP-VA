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
  model: 'rod', size: 416, everyNFrames: 4, conf: 0.40, maxAgeMs: 1500,
  classes: ['stairs', 'manhole', 'bench', 'chair', 'guard_rail', 'electrical_box', 'plant_pot', 'bicycle_rack'],
};

export const CONFIG = {
  // Input size: 320 is faster, 416 sees smaller objects. Override with ?size=416 (and ?model=rod or ?model=wotr)
  inputSize: 320,
  confThreshold: 0.45,
  nmsIou: 0.5,

  // Camera horizontal field of view (degrees) used for distance estimates. Calibrate per phone.
  hfovDeg: 66,

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
  cooldownMs: { 0: 3000, 1: 6000, 2: 6000, 3: 12000, 4: 15000 },
  heartbeatMs: 30000, // "still scanning" if nothing has been spoken for this long
  staleMs: 2500, // routine alerts older than this are dropped instead of spoken late

  speechRate: 1.15,
  speechLang: 'en-GB',
};
