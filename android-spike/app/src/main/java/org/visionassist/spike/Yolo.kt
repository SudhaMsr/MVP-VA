package org.visionassist.spike

import androidx.camera.core.ImageProxy
import java.nio.FloatBuffer

// Ports of docs/js/detector.js letterbox + rgbaToTensor, and a cut-down decode (best class only, no NMS: the spike only
// needs to show the model sees something). The full decode, tracker and alert rules are listed in REPORT.md as porting work.
object Yolo {
    // RGBA_8888 frame -> letterboxed, planar RGB floats 0..1, grey (114) padding, like the web app.
    fun toTensor(img: ImageProxy, size: Int, out: FloatBuffer) {
        val plane = img.planes[0]; val buf = plane.buffer; val rowStride = plane.rowStride; val px = plane.pixelStride
        val w = img.width; val h = img.height
        val r = minOf(size.toFloat() / w, size.toFloat() / h)
        val nw = Math.round(w * r); val nh = Math.round(h * r); val dx = (size - nw) / 2; val dy = (size - nh) / 2
        val n = size * size; val pad = 114f / 255f
        out.rewind()
        val arr = out.array()
        for (y in 0 until size) for (x in 0 until size) {
            val i = y * size + x
            val sx = ((x - dx) / r).toInt(); val sy = ((y - dy) / r).toInt()
            if (x < dx || y < dy || x >= dx + nw || y >= dy + nh || sx >= w || sy >= h) { arr[i] = pad; arr[n + i] = pad; arr[2 * n + i] = pad; continue }
            val o = sy * rowStride + sx * px
            arr[i] = (buf.get(o).toInt() and 0xff) / 255f
            arr[n + i] = (buf.get(o + 1).toInt() and 0xff) / 255f
            arr[2 * n + i] = (buf.get(o + 2).toInt() and 0xff) / 255f
        }
    }

    // o: [4 + nc][N]. The name of the highest-scoring box above conf, or null.
    fun top(o: Array<FloatArray>, names: List<String>, conf: Float): String? {
        val nBoxes = o[0].size; var best = -1; var bs = conf
        for (i in 0 until nBoxes) for (c in names.indices) { val s = o[4 + c][i]; if (s > bs) { bs = s; best = c } }
        return if (best >= 0) names[best].replace('_', ' ') else null
    }
}
