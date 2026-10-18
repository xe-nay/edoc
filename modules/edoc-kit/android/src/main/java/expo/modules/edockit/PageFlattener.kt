package expo.modules.edockit

import android.content.Context
import android.graphics.Bitmap
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfByte
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.dnn.Dnn
import org.opencv.dnn.Net
import org.opencv.imgproc.Imgproc

// Flattens a bent or curled page (held in the hand, a book's curve) so its lines come out
// straight, with UVDoc ("Neural Grid-based Document Unwarping", MIT License), converted by
// scripts/export-flatten-model.py and run with OpenCV's dnn module, on the phone. The model sees
// the page at 488 x 712 and says, on a 45 x 31 grid, where each point of the flat page lies in the
// photo; the photo is then resampled along that grid at full size.
internal object PageFlattener {
  private const val WIDTH = 488
  private const val HEIGHT = 712
  private var net: Net? = null
  private var failed = false

  @Synchronized
  fun load(context: Context): Boolean {
    if (net != null) return true
    if (failed) return false
    return try {
      val bytes = context.assets.open("page-flatten.onnx").use { it.readBytes() }
      net = Dnn.readNetFromONNX(MatOfByte(*bytes))
      true
    } catch (error: Throwable) {
      failed = true
      false
    }
  }

  // The page flattened, or null when the model is not available. The picture should be the page
  // with a little margin around it.
  @Synchronized
  fun flatten(source: Bitmap): Bitmap? {
    val model = net ?: return null
    val rgba = Mat()
    Utils.bitmapToMat(source, rgba)
    val rgb = Mat()
    Imgproc.cvtColor(rgba, rgb, Imgproc.COLOR_RGBA2RGB)
    rgba.release()
    val fitted = Mat()
    Imgproc.resize(rgb, fitted, Size(WIDTH.toDouble(), HEIGHT.toDouble()), 0.0, 0.0, Imgproc.INTER_AREA)
    val blob = Dnn.blobFromImage(fitted, 1.0 / 255, Size(WIDTH.toDouble(), HEIGHT.toDouble()), Scalar(0.0, 0.0, 0.0), false, false)
    fitted.release()
    model.setInput(blob)
    val output = model.forward()
    blob.release()
    val cells = FloatArray(2 * 45 * 31)
    output.reshape(1, 1).get(0, 0, cells)
    output.release()

    // The grid's x and y (from -1 to 1 across the photo), spread over the full picture.
    val width = source.width
    val height = source.height
    val gridX = Mat(45, 31, CvType.CV_32FC1)
    val gridY = Mat(45, 31, CvType.CV_32FC1)
    gridX.put(0, 0, cells.copyOfRange(0, 45 * 31))
    gridY.put(0, 0, cells.copyOfRange(45 * 31, 2 * 45 * 31))
    val mapX = Mat()
    val mapY = Mat()
    Imgproc.resize(gridX, mapX, Size(width.toDouble(), height.toDouble()), 0.0, 0.0, Imgproc.INTER_LINEAR)
    Imgproc.resize(gridY, mapY, Size(width.toDouble(), height.toDouble()), 0.0, 0.0, Imgproc.INTER_LINEAR)
    listOf(gridX, gridY).forEach { it.release() }
    Core.add(mapX, Scalar(1.0), mapX)
    Core.multiply(mapX, Scalar((width - 1) / 2.0), mapX)
    Core.add(mapY, Scalar(1.0), mapY)
    Core.multiply(mapY, Scalar((height - 1) / 2.0), mapY)

    val flat = Mat()
    Imgproc.remap(rgb, flat, mapX, mapY, Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE)
    listOf(rgb, mapX, mapY).forEach { it.release() }
    val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    Utils.matToBitmap(flat, result)
    flat.release()
    return result
  }
}
