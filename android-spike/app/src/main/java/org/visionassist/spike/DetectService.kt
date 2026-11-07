package org.visionassist.spike

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.ServiceInfo
import android.os.PowerManager
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import java.nio.FloatBuffer
import java.util.Locale
import java.util.concurrent.Executors

// The three questions of the spike, in one foreground service:
//  (a) do CameraX frames keep arriving at about 320x320 with the screen off?            -> "frames" in the log, spoken
//  (b) does best320.onnx run at 8 frames per second or more with ONNX Runtime Android?   -> "fps" and "ms" in the log
//  (c) can TextToSpeech speak from the service with the screen off?                      -> you hear the check every 15 s
// Every 15 s it logs (tag VASpike) and says e.g. "Check. 9 frames a second. Screen off." It also says the top detection
// so you can tell the model is really seeing. Nothing here warns about hazards: it is a feasibility test, not the app.
class DetectService : LifecycleService() {
    private val tag = "VASpike"
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var tts: TextToSpeech
    private var ttsReady = false
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null
    private val input = FloatBuffer.allocate(3 * SIZE * SIZE)
    private var frames = 0
    private var inferMs = 0L
    private var windowStart = SystemClock.elapsedRealtime()
    private var lastTop = ""
    private var wake: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("spike", "Vision Assist spike", NotificationManager.IMPORTANCE_LOW))
        val n = Notification.Builder(this, "spike").setContentTitle("Vision Assist spike").setContentText("Camera test running")
            .setSmallIcon(android.R.drawable.ic_menu_camera).setOngoing(true).build()
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        // A partial wake lock keeps the CPU running with the screen off. Part of what the spike measures is the battery cost.
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "va:spike").apply { acquire(60 * 60 * 1000L) }
        tts = TextToSpeech(this) { ok -> ttsReady = ok == TextToSpeech.SUCCESS; if (ttsReady) { tts.language = Locale.UK; say("Spike started.") } }
        worker.execute { loadModel() }
        startCamera()
    }

    private fun loadModel() {
        try {
            env = OrtEnvironment.getEnvironment()
            val bytes = assets.open("best320.onnx").readBytes()
            session = env!!.createSession(bytes, OrtSession.SessionOptions().apply { setIntraOpNumThreads(4); addXnnpack(mapOf("intra_op_num_threads" to "4")) })
            Log.i(tag, "model loaded: inputs ${session!!.inputNames} outputs ${session!!.outputNames}")
        } catch (e: Exception) { Log.e(tag, "model load failed", e); say("The model could not load.") }
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(Size(320, 320), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .build()
            analysis.setAnalyzer(worker) { img -> onFrame(img) }
            provider.unbindAll()
            provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, analysis) // no Preview: nothing needs the screen
        }, ContextCompat.getMainExecutor(this))
    }

    private fun onFrame(img: ImageProxy) {
        img.use {
            val s = session ?: return
            val t0 = SystemClock.elapsedRealtime()
            Yolo.toTensor(it, SIZE, input)
            OnnxTensor.createTensor(env, input, longArrayOf(1, 3, SIZE.toLong(), SIZE.toLong())).use { x ->
                s.run(mapOf(s.inputNames.first() to x)).use { out ->
                    @Suppress("UNCHECKED_CAST")
                    val o = (out[0].value as Array<Array<FloatArray>>)[0] // [4 + nc][N]
                    lastTop = Yolo.top(o, WOTR_NAMES, 0.45f) ?: lastTop
                }
            }
            inferMs += SystemClock.elapsedRealtime() - t0
            frames += 1
            val now = SystemClock.elapsedRealtime()
            if (now - windowStart >= 15000) report(now, it.width, it.height)
        }
    }

    private fun report(now: Long, w: Int, h: Int) {
        val secs = (now - windowStart) / 1000.0
        val fps = frames / secs
        val screenOn = getSystemService(PowerManager::class.java).isInteractive
        val bat = (getSystemService(BATTERY_SERVICE) as android.os.BatteryManager).getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
        Log.i(tag, "frames=$frames fps=${"%.1f".format(fps)} ms=${if (frames > 0) inferMs / frames else 0} frame=${w}x$h screenOn=$screenOn battery=$bat top=$lastTop")
        say("Check. ${fps.toInt()} frames a second. Screen ${if (screenOn) "on" else "off"}.${if (lastTop.isNotEmpty()) " I last saw a $lastTop." else ""}")
        frames = 0; inferMs = 0; windowStart = now
    }

    private fun say(text: String) { if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_ADD, null, text.hashCode().toString()) }

    override fun onDestroy() {
        worker.shutdown(); session?.close(); tts.shutdown(); wake?.release()
        super.onDestroy()
    }

    companion object {
        const val SIZE = 320
        // Must match docs/js/config.js WOTR_NAMES (the order of the trained model's classes).
        val WOTR_NAMES = listOf("tree", "red_light", "green_light", "crosswalk", "blind_road", "sign", "person", "bicycle", "bus", "truck", "car",
            "motorcycle", "reflective_cone", "ashcan", "warning_column", "roadblock", "pole", "dog", "tricycle", "fire_hydrant")
    }
}
