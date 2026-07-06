/** Cliente mínimo de Google Sheets + Drive por REST (fetch), sin SDKs. */

import { logDebug } from '../../utils/logger'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'

async function gfetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET'
  const shortUrl = url.replace(/https:\/\/[^/]+/, '').slice(0, 90)
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    let message = `Error ${res.status} de Google`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // sin cuerpo JSON: se queda el mensaje genérico
    }
    logDebug('api', `${method} ${shortUrl} → ${res.status}`, message)
    if (res.status === 401) message = 'La sesión de Google expiró; reconecta tu cuenta'
    if (res.status === 403) message = `Sin permiso sobre la hoja compartida (${message})`
    if (res.status === 404) message = 'No se encontró la hoja compartida (¿te la compartieron?)'
    throw new Error(message)
  }
  logDebug('api', `${method} ${shortUrl} → ${res.status}`)
  return (await res.json()) as T
}

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
}

export async function createSpreadsheet(
  title: string,
  tabs: readonly string[],
  token: string,
): Promise<string> {
  const body = {
    properties: { title },
    sheets: tabs.map((t) => ({ properties: { title: t } })),
  }
  const res = await gfetch<{ spreadsheetId: string }>(SHEETS_API, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.spreadsheetId
}

/**
 * Busca (o crea) una carpeta por nombre dentro de `parentId` (o la raíz del
 * Drive si es null). Devuelve el id de la carpeta. Bajo `drive.file` solo
 * encuentra carpetas creadas por la propia app, así que es idempotente.
 */
export async function ensureFolder(
  name: string,
  parentId: string | null,
  token: string,
): Promise<string> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : ''
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false${parentClause}`
  const found = await gfetch<{ files?: Array<{ id: string }> }>(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    token,
  )
  if (found.files && found.files.length > 0) return found.files[0].id
  const created = await gfetch<{ id: string }>(`${DRIVE_API}/files`, token, {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  })
  return created.id
}

/** Mueve una hoja a una carpeta y la marca como grupo de Ram Split (appProperties). */
export async function fileIntoFolder(
  fileId: string,
  folderId: string,
  token: string,
): Promise<void> {
  await gfetch(
    `${DRIVE_API}/files/${fileId}?addParents=${folderId}&removeParents=root&fields=id`,
    token,
    { method: 'PATCH', body: JSON.stringify({ appProperties: { ramsplit: 'group' } }) },
  )
}

/** Lista las hojas de Ram Split accesibles por la cuenta (creadas o autorizadas). */
export async function listRamSplitSpreadsheets(
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const q =
    "appProperties has { key='ramsplit' and value='group' } and trashed=false and mimeType='application/vnd.google-apps.spreadsheet'"
  const res = await gfetch<{ files?: Array<{ id: string; name: string }> }>(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=100`,
    token,
  )
  return res.files ?? []
}

/** Lee todas las pestañas pedidas de una vez. Devuelve filas por pestaña (puede ser []). */
export async function batchGetTabs(
  spreadsheetId: string,
  tabs: readonly string[],
  token: string,
): Promise<Record<string, string[][]>> {
  const query = tabs.map((t) => `ranges=${encodeURIComponent(t)}`).join('&')
  const res = await gfetch<{ valueRanges?: Array<{ values?: string[][] }> }>(
    `${SHEETS_API}/${spreadsheetId}/values:batchGet?${query}&majorDimension=ROWS`,
    token,
  )
  const out: Record<string, string[][]> = {}
  tabs.forEach((tab, i) => {
    out[tab] = res.valueRanges?.[i]?.values ?? []
  })
  return out
}

/** Reemplaza el contenido completo de una pestaña (limpiar + escribir). */
export async function overwriteTab(
  spreadsheetId: string,
  tab: string,
  rows: string[][],
  token: string,
): Promise<void> {
  await gfetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}:clear`, token, {
    method: 'POST',
    body: '{}',
  })
  if (rows.length === 0) return
  await gfetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
    token,
    { method: 'PUT', body: JSON.stringify({ values: rows }) },
  )
}

export interface ShareResult {
  shared: string[]
  failed: Array<{ email: string; error: string }>
}

/** Lista las hojas de Ram Split que son hijas de una carpeta (para unirse por carpeta). */
export async function listFolderSheets(
  folderId: string,
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const q = `'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.spreadsheet'`
  const res = await gfetch<{ files?: Array<{ id: string; name: string }> }>(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
    token,
  )
  return res.files ?? []
}

/** Sube un archivo (imagen) a una carpeta con multipart. Devuelve su id en Drive. */
export async function uploadToFolder(
  folderId: string,
  blob: Blob,
  name: string,
  token: string,
): Promise<string> {
  const boundary = `ramsplit${Math.random().toString(36).slice(2)}`
  const metadata = {
    name,
    parents: [folderId],
    appProperties: { ramsplit: 'asset' },
  }
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ])
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  if (!res.ok) {
    logDebug('api', `upload → ${res.status}`)
    throw new Error(res.status === 401 ? 'La sesión de Google expiró' : 'No se pudo subir la imagen')
  }
  const data = (await res.json()) as { id: string }
  logDebug('api', `imagen subida a Drive: ${data.id}`)
  return data.id
}

/** Sobrescribe el contenido de un archivo existente en Drive (upload media). */
export async function updateFileContent(fileId: string, blob: Blob, token: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': blob.type || 'application/octet-stream',
      },
      body: blob,
    },
  )
  if (!res.ok) {
    logDebug('api', `update file ${fileId} → ${res.status}`)
    throw new Error(res.status === 401 ? 'La sesión de Google expiró' : 'No se pudo actualizar el respaldo')
  }
}

/** Hace un archivo visible por link ("cualquiera con el enlace, lector"). */
export async function makeFilePublic(fileId: string, token: string): Promise<void> {
  await gfetch(`${DRIVE_API}/files/${fileId}/permissions`, token, {
    method: 'POST',
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}

/** Descarga un archivo de Drive por id. Devuelve el Blob y su tipo. */
export async function downloadFile(
  fileId: string,
  token: string,
): Promise<{ blob: Blob; mimeType: string }> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    logDebug('api', `download ${fileId} → ${res.status}`)
    throw new Error(res.status === 403 || res.status === 404 ? 'Sin acceso a la imagen' : 'No se pudo bajar la imagen')
  }
  const blob = await res.blob()
  return { blob, mimeType: blob.type || 'image/jpeg' }
}

/** Comparte la hoja como editor con cada email; Google envía el correo de invitación. */
export async function shareWithEmails(
  fileId: string,
  emails: string[],
  token: string,
): Promise<ShareResult> {
  const result: ShareResult = { shared: [], failed: [] }
  for (const email of emails) {
    try {
      await gfetch(
        `${DRIVE_API}/files/${fileId}/permissions?sendNotificationEmail=true&emailMessage=${encodeURIComponent(
          'Te invitaron a un grupo de gastos compartidos en Ram Split',
        )}`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }),
        },
      )
      result.shared.push(email)
    } catch (e) {
      result.failed.push({ email, error: e instanceof Error ? e.message : 'error desconocido' })
    }
  }
  return result
}
