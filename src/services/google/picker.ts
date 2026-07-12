import { GOOGLE_API_KEY, googleProjectNumber } from './config'
import { logDebug } from '../../utils/logger'

/**
 * Selector de archivos de Google (Picker). Bajo el scope `drive.file`, elegir un
 * archivo aquí es lo que le otorga a la app acceso a esa hoja compartida.
 * Tipos mínimos locales para no chocar con la declaración global de auth.ts.
 */

interface PickerNamespace {
  picker: {
    DocsView: new (viewId?: string) => {
      setIncludeFolders(v: boolean): unknown
      setSelectFolderEnabled(v: boolean): unknown
      setMimeTypes(v: string): unknown
      setMode(mode: string): unknown
    }
    PickerBuilder: new () => PickerBuilder
    ViewId: { SPREADSHEETS: string; FOLDERS: string; DOCS: string }
    DocsViewMode: { LIST: string }
    Feature: { MINE_ONLY: string }
    Action: { PICKED: string; CANCEL: string }
  }
}

interface PickerBuilder {
  addView(view: unknown): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setAppId(appId: string): PickerBuilder
  setLocale(locale: string): PickerBuilder
  setTitle(title: string): PickerBuilder
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder
  build(): { setVisible(v: boolean): void }
}

interface PickerResponse {
  action: string
  docs?: Array<{ id: string; name?: string }>
}

interface PickerWindow {
  gapi?: { load(api: string, cb: () => void): void }
  google?: Partial<PickerNamespace>
}

let pickerReady: Promise<void> | null = null

function loadPickerApi(): Promise<void> {
  const w = window as unknown as PickerWindow
  if (w.google?.picker) return Promise.resolve()
  if (!pickerReady) {
    pickerReady = new Promise((resolve, reject) => {
      const done = () => {
        const win = window as unknown as PickerWindow
        if (!win.gapi) {
          reject(new Error('No se pudo cargar el selector de Google'))
          return
        }
        win.gapi.load('picker', () => resolve())
      }
      if (w.gapi) {
        done()
        return
      }
      const script = document.createElement('script')
      script.src = 'https://apis.google.com/js/api.js'
      script.async = true
      script.onload = done
      script.onerror = () => {
        pickerReady = null
        reject(new Error('No se pudo cargar el selector de Google (¿sin conexión?)'))
      }
      document.head.appendChild(script)
    })
  }
  return pickerReady
}

/**
 * Selector para vincular un grupo: dos pestañas — CARPETAS (ideal: da acceso a
 * hoja + recibos + portada) y hojas de cálculo (compatibilidad con grupos
 * compartidos antes de las carpetas). `joinGroup` acepta ambos tipos de id.
 */
export async function pickGroupSource(token: string): Promise<string | null> {
  if (!GOOGLE_API_KEY) {
    throw new Error('Falta configurar VITE_GOOGLE_API_KEY (ver README → Publicar tu propia instancia)')
  }
  const appId = googleProjectNumber()
  if (!appId) throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID')
  await loadPickerApi()
  const g = (window as unknown as { google: PickerNamespace }).google
  logDebug('picker', 'abriendo selector de carpeta/hoja del grupo')

  const folders = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
  folders.setSelectFolderEnabled(true)
  folders.setMimeTypes('application/vnd.google-apps.folder')
  folders.setMode(g.picker.DocsViewMode.LIST)

  const sheets = new g.picker.DocsView(g.picker.ViewId.SPREADSHEETS)
  sheets.setIncludeFolders(false)
  sheets.setMode(g.picker.DocsViewMode.LIST)

  return new Promise((resolve) => {
    const picker = new g.picker.PickerBuilder()
      .addView(folders)
      .addView(sheets)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY!)
      .setAppId(appId)
      .setLocale('es')
      .setTitle('Elige la carpeta del grupo compartido')
      .setCallback((data) => {
        if (data.action === g.picker.Action.PICKED) {
          const id = data.docs?.[0]?.id ?? null
          logDebug('picker', `elegido: ${id}`)
          resolve(id)
        } else if (data.action === g.picker.Action.CANCEL) {
          logDebug('picker', 'selector cancelado')
          resolve(null)
        }
      })
      .build()
    picker.setVisible(true)
  })
}
