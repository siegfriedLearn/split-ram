import type { UUID } from '../db/types'

export interface Transfer {
  from: UUID
  to: UUID
  amountCents: number
}

/**
 * Simplificación de deudas (min cash flow, greedy): empareja al mayor deudor
 * con el mayor acreedor hasta saldar todos los balances.
 * Preserva los balances netos y produce a lo sumo n-1 transferencias.
 */
export function simplifyDebts(balances: Map<UUID, number>): Transfer[] {
  const creditors: Array<{ id: UUID; amount: number }> = []
  const debtors: Array<{ id: UUID; amount: number }> = []
  for (const [id, amount] of balances) {
    if (amount > 0) creditors.push({ id, amount })
    else if (amount < 0) debtors.push({ id, amount: -amount })
  }
  creditors.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))
  debtors.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))

  const transfers: Transfer[] = []
  let ci = 0
  let di = 0
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci]
    const d = debtors[di]
    const amount = Math.min(c.amount, d.amount)
    if (amount > 0) {
      transfers.push({ from: d.id, to: c.id, amountCents: amount })
    }
    c.amount -= amount
    d.amount -= amount
    if (c.amount === 0) ci++
    if (d.amount === 0) di++
  }
  return transfers
}
