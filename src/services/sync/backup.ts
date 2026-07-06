import { db } from '../../db/db'
import { getAccessToken, NeedsAuthError } from '../google/auth'
import { ensureFolder, updateFileContent, uploadToFolder } from '../google/sheets'
import { buildBackup } from '../../features/export/exporters'
import { nowISO } from '../../utils/id'
import { logDebug } from '../../utils/logger'

/**
 * Respaldo completo en Drive: TODA la info local (incluidos los gastos sin
 * grupo) en un único archivo JSON dentro de la carpeta "RAM Split". Es liviano
 * (sin imágenes) y se puede restaurar desde Ajustes → Importar JSON.
 */

const BACKUP_NAME = 'ram-split-backup.json'
let inFlight: Promise<boolean> | null = null

export function backupToDrive(interactive = false): Promise<boolean> {
  if (!inFlight) inFlight = run(interactive).finally(() => (inFlight = null))
  return inFlight
}

async function run(interactive: boolean): Promise<boolean> {
  const settings = await db.settings.get('app')
  // Sin cuenta conectada no hay dónde respaldar (el modo silencioso no molesta)
  if (!settings?.googleEmail && !interactive) return false
  try {
    const token = await getAccessToken(interactive)
    const backup = await buildBackup(false) // sin imágenes: respaldo liviano
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })

    let fileId = settings?.backupFileId ?? null
    if (fileId) {
      try {
        await updateFileContent(fileId, blob, token)
      } catch {
        fileId = null // el archivo pudo borrarse: se recrea abajo
      }
    }
    if (!fileId) {
      const folder = await ensureFolder('RAM Split', null, token)
      fileId = await uploadToFolder(folder, blob, BACKUP_NAME, token)
    }
    await db.settings.update('app', { backupFileId: fileId, lastBackupAt: nowISO() })
    logDebug('backup', 'respaldo actualizado en Drive')
    return true
  } catch (e) {
    if (e instanceof NeedsAuthError && !interactive) return false
    logDebug('backup', 'error al respaldar', e instanceof Error ? e.message : e)
    if (interactive) throw e
    return false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
/** Programa un respaldo tras un cambio local (agrupa ráfagas). */
export function scheduleBackup(): void {
  clearTimeout(debounce)
  debounce = setTimeout(() => void backupToDrive().catch(() => {}), 8000)
}
