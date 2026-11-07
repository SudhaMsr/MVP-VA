# Android spike: can Vision Assist run with the screen off?

**Status, 7 Nov 2026: written, not built or run.** The machine this was written on has no Android SDK, so nothing here has been
compiled or tried on a phone. The answers below are what the platform documents say and what to measure; the spike exists to
replace them with measurements from the Poco. Do not decide on a native app from this report alone.

## Why a spike
Walkers asked for the phone in a chest pocket or on a lanyard with the screen off. The web app cannot do that: Chrome stops the
camera when the screen locks (the app already stops itself and says so). A Capacitor or TWA wrapper does not help, because the camera
still runs inside a WebView that Android pauses with the screen off. Screen-off needs a native camera pipeline (CameraX) and native
inference (ONNX Runtime for Android) in a **foreground service**.

## The three questions, and how the spike answers them
| | Question | What the platform says (unverified here) | What the spike measures |
|---|---|---|---|
| a | CameraX frames at about 320x320 in a foreground service, screen off, Android 13+ | Allowed if the service has `foregroundServiceType="camera"` (and on Android 14+ the `FOREGROUND_SERVICE_CAMERA` permission) **and was started while the app was on screen** ("while-in-use" rule). Some makers (Xiaomi/Poco MIUI/HyperOS) add their own battery limits that can still stop it: "Autostart" and "No restrictions" battery setting may be needed. | `frames=` every 15 s in logcat, and the spoken "Check. N frames a second. Screen off." |
| b | best320.onnx at 8 fps or more with ONNX Runtime Android on a mid-range phone | Compare with the web app's own figure on the same phone (the `perf` events from Package C). Native ORT with XNNPACK and 4 threads is generally faster than single-threaded WebAssembly, so 8 fps is plausible, but it is not measured, and screen-off CPU throttling is unknown. | `fps=` and `ms=` (inference ms per frame). |
| c | TextToSpeech speaking from the service, screen off | Allowed: TTS is a bound system service and works from a foreground service. Audio focus and Bluetooth headsets need checking. | You hear the check every 15 s with the screen locked. |

Also logged: battery percent every 15 s (battery per hour, screen off) and the model's top detection (so you know it really sees).

## How to run it (Android Studio)
1. Install Android Studio (Ladybug or newer), open the `android-spike/` folder, let Gradle sync (AGP 8.7, Kotlin 2.0, compileSdk 35).
2. Copy the model in: `mkdir -p app/src/main/assets && cp ../docs/models/best320.onnx app/src/main/assets/` (git ignores it).
3. Phone: Developer options on, USB debugging on. Run the app. On a Poco: Settings > Apps > VA spike > Battery: No restrictions; Autostart on.
4. Tap **Start test**, allow camera and notifications, then lock the screen. Walk or sit for 10 minutes with the phone in a pocket
   with the camera out (or on a lanyard).
5. Read the results: `adb logcat -s VASpike`. Each line: `frames= fps= ms= frame=WxH screenOn= battery= top=`.
6. Pass if, with `screenOn=false`: fps stays at 8 or more for 10 minutes, the spoken checks keep coming, and battery use is under
   about 20 percent per hour. Record the numbers here.

## Results (fill in)
| Phone | Android | fps screen on | fps screen off | ms per frame | Spoken with screen off? | Battery % per hour | Notes |
|---|---|---|---|---|---|---|---|
| Poco | | | | | | | |

## What would need porting from docs/js
| Web module | What it does | Port effort |
|---|---|---|
| detector.js | letterbox, tensor, decode, NMS | small: letterbox/tensor done in Yolo.kt; decode + NMS ~1 day |
| tracker.js | IoU tracking, box distance, approach speed (line fit), edge handling | 1 to 2 days, port its tests too |
| alerts.js + freespace.js | priorities, corridor, encounter memory, talk budget, crowd rule, clearer-side advice | 3 to 4 days: the safety core; must be test-for-test identical |
| lanes.js + config.js | three lanes, stairs confirmation, thresholds | 1 day |
| speech.js | urgent/nav/status/normal queue, stale drops, hush/skip/hold | 2 days on Android TTS (utterance progress listener) |
| haptics.js, cues.js | patterns and tones | half a day (VibrationEffect, ToneGenerator) |
| nav.js, routes.js, dialogue.js, commands.js | navigation, recorded routes, the voice dialogue and command parser | 4 to 6 days, or keep them in a WebView and talk to the service |
| safetext.js | banned phrases | half a day, plus the string-scan test |
| camcheck.js, battery.js, perf.js | dark camera, battery, measurements | 1 day |
| Speech input | Google STT / Android SpeechRecognizer, tap to talk with screen off (volume key or headset button) | 2 to 3 days: new design work |

**Estimate:** detection-only screen-off app (camera, three lanes, tracker, alerts, speech, haptics): about **2 to 3 weeks** for one
developer including tests. Full parity with navigation and voice: **5 to 7 weeks**. A hybrid (native service for camera, detection
and warnings; the existing web app in a WebView for navigation and conversation) is probably 3 to 4 weeks and keeps one source for
the dialogue. The safety logic (alerts.js) must be ported with its tests, or shared by running the same JS in a JS engine
(e.g. QuickJS) inside the service; that option is worth a day of its own spike.

## Risks
- Maker battery killers (MIUI/HyperOS especially) can stop the service; users would need guided settings.
- Pocket heat with the camera and 4 inference threads running for 30+ minutes.
- Play Store review of camera foreground services (must be clearly user-initiated and visible in the notification).
- Two codebases to keep identical on safety rules unless the JS is shared.

## Recommendation
Run this spike on the Poco only once the pilot shows people want screen-off use (as the build plan says). If (a), (b) and (c) pass,
build the hybrid first.
