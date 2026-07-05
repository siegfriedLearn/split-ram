import { useLiveQuery } from 'dexie-react-hooks'
import { db, notDeleted } from './db'
import type { Budget, Expense, RecurringRule, Settlement } from './types'

export function useExpenses(): Expense[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.expenses.orderBy('date').reverse().toArray()
    return all.filter(notDeleted)
  }, [])
}

export function useSettlements(): Settlement[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.settlements.orderBy('date').reverse().toArray()
    return all.filter(notDeleted)
  }, [])
}

export function useBudgets(): Budget[] | undefined {
  return useLiveQuery(async () => (await db.budgets.toArray()).filter(notDeleted), [])
}

export function useRecurringRules(): RecurringRule[] | undefined {
  return useLiveQuery(async () => (await db.recurringRules.toArray()).filter(notDeleted), [])
}
