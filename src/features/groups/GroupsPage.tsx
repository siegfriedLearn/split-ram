import { useMemo, useState } from 'react'
import { db, newEntity, touched, PERSON_COLORS } from '../../db/db'
import type { Expense, Group, GroupDefaultSplit, GroupType, Person } from '../../db/types'
import { SUPPORTED_CURRENCIES } from '../../db/types'
import { useApp } from '../../state/AppContext'
import { useExpenses, useSettlements } from '../../db/hooks'
import { Avatar, EmptyState, Field, Modal, SegmentedControl } from '../../components/ui'
import {
  IconCloud,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
  IconWallet,
} from '../../components/icons'
import { formatMoney } from '../../utils/format'
import { computeNetBalances } from '../../domain/balances'
import { notifyGroupMutation } from '../../services/sync/groupSync'
import { QuickAddPerson } from '../../components/QuickAddPerson'
import { ExpenseForm } from '../expenses/ExpenseForm'

export const GROUP_TYPES: Array<{ value: GroupType; label: string; icon: string }> = [
  { value: 'hogar', label: 'Hogar', icon: '🏠' },
  { value: 'viaje', label: 'Viaje', icon: '✈️' },
  { value: 'pareja', label: 'Pareja', icon: '❤️' },
  { value: 'otro', label: 'Otro', icon: '📦' },
]

/** Balance mío dentro de un conjunto de gastos/pagos (centavos base). */
function useMyBalances() {
  const { me } = useApp()
  const expenses = useExpenses()
  const settlements = useSettlements()
  return useMemo(() => {
    const meId = me?.id
    const perGroup = new Map<string, number>()
    if (!meId || !expenses || !settlements) return { perGroup, overall: 0, hasNoGroup: false }
    const scopes = new Map<string, { exp: Expense[]; set: NonNullable<typeof settlements> }>()
    const key = (groupId: string | null) => groupId ?? 'none'
    for (const e of expenses) {
      const k = key(e.groupId)
      if (!scopes.has(k)) scopes.set(k, { exp: [], set: [] })
      scopes.get(k)!.exp.push(e)
    }
    for (const s of settlements) {
      const k = key(s.groupId)
      if (!scopes.has(k)) scopes.set(k, { exp: [], set: [] })
      scopes.get(k)!.set.push(s)
    }
    let overall = 0
    for (const [k, { exp, set }] of scopes) {
      const mine = computeNetBalances(exp, set).get(meId) ?? 0
      perGroup.set(k, mine)
      overall += mine
    }
    return { perGroup, overall, hasNoGroup: scopes.has('none') }
  }, [expenses, settlements, me?.id])
}

export function GroupsPage() {
  const { groups, personById, settings } = useApp()
  const { perGroup, overall, hasNoGroup } = useMyBalances()
  const [editingGroup, setEditingGroup] = useState<Group | 'new' | null>(null)
  const [showPersons, setShowPersons] = useState(false)
  const [addingExpense, setAddingExpense] = useState(false)

  const base = settings.baseCurrency
  const minVisible = 100

  function balanceLabel(cents: number) {
    if (Math.abs(cents) < minVisible)
      return <span className="text-xs font-semibold text-slate-400">Saldado</span>
    return cents > 0 ? (
      <span className="text-sm font-bold text-emerald-600">te deben {formatMoney(cents, base)}</span>
    ) : (
      <span className="text-sm font-bold text-red-500">debes {formatMoney(-cents, base)}</span>
    )
  }

  return (
    <div className="space-y-4">
      {/* Balance general */}
      <div className="card flex items-center justify-between px-4 py-3">
        <p className="text-sm text-slate-500">
          En general,{' '}
          {Math.abs(overall) < minVisible ? (
            <strong className="text-slate-700 dark:text-slate-200">estás al día</strong>
          ) : overall > 0 ? (
            <strong className="text-emerald-600">te deben {formatMoney(overall, base)}</strong>
          ) : (
            <strong className="text-red-500">debes {formatMoney(-overall, base)}</strong>
          )}
        </p>
        <button
          className="flex items-center gap-1 text-xs font-semibold text-brand-600"
          onClick={() => setShowPersons(true)}
        >
          <IconUsers size={14} /> Personas
        </button>
      </div>

      {groups.length === 0 && !hasNoGroup && (
        <EmptyState
          icon={<IconUsers size={44} />}
          title="Sin grupos todavía"
          hint="Crea un grupo como Hogar o Viaje para dividir gastos."
        />
      )}

      <div className="space-y-2.5">
        {groups.map((g) => {
          const typeInfo = GROUP_TYPES.find((t) => t.value === g.type)
          const myBalance = perGroup.get(g.id) ?? 0
          return (
            <button
              key={g.id}
              onClick={() => (location.hash = `#/grupos/${g.id}`)}
              className="card flex w-full items-center gap-3 p-4 text-left transition hover:ring-2 hover:ring-brand-500/40"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
                {typeInfo?.icon ?? '📦'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate font-bold">
                  {g.name}
                  {g.share && (
                    <IconCloud
                      size={13}
                      className={`shrink-0 ${g.share.lastError ? 'text-red-400' : 'text-brand-500'}`}
                    />
                  )}
                </p>
                <div className="mt-0.5">{balanceLabel(myBalance)}</div>
              </div>
              <div className="flex -space-x-2">
                {g.memberIds.slice(0, 4).map((id) => (
                  <div key={id} className="rounded-full ring-2 ring-white dark:ring-slate-900">
                    <Avatar person={personById.get(id)} size={24} />
                  </div>
                ))}
              </div>
            </button>
          )
        })}

        {hasNoGroup && (
          <button
            onClick={() => (location.hash = '#/grupos/none')}
            className="card flex w-full items-center gap-3 p-4 text-left transition hover:ring-2 hover:ring-brand-500/40"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
              <IconWallet size={22} className="text-slate-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">Sin grupo</p>
              <div className="mt-0.5">{balanceLabel(perGroup.get('none') ?? 0)}</div>
            </div>
          </button>
        )}
      </div>

      <button className="btn-secondary w-full" onClick={() => setEditingGroup('new')}>
        <IconPlus size={16} /> Nuevo grupo
      </button>

      {/* FAB global: agregar gasto eligiendo grupo en el formulario */}
      <button
        onClick={() => setAddingExpense(true)}
        className="fixed right-4 bottom-24 z-40 flex h-14 items-center gap-2 rounded-2xl bg-brand-600 px-5 font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 active:scale-95 sm:bottom-8"
      >
        <IconPlus size={22} /> Gasto
      </button>

      {editingGroup && (
        <GroupForm group={editingGroup === 'new' ? null : editingGroup} onClose={() => setEditingGroup(null)} />
      )}
      {showPersons && <PersonsModal onClose={() => setShowPersons(false)} />}
      {addingExpense && <ExpenseForm expense={null} onClose={() => setAddingExpense(false)} />}
    </div>
  )
}

// ---------- Personas (modal) ----------

function PersonsModal({ onClose }: { onClose: () => void }) {
  const { persons } = useApp()
  const [editingPerson, setEditingPerson] = useState<Person | 'new' | null>(null)

  async function deletePerson(p: Person) {
    if (p.isMe) return
    if (!window.confirm(`¿Eliminar a ${p.name}? Sus gastos históricos se conservan.`)) return
    await db.persons.update(p.id, { deletedAt: nowISODate(), ...touched() })
  }

  return (
    <Modal title="Personas" onClose={onClose}>
      <div className="space-y-3">
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {persons.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar person={p} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {p.name}
                  {p.isMe && <span className="ml-1.5 text-xs font-normal text-brand-600">(yo)</span>}
                </p>
                {p.email && <p className="truncate text-xs text-slate-500">{p.email}</p>}
              </div>
              <button
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                onClick={() => setEditingPerson(p)}
                aria-label={`Editar ${p.name}`}
              >
                <IconPencil size={15} />
              </button>
              {!p.isMe && (
                <button
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  onClick={() => deletePerson(p)}
                  aria-label={`Eliminar ${p.name}`}
                >
                  <IconTrash size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          className="btn-secondary w-full"
          onClick={() => setEditingPerson('new')}
        >
          <IconPlus size={16} /> Nueva persona
        </button>
      </div>
      {editingPerson && (
        <PersonForm
          person={editingPerson === 'new' ? null : editingPerson}
          onClose={() => setEditingPerson(null)}
        />
      )}
    </Modal>
  )
}

function nowISODate() {
  return new Date().toISOString()
}

// ---------- Formulario de grupo ----------

type SplitMode = 'equal' | GroupDefaultSplit['method']

export function GroupForm({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const { persons, personById, settings, me } = useApp()
  const [name, setName] = useState(group?.name ?? '')
  const [type, setType] = useState<GroupType>(group?.type ?? 'hogar')
  const [currency, setCurrency] = useState(group?.currency ?? settings.baseCurrency)
  const [memberIds, setMemberIds] = useState<string[]>(group?.memberIds ?? (me ? [me.id] : []))
  const [splitMode, setSplitMode] = useState<SplitMode>(group?.defaultSplit?.method ?? 'equal')
  const [splitValues, setSplitValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(group?.defaultSplit?.values ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  )
  const [error, setError] = useState('')

  const percentSum = memberIds.reduce((s, id) => s + (Number(splitValues[id]) || 0), 0)

  async function save() {
    if (!name.trim()) {
      setError('Ponle un nombre al grupo')
      return
    }
    if (memberIds.length < 1) {
      setError('El grupo necesita al menos un miembro')
      return
    }
    let defaultSplit: GroupDefaultSplit | null = null
    if (splitMode !== 'equal') {
      const values = Object.fromEntries(memberIds.map((id) => [id, Number(splitValues[id]) || 0]))
      const sum = Object.values(values).reduce((s, v) => s + v, 0)
      if (splitMode === 'percent' && Math.abs(sum - 100) > 0.01) {
        setError(`Los porcentajes deben sumar 100% (suman ${sum}%)`)
        return
      }
      if (splitMode === 'shares' && sum <= 0) {
        setError('Asigna al menos una parte a algún miembro')
        return
      }
      defaultSplit = { method: splitMode, values }
    }
    const data = { name: name.trim(), type, currency, memberIds, defaultSplit }
    if (group) {
      await db.groups.update(group.id, { ...data, ...touched() })
      notifyGroupMutation(group.share ? group.id : null)
    } else {
      await db.groups.add({ ...newEntity(), ...data })
    }
    onClose()
  }

  return (
    <Modal
      title={group ? 'Editar grupo' : 'Nuevo grupo'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
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
        <Field label="Nombre">
          <input
            className="input"
            placeholder="Hogar, Viaje a Cartagena…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Tipo">
          <div className="flex flex-wrap gap-1.5">
            {GROUP_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`chip ${
                  type === t.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Moneda del grupo">
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([settings.baseCurrency, ...SUPPORTED_CURRENCIES])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Miembros">
          <div className="flex flex-wrap gap-1.5">
            {persons.map((p) => {
              const active = memberIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setMemberIds((prev) =>
                      active ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                    )
                  }
                  className={`chip ${
                    active
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {p.isMe ? `${p.name} (yo)` : p.name}
                </button>
              )
            })}
          </div>
          <div className="mt-2">
            <QuickAddPerson withEmail onCreated={(id) => setMemberIds((prev) => [...prev, id])} />
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            El correo es opcional: sirve para invitar y reconocer a la persona si compartes el
            grupo.
          </p>
        </Field>
        <Field label="División predeterminada">
          <div className="space-y-2">
            <SegmentedControl
              options={[
                { value: 'equal' as SplitMode, label: 'Iguales' },
                { value: 'percent' as SplitMode, label: 'Porcentajes' },
                { value: 'shares' as SplitMode, label: 'Partes' },
              ]}
              value={splitMode}
              onChange={setSplitMode}
            />
            {splitMode !== 'equal' && (
              <div className="space-y-1.5">
                {memberIds.map((id) => {
                  const p = personById.get(id)
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <Avatar person={p} size={26} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {p?.isMe ? `${p.name} (yo)` : (p?.name ?? '?')}
                      </span>
                      <input
                        className="input w-24 text-right"
                        inputMode="decimal"
                        placeholder="0"
                        value={splitValues[id] ?? ''}
                        onChange={(e) =>
                          setSplitValues((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                      />
                      <span className="w-12 text-xs text-slate-400">
                        {splitMode === 'percent' ? '%' : 'partes'}
                      </span>
                    </div>
                  )
                })}
                {splitMode === 'percent' && (
                  <p
                    className={`text-xs font-medium ${Math.abs(percentSum - 100) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}
                  >
                    Suma: {percentSum}%
                  </p>
                )}
                <p className="text-xs text-slate-400">
                  Los gastos nuevos de este grupo se dividirán así automáticamente (puedes
                  cambiarlo en cada gasto).
                </p>
              </div>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  )
}

// ---------- Formulario de persona ----------

export function PersonForm({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const { persons } = useApp()
  const [name, setName] = useState(person?.name ?? '')
  const [email, setEmail] = useState(person?.email ?? '')
  const [color, setColor] = useState(
    person?.color ?? PERSON_COLORS[persons.length % PERSON_COLORS.length],
  )
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) {
      setError('Escribe un nombre')
      return
    }
    const data = { name: name.trim(), email: email.trim() || undefined, color }
    if (person) {
      await db.persons.update(person.id, { ...data, ...touched() })
      // propaga el cambio a los grupos compartidos donde participa
      for (const g of await db.groups.toArray()) {
        if (g.share && g.memberIds.includes(person.id)) notifyGroupMutation(g.id)
      }
    } else {
      await db.persons.add({ ...newEntity(), ...data })
    }
    onClose()
  }

  return (
    <Modal
      title={person ? 'Editar persona' : 'Nueva persona'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
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
        <Field label="Nombre">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email (opcional)">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {PERSON_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full transition ${color === c ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-slate-900' : ''}`}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  )
}
