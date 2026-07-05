import { describe, expect, it } from 'vitest'
import { simplifyDebts } from './simplifyDebts'
import type { UUID } from '../db/types'

function netFromTransfers(transfers: ReturnType<typeof simplifyDebts>): Map<UUID, number> {
  const net = new Map<UUID, number>()
  for (const t of transfers) {
    net.set(t.from, (net.get(t.from) ?? 0) + t.amountCents)
    net.set(t.to, (net.get(t.to) ?? 0) - t.amountCents)
  }
  return net
}

describe('simplifyDebts', () => {
  it('sin deudas no genera transferencias', () => {
    expect(simplifyDebts(new Map([['a', 0]]))).toEqual([])
    expect(simplifyDebts(new Map())).toEqual([])
  })

  it('caso simple: un deudor le paga a un acreedor', () => {
    const transfers = simplifyDebts(
      new Map([
        ['a', 5000],
        ['b', -5000],
      ]),
    )
    expect(transfers).toEqual([{ from: 'b', to: 'a', amountCents: 5000 }])
  })

  it('reduce cadenas: A→B→C se vuelve A→C', () => {
    // b debe 100 a a; c debe 100 a b ⟹ balances: a +100, b 0, c -100
    const transfers = simplifyDebts(
      new Map([
        ['a', 10000],
        ['b', 0],
        ['c', -10000],
      ]),
    )
    expect(transfers).toEqual([{ from: 'c', to: 'a', amountCents: 10000 }])
  })

  it('preserva los balances netos y usa a lo sumo n-1 transferencias', () => {
    const balances = new Map<UUID, number>([
      ['a', 7000],
      ['b', -2000],
      ['c', -1500],
      ['d', -3500],
      ['e', 0],
    ])
    const transfers = simplifyDebts(balances)
    expect(transfers.length).toBeLessThanOrEqual(4)
    // Pagar la deuda deja a todos en cero: lo transferido neto == -balance
    const net = netFromTransfers(transfers)
    for (const [id, expected] of balances) {
      expect(net.get(id) ?? 0).toBe(-expected + 0)
    }
  })

  it('es determinista ante empates', () => {
    const balances = new Map<UUID, number>([
      ['x', 1000],
      ['y', -500],
      ['z', -500],
    ])
    expect(simplifyDebts(balances)).toEqual(simplifyDebts(balances))
  })
})
