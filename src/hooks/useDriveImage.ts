import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { drivePublicImageUrl, getImageUrl } from '../services/sync/assets'

/** Posición de scroll de la ventana (para encabezados que se colapsan). */
export function useScrollY(): number {
  const [y, setY] = useState(typeof window !== 'undefined' ? window.scrollY : 0)
  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setY(window.scrollY))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])
  return y
}

/**
 * URL de imagen: primero la copia local (tabla receipts), luego la caché de
 * Drive. Con `publicFallback` (portadas, que son públicas por link) usa la URL
 * pública de Drive cuando no hay copia local/caché — así la ven todos los
 * miembros. null si no hay nada que mostrar.
 */
export function useDriveImage(
  localId?: string | null,
  driveId?: string | null,
  publicFallback = false,
): string | null {
  const [url, setUrl] = useState<string | null>(
    publicFallback && driveId && !localId ? drivePublicImageUrl(driveId) : null,
  )
  useEffect(() => {
    let revoked = false
    let objUrl: string | null = null
    setUrl(publicFallback && driveId && !localId ? drivePublicImageUrl(driveId) : null)
    void (async () => {
      let u: string | null = null
      if (localId) {
        const r = await db.receipts.get(localId)
        if (r) u = URL.createObjectURL(r.blob)
      } else if (driveId) {
        u = await getImageUrl(driveId) // caché local; null si no está
      }
      if (!u) return // se mantiene el fallback público (o null)
      if (revoked) {
        URL.revokeObjectURL(u)
        return
      }
      objUrl = u
      setUrl(u)
    })()
    return () => {
      revoked = true
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [localId, driveId, publicFallback])
  return url
}
