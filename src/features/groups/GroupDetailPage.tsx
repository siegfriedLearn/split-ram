import { useMemo, useState } from 'react'
import type { Expense } from '../../db/types'
import { db, touched } from '../../db/db'
import { useApp } from '../../state/AppContext'
import { useExpenses, useSettlements } from '../../db/hooks'
import { EmptyState, SegmentedControl } from '../../components/ui'
import {
  IconCloud,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconRepeat,
  IconShare,
  IconTrash,
} from '../../components/icons'
import { formatMoney, timeAgo } from '../../utils/format'
import { computeNetBalances } from '../../domain/balances'
import { simplifyDebts } from '../../domain/simplifyDebts'
import { nowISO } from '../../utils/id'
import { syncGroup } from '../../services/sync/groupSync'
import { useDriveImage } from '../../hooks/useDriveImage'
import { ExpenseForm } from '../expenses/ExpenseForm'
import { ExpenseList } from '../expenses/ExpenseList'
import { GroupBalances } from '../balances/GroupBalances'
import { ShareGroupModal } from './ShareGroupModal'
import { GroupForm, GROUP_TYPES } from './GroupsPage'

/** Detalle de un grupo: sus gastos y sus balances. `groupId === 'none'` = sin grupo. */
export function GroupDetailPage({ groupId }: { groupId: string }) {
  const { groupById, personById, settings, me } = useApp()
  const expenses = useExpenses()
  const settlements = useSettlements()
  const [view, setView] = useState<'gastos' | 'balances'>('gastos')
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const isNone = groupId === 'none'
  const group = isNone ? undefined : groupById.get(groupId)
  const typeInfo = GROUP_TYPES.find((t) => t.value === group?.type)
  const groupImage = useDriveImage(group?.imageLocalId, group?.imageDriveId, true)

  const scoped = useMemo(
    () =>
      (expenses ?? []).filter((e) => (isNone ? !e.groupId : e.groupId === groupId)),
    [expenses, groupId, isNone],
  )
  const scopedSettlements = useMemo(
    () =>
      (settlements ?? []).filter((s) => (isNone ? !s.groupId : s.groupId === groupId)),
    [settlements, groupId, isNone],
  )

  // Resumen tipo Splitwise: mi posición neta y con quién, ya liquidando pagos.
  const summary = useMemo(() => {
    if (!me) return { overall: 0, lines: [] as Array<{ name: string; cents: number }> }
    const balances = computeNetBalances(scoped, scopedSettlements)
    const overall = balances.get(me.id) ?? 0
    const lines = simplifyDebts(balances)
      .filter((t) => t.from === me.id || t.to === me.id)
      .map((t) =>
        t.to === me.id
          ? { name: personById.get(t.from)?.name ?? '?', cents: t.amountCents } // me deben
          : { name: personById.get(t.to)?.name ?? '?', cents: -t.amountCents }, // le debo
      )
      .sort((a, b) => b.cents - a.cents)
    return { overall, lines }
  }, [scoped, scopedSettlements, me, personById])

  function goBack() {
    location.hash = '#/grupos'
  }

  async function deleteGroup() {
    if (!group) return
    if (!window.confirm(`¿Eliminar el grupo "${group.name}"? Sus gastos se conservan.`)) return
    await db.groups.update(group.id, { deletedAt: nowISO(), ...touched() })
    goBack()
  }

  if (!isNone && !group) {
    return (
      <EmptyState icon={<IconReceipt size={44} />} title="Grupo no encontrado" hint="Puede haber sido eliminado." />
    )
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <button
          onClick={goBack}
          className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
          aria-label="Volver a grupos"
        >
          ←
        </button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xl dark:bg-slate-800">
          {groupImage ? (
            <img src={groupImage} alt="" className="h-full w-full object-cover" />
          ) : isNone ? (
            '👛'
          ) : (
            (typeInfo?.icon ?? '📦')
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-extrabold">{isNone ? 'Sin grupo' : group!.name}</h2>
          {group?.share && (
            <p className="flex items-center gap-1 text-xs">
              <IconCloud size={12} className={group.share.lastError ? 'text-red-400' : 'text-brand-500'} />
              {group.share.lastError ? (
                <span className="truncate text-red-500" title={group.share.lastError}>
                  {group.share.lastError}
                </span>
              ) : (
                <span className="text-slate-400">
                  {group.share.lastSyncAt
                    ? `Sincronizado ${timeAgo(group.share.lastSyncAt)}`
                    : 'Sin sincronizar'}
                </span>
              )}
            </p>
          )}
        </div>
        {group && (
          <div className="flex gap-1">
            {group.share && (
              <button
                className="rounded-lg p-2 text-brand-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true)
                  try {
                    await syncGroup(group.id, true)
                  } catch {
                    // el error queda en share.lastError y se muestra en el encabezado
                  } finally {
                    setSyncing(false)
                  }
                }}
                aria-label="Sincronizar"
              >
                <IconRepeat size={17} className={syncing ? 'animate-spin' : ''} />
              </button>
            )}
            <button
              className={`rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 ${group.share ? 'text-brand-500' : 'text-slate-400'}`}
              onClick={() => setShowShare(true)}
              aria-label="Compartir grupo"
            >
              <IconShare size={17} />
            </button>
            <button
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => setShowEdit(true)}
              aria-label="Editar grupo"
            >
              <IconPencil size={17} />
            </button>
            <button
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
              onClick={deleteGroup}
              aria-label="Eliminar grupo"
            >
              <IconTrash size={17} />
            </button>
          </div>
        )}
      </div>

      {/* Resumen de cuentas (estilo Splitwise) */}
      <div className="card px-4 py-3">
        <p className="text-base font-bold">
          {Math.abs(summary.overall) < 100 ? (
            <span className="text-slate-700 dark:text-slate-200">Estás al día en este grupo</span>
          ) : summary.overall > 0 ? (
            <>
              <span className="text-slate-500">En total, </span>
              <span className="text-emerald-600">
                te deben {formatMoney(summary.overall, settings.baseCurrency)}
              </span>
            </>
          ) : (
            <>
              <span className="text-slate-500">En total, </span>
              <span className="text-red-500">
                debes {formatMoney(-summary.overall, settings.baseCurrency)}
              </span>
            </>
          )}
        </p>
        {summary.lines.length > 0 && (
          <div className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
            {summary.lines.map((l) => (
              <p key={l.name} className="text-sm">
                {l.cents > 0 ? (
                  <span className="text-emerald-600">
                    {l.name} te debe {formatMoney(l.cents, settings.baseCurrency)}
                  </span>
                ) : (
                  <span className="text-red-500">
                    Le debes a {l.name} {formatMoney(-l.cents, settings.baseCurrency)}
                  </span>
                )}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Total del grupo + selector de vista */}
      <div className="card flex items-center justify-between px-4 py-3">
        <p className="text-sm text-slate-500">
          Total gastado:{' '}
          <strong className="text-slate-700 dark:text-slate-200">
            {formatMoney(
              scoped.reduce((s, e) => s + Math.round(e.amountCents * e.fxRateToBase), 0),
              settings.baseCurrency,
            )}
          </strong>
        </p>
        <SegmentedControl
          options={[
            { value: 'gastos' as const, label: 'Gastos' },
            { value: 'balances' as const, label: 'Balances' },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {view === 'gastos' ? (
        scoped.length === 0 ? (
          <EmptyState
            icon={<IconReceipt size={44} />}
            title="Sin gastos todavía"
            hint="Toca el botón + para registrar el primero."
          />
        ) : (
          <ExpenseList expenses={scoped} onSelect={setEditing} showGroup={false} />
        )
      ) : (
        <GroupBalances scope={groupId} />
      )}

      {view === 'gastos' && (
        <button
          onClick={() => setEditing('new')}
          className="fixed right-4 bottom-24 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 active:scale-95 sm:bottom-8"
          aria-label="Nuevo gasto"
        >
          <IconPlus size={26} />
        </button>
      )}

      {editing && (
        <ExpenseForm
          expense={editing === 'new' ? null : editing}
          defaultGroupId={isNone ? null : groupId}
          onClose={() => setEditing(null)}
        />
      )}
      {showEdit && group && <GroupForm group={group} onClose={() => setShowEdit(false)} />}
      {showShare && group && (
        <ShareGroupModal
          group={groupById.get(group.id) ?? group}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}
