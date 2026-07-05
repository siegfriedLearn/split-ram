import type { ExpenseItem, MoneyShare, UUID } from '../db/types'

/**
 * Reparte `amountCents` proporcionalmente a los pesos, en centavos enteros.
 * Usa el método del mayor residuo: la suma de los resultados siempre es exacta.
 */
export function splitByWeights(
  amountCents: number,
  entries: Array<{ personId: UUID; weight: number }>,
): MoneyShare[] {
  const active = entries.filter((e) => e.weight > 0)
  const totalWeight = active.reduce((s, e) => s + e.weight, 0)
  if (active.length === 0 || totalWeight <= 0) {
    throw new Error('La división necesita al menos un participante con peso mayor a cero')
  }
  const raw = active.map((e) => (amountCents * e.weight) / totalWeight)
  const floored = raw.map(Math.floor)
  let remainder = amountCents - floored.reduce((s, v) => s + v, 0)
  // Asigna los centavos sobrantes a los mayores residuos (empates: orden de entrada)
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  const result = floored.slice()
  for (const { i } of order) {
    if (remainder <= 0) break
    result[i] += 1
    remainder -= 1
  }
  return active.map((e, i) => ({ personId: e.personId, amountCents: result[i] }))
}

export function splitEqual(amountCents: number, personIds: UUID[]): MoneyShare[] {
  return splitByWeights(
    amountCents,
    personIds.map((personId) => ({ personId, weight: 1 })),
  )
}

export function splitPercent(
  amountCents: number,
  entries: Array<{ personId: UUID; percent: number }>,
): MoneyShare[] {
  const total = entries.reduce((s, e) => s + e.percent, 0)
  if (Math.abs(total - 100) > 0.01) {
    throw new Error(`Los porcentajes deben sumar 100% (suman ${total.toFixed(2)}%)`)
  }
  return splitByWeights(
    amountCents,
    entries.map((e) => ({ personId: e.personId, weight: e.percent })),
  )
}

export function splitShares(
  amountCents: number,
  entries: Array<{ personId: UUID; shares: number }>,
): MoneyShare[] {
  return splitByWeights(
    amountCents,
    entries.map((e) => ({ personId: e.personId, weight: e.shares })),
  )
}

export function splitExact(
  amountCents: number,
  entries: Array<{ personId: UUID; amountCents: number }>,
): MoneyShare[] {
  const sum = entries.reduce((s, e) => s + e.amountCents, 0)
  if (sum !== amountCents) {
    throw new Error('Los montos exactos no suman el total del gasto')
  }
  return entries
    .filter((e) => e.amountCents !== 0)
    .map((e) => ({ personId: e.personId, amountCents: e.amountCents }))
}

/** División por ítems: cada ítem se reparte en partes iguales entre sus personas. */
export function splitItems(items: ExpenseItem[]): { total: number; splits: MoneyShare[] } {
  const acc = new Map<UUID, number>()
  let total = 0
  for (const item of items) {
    if (item.personIds.length === 0) {
      throw new Error(`El ítem "${item.name || 'sin nombre'}" no tiene personas asignadas`)
    }
    total += item.amountCents
    for (const share of splitEqual(item.amountCents, item.personIds)) {
      acc.set(share.personId, (acc.get(share.personId) ?? 0) + share.amountCents)
    }
  }
  const splits = [...acc.entries()].map(([personId, amountCents]) => ({ personId, amountCents }))
  return { total, splits }
}

/** Invariante central: la suma de las partes es exactamente el total. */
export function validateSplits(amountCents: number, splits: MoneyShare[]): boolean {
  return splits.reduce((s, e) => s + e.amountCents, 0) === amountCents
}
