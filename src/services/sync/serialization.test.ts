import { describe, expect, it } from 'vitest'
import type { Expense, Group, Person, Settlement } from '../../db/types'
import {
  expenseToRow,
  groupToMeta,
  parseExpenseRow,
  parseMeta,
  parsePersonRow,
  parseSettlementRow,
  personToRow,
  settlementToRow,
} from './serialization'

describe('serialización de filas', () => {
  it('round-trip de gasto conserva todo menos recibo y categoría local', () => {
    const expense: Expense = {
      id: 'e1',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
      deletedAt: null,
      groupId: 'g1',
      description: 'Mercado',
      amountCents: 9000000,
      currency: 'COP',
      fxRateToBase: 1,
      date: '2026-07-01',
      categoryId: 'cat-local',
      paidBy: [{ personId: 'a', amountCents: 9000000 }],
      splits: [
        { personId: 'a', amountCents: 4500000 },
        { personId: 'b', amountCents: 4500000 },
      ],
      splitMethod: 'equal',
      notes: 'nota',
      receiptId: 'recibo-local',
      recurringRuleId: null,
    }
    const row = expenseToRow(expense, { name: 'Mercado', icon: '🛒', color: '#22c55e' })
    const parsed = parseExpenseRow(row)

    expect(parsed.category).toEqual({ name: 'Mercado', icon: '🛒', color: '#22c55e' })
    expect(parsed.expense.receiptId).toBeNull() // los recibos no viajan
    expect(parsed.expense.splits).toEqual(expense.splits)
    expect(parsed.expense.paidBy).toEqual(expense.paidBy)
    expect(parsed.expense.amountCents).toBe(9000000)
    expect(parsed.expense.date).toBe('2026-07-01')
    expect(parsed.expense.updatedAt).toBe(expense.updatedAt)
    expect('categoryId' in parsed.expense).toBe(false)
  })

  it('round-trip de persona excluye isMe', () => {
    const person: Person = {
      id: 'p1',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
      deletedAt: null,
      name: 'Laura',
      email: 'laura@gmail.com',
      color: '#6366f1',
      isMe: true,
    }
    const parsed = parsePersonRow(personToRow(person))
    expect(parsed.name).toBe('Laura')
    expect(parsed.email).toBe('laura@gmail.com')
    expect(parsed.isMe).toBeUndefined()
  })

  it('round-trip de pago', () => {
    const s: Settlement = {
      id: 's1',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
      deletedAt: null,
      groupId: 'g1',
      fromPersonId: 'a',
      toPersonId: 'b',
      amountCents: 5000,
      currency: 'COP',
      fxRateToBase: 1,
      date: '2026-07-01',
    }
    expect(parseSettlementRow(settlementToRow(s))).toEqual(s)
  })

  it('round-trip de meta del grupo con división predeterminada', () => {
    const group: Group = {
      id: 'g1',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
      deletedAt: null,
      name: 'Apartamento',
      type: 'pareja',
      currency: 'COP',
      memberIds: ['a', 'b'],
      defaultSplit: { method: 'percent', values: { a: 43, b: 57 } },
    }
    const meta = parseMeta(groupToMeta(group))
    expect(meta.id).toBe('g1')
    expect(meta.name).toBe('Apartamento')
    expect(meta.defaultSplit).toEqual({ method: 'percent', values: { a: 43, b: 57 } })
  })

  it('rechaza hojas con formato desconocido', () => {
    expect(() => parseMeta('{"foo": 1}')).toThrow()
    expect(() => parseMeta(JSON.stringify({ version: 2, id: 'x', name: 'y' }))).toThrow()
  })
})
