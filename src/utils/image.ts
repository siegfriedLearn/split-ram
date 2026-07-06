/**
 * Comprime una imagen a JPEG reescalando al lado máximo dado. Reduce el peso
 * antes de subir a Drive (recibos y portadas). Si algo falla, devuelve el original.
 */
export async function compressImage(
  file: Blob,
  maxSide = 1280,
  quality = 0.7,
): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
