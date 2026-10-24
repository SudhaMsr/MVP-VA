// Central settings. Tune these during field testing (day 8-9).
export const CLASSES = [
  'tree', 'red_light', 'green_light', 'crosswalk', 'blind_road', 'sign', 'person', 'bicycle', 'bus',
  'truck', 'car', 'motorcycle', 'reflective_cone', 'ashcan', 'warning_column', 'roadblock', 'pole', 'dog',
  'tricycle', 'fire_hydrant',
];

export const CONFIG = {
  // Model: 320 is faster, 416 sees smaller objects. Override with ?size=416
  modelUrl: (size) => `models/best${size}.onnx`,
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
