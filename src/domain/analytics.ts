import type { Expense, UUID } from '../db/types'
import { toBaseCents } from './balances'

/** 'total' = todo lo pagado del gasto; 'mine' = solo mi parte (finanzas personales). */
export type Perspective = 'total' | 'mine'

export function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7)
}

/** Monto del gasto en centavos de moneda base según la perspectiva. */
export function expenseAmountBase(e: Expense, perspective: Perspective, meId: UUID | null): number {
  if (perspective === 'total') return toBaseCents(e.amountCents, e.fxRateToBase)
  if (!meId) return 0
  const mine = e.splits.find((s) => s.personId === meId)
  return mine ? toBaseCents(mine.amountCents, e.fxRateToBase) : 0
}

export function sumByCategory(
  expenses: Expense[],
  perspective: Perspective,
  meId: UUID | null,
): Map<UUID, number> {
  const acc = new Map<UUID, number>()
  for (const e of expenses) {
    const amount = expenseAmountBase(e, perspective, meId)
    if (amount === 0) continue
    acc.set(e.categoryId, (acc.get(e.categoryId) ?? 0) + amount)
  }
  return acc
}

export function sumByMonth(
  expenses: Expense[],
  perspective: Perspective,
  meId: UUID | null,
): Map<string, number> {
  const acc = new Map<string, number>()
  for (const e of expenses) {
    const amount = expenseAmountBase(e, perspective, meId)
    const key = monthKey(e.date)
    acc.set(key, (acc.get(key) ?? 0) + amount)
  }
  return acc
}

export function sumByMonthAndCategory(
  expenses: Expense[],
  perspective: Perspective,
  meId: UUID | null,
): Map<string, Map<UUID, number>> {
  const acc = new Map<string, Map<UUID, number>>()
  for (const e of expenses) {
    const amount = expenseAmountBase(e, perspective, meId)
    if (amount === 0) continue
    const key = monthKey(e.date)
    let byCat = acc.get(key)
    if (!byCat) {
      byCat = new Map()
      acc.set(key, byCat)
    }
    byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + amount)
  }
  return acc
}

/** Lista continua de meses YYYY-MM entre dos claves inclusive. */
export function monthRange(fromKey: string, toKey: string): string[] {
  const [fy, fm] = fromKey.split('-').map(Number)
  const [ty, tm] = toKey.split('-').map(Number)
  const out: string[] = []
  let y = fy
  let m = fm
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export interface CategoryInsight {
  topCategoryId: UUID | null
  topAmount: number
  topFraction: number
  momChangeFraction: number | null
}

/** Insight del mes: categoría más fuerte y su variación vs. el mes anterior. */
export function computeMonthInsight(
  expenses: Expense[],
  currentMonth: string,
  previousMonth: string,
  perspective: Perspective,
  meId: UUID | null,
): CategoryInsight {
  const current = expenses.filter((e) => monthKey(e.date) === currentMonth)
  const byCat = sumByCategory(current, perspective, meId)
  let topCategoryId: UUID | null = null
  let topAmount = 0
  let total = 0
  for (const [cat, amount] of byCat) {
    total += amount
    if (amount > topAmount) {
      topAmount = amount
      topCategoryId = cat
    }
  }
  let momChangeFraction: number | null = null
  if (topCategoryId) {
    const prev = expenses.filter((e) => monthKey(e.date) === previousMonth)
    const prevAmount = sumByCategory(prev, perspective, meId).get(topCategoryId) ?? 0
    momChangeFraction = prevAmount > 0 ? (topAmount - prevAmount) / prevAmount : null
  }
  return {
    topCategoryId,
    topAmount,
    topFraction: total > 0 ? topAmount / total : 0,
    momChangeFraction,
  }
}
