import { describe, expect, it } from 'vitest'
import { computeNetBalances, toBaseCents } from './balances'
import type { Expense, Settlement } from '../db/types'

const [A, B, C] = ['ana', 'beto', 'carla']

function expense(partial: Partial<Expense>): Expense {
  return {
    id: 'e1',
    createdAt: '',
    updatedAt: '',
    groupId: null,
    description: 'test',
    amountCents: 0,
    currency: 'COP',
    fxRateToBase: 1,
    date: '2026-07-01',
    categoryId: 'cat',
    paidBy: [],
    splits: [],
    splitMethod: 'equal',
    ...partial,
  }
}

describe('computeNetBalances', () => {
  it('acredita al pagador y debita a los participantes', () => {
    const e = expense({
      amountCents: 9000,
      paidBy: [{ personId: A, amountCents: 9000 }],
      splits: [
        { personId: A, amountCents: 3000 },
        { personId: B, amountCents: 3000 },
        { personId: C, amountCents: 3000 },
      ],
    })
    const balances = computeNetBalances([e], [])
    expect(balances.get(A)).toBe(6000)
    expect(balances.get(B)).toBe(-3000)
    expect(balances.get(C)).toBe(-3000)
  })

  it('los balances netos siempre suman cero', () => {
    const e1 = expense({
      amountCents: 10001,
      paidBy: [
        { personId: A, amountCents: 5001 },
        { personId: B, amountCents: 5000 },
      ],
      splits: [
        { personId: A, amountCents: 3334 },
        { personId: B, amountCents: 3334 },
        { personId: C, amountCents: 3333 },
      ],
    })
    const balances = computeNetBalances([e1], [])
    const total = [...balances.values()].reduce((s, v) => s + v, 0)
    expect(total).toBe(0)
  })

  it('un pago reduce la deuda', () => {
    const e = expense({
      amountCents: 6000,
      paidBy: [{ personId: A, amountCents: 6000 }],
      splits: [
        { personId: A, amountCents: 3000 },
        { personId: B, amountCents: 3000 },
      ],
    })
    const pago: Settlement = {
      id: 's1',
      createdAt: '',
      updatedAt: '',
      groupId: null,
      fromPersonId: B,
      toPersonId: A,
      amountCents: 3000,
      currency: 'COP',
      fxRateToBase: 1,
      date: '2026-07-02',
    }
    const balances = computeNetBalances([e], [pago])
    expect(balances.get(A)).toBe(0)
    expect(balances.get(B)).toBe(0)
  })

  it('convierte a moneda base con la tasa congelada', () => {
    expect(toBaseCents(1000, 4000)).toBe(4000000) // 10 USD a 4000 COP/USD
    const e = expense({
      amountCents: 1000,
      currency: 'USD',
      fxRateToBase: 4000,
      paidBy: [{ personId: A, amountCents: 1000 }],
      splits: [
        { personId: A, amountCents: 500 },
        { personId: B, amountCents: 500 },
      ],
    })
    const balances = computeNetBalances([e], [])
    expect(balances.get(B)).toBe(-2000000)
  })
})
