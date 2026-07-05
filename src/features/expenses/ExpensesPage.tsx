import { useMemo, useState } from 'react'
import type { Expense } from '../../db/types'
import { useExpenses } from '../../db/hooks'
import { useApp } from '../../state/AppContext'
import { EmptyState, Field } from '../../components/ui'
import { IconFilter, IconReceipt, IconSearch } from '../../components/icons'
import { ExpenseForm } from './ExpenseForm'
import { ExpenseList } from './ExpenseList'

interface Filters {
  categoryId: string
  groupId: string
  personId: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { categoryId: '', groupId: '', personId: '', from: '', to: '' }

/** Actividad: búsqueda y filtros sobre todos los gastos (todas las agrupaciones). */
export function ExpensesPage() {
  const { categories, groups, persons } = useApp()
  const expenses = useExpenses()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const filtered = useMemo(() => {
    if (!expenses) return []
    const q = search.trim().toLowerCase()
    return expenses.filter((e) => {
      if (q) {
        const haystack = `${e.description} ${e.notes ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (filters.categoryId && e.categoryId !== filters.categoryId) return false
      if (filters.groupId === 'none' && e.groupId) return false
      if (filters.groupId && filters.groupId !== 'none' && e.groupId !== filters.groupId)
        return false
      if (filters.personId) {
        const involved =
          e.splits.some((s) => s.personId === filters.personId) ||
          e.paidBy.some((p) => p.personId === filters.personId)
        if (!involved) return false
      }
      if (filters.from && e.date < filters.from) return false
      if (filters.to && e.date > filters.to) return false
      return true
    })
  }, [expenses, search, filters])

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <input
            className="input pl-9"
            placeholder="Buscar en todos los gastos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className={`btn-secondary relative !px-3 ${showFilters ? '!bg-brand-600 !text-white' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
          aria-label="Filtros"
        >
          <IconFilter size={18} />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="card space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría">
              <select
                className="input"
                value={filters.categoryId}
                onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">Todas</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grupo">
              <select
                className="input"
                value={filters.groupId}
                onChange={(e) => setFilters((f) => ({ ...f, groupId: e.target.value }))}
              >
                <option value="">Todos</option>
                <option value="none">Sin grupo</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Persona">
              <select
                className="input"
                value={filters.personId}
                onChange={(e) => setFilters((f) => ({ ...f, personId: e.target.value }))}
              >
                <option value="">Todas</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Desde">
                <input
                  className="input"
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                />
              </Field>
              <Field label="Hasta">
                <input
                  className="input"
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                />
              </Field>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button
              className="text-xs font-semibold text-brand-600"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {expenses && filtered.length === 0 ? (
        <EmptyState
          icon={<IconReceipt size={48} />}
          title={expenses.length === 0 ? 'Aún no hay gastos' : 'Sin resultados'}
          hint={
            expenses.length === 0
              ? 'Entra a un grupo y registra tu primer gasto.'
              : 'Prueba con otra búsqueda u otros filtros.'
          }
        />
      ) : (
        <ExpenseList expenses={filtered} onSelect={setEditing} />
      )}

      {editing && <ExpenseForm expense={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
