package expo.modules.edockit

import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenter
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import java.util.concurrent.TimeUnit

// Google's subject segmentation (ML Kit, delivered by Google Play services): tells which pixels
// of a picture belong to its main object, here the page, without any of Google's screens.
internal object Foreground {
  private var segmenter: SubjectSegmenter? = null

  @Synchronized
  fun client(): SubjectSegmenter =
    segmenter ?: SubjectSegmentation.getClient(
      SubjectSegmenterOptions.Builder().enableForegroundConfidenceMask().build(),
    ).also { segmenter = it }

  // How sure the model is (0 to 1) that each pixel, row by row, is part of the main object; null
  // while Play services is still fetching the model or when it cannot run.
  fun mask(bitmap: Bitmap): FloatArray? = try {
    val result = Tasks.await(client().process(InputImage.fromBitmap(bitmap, 0)), 1500, TimeUnit.MILLISECONDS)
    val buffer = result.foregroundConfidenceMask
    if (buffer == null) {
      null
    } else {
      buffer.rewind()
      val values = FloatArray(buffer.remaining())
      buffer.get(values)
      if (values.size == bitmap.width * bitmap.height) values else null
    }
  } catch (error: Exception) {
    null
  }
}
