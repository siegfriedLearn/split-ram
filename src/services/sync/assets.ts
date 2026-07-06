import { db } from '../../db/db'
import { getAccessToken } from '../google/auth'
import { uploadToFolder } from '../google/sheets'
import { compressImage } from '../../utils/image'
import { nowISO } from '../../utils/id'

/**
 * Imágenes (recibos y portadas de grupo) en la carpeta del grupo en Drive.
 * Bajo el permiso `drive.file`, la app solo puede leer por API las imágenes que
 * ella misma subió (quedan en caché local). Para las que subió otro miembro,
 * el acceso es vía el link de Drive (el miembro tiene permiso sobre la carpeta).
 */

/** Sube una imagen (comprimida) a la carpeta del grupo. Devuelve su id de Drive. */
export async function uploadImage(folderId: string, file: Blob, name: string): Promise<string> {
  const token = await getAccessToken(true)
  const compressed = await compressImage(file)
  const id = await uploadToFolder(folderId, compressed, name, token)
  // guarda la copia local ya subida para verla al instante
  await db.driveBlobs.put({ id, blob: compressed, mimeType: compressed.type, fetchedAt: nowISO() })
  return id
}

/** Object URL desde la caché local (sin llamar a la API). null si no está cacheada. */
export async function getImageUrl(driveId: string): Promise<string | null> {
  const cached = await db.driveBlobs.get(driveId)
  return cached ? URL.createObjectURL(cached.blob) : null
}

/** Link para abrir un archivo directamente en Google Drive (usa la sesión del usuario). */
export function driveViewUrl(driveId: string): string {
  return `https://drive.google.com/file/d/${driveId}/view`
}

/** URL de imagen para archivos públicos por link (portadas). Sirve en <img>. */
export function drivePublicImageUrl(driveId: string): string {
  return `https://lh3.googleusercontent.com/d/${driveId}=w1000`
}
