import { useMemo, useState } from 'react'
import type { Expense } from '../../db/types'
import { db, touched } from '../../db/db'
import { useApp } from '../../state/AppContext'
import { useExpenses, useSettlements } from '../../db/hooks'
import { EmptyState, SegmentedControl } from '../../components/ui'
import {
  IconArrowLeft,
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
import { useDriveImage, useScrollY } from '../../hooks/useDriveImage'
import { ExpenseForm } from '../expenses/ExpenseForm'
import { ExpenseList } from '../expenses/ExpenseList'
import { GroupBalances } from '../balances/GroupBalances'
import { ShareGroupModal } from './ShareGroupModal'
import { GroupForm } from './GroupsPage'

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

  // La portada se desvanece al hacer scroll (0 arriba → 1 colapsado)
  const scrollY = useScrollY()
  const collapse = Math.min(1, scrollY / 200)
  const heroHeight = 176 - collapse * (176 - 64) // 176px → 64px
  const coverOpacity = 1 - collapse * 0.85

  const iconBtn =
    'rounded-full bg-black/30 p-2 text-white backdrop-blur-sm transition hover:bg-black/50'

  return (
    <div className="space-y-4">
      {/* Hero con portada de fondo (se colapsa/desvanece al bajar) */}
      <div
        className="sticky top-0 z-20 -mx-4 -mt-4 overflow-hidden sm:-mx-6 sm:-mt-4"
        style={{ height: heroHeight }}
      >
        {/* fondo: portada o degradado del color de marca */}
        {groupImage ? (
          <img
            src={groupImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: coverOpacity }}
          />
        ) : (
          <div
            className="absolute inset-0 bg-gradient-to-br from-brand-600 to-brand-800"
            style={{ opacity: coverOpacity }}
          />
        )}
        {/* scrim para legibilidad + base sólida cuando la portada se desvanece */}
        <div className="absolute inset-0 bg-slate-950" style={{ opacity: collapse * 0.9 }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/40" />

        {/* barra superior: volver + acciones (siempre visibles) */}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3">
          <button onClick={goBack} className={iconBtn} aria-label="Volver a grupos">
            <IconArrowLeft size={18} />
          </button>
          {collapse > 0.55 && (
            <span className="truncate text-sm font-bold text-white">
              {isNone ? 'Sin grupo' : group!.name}
            </span>
          )}
          <div className="ml-auto flex gap-1.5">
            {group?.share && (
              <button
                className={iconBtn}
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true)
                  try {
                    await syncGroup(group.id, true)
                  } catch {
                    // el error queda en share.lastError y se muestra abajo
                  } finally {
                    setSyncing(false)
                  }
                }}
                aria-label="Sincronizar"
              >
                <IconRepeat size={17} className={syncing ? 'animate-spin' : ''} />
              </button>
            )}
            {group && (
              <>
                <button className={iconBtn} onClick={() => setShowShare(true)} aria-label="Compartir grupo">
                  <IconShare size={17} />
                </button>
                <button className={iconBtn} onClick={() => setShowEdit(true)} aria-label="Editar grupo">
                  <IconPencil size={17} />
                </button>
                <button className={iconBtn} onClick={deleteGroup} aria-label="Eliminar grupo">
                  <IconTrash size={17} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* título + estado de sync, abajo del hero (se desvanece al colapsar) */}
        <div
          className="absolute inset-x-0 bottom-0 p-4"
          style={{ opacity: 1 - collapse * 1.4 }}
        >
          <h2 className="truncate text-2xl font-extrabold text-white drop-shadow">
            {isNone ? 'Sin grupo' : group!.name}
          </h2>
          {group?.share && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-white/90">
              <IconCloud size={12} />
              {group.share.lastError ? (
                <span className="truncate" title={group.share.lastError}>
                  {group.share.lastError}
                </span>
              ) : (
                <span>
                  {group.share.lastSyncAt
                    ? `Sincronizado ${timeAgo(group.share.lastSyncAt)}`
                    : 'Sin sincronizar'}
                </span>
              )}
            </p>
          )}
        </div>
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
