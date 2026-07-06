import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { getImageUrl } from '../services/sync/assets'

/**
 * Devuelve un object URL para una imagen: primero la copia local (tabla
 * receipts) si existe, si no la baja de Drive (cacheada). null mientras carga
 * o si no hay acceso.
 */
export function useDriveImage(localId?: string | null, driveId?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked = false
    let objUrl: string | null = null
    setUrl(null)
    void (async () => {
      let u: string | null = null
      if (localId) {
        const r = await db.receipts.get(localId)
        if (r) u = URL.createObjectURL(r.blob)
      } else if (driveId) {
        u = await getImageUrl(driveId)
      }
      if (revoked) {
        if (u) URL.revokeObjectURL(u)
        return
      }
      objUrl = u
      setUrl(u)
    })()
    return () => {
      revoked = true
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [localId, driveId])
  return url
}
