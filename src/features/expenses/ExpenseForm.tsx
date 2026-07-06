import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newEntity, touched } from '../../db/db'
import type {
  Expense,
  ExpenseItem,
  MoneyShare,
  RecurringFrequency,
  SplitMethod,
  UUID,
} from '../../db/types'
import { SUPPORTED_CURRENCIES } from '../../db/types'
import { useApp } from '../../state/AppContext'
import { Avatar, Field, Modal, SegmentedControl } from '../../components/ui'
import { IconCamera, IconSparkles, IconTrash } from '../../components/icons'
import { QuickAddPerson } from '../../components/QuickAddPerson'
import { splitEqual, splitExact, splitItems, splitPercent, splitShares } from '../../domain/splits'
import { advanceDate } from '../../domain/recurring'
import { centsToInput, formatMoney, parseAmountToCents } from '../../utils/format'
import { nowISO, todayISO, uuid } from '../../utils/id'
import { getRate } from '../../services/fx'
import { scanReceipt } from '../../services/ocr'
import { useDriveImage } from '../../hooks/useDriveImage'
import { notifyGroupMutation } from '../../services/sync/groupSync'

const METHOD_LABELS: Array<{ value: SplitMethod; label: string }> = [
  { value: 'equal', label: 'Iguales' },
  { value: 'exact', label: 'Exactos' },
  { value: 'percent', label: '%' },
  { value: 'shares', label: 'Partes' },
  { value: 'items', label: 'Ítems' },
]

interface ItemDraft {
  id: string
  name: string
  amountStr: string
  personIds: UUID[]
}

export function ExpenseForm({
  expense,
  defaultGroupId,
  onClose,
}: {
  expense: Expense | null
  defaultGroupId?: string | null
  onClose: () => void
}) {
  const { persons, categories, groups, groupById, settings, me } = useApp()
  const base = settings.baseCurrency

  const defaultCategory = useMemo(
    () => categories.find((c) => c.name === 'Otros') ?? categories[0],
    [categories],
  )

  const [description, setDescription] = useState(expense?.description ?? '')
  const [amountStr, setAmountStr] = useState(
    expense ? centsToInput(expense.amountCents, expense.currency) : '',
  )
  const [currency, setCurrency] = useState(expense?.currency ?? base)
  const [fxRateStr, setFxRateStr] = useState(expense ? String(expense.fxRateToBase) : '1')
  const [fxLoading, setFxLoading] = useState(false)
  const [date, setDate] = useState(expense?.date ?? todayISO())
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? defaultCategory?.id ?? '')
  const [groupId, setGroupId] = useState<string>(expense?.groupId ?? defaultGroupId ?? '')
  const [method, setMethod] = useState<SplitMethod>(
    expense?.splitMethod ??
      groupById.get(defaultGroupId ?? '')?.defaultSplit?.method ??
      'equal',
  )

  const [participantIds, setParticipantIds] = useState<UUID[]>(() => {
    if (expense) return expense.splits.map((s) => s.personId)
    const g = groupById.get(defaultGroupId ?? '')
    if (g) return [...g.memberIds]
    return me ? [me.id] : []
  })

  const [payerMode, setPayerMode] = useState<'single' | 'multi'>(
    expense && expense.paidBy.length > 1 ? 'multi' : 'single',
  )
  const [payerId, setPayerId] = useState<UUID>(expense?.paidBy[0]?.personId ?? me?.id ?? '')
  const [payerAmounts, setPayerAmounts] = useState<Record<UUID, string>>(() => {
    const out: Record<UUID, string> = {}
    if (expense && expense.paidBy.length > 1) {
      for (const p of expense.paidBy) out[p.personId] = centsToInput(p.amountCents, expense.currency)
    }
    return out
  })

  const [rawInputs, setRawInputs] = useState<Record<UUID, string>>(() => {
    const out: Record<UUID, string> = {}
    if (expense?.splitInput) {
      for (const [pid, v] of Object.entries(expense.splitInput)) {
        out[pid] =
          expense.splitMethod === 'exact' ? centsToInput(v, expense.currency) : String(v)
      }
    } else if (!expense) {
      // Gasto nuevo: aplica la división predeterminada del grupo si existe
      const preset = groupById.get(defaultGroupId ?? '')?.defaultSplit
      if (preset) {
        for (const [pid, v] of Object.entries(preset.values)) out[pid] = String(v)
      }
    }
    return out
  })

  const [items, setItems] = useState<ItemDraft[]>(() =>
    (expense?.items ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      amountStr: centsToInput(it.amountCents, expense?.currency ?? base),
      personIds: [...it.personIds],
    })),
  )

  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [keepReceipt, setKeepReceipt] = useState(
    Boolean(expense?.receiptId || expense?.receiptDriveId),
  )
  const [ocrBusy, setOcrBusy] = useState(false)
  const [recurring, setRecurring] = useState<RecurringFrequency | ''>('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)

  // El error se muestra arriba del formulario: al aparecer, llévalo a la vista
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [error])

  const existingReceipt = useLiveQuery(
    async () => (expense?.receiptId ? db.receipts.get(expense.receiptId) : undefined),
    [expense?.receiptId],
  )
  const localPreviewUrl = useMemo(() => {
    if (receiptFile) return URL.createObjectURL(receiptFile)
    if (keepReceipt && existingReceipt) return URL.createObjectURL(existingReceipt.blob)
    return null
  }, [receiptFile, keepReceipt, existingReceipt])
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl)
    }
  }, [localPreviewUrl])
  // Recibo que subió otro miembro: sin copia local, se baja de Drive
  const needsDriveReceipt = keepReceipt && !localPreviewUrl && Boolean(expense?.receiptDriveId)
  const driveReceiptUrl = useDriveImage(null, needsDriveReceipt ? expense?.receiptDriveId : null)
  const receiptPreviewUrl = localPreviewUrl ?? driveReceiptUrl

  // Al elegir grupo, los participantes pasan a ser sus miembros y se aplica
  // su división predeterminada (si la tiene)
  function handleGroupChange(id: string) {
    setGroupId(id)
    const g = groupById.get(id)
    if (g) {
      setParticipantIds([...g.memberIds])
      if (g.defaultSplit) {
        setMethod(g.defaultSplit.method)
        setRawInputs(
          Object.fromEntries(
            Object.entries(g.defaultSplit.values).map(([pid, v]) => [pid, String(v)]),
          ),
        )
      }
      if (g.currency !== currency) handleCurrencyChange(g.currency)
    }
  }

  async function handleCurrencyChange(next: string) {
    setCurrency(next)
    if (next === base) {
      setFxRateStr('1')
      return
    }
    setFxLoading(true)
    try {
      const rate = await getRate(next, base)
      setFxRateStr(String(rate))
    } catch {
      setFxRateStr('')
    } finally {
      setFxLoading(false)
    }
  }

  const selectablePersons = useMemo(() => {
    const g = groupById.get(groupId)
    if (!g) return persons
    const memberSet = new Set(g.memberIds)
    return persons.filter((p) => memberSet.has(p.id))
  }, [groupId, groupById, persons])

  function toggleParticipant(id: UUID) {
    setParticipantIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    )
  }

  // Persona creada desde el formulario: si hay grupo elegido también entra al grupo,
  // y queda seleccionada como participante de este gasto
  async function handlePersonCreated(id: UUID) {
    const g = groupById.get(groupId)
    if (g && !g.memberIds.includes(id)) {
      await db.groups.update(g.id, { memberIds: [...g.memberIds, id], ...touched() })
    }
    setParticipantIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  const itemsTotalCents = items.reduce((s, it) => {
    const c = parseAmountToCents(it.amountStr)
    return s + (Number.isNaN(c) ? 0 : c)
  }, 0)
  const amountCents = method === 'items' ? itemsTotalCents : parseAmountToCents(amountStr)

  // Vista previa de validación según método
  const exactSumCents = participantIds.reduce((s, pid) => {
    const c = parseAmountToCents(rawInputs[pid] ?? '')
    return s + (Number.isNaN(c) ? 0 : c)
  }, 0)
  const percentSum = participantIds.reduce((s, pid) => s + (Number(rawInputs[pid]) || 0), 0)
  // Solo cuentan los montos de personas visibles (evita restos de selecciones previas)
  const payersSumCents = selectablePersons.reduce((s, p) => {
    const c = parseAmountToCents(payerAmounts[p.id] ?? '')
    return s + (Number.isNaN(c) ? 0 : c)
  }, 0)

  async function handleScan() {
    const file = receiptFile ?? (keepReceipt && existingReceipt ? existingReceipt.blob : null)
    if (!file) return
    setOcrBusy(true)
    setError('')
    try {
      const scan = await scanReceipt(file)
      if (scan.amountCents) setAmountStr(centsToInput(scan.amountCents, currency))
      if (scan.date) setDate(scan.date)
      if (!scan.amountCents && !scan.date) {
        setError('El OCR no encontró monto ni fecha en la imagen; ingrésalos manualmente.')
      }
    } catch {
      setError('No se pudo escanear el recibo (el OCR necesita conexión la primera vez).')
    } finally {
      setOcrBusy(false)
    }
  }

  async function handleSave() {
    setError('')
    try {
      if (Number.isNaN(amountCents) || amountCents <= 0) {
        throw new Error('Ingresa un monto válido mayor a cero')
      }
      if (!categoryId) throw new Error('Elige una categoría')
      if (method !== 'items' && participantIds.length === 0) {
        throw new Error('Elige al menos un participante')
      }

      const fxRateToBase = currency === base ? 1 : Number(fxRateStr)
      if (!Number.isFinite(fxRateToBase) || fxRateToBase <= 0) {
        throw new Error(`Ingresa la tasa de cambio de ${currency} a ${base}`)
      }

      let splits: MoneyShare[]
      let splitInput: Record<UUID, number> | undefined
      let finalItems: ExpenseItem[] | undefined
      if (method === 'equal') {
        splits = splitEqual(amountCents, participantIds)
      } else if (method === 'exact') {
        const entries = participantIds.map((pid) => {
          const c = parseAmountToCents(rawInputs[pid] ?? '')
          return { personId: pid, amountCents: Number.isNaN(c) ? 0 : c }
        })
        splits = splitExact(amountCents, entries)
        splitInput = Object.fromEntries(entries.map((e) => [e.personId, e.amountCents]))
      } else if (method === 'percent') {
        const entries = participantIds.map((pid) => ({
          personId: pid,
          percent: Number(rawInputs[pid]) || 0,
        }))
        splits = splitPercent(amountCents, entries)
        splitInput = Object.fromEntries(entries.map((e) => [e.personId, e.percent]))
      } else if (method === 'shares') {
        const entries = participantIds.map((pid) => ({
          personId: pid,
          shares: Number(rawInputs[pid]) || 0,
        }))
        splits = splitShares(amountCents, entries)
        splitInput = Object.fromEntries(entries.map((e) => [e.personId, e.shares]))
      } else {
        finalItems = items.map((it) => {
          const c = parseAmountToCents(it.amountStr)
          if (Number.isNaN(c) || c <= 0) {
            throw new Error(`El ítem "${it.name || 'sin nombre'}" necesita un monto válido`)
          }
          return { id: it.id, name: it.name, amountCents: c, personIds: it.personIds }
        })
        if (finalItems.length === 0) throw new Error('Agrega al menos un ítem')
        splits = splitItems(finalItems).splits
      }

      let paidBy: MoneyShare[]
      if (payerMode === 'single') {
        if (!payerId) throw new Error('Elige quién pagó')
        paidBy = [{ personId: payerId, amountCents }]
      } else {
        paidBy = selectablePersons
          .map((p) => ({ personId: p.id, amountCents: parseAmountToCents(payerAmounts[p.id] ?? '') }))
          .filter((p) => !Number.isNaN(p.amountCents) && p.amountCents > 0)
        if (paidBy.length === 0) {
          throw new Error('Indica cuánto pagó cada persona (agrega personas con "+ Nueva persona" si hace falta)')
        }
        const sum = paidBy.reduce((s, p) => s + p.amountCents, 0)
        if (sum !== amountCents) {
          throw new Error(
            `Lo pagado entre todos (${formatMoney(sum, currency)}) no suma el total del gasto (${formatMoney(amountCents, currency)})`,
          )
        }
      }

      setSaving(true)

      let receiptId = keepReceipt ? (expense?.receiptId ?? null) : null
      // conserva/limpia la copia en Drive junto con la local
      let receiptDriveId = keepReceipt ? (expense?.receiptDriveId ?? null) : null
      if (receiptFile) {
        const receipt = { ...newEntity(), blob: receiptFile, mimeType: receiptFile.type }
        await db.receipts.add(receipt)
        receiptId = receipt.id
        receiptDriveId = null // recibo nuevo: la sync lo vuelve a subir
      }

      const data = {
        groupId: groupId || null,
        description: description.trim() || 'Gasto',
        amountCents,
        currency,
        fxRateToBase,
        date,
        categoryId,
        paidBy,
        splits,
        splitMethod: method,
        splitInput,
        items: finalItems,
        notes: notes.trim() || undefined,
        receiptId,
        receiptDriveId,
      }

      if (expense) {
        await db.expenses.update(expense.id, { ...data, ...touched() })
      } else {
        const created: Expense = { ...newEntity(), ...data, recurringRuleId: null }
        if (recurring) {
          const rule = {
            ...newEntity(),
            frequency: recurring,
            nextDate: advanceDate(date, recurring, Number(date.split('-')[2])),
            dayAnchor: Number(date.split('-')[2]),
            endDate: null,
            active: true,
            template: {
              groupId: data.groupId,
              description: data.description,
              amountCents,
              currency,
              fxRateToBase,
              categoryId,
              paidBy,
              splits,
              splitMethod: method,
              splitInput,
              notes: data.notes,
            },
          }
          await db.recurringRules.add(rule)
          created.recurringRuleId = rule.id
        }
        await db.expenses.add(created)
      }
      // dispara la sincronización del grupo compartido afectado (y el anterior si cambió)
      notifyGroupMutation(groupId || null)
      if (expense?.groupId && expense.groupId !== groupId) notifyGroupMutation(expense.groupId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el gasto')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!expense) return
    if (!window.confirm('¿Eliminar este gasto?')) return
    await db.expenses.update(expense.id, { deletedAt: nowISO(), ...touched() })
    notifyGroupMutation(expense.groupId)
    onClose()
  }

  const inputForMethod = (pid: UUID) => {
    if (method === 'equal') return null
    const suffix = method === 'percent' ? '%' : method === 'shares' ? 'partes' : currency
    return (
      <div className="flex items-center gap-1.5">
        <input
          className="input w-24 text-right"
          inputMode="decimal"
          placeholder="0"
          value={rawInputs[pid] ?? ''}
          onChange={(e) => setRawInputs((prev) => ({ ...prev, [pid]: e.target.value }))}
        />
        <span className="w-10 text-xs text-slate-400">{suffix}</span>
      </div>
    )
  }

  return (
    <Modal
      title={expense ? 'Editar gasto' : 'Nuevo gasto'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {expense && (
            <button className="btn-secondary !px-3 text-red-600" onClick={handleDelete} aria-label="Eliminar gasto">
              <IconTrash size={18} />
            </button>
          )}
          <button className="btn-secondary flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p
            ref={errorRef}
            className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <Field label="Descripción">
          <input
            className="input"
            placeholder="Mercado, cena, taxi…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={method === 'items' ? 'Total (por ítems)' : 'Monto'}>
            <input
              className="input text-lg font-semibold"
              inputMode="decimal"
              placeholder="0"
              value={method === 'items' ? centsToInput(itemsTotalCents, currency) : amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              disabled={method === 'items'}
            />
          </Field>
          <Field label="Moneda">
            <select
              className="input"
              value={currency}
              onChange={(e) => handleCurrencyChange(e.target.value)}
            >
              {[...new Set([base, ...SUPPORTED_CURRENCIES])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {currency !== base && (
          <Field label={`Tasa de cambio (1 ${currency} en ${base})`}>
            <div className="flex items-center gap-2">
              <input
                className="input"
                inputMode="decimal"
                placeholder={fxLoading ? 'Obteniendo tasa…' : 'Ej: 4000'}
                value={fxRateStr}
                onChange={(e) => setFxRateStr(e.target.value)}
              />
              {!Number.isNaN(amountCents) && Number(fxRateStr) > 0 && (
                <span className="shrink-0 text-xs text-slate-500">
                  ≈ {formatMoney(Math.round(amountCents * Number(fxRateStr)), base)}
                </span>
              )}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Grupo">
            <select
              className="input"
              value={groupId}
              onChange={(e) => handleGroupChange(e.target.value)}
            >
              <option value="">Sin grupo</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Categoría">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={`chip ${
                  categoryId === c.id
                    ? 'text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
                style={categoryId === c.id ? { backgroundColor: c.color } : undefined}
              >
                <span>{c.icon}</span> {c.name}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Pagado por">
          <div className="space-y-2">
            <SegmentedControl
              options={[
                { value: 'single', label: 'Una persona' },
                { value: 'multi', label: 'Varias personas' },
              ]}
              value={payerMode}
              onChange={setPayerMode}
            />
            {payerMode === 'single' ? (
              <select className="input" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isMe ? `${p.name} (yo)` : p.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-1.5">
                {selectablePersons.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <Avatar person={p} size={26} />
                    <span className="flex-1 truncate text-sm">{p.name}</span>
                    <input
                      className="input w-28 text-right"
                      inputMode="decimal"
                      placeholder="0"
                      value={payerAmounts[p.id] ?? ''}
                      onChange={(e) =>
                        setPayerAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
                <QuickAddPerson onCreated={handlePersonCreated} />
                {!Number.isNaN(amountCents) && (
                  <p
                    className={`text-xs font-medium ${payersSumCents === amountCents ? 'text-emerald-600' : 'text-amber-600'}`}
                  >
                    Pagado: {formatMoney(payersSumCents, currency)} de{' '}
                    {formatMoney(amountCents, currency)}
                  </p>
                )}
              </div>
            )}
          </div>
        </Field>

        <Field label="Dividir">
          <div className="space-y-2">
            <SegmentedControl options={METHOD_LABELS} value={method} onChange={setMethod} />

            {method !== 'items' ? (
              <div className="space-y-1.5">
                {selectablePersons.map((p) => {
                  const active = participantIds.includes(p.id)
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleParticipant(p.id)}
                        className={`flex flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition ${
                          active ? '' : 'opacity-40 grayscale'
                        } hover:bg-slate-50 dark:hover:bg-slate-800`}
                      >
                        <Avatar person={p} size={26} />
                        <span className="truncate text-sm">{p.isMe ? `${p.name} (yo)` : p.name}</span>
                      </button>
                      {active && inputForMethod(p.id)}
                    </div>
                  )
                })}
                <QuickAddPerson onCreated={handlePersonCreated} />
                {method === 'exact' && !Number.isNaN(amountCents) && (
                  <p
                    className={`text-xs font-medium ${exactSumCents === amountCents ? 'text-emerald-600' : 'text-amber-600'}`}
                  >
                    Asignado: {formatMoney(exactSumCents, currency)} de{' '}
                    {formatMoney(amountCents, currency)}
                  </p>
                )}
                {method === 'percent' && (
                  <p
                    className={`text-xs font-medium ${Math.abs(percentSum - 100) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}
                  >
                    Suma: {percentSum}%
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={it.id} className="card space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        className="input flex-1"
                        placeholder={`Ítem ${idx + 1}`}
                        value={it.name}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x)),
                          )
                        }
                      />
                      <input
                        className="input w-24 text-right"
                        inputMode="decimal"
                        placeholder="0"
                        value={it.amountStr}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) =>
                              x.id === it.id ? { ...x, amountStr: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="p-1 text-slate-400 hover:text-red-500"
                        onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
                        aria-label="Quitar ítem"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectablePersons.map((p) => {
                        const active = it.personIds.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id
                                    ? {
                                        ...x,
                                        personIds: active
                                          ? x.personIds.filter((id) => id !== p.id)
                                          : [...x.personIds, p.id],
                                      }
                                    : x,
                                ),
                              )
                            }
                            className={`chip ${
                              active
                                ? 'bg-brand-600 text-white'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { id: uuid(), name: '', amountStr: '', personIds: [] },
                    ])
                  }
                >
                  + Agregar ítem
                </button>
                <QuickAddPerson onCreated={handlePersonCreated} />
              </div>
            )}
          </div>
        </Field>

        <Field label="Recibo">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setReceiptFile(f)
                  setKeepReceipt(false)
                }
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              <IconCamera size={16} /> Foto
            </button>
            {(receiptFile || (keepReceipt && existingReceipt)) && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleScan}
                disabled={ocrBusy}
              >
                <IconSparkles size={16} /> {ocrBusy ? 'Escaneando…' : 'Escanear (OCR)'}
              </button>
            )}
            {(receiptFile || keepReceipt) && (
              <>
                <button
                  type="button"
                  className="p-1 text-slate-400 hover:text-red-500"
                  onClick={() => {
                    setReceiptFile(null)
                    setKeepReceipt(false)
                  }}
                  aria-label="Quitar recibo"
                >
                  <IconTrash size={16} />
                </button>
              </>
            )}
          </div>
          {receiptPreviewUrl && (
            <img
              src={receiptPreviewUrl}
              alt="Recibo"
              className="mt-2 max-h-40 rounded-xl object-contain"
            />
          )}
        </Field>

        {!expense && (
          <Field label="Repetir">
            <select
              className="input"
              value={recurring}
              onChange={(e) => setRecurring(e.target.value as RecurringFrequency | '')}
            >
              <option value="">No se repite</option>
              <option value="weekly">Cada semana</option>
              <option value="monthly">Cada mes</option>
              <option value="yearly">Cada año</option>
            </select>
          </Field>
        )}

        <Field label="Notas">
          <textarea
            className="input"
            rows={2}
            placeholder="Opcional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}

