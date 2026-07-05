import { useMemo, useState } from 'react'
import { db, newEntity, touched } from '../../db/db'
import { useExpenses, useSettlements } from '../../db/hooks'
import { useApp } from '../../state/AppContext'
import { Avatar, EmptyState, Field, Modal } from '../../components/ui'
import { IconArrowRight, IconScale, IconTrash } from '../../components/icons'
import { computeNetBalances } from '../../domain/balances'
import { simplifyDebts, type Transfer } from '../../domain/simplifyDebts'
import {
  centsToInput,
  currencyDecimals,
  formatDate,
  formatMoney,
  parseAmountToCents,
} from '../../utils/format'
import { nowISO, todayISO } from '../../utils/id'
import { notifyGroupMutation } from '../../services/sync/groupSync'

/** Balances, deudas simplificadas y pagos de un grupo ('none' = gastos sin grupo). */
export function GroupBalances({ scope }: { scope: string }) {
  const { personById, settings } = useApp()
  const expenses = useExpenses()
  const settlements = useSettlements()
  const [settling, setSettling] = useState<Transfer | 'manual' | null>(null)

  const scoped = useMemo(() => {
    const match = (groupId: string | null) => (scope === 'none' ? !groupId : groupId === scope)
    return {
      exp: (expenses ?? []).filter((e) => match(e.groupId)),
      set: (settlements ?? []).filter((s) => match(s.groupId)),
    }
  }, [expenses, settlements, scope])

  const minVisibleCents = currencyDecimals(settings.baseCurrency) === 0 ? 100 : 1

  const balances = useMemo(() => computeNetBalances(scoped.exp, scoped.set), [scoped])
  const transfers = useMemo(
    () => simplifyDebts(balances).filter((t) => t.amountCents >= minVisibleCents),
    [balances, minVisibleCents],
  )
  const balanceRows = useMemo(
    () =>
      [...balances.entries()]
        .filter(([, v]) => Math.abs(v) >= minVisibleCents)
        .sort((a, b) => b[1] - a[1]),
    [balances, minVisibleCents],
  )

  async function deleteSettlement(id: string) {
    if (!window.confirm('¿Eliminar este pago?')) return
    const settlement = await db.settlements.get(id)
    await db.settlements.update(id, { deletedAt: nowISO(), ...touched() })
    notifyGroupMutation(settlement?.groupId)
  }

  const base = settings.baseCurrency

  return (
    <div className="space-y-5">
      {balanceRows.length === 0 ? (
        <EmptyState
          icon={<IconScale size={48} />}
          title="Todo está saldado"
          hint="Cuando haya deudas pendientes las verás aquí."
        />
      ) : (
        <>
          <section>
            <h3 className="mb-2 px-1 text-sm font-bold text-slate-500 dark:text-slate-400">
              Balances
            </h3>
            <div className="card divide-y divide-slate-100 dark:divide-slate-800">
              {balanceRows.map(([personId, amount]) => {
                const person = personById.get(personId)
                const positive = amount > 0
                return (
                  <div key={personId} className="flex items-center gap-3 px-4 py-3">
                    <Avatar person={person} size={34} />
                    <p className="flex-1 truncate text-sm font-semibold">
                      {person?.isMe ? 'Tú' : (person?.name ?? '?')}
                    </p>
                    <div className="text-right">
                      <p
                        className={`text-sm font-bold ${positive ? 'text-emerald-600' : 'text-red-500'}`}
                      >
                        {positive ? '+' : ''}
                        {formatMoney(amount, base)}
                      </p>
                      <p className="text-xs text-slate-400">{positive ? 'le deben' : 'debe'}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 px-1 text-sm font-bold text-slate-500 dark:text-slate-400">
              Deudas simplificadas ({transfers.length}{' '}
              {transfers.length === 1 ? 'transferencia' : 'transferencias'})
            </h3>
            <div className="card divide-y divide-slate-100 dark:divide-slate-800">
              {transfers.map((t, i) => {
                const from = personById.get(t.from)
                const to = personById.get(t.to)
                return (
                  <div key={i} className="flex items-center gap-2 px-4 py-3">
                    <Avatar person={from} size={28} />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {from?.isMe ? 'Tú' : from?.name}
                    </span>
                    <IconArrowRight size={14} className="shrink-0 text-slate-400" />
                    <Avatar person={to} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {to?.isMe ? 'Tú' : to?.name}
                    </span>
                    <span className="shrink-0 text-sm font-bold">
                      {formatMoney(t.amountCents, base)}
                    </span>
                    <button
                      className="ml-1 shrink-0 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300"
                      onClick={() => setSettling(t)}
                    >
                      Liquidar
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}

      <button className="btn-secondary w-full" onClick={() => setSettling('manual')}>
        Registrar un pago manual
      </button>

      {scoped.set.length > 0 && (
        <section>
          <h3 className="mb-2 px-1 text-sm font-bold text-slate-500 dark:text-slate-400">
            Pagos registrados
          </h3>
          <div className="card divide-y divide-slate-100 dark:divide-slate-800">
            {scoped.set.map((s) => {
              const from = personById.get(s.fromPersonId)
              const to = personById.get(s.toPersonId)
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {from?.isMe ? 'Tú' : from?.name} pagó a {to?.isMe ? 'ti' : to?.name}
                    </p>
                    <p className="text-xs text-slate-500">{formatDate(s.date)}</p>
                  </div>
                  <span className="text-sm font-bold">
                    {formatMoney(s.amountCents, s.currency)}
                  </span>
                  <button
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                    onClick={() => deleteSettlement(s.id)}
                    aria-label="Eliminar pago"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {settling && (
        <SettleForm
          prefill={settling === 'manual' ? null : settling}
          groupId={scope !== 'none' ? scope : null}
          onClose={() => setSettling(null)}
        />
      )}
    </div>
  )
}

function SettleForm({
  prefill,
  groupId,
  onClose,
}: {
  prefill: Transfer | null
  groupId: string | null
  onClose: () => void
}) {
  const { persons, settings, me } = useApp()
  const base = settings.baseCurrency
  const [fromId, setFromId] = useState(prefill?.from ?? me?.id ?? '')
  const [toId, setToId] = useState(prefill?.to ?? '')
  const initialAmountStr = prefill ? centsToInput(prefill.amountCents, base) : ''
  const [amountStr, setAmountStr] = useState(initialAmountStr)
  const [date, setDate] = useState(todayISO())
  const [error, setError] = useState('')

  async function save() {
    // Si el usuario no tocó el monto prellenado, liquida el valor exacto en centavos
    const amountCents =
      prefill && amountStr === initialAmountStr
        ? prefill.amountCents
        : parseAmountToCents(amountStr)
    if (!fromId || !toId || fromId === toId) {
      setError('Elige dos personas distintas')
      return
    }
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setError('Ingresa un monto válido')
      return
    }
    await db.settlements.add({
      ...newEntity(),
      groupId,
      fromPersonId: fromId,
      toPersonId: toId,
      amountCents,
      currency: base,
      fxRateToBase: 1,
      date,
    })
    notifyGroupMutation(groupId)
    onClose()
  }

  return (
    <Modal
      title="Registrar pago"
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quién paga">
            <select className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">Elegir…</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.isMe ? `${p.name} (yo)` : p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Recibe">
            <select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Elegir…</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.isMe ? `${p.name} (yo)` : p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Monto (${base})`}>
            <input
              className="input"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
            />
          </Field>
          <Field label="Fecha">
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
