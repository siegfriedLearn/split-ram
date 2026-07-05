import { db, newEntity, touched } from '../db/db'
import type { Expense } from '../db/types'
import { advanceDate, dueOccurrences } from '../domain/recurring'
import { todayISO } from '../utils/id'

let inFlight: Promise<number> | null = null

/**
 * Materializa los gastos recurrentes vencidos (idempotente; segura ante el
 * doble montaje de StrictMode gracias al candado en memoria + transacción).
 * Devuelve cuántos gastos se crearon.
 */
export function materializeRecurring(): Promise<number> {
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function run(): Promise<number> {
  const today = todayISO()
  return db.transaction('rw', [db.recurringRules, db.expenses], async () => {
    const rules = await db.recurringRules.toArray()
    let created = 0
    for (const rule of rules) {
      const due = dueOccurrences(rule, today)
      if (due.length === 0) continue
      for (const date of due) {
        const expense: Expense = {
          ...newEntity(),
          ...rule.template,
          date,
          recurringRuleId: rule.id,
        }
        await db.expenses.add(expense)
        created++
      }
      let next = due[due.length - 1]
      next = advanceDate(next, rule.frequency, rule.dayAnchor)
      await db.recurringRules.update(rule.id, { nextDate: next, ...touched() })
    }
    return created
  })
}
