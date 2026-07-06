import { db } from '../db/db'
import { logDebug } from '../utils/logger'

/**
 * Notificaciones del sistema cuando la sincronización trae cambios de otros
 * miembros. Funcionan con la app abierta o en segundo plano (el sondeo corre
 * cada 60 s); con la app totalmente cerrada no hay push (no tenemos servidor).
 */

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined'
}

/** Pide permiso (requiere gesto del usuario) y activa la preferencia. */
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false
  const permission = await Notification.requestPermission()
  const granted = permission === 'granted'
  await db.settings.update('app', { notifyChanges: granted })
  logDebug('notif', granted ? 'notificaciones activadas' : `permiso: ${permission}`)
  return granted
}

export async function disableNotifications(): Promise<void> {
  await db.settings.update('app', { notifyChanges: false })
}

/** Muestra una notificación de cambios en un grupo (solo con la app oculta). */
export async function notifyGroupChanges(groupName: string, summary: string): Promise<void> {
  try {
    const settings = await db.settings.get('app')
    if (!settings?.notifyChanges) return
    if (!notificationsSupported() || Notification.permission !== 'granted') return
    // con la app visible el cambio ya se ve en pantalla; no hace falta avisar
    if (document.visibilityState === 'visible') return

    const title = `Ram Split · ${groupName}`
    const options: NotificationOptions = { body: summary, icon: '/pwa-192.png', tag: `ramsplit-${groupName}` }
    // vía service worker si existe (necesario en PWA Android); si no, directo
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg?.showNotification) reg.showNotification(title, options)
    else new Notification(title, options)
    logDebug('notif', `notificado: ${summary}`)
  } catch (e) {
    logDebug('notif', 'error al notificar', e instanceof Error ? e.message : e)
  }
}
