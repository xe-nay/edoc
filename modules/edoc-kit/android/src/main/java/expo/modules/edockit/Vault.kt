package expo.modules.edockit

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import expo.modules.kotlin.exception.CodedException
import java.io.DataInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

// Encryption for protected documents and password-protected backups.
// File formats are identical to the iPhone app, so backups move between the two.
//
// Pages: a file whose name ends in ".enc" holds nonce (12 bytes) + AES-256-GCM ciphertext + tag,
// made with a key that never leaves this phone: it is stored wrapped by the Android Keystore.
//
// Backups: magic + salt + iteration count, then 1 MB chunks, each sealed with a key derived
// from the password (PBKDF2-SHA256) and authenticated with its position and a last-chunk flag.
object Vault {
  private const val ENCRYPTED_SUFFIX = ".enc"
  private const val WRAP_ALIAS = "edoc_page_key_wrap"
  private const val KEY_FILE = "vault.key"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val NONCE_LENGTH = 12
  private const val TAG_BITS = 128

  private val ARCHIVE_MAGIC = "EDOCBK01".toByteArray(Charsets.US_ASCII)
  private const val SALT_LENGTH = 16
  private const val CHUNK_SIZE = 1 shl 20
  private const val CHUNK_OVERHEAD = 28
  private const val PASSWORD_ITERATIONS = 600_000

  private val random = SecureRandom()
  private var cachedKey: SecretKeySpec? = null

  fun isEncrypted(file: File): Boolean = file.name.endsWith(ENCRYPTED_SUFFIX)

  // --- Device key ------------------------------------------------------------

  private fun wrappingKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(WRAP_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(WRAP_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  @Synchronized
  private fun deviceKey(context: Context): SecretKeySpec {
    cachedKey?.let { return it }
    val file = File(context.noBackupFilesDir, KEY_FILE)
    val raw: ByteArray
    if (file.exists()) {
      // An existing key that cannot be unwrapped must never be replaced by a new one.
      try {
        val blob = file.readBytes()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(TAG_BITS, blob, 0, NONCE_LENGTH))
        raw = cipher.doFinal(blob, NONCE_LENGTH, blob.size - NONCE_LENGTH)
      } catch (error: Exception) {
        throw CodedException("ERR_KEYSTORE", "The encryption key cannot be read", error)
      }
    } else {
      raw = ByteArray(32).also { random.nextBytes(it) }
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
      val blob = cipher.iv + cipher.doFinal(raw)
      val temp = File(context.noBackupFilesDir, "$KEY_FILE.tmp")
      temp.writeBytes(blob)
      if (!temp.renameTo(file)) {
        throw CodedException("ERR_KEYSTORE", "The encryption key cannot be saved", null)
      }
    }
    return SecretKeySpec(raw, "AES").also { cachedKey = it }
  }

  // --- Page files ------------------------------------------------------------

  // Returns the plain content of a file, decrypting it when its name ends in ".enc".
  fun read(context: Context, file: File): ByteArray {
    val raw = file.readBytes()
    if (!isEncrypted(file)) {
      return raw
    }
    val key = deviceKey(context)
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, raw, 0, NONCE_LENGTH))
      return cipher.doFinal(raw, NONCE_LENGTH, raw.size - NONCE_LENGTH)
    } catch (error: Exception) {
      throw CodedException("ERR_DECRYPT", "This document cannot be decrypted on this phone", error)
    }
  }

  // Writes content to a file, encrypting it when the name ends in ".enc".
  fun write(context: Context, data: ByteArray, file: File) {
    file.parentFile?.mkdirs()
    var payload = data
    if (isEncrypted(file)) {
      val nonce = ByteArray(NONCE_LENGTH).also { random.nextBytes(it) }
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, deviceKey(context), GCMParameterSpec(TAG_BITS, nonce))
      payload = nonce + cipher.doFinal(data)
    }
    val temp = File(file.parentFile, "${file.name}.tmp")
    temp.writeBytes(payload)
    if (file.exists()) {
      file.delete()
    }
    if (!temp.renameTo(file)) {
      throw CodedException("ERR_WRITE", "The file cannot be saved", null)
    }
  }

  // --- Password-protected archives ---------------------------------------------

  private fun bigEndian(value: Int): ByteArray = byteArrayOf(
    (value ushr 24).toByte(),
    (value ushr 16).toByte(),
    (value ushr 8).toByte(),
    value.toByte()
  )

  private fun chunkTag(index: Long, isFinal: Boolean): ByteArray {
    val tag = ByteArray(9)
    for (position in 0 until 8) {
      tag[position] = (index ushr (56 - 8 * position)).toByte()
    }
    tag[8] = if (isFinal) 1 else 0
    return tag
  }

  private fun passwordKey(password: String, salt: ByteArray, iterations: Int): SecretKeySpec {
    val spec = PBEKeySpec(password.toCharArray(), salt, iterations, 256)
    try {
      val derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
      return SecretKeySpec(derived, "AES")
    } catch (error: Exception) {
      throw CodedException("ERR_PASSWORD", "The password cannot be used", error)
    } finally {
      spec.clearPassword()
    }
  }

  fun isSealedArchive(file: File): Boolean {
    if (!file.exists() || file.length() < ARCHIVE_MAGIC.size) {
      return false
    }
    val head = ByteArray(ARCHIVE_MAGIC.size)
    FileInputStream(file).use { DataInputStream(it).readFully(head) }
    return head.contentEquals(ARCHIVE_MAGIC)
  }

  fun sealArchive(source: File, destination: File, password: String) {
    val salt = ByteArray(SALT_LENGTH).also { random.nextBytes(it) }
    val key = passwordKey(password, salt, PASSWORD_ITERATIONS)
    destination.parentFile?.mkdirs()
    var remaining = source.length()
    DataInputStream(FileInputStream(source).buffered()).use { input ->
      FileOutputStream(destination).buffered().use { output ->
        output.write(ARCHIVE_MAGIC)
        output.write(salt)
        output.write(bigEndian(PASSWORD_ITERATIONS))
        var index = 0L
        do {
          val chunk = ByteArray(minOf(CHUNK_SIZE.toLong(), remaining).toInt())
          input.readFully(chunk)
          remaining -= chunk.size
          val nonce = ByteArray(NONCE_LENGTH).also { random.nextBytes(it) }
          val cipher = Cipher.getInstance(TRANSFORMATION)
          cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
          cipher.updateAAD(chunkTag(index, remaining == 0L))
          val sealed = cipher.doFinal(chunk)
          output.write(bigEndian(NONCE_LENGTH + sealed.size))
          output.write(nonce)
          output.write(sealed)
          index += 1
        } while (remaining > 0)
      }
    }
  }

  fun openArchive(source: File, destination: File, password: String) {
    val damaged = CodedException("ERR_ARCHIVE", "This backup is damaged", null)
    val size = source.length()
    val headerLength = ARCHIVE_MAGIC.size + SALT_LENGTH + 4
    if (size < headerLength) {
      throw CodedException("ERR_ARCHIVE", "This file is not an encrypted eDoc backup", null)
    }
    destination.parentFile?.mkdirs()
    DataInputStream(FileInputStream(source).buffered()).use { input ->
      val magic = ByteArray(ARCHIVE_MAGIC.size).also { input.readFully(it) }
      if (!magic.contentEquals(ARCHIVE_MAGIC)) {
        throw CodedException("ERR_ARCHIVE", "This file is not an encrypted eDoc backup", null)
      }
      val salt = ByteArray(SALT_LENGTH).also { input.readFully(it) }
      val iterations = input.readInt()
      if (iterations < 10_000 || iterations > 20_000_000) {
        throw damaged
      }
      val key = passwordKey(password, salt, iterations)

      FileOutputStream(destination).buffered().use { output ->
        var offset = headerLength.toLong()
        var index = 0L
        var finished = false
        while (!finished) {
          if (offset + 4 > size) {
            throw damaged
          }
          val length = input.readInt()
          if (length < CHUNK_OVERHEAD || length > CHUNK_SIZE + CHUNK_OVERHEAD || offset + 4 + length > size) {
            throw damaged
          }
          val combined = ByteArray(length).also { input.readFully(it) }
          offset += 4 + length
          val isFinal = offset == size
          val plain = try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, combined, 0, NONCE_LENGTH))
            cipher.updateAAD(chunkTag(index, isFinal))
            cipher.doFinal(combined, NONCE_LENGTH, combined.size - NONCE_LENGTH)
          } catch (error: Exception) {
            // The first chunk failing means the key is wrong; later ones mean corruption.
            throw if (index == 0L) CodedException("ERR_PASSWORD", "Wrong password", null) else damaged
          }
          output.write(plain)
          index += 1
          finished = isFinal
        }
      }
    }
  }
}
