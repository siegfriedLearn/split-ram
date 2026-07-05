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
