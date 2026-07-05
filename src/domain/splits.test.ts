import { describe, expect, it } from 'vitest'
import {
  splitEqual,
  splitExact,
  splitItems,
  splitPercent,
  splitShares,
  validateSplits,
} from './splits'

const [A, B, C] = ['ana', 'beto', 'carla']

describe('splitEqual', () => {
  it('divide en partes iguales exactas', () => {
    const splits = splitEqual(9000, [A, B, C])
    expect(splits.map((s) => s.amountCents)).toEqual([3000, 3000, 3000])
  })

  it('reparte los centavos sobrantes sin perder ninguno', () => {
    const splits = splitEqual(10000, [A, B, C])
    expect(validateSplits(10000, splits)).toBe(true)
    const amounts = splits.map((s) => s.amountCents).sort()
    expect(amounts).toEqual([3333, 3333, 3334])
  })

  it('cuadra siempre para montos y tamaños arbitrarios', () => {
    for (let amount = 1; amount < 500; amount += 7) {
      for (let n = 1; n <= 6; n++) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`)
        expect(validateSplits(amount, splitEqual(amount, ids))).toBe(true)
      }
    }
  })

  it('falla sin participantes', () => {
    expect(() => splitEqual(1000, [])).toThrow()
  })
})

describe('splitPercent', () => {
  it('divide por porcentajes y cuadra centavos', () => {
    const splits = splitPercent(10001, [
      { personId: A, percent: 50 },
      { personId: B, percent: 30 },
      { personId: C, percent: 20 },
    ])
    expect(validateSplits(10001, splits)).toBe(true)
    expect(splits.find((s) => s.personId === A)!.amountCents).toBeGreaterThan(
      splits.find((s) => s.personId === B)!.amountCents,
    )
  })

  it('rechaza porcentajes que no suman 100', () => {
    expect(() =>
      splitPercent(1000, [
        { personId: A, percent: 60 },
        { personId: B, percent: 30 },
      ]),
    ).toThrow()
  })
})

describe('splitShares', () => {
  it('divide por partes (2:1) correctamente', () => {
    const splits = splitShares(9000, [
      { personId: A, shares: 2 },
      { personId: B, shares: 1 },
    ])
    expect(splits.find((s) => s.personId === A)!.amountCents).toBe(6000)
    expect(splits.find((s) => s.personId === B)!.amountCents).toBe(3000)
  })

  it('excluye a quien tiene 0 partes', () => {
    const splits = splitShares(1000, [
      { personId: A, shares: 1 },
      { personId: B, shares: 0 },
    ])
    expect(splits).toHaveLength(1)
    expect(splits[0].personId).toBe(A)
  })
})

describe('splitExact', () => {
  it('acepta montos que suman el total', () => {
    const splits = splitExact(5000, [
      { personId: A, amountCents: 1200 },
      { personId: B, amountCents: 3800 },
    ])
    expect(validateSplits(5000, splits)).toBe(true)
  })

  it('rechaza montos que no suman el total', () => {
    expect(() =>
      splitExact(5000, [
        { personId: A, amountCents: 1000 },
        { personId: B, amountCents: 3800 },
      ]),
    ).toThrow()
  })
})

describe('splitItems', () => {
  it('reparte cada ítem entre sus personas y agrega por persona', () => {
    const { total, splits } = splitItems([
      { id: '1', name: 'Pizza', amountCents: 3000, personIds: [A, B] },
      { id: '2', name: 'Cerveza', amountCents: 1000, personIds: [B] },
    ])
    expect(total).toBe(4000)
    expect(splits.find((s) => s.personId === A)!.amountCents).toBe(1500)
    expect(splits.find((s) => s.personId === B)!.amountCents).toBe(2500)
    expect(validateSplits(total, splits)).toBe(true)
  })

  it('rechaza ítems sin personas asignadas', () => {
    expect(() =>
      splitItems([{ id: '1', name: 'Solo', amountCents: 100, personIds: [] }]),
    ).toThrow()
  })
})
