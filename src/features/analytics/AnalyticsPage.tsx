import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db, newEntity, touched } from '../../db/db'
import type { Budget } from '../../db/types'
import { useBudgets, useExpenses, useSettlements } from '../../db/hooks'
import { useApp } from '../../state/AppContext'
import { EmptyState, Field, Modal, SegmentedControl } from '../../components/ui'
import { IconChart, IconDownload, IconPlus, IconSparkles, IconTrash } from '../../components/icons'
import {
  computeMonthInsight,
  expenseAmountBase,
  monthKey,
  monthRange,
  sumByCategory,
  sumByMonth,
  sumByMonthAndCategory,
  type Perspective,
} from '../../domain/analytics'
import { formatMoney, formatMonth, formatPercent, parseAmountToCents } from '../../utils/format'
import { todayISO, nowISO } from '../../utils/id'
import type { ExportContext } from '../export/exporters'

type Period = '1m' | '3m' | '6m' | '12m' | 'all'

const PERIOD_LABELS: Record<Period, string> = {
  '1m': 'Este mes',
  '3m': '3 meses',
  '6m': '6 meses',
  '12m': '12 meses',
  all: 'Todo',
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

export function AnalyticsPage() {
  const { categoryById, groups, groupById, personById, settings, me } = useApp()
  const expenses = useExpenses()
  const settlements = useSettlements()
  const budgets = useBudgets()
  const [period, setPeriod] = useState<Period>('6m')
  const [perspective, setPerspective] = useState<Perspective>('mine')
  const [groupFilter, setGroupFilter] = useState('')
  const [budgetModal, setBudgetModal] = useState<Budget | 'new' | null>(null)
  const [exporting, setExporting] = useState(false)

  const base = settings.baseCurrency
  const meId = me?.id ?? null
  const currentMonth = monthKey(todayISO())

  const fromMonth = useMemo(() => {
    if (period === 'all') {
      const oldest = expenses?.[expenses.length - 1]
      return oldest ? monthKey(oldest.date) : currentMonth
    }
    const monthsBack = { '1m': 0, '3m': 2, '6m': 5, '12m': 11 }[period]
    return shiftMonth(currentMonth, -monthsBack)
  }, [period, expenses, currentMonth])

  const filtered = useMemo(() => {
    return (expenses ?? []).filter((e) => {
      if (monthKey(e.date) < fromMonth || monthKey(e.date) > currentMonth) return false
      if (groupFilter === 'none' && e.groupId) return false
      if (groupFilter && groupFilter !== 'none' && e.groupId !== groupFilter) return false
      return true
    })
  }, [expenses, fromMonth, currentMonth, groupFilter])

  const months = useMemo(() => monthRange(fromMonth, currentMonth), [fromMonth, currentMonth])

  const totalPeriod = useMemo(
    () => filtered.reduce((s, e) => s + expenseAmountBase(e, perspective, meId), 0),
    [filtered, perspective, meId],
  )

  const byCategory = useMemo(() => {
    const totals = sumByCategory(filtered, perspective, meId)
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([catId, cents]) => {
        const cat = categoryById.get(catId)
        return {
          catId,
          name: cat?.name ?? 'Otra',
          icon: cat?.icon ?? '📦',
          color: cat?.color ?? '#94a3b8',
          value: cents,
        }
      })
  }, [filtered, perspective, meId, categoryById])

  const trendData = useMemo(() => {
    const totals = sumByMonth(filtered, perspective, meId)
    return months.map((m) => ({
      month: m,
      label: formatMonth(m).slice(0, 3),
      total: (totals.get(m) ?? 0) / 100,
    }))
  }, [filtered, perspective, meId, months])

  const stackedData = useMemo(() => {
    const byMonthCat = sumByMonthAndCategory(filtered, perspective, meId)
    const topCats = byCategory.slice(0, 5).map((c) => c.catId)
    return months.map((m) => {
      const catMap = byMonthCat.get(m) ?? new Map()
      const row: Record<string, number | string> = { month: m, label: formatMonth(m).slice(0, 3) }
      let others = 0
      for (const [catId, cents] of catMap) {
        if (topCats.includes(catId)) row[catId] = (cents as number) / 100
        else others += cents as number
      }
      if (others > 0) row['otros'] = others / 100
      return row
    })
  }, [filtered, perspective, meId, months, byCategory])

  const insight = useMemo(
    () =>
      computeMonthInsight(
        (expenses ?? []).filter((e) => {
          if (groupFilter === 'none' && e.groupId) return false
          if (groupFilter && groupFilter !== 'none' && e.groupId !== groupFilter) return false
          return true
        }),
        currentMonth,
        shiftMonth(currentMonth, -1),
        perspective,
        meId,
      ),
    [expenses, groupFilter, currentMonth, perspective, meId],
  )

  const avgMonthly = months.length > 0 ? Math.round(totalPeriod / months.length) : 0

  // Presupuestos siempre sobre "mi parte" del mes actual (finanzas personales)
  const spentThisMonthByCat = useMemo(() => {
    const thisMonth = (expenses ?? []).filter((e) => monthKey(e.date) === currentMonth)
    return sumByCategory(thisMonth, 'mine', meId)
  }, [expenses, currentMonth, meId])

  function buildExportContext(): ExportContext {
    return {
      expenses: filtered,
      settlements: settlements ?? [],
      personById,
      categoryById,
      groupById,
      baseCurrency: base,
      meId,
      periodLabel: PERIOD_LABELS[period],
    }
  }

  async function handleExport(kind: 'csv' | 'xlsx' | 'pdf') {
    setExporting(true)
    try {
      // Import dinámico: xlsx/jspdf solo se descargan al exportar
      const exporters = await import('../export/exporters')
      if (kind === 'csv') exporters.exportCSV(buildExportContext())
      else if (kind === 'xlsx') exporters.exportXLSX(buildExportContext())
      else await exporters.exportPDF(buildExportContext(), ['chart-categorias', 'chart-tendencia'])
    } finally {
      setExporting(false)
    }
  }

  const moneyTick = (v: number) =>
    new Intl.NumberFormat('es-CO', { notation: 'compact' }).format(v)
  const tooltipFormatter = (value: number | string | Array<number | string>) =>
    formatMoney(Math.round(Number(value) * 100), base)

  if (expenses && expenses.length === 0) {
    return (
      <EmptyState
        icon={<IconChart size={48} />}
        title="Aún no hay datos para analizar"
        hint="Registra tus primeros gastos y aquí verás gráficos y tendencias."
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={(Object.keys(PERIOD_LABELS) as Period[]).map((p) => ({
            value: p,
            label: PERIOD_LABELS[p],
          }))}
          value={period}
          onChange={setPeriod}
        />
        <SegmentedControl
          options={[
            { value: 'mine' as Perspective, label: 'Mi parte' },
            { value: 'total' as Perspective, label: 'Total' },
          ]}
          value={perspective}
          onChange={setPerspective}
        />
        <select
          className="input !w-auto !py-1.5 text-xs"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
        >
          <option value="">Todos los grupos</option>
          <option value="none">Sin grupo</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Total del período</p>
          <p className="mt-1 text-xl font-extrabold">{formatMoney(totalPeriod, base)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Promedio mensual</p>
          <p className="mt-1 text-xl font-extrabold">{formatMoney(avgMonthly, base)}</p>
        </div>
      </div>

      {insight.topCategoryId && (
        <div className="card flex items-start gap-3 border-l-4 border-l-brand-500 p-4">
          <IconSparkles size={20} className="mt-0.5 shrink-0 text-brand-500" />
          <p className="text-sm leading-relaxed">
            Tu categoría más fuerte este mes es{' '}
            <strong>
              {categoryById.get(insight.topCategoryId)?.icon}{' '}
              {categoryById.get(insight.topCategoryId)?.name}
            </strong>{' '}
            con <strong>{formatMoney(insight.topAmount, base)}</strong> (
            {formatPercent(insight.topFraction)} de tu gasto).
            {insight.momChangeFraction !== null &&
              (Math.abs(insight.momChangeFraction) < 0.005 ? (
                <> Se mantiene igual que el mes pasado.</>
              ) : (
                <>
                  {' '}
                  {insight.momChangeFraction > 0 ? 'Subió' : 'Bajó'}{' '}
                  <strong
                    className={insight.momChangeFraction > 0 ? 'text-red-500' : 'text-emerald-600'}
                  >
                    {formatPercent(Math.abs(insight.momChangeFraction))}
                  </strong>{' '}
                  frente al mes pasado.
                </>
              ))}
          </p>
        </div>
      )}

      {byCategory.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-1 text-sm font-bold">Gasto por categoría</h3>
          <div id="chart-categorias" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byCategory.map((c) => ({ ...c, value: c.value / 100 }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {byCategory.map((c) => (
                    <Cell key={c.catId} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip formatter={tooltipFormatter} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1.5">
            {byCategory.map((c, i) => (
              <div key={c.catId} className="flex items-center gap-2 text-sm">
                <span className="w-4 text-right text-xs font-bold text-slate-400">{i + 1}</span>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="flex-1 truncate">
                  {c.icon} {c.name}
                </span>
                <span className="text-xs text-slate-400">
                  {totalPeriod > 0 ? formatPercent(c.value / totalPeriod) : '—'}
                </span>
                <span className="w-24 text-right font-semibold">{formatMoney(c.value, base)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {months.length > 1 && (
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-bold">Tendencia mensual</h3>
          <div id="chart-tendencia" className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ left: 8, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={moneyTick} tick={{ fontSize: 11 }} width={44} />
                <Tooltip formatter={tooltipFormatter} />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Gasto"
                  stroke="#0d9488"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {months.length > 1 && byCategory.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-bold">Evolución por categoría (top 5)</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedData} margin={{ left: 8, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={moneyTick} tick={{ fontSize: 11 }} width={44} />
                <Tooltip formatter={tooltipFormatter} />
                {byCategory.slice(0, 5).map((c) => (
                  <Bar key={c.catId} dataKey={c.catId} name={c.name} stackId="a" fill={c.color} />
                ))}
                <Bar dataKey="otros" name="Otras" stackId="a" fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">
            Presupuestos del mes (mi parte)
          </h3>
          <button
            className="flex items-center gap-1 text-xs font-semibold text-brand-600"
            onClick={() => setBudgetModal('new')}
          >
            <IconPlus size={14} /> Presupuesto
          </button>
        </div>
        {(budgets ?? []).length === 0 ? (
          <p className="card p-4 text-sm text-slate-500">
            Define límites mensuales por categoría para controlar tu gasto.
          </p>
        ) : (
          <div className="card divide-y divide-slate-100 dark:divide-slate-800">
            {(budgets ?? []).map((b) => {
              const cat = categoryById.get(b.categoryId)
              const spent = spentThisMonthByCat.get(b.categoryId) ?? 0
              const frac = b.monthlyLimitCents > 0 ? spent / b.monthlyLimitCents : 0
              const over = frac > 1
              return (
                <button
                  key={b.id}
                  className="w-full px-4 py-3 text-left"
                  onClick={() => setBudgetModal(b)}
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">
                      {cat?.icon} {cat?.name}
                    </span>
                    <span className={over ? 'font-bold text-red-500' : 'text-slate-500'}>
                      {formatMoney(spent, base)} / {formatMoney(b.monthlyLimitCents, base)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all ${
                        over ? 'bg-red-500' : frac > 0.8 ? 'bg-amber-400' : 'bg-brand-500'
                      }`}
                      style={{ width: `${Math.min(100, frac * 100)}%` }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="card p-4">
        <h3 className="mb-2 text-sm font-bold">Exportar este período</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => handleExport('csv')} disabled={exporting}>
            <IconDownload size={16} /> CSV
          </button>
          <button className="btn-secondary" onClick={() => handleExport('xlsx')} disabled={exporting}>
            <IconDownload size={16} /> Excel
          </button>
          <button className="btn-secondary" onClick={() => handleExport('pdf')} disabled={exporting}>
            <IconDownload size={16} /> {exporting ? 'Generando…' : 'PDF con gráficos'}
          </button>
        </div>
      </section>

      {budgetModal && (
        <BudgetForm
          budget={budgetModal === 'new' ? null : budgetModal}
          existingCategoryIds={(budgets ?? []).map((b) => b.categoryId)}
          onClose={() => setBudgetModal(null)}
        />
      )}
    </div>
  )
}

function BudgetForm({
  budget,
  existingCategoryIds,
  onClose,
}: {
  budget: Budget | null
  existingCategoryIds: string[]
  onClose: () => void
}) {
  const { categories, settings } = useApp()
  const base = settings.baseCurrency
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? '')
  const [limitStr, setLimitStr] = useState(
    budget ? String(budget.monthlyLimitCents / 100) : '',
  )
  const [error, setError] = useState('')

  const available = categories.filter(
    (c) => c.id === budget?.categoryId || !existingCategoryIds.includes(c.id),
  )

  async function save() {
    const limit = parseAmountToCents(limitStr)
    if (!categoryId) {
      setError('Elige una categoría')
      return
    }
    if (Number.isNaN(limit) || limit <= 0) {
      setError('Ingresa un límite válido')
      return
    }
    if (budget) {
      await db.budgets.update(budget.id, { categoryId, monthlyLimitCents: limit, ...touched() })
    } else {
      await db.budgets.add({ ...newEntity(), categoryId, monthlyLimitCents: limit })
    }
    onClose()
  }

  async function remove() {
    if (!budget) return
    await db.budgets.update(budget.id, { deletedAt: nowISO(), ...touched() })
    onClose()
  }

  return (
    <Modal
      title={budget ? 'Editar presupuesto' : 'Nuevo presupuesto'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {budget && (
            <button className="btn-secondary !px-3 text-red-600" onClick={remove} aria-label="Eliminar presupuesto">
              <IconTrash size={18} />
            </button>
          )}
          <button className="btn-secondary flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary flex-1" onClick={save}>
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <Field label="Categoría">
          <select
            className="input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Elegir…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Límite mensual (${base})`}>
          <input
            className="input"
            inputMode="decimal"
            placeholder="500000"
            value={limitStr}
            onChange={(e) => setLimitStr(e.target.value)}
          />
        </Field>
        <p className="text-xs text-slate-400">
          El presupuesto se compara con tu parte de los gastos de cada mes.
        </p>
      </div>
    </Modal>
  )
}
