import type { Expense, Settlement, UUID } from '../db/types'

/** Convierte centavos de la moneda del gasto a centavos de la moneda base con la tasa congelada. */
export function toBaseCents(amountCents: number, fxRateToBase: number): number {
  return Math.round(amountCents * fxRateToBase)
}

/**
 * Balance neto por persona en centavos de moneda base.
 * Positivo = le deben dinero (acreedor). Negativo = debe dinero (deudor).
 */
export function computeNetBalances(
  expenses: Expense[],
  settlements: Settlement[],
): Map<UUID, number> {
  const balances = new Map<UUID, number>()
  const add = (personId: UUID, delta: number) => {
    balances.set(personId, (balances.get(personId) ?? 0) + delta)
  }

  for (const e of expenses) {
    for (const p of e.paidBy) add(p.personId, toBaseCents(p.amountCents, e.fxRateToBase))
    for (const s of e.splits) add(s.personId, -toBaseCents(s.amountCents, e.fxRateToBase))
  }
  // Un pago de A a B reduce la deuda de A y lo que le deben a B
  for (const s of settlements) {
    const base = toBaseCents(s.amountCents, s.fxRateToBase)
    add(s.fromPersonId, base)
    add(s.toPersonId, -base)
  }
  return balances
}
