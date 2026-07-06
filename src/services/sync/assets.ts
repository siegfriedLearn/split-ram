import { db } from '../../db/db'
import { getAccessToken } from '../google/auth'
import { downloadFile, uploadToFolder } from '../google/sheets'
import { compressImage } from '../../utils/image'
import { nowISO } from '../../utils/id'
import { logDebug } from '../../utils/logger'

/**
 * Imágenes (recibos y portadas de grupo) compartidas vía la carpeta del grupo
 * en Drive. Se cachean localmente en `driveBlobs` para no rebajarlas cada vez.
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

/** Devuelve un object URL de una imagen de Drive, bajándola y cacheándola si hace falta. */
export async function getImageUrl(driveId: string, interactive = false): Promise<string | null> {
  const cached = await db.driveBlobs.get(driveId)
  if (cached) return URL.createObjectURL(cached.blob)
  try {
    const token = await getAccessToken(interactive)
    const { blob, mimeType } = await downloadFile(driveId, token)
    await db.driveBlobs.put({ id: driveId, blob, mimeType, fetchedAt: nowISO() })
    return URL.createObjectURL(blob)
  } catch (e) {
    logDebug('assets', `no se pudo bajar ${driveId}`, e instanceof Error ? e.message : e)
    return null
  }
}
