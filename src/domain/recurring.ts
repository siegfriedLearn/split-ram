import type { RecurringFrequency, RecurringRule } from '../db/types'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * Avanza una fecha según la frecuencia. Para mensual/anual el día se ancla al
 * día original (dayAnchor) y se recorta al último día del mes cuando no existe
 * (p. ej. 31 de enero → 28 de febrero → 31 de marzo).
 */
export function advanceDate(
  dateISO: string,
  frequency: RecurringFrequency,
  dayAnchor?: number,
): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const anchor = dayAnchor ?? d
  if (frequency === 'weekly') {
    const next = new Date(y, m - 1, d + 7)
    return toISO(next.getFullYear(), next.getMonth() + 1, next.getDate())
  }
  if (frequency === 'monthly') {
    let ny = y
    let nm = m + 1
    if (nm > 12) {
      nm = 1
      ny++
    }
    return toISO(ny, nm, Math.min(anchor, daysInMonth(ny, nm)))
  }
  return toISO(y + 1, m, Math.min(anchor, daysInMonth(y + 1, m)))
}

/** Fechas pendientes de materializar para una regla (todas las <= hoy). */
export function dueOccurrences(rule: RecurringRule, todayISO: string): string[] {
  if (!rule.active || rule.deletedAt) return []
  const dates: string[] = []
  let next = rule.nextDate
  const anchor = rule.dayAnchor || Number(rule.nextDate.split('-')[2])
  // Tope de seguridad para no entrar en bucle con datos corruptos
  for (let i = 0; i < 400 && next <= todayISO; i++) {
    if (rule.endDate && next > rule.endDate) break
    dates.push(next)
    next = advanceDate(next, rule.frequency, anchor)
  }
  return dates
}
