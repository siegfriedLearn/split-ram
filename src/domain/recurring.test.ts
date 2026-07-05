import { describe, expect, it } from 'vitest'
import { advanceDate, dueOccurrences } from './recurring'
import type { RecurringRule } from '../db/types'

describe('advanceDate', () => {
  it('semanal suma 7 días', () => {
    expect(advanceDate('2026-07-04', 'weekly')).toBe('2026-07-11')
    expect(advanceDate('2026-12-28', 'weekly')).toBe('2027-01-04')
  })

  it('mensual recorta al fin de mes y recupera el ancla', () => {
    expect(advanceDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28')
    expect(advanceDate('2026-02-28', 'monthly', 31)).toBe('2026-03-31')
    expect(advanceDate('2026-12-15', 'monthly', 15)).toBe('2027-01-15')
  })

  it('anual maneja 29 de febrero', () => {
    expect(advanceDate('2024-02-29', 'yearly', 29)).toBe('2025-02-28')
  })
})

describe('dueOccurrences', () => {
  const baseRule: RecurringRule = {
    id: 'r1',
    createdAt: '',
    updatedAt: '',
    frequency: 'monthly',
    nextDate: '2026-05-01',
    dayAnchor: 1,
    active: true,
    template: {
      groupId: null,
      description: 'Arriendo',
      amountCents: 100000,
      currency: 'COP',
      fxRateToBase: 1,
      categoryId: 'cat',
      paidBy: [],
      splits: [],
      splitMethod: 'equal',
    },
  }

  it('devuelve todas las ocurrencias vencidas', () => {
    expect(dueOccurrences(baseRule, '2026-07-04')).toEqual([
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
    ])
  })

  it('respeta endDate y reglas inactivas', () => {
    expect(dueOccurrences({ ...baseRule, endDate: '2026-05-31' }, '2026-07-04')).toEqual([
      '2026-05-01',
    ])
    expect(dueOccurrences({ ...baseRule, active: false }, '2026-07-04')).toEqual([])
  })

  it('no devuelve nada si aún no vence', () => {
    expect(dueOccurrences({ ...baseRule, nextDate: '2026-08-01' }, '2026-07-04')).toEqual([])
  })
})
