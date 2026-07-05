import { db } from '../../db/db'
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config'
import { logDebug } from '../../utils/logger'

/** Autenticación con Google Identity Services (token model), 100% en el navegador. */

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: { type: string; message?: string }) => void
          }): TokenClient
          revoke(token: string, callback?: () => void): void
        }
      }
    }
  }
}

/** Se lanza cuando una operación en segundo plano necesita que el usuario reconecte. */
export class NeedsAuthError extends Error {
  constructor() {
    super('Conecta tu cuenta Google para sincronizar')
    this.name = 'NeedsAuthError'
  }
}

const STORAGE_KEY = 'ramsplit-gtoken'

interface CachedToken {
  token: string
  expiresAt: number
}

let cached: CachedToken | null = null

// localStorage (no sessionStorage): el token debe sobrevivir a cerrar la pestaña,
// especialmente en el celular donde cada apertura es una "sesión" nueva.
function readCache(): CachedToken | null {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) cached = JSON.parse(raw) as CachedToken
  } catch {
    cached = null
  }
  return cached
}

function writeCache(value: CachedToken | null) {
  cached = value
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // sin localStorage (modo privado estricto): solo caché en memoria
  }
}

export function hasValidToken(): boolean {
  const c = readCache()
  return Boolean(c && c.expiresAt - 60_000 > Date.now())
}

let gisPromise: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        gisPromise = null
        reject(new Error('No se pudo cargar Google Identity (¿sin conexión?)'))
      }
      document.head.appendChild(script)
    })
  }
  return gisPromise
}

/**
 * Token de acceso. `interactive: false` nunca abre popup: si no hay token
 * vigente lanza NeedsAuthError (el sync en segundo plano se salta en silencio).
 */
export async function getAccessToken(interactive: boolean): Promise<string> {
  const c = readCache()
  if (c && c.expiresAt - 60_000 > Date.now()) return c.token
  if (!interactive) throw new NeedsAuthError()
  const clientId = GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID (ver README → Grupos compartidos)')
  }
  logDebug('auth', `pidiendo token · origin=${location.origin}`)
  await loadGis()
  logDebug('auth', 'script GIS cargado, abriendo popup de Google')
  return new Promise<string>((resolve, reject) => {
    // Sin timeout el botón se queda "cargando" para siempre si el popup
    // fue bloqueado o Google nunca responde.
    const timer = setTimeout(() => {
      logDebug('auth', 'TIMEOUT: Google no respondió en 90 s (¿popup bloqueado o cerrado?)')
      reject(
        new Error(
          'Google no respondió. Revisa si el navegador bloqueó el popup (ícono en la barra de direcciones), permítelo y reintenta.',
        ),
      )
    }, 90_000)
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: (response) => {
        clearTimeout(timer)
        if (response.error || !response.access_token) {
          logDebug('auth', 'respuesta con error', {
            error: response.error,
            desc: response.error_description,
          })
          reject(new Error(response.error_description ?? response.error ?? 'Autorización cancelada'))
          return
        }
        logDebug('auth', `token recibido, expira en ${response.expires_in ?? 3600}s`)
        writeCache({
          token: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
        })
        resolve(response.access_token)
      },
      error_callback: (error) => {
        clearTimeout(timer)
        logDebug('auth', 'error_callback de GIS', { type: error.type, message: error.message })
        const hint =
          error.type === 'popup_failed_to_open'
            ? 'El navegador bloqueó el popup de Google: permítelo desde la barra de direcciones y reintenta.'
            : error.type === 'popup_closed'
              ? 'Cerraste la ventana de Google antes de autorizar.'
              : (error.message ?? `Autorización fallida (${error.type})`)
        reject(new Error(hint))
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

/** Conecta la cuenta: pide token y guarda el email en Ajustes. Devuelve el email. */
export async function connectGoogle(): Promise<string> {
  const token = await getAccessToken(true)
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    logDebug('auth', `userinfo falló · status=${res.status}`)
    throw new Error('No se pudo leer la cuenta de Google')
  }
  const info = (await res.json()) as { email?: string }
  const email = info.email ?? ''
  logDebug('auth', `conectado como ${email}`)
  await db.settings.update('app', { googleEmail: email })
  // Guarda el email en mi persona "yo" si no lo tiene: permite que otros
  // dispositivos y grupos me reconozcan por correo automáticamente.
  const settings = await db.settings.get('app')
  if (email && settings?.mePersonId) {
    const me = await db.persons.get(settings.mePersonId)
    if (me && !me.email) await db.persons.update(me.id, { email })
  }
  return email
}

export async function disconnectGoogle(): Promise<void> {
  const c = readCache()
  if (c && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(c.token)
  }
  writeCache(null)
  await db.settings.update('app', { googleEmail: null })
}
