package org.visionassist.spike

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

// Spike only: two big buttons and a status line. Start must be pressed while the app is on screen: Android only lets a
// foreground service use the camera if it was started while the app was visible ("while-in-use" access).
class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = TextView(this).apply { textSize = 20f; text = "Ready. Start, then lock the screen." }
        val start = Button(this).apply { text = "Start test"; textSize = 28f; minHeight = 300; setOnClickListener { begin() } }
        val stop = Button(this).apply { text = "Stop test"; textSize = 28f; minHeight = 300; setOnClickListener { stopService(Intent(this@MainActivity, DetectService::class.java)); status.text = "Stopped. Results are in logcat (tag VASpike)." } }
        setContentView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.BOTTOM; setPadding(32, 32, 32, 32); addView(status); addView(start); addView(stop) })
    }

    private fun begin() {
        val need = arrayOf(Manifest.permission.CAMERA, Manifest.permission.POST_NOTIFICATIONS).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (need.isNotEmpty()) { requestPermissions(need.toTypedArray(), 1); return }
        startForegroundService(Intent(this, DetectService::class.java))
        status.text = "Running. Lock the screen now; listen for the spoken checks."
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.all { it == PackageManager.PERMISSION_GRANTED }) begin() else status.text = "Camera permission is needed."
    }
}
