import { useMemo } from 'react'
import type { Expense } from '../../db/types'
import { useApp } from '../../state/AppContext'
import { IconRepeat } from '../../components/icons'
import { formatDate, formatMoney, formatMonth } from '../../utils/format'
import { expenseAmountBase, monthKey } from '../../domain/analytics'

/** Lista de gastos agrupada por mes con total mensual. Presentacional. */
export function ExpenseList({
  expenses,
  onSelect,
  showGroup = true,
}: {
  expenses: Expense[]
  onSelect: (e: Expense) => void
  showGroup?: boolean
}) {
  const { categoryById, groupById, personById, settings, me } = useApp()

  const byMonth = useMemo(() => {
    const map = new Map<string, { items: Expense[]; totalBase: number }>()
    for (const e of expenses) {
      const key = monthKey(e.date)
      let bucket = map.get(key)
      if (!bucket) {
        bucket = { items: [], totalBase: 0 }
        map.set(key, bucket)
      }
      bucket.items.push(e)
      bucket.totalBase += expenseAmountBase(e, 'total', me?.id ?? null)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [expenses, me?.id])

  return (
    <>
      {byMonth.map(([month, bucket]) => (
        <section key={month}>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">
              {formatMonth(month)}
            </h3>
            <span className="text-xs font-semibold text-slate-400">
              {formatMoney(bucket.totalBase, settings.baseCurrency)}
            </span>
          </div>
          <div className="card divide-y divide-slate-100 dark:divide-slate-800">
            {bucket.items.map((e) => {
              const cat = categoryById.get(e.categoryId)
              const group = e.groupId ? groupById.get(e.groupId) : undefined
              const payers = e.paidBy
                .map((p) => {
                  const person = personById.get(p.personId)
                  return person?.isMe ? 'Tú' : (person?.name ?? '?')
                })
                .join(', ')
              const myShare = me ? e.splits.find((s) => s.personId === me.id) : undefined
              return (
                <button
                  key={e.id}
                  onClick={() => onSelect(e)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
                    style={{ backgroundColor: `${cat?.color ?? '#94a3b8'}22` }}
                  >
                    {cat?.icon ?? '📦'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      {e.description}
                      {e.recurringRuleId && (
                        <IconRepeat size={12} className="shrink-0 text-slate-400" />
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {formatDate(e.date)}
                      {showGroup && group ? ` · ${group.name}` : ''} · Pagó {payers}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{formatMoney(e.amountCents, e.currency)}</p>
                    {myShare && myShare.amountCents !== e.amountCents && (
                      <p className="text-xs text-slate-400">
                        Tu parte: {formatMoney(myShare.amountCents, e.currency)}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
