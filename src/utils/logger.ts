/**
 * Registro de diagnóstico en memoria + localStorage (últimas 300 entradas).
 * Visible en Ajustes → Diagnóstico y en la consola del navegador.
 */
const KEY = 'ramsplit-debug-log'
const MAX = 300

function safeJson(data: unknown): string {
  try {
    return typeof data === 'string' ? data : JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export function logDebug(scope: string, message: string, data?: unknown): void {
  const time = new Date().toISOString().slice(11, 19)
  const entry = `${time} [${scope}] ${message}${data !== undefined ? ` · ${safeJson(data)}` : ''}`
  console.log('[RamSplit]', entry)
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]
    arr.push(entry)
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX)))
  } catch {
    // sin espacio o localStorage no disponible: queda solo en consola
  }
}

export function getDebugLog(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function clearDebugLog(): void {
  localStorage.removeItem(KEY)
}
