import { db, newEntity, notDeleted, touched } from '../../db/db'
import type { Category, Expense, Group, Person, UUID } from '../../db/types'
import { getAccessToken, NeedsAuthError } from '../google/auth'
import {
  batchGetTabs,
  createSpreadsheet,
  overwriteTab,
  shareWithEmails,
  type ShareResult,
} from '../google/sheets'
import { mergedState, reconcile } from './merge'
import {
  SHEET_TABS,
  expenseToRow,
  groupToMeta,
  parseExpenseRow,
  parseMeta,
  parsePersonRow,
  parseSettlementRow,
  personToRow,
  settlementToRow,
  type CategoryRef,
} from './serialization'
import { nowISO } from '../../utils/id'
import { logDebug } from '../../utils/logger'

// ---------- utilidades ----------

function catRef(category: Category | undefined): CategoryRef {
  return {
    name: category?.name ?? 'Otros',
    icon: category?.icon ?? '📦',
    color: category?.color ?? '#94a3b8',
  }
}

/** Garantiza que existan categorías locales para las refs remotas; mapa nombre→id. */
async function ensureCategories(refs: CategoryRef[]): Promise<Map<string, UUID>> {
  const cats = await db.categories.toArray()
  const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]))
  for (const ref of refs) {
    const key = ref.name.toLowerCase()
    if (!byName.has(key)) {
      const created = { ...newEntity(), name: ref.name, icon: ref.icon, color: ref.color }
      await db.categories.add(created)
      byName.set(key, created.id)
    }
  }
  return byName
}

export function buildJoinLink(spreadsheetId: string): string {
  return `${location.origin}${location.pathname}#/unirse/${spreadsheetId}`
}

// ---------- sincronización de un grupo ----------

const inFlight = new Map<string, Promise<void>>()

export function syncGroup(groupId: string, interactive = false): Promise<void> {
  const existing = inFlight.get(groupId)
  if (existing) return existing
  const p = doSync(groupId, interactive).finally(() => inFlight.delete(groupId))
  inFlight.set(groupId, p)
  return p
}

async function doSync(groupId: string, interactive: boolean): Promise<void> {
  const group = await db.groups.get(groupId)
  if (!group?.share) return
  const share = group.share
  try {
    const token = await getAccessToken(interactive)
    const tabs = await batchGetTabs(share.spreadsheetId, SHEET_TABS, token)

    // --- parseo remoto ---
    const metaRaw = tabs.meta[0]?.[0]
    const remoteMeta = metaRaw ? parseMeta(metaRaw) : null
    const remotePersons = tabs.members.map(parsePersonRow)
    const parsedExpenses = tabs.expenses.map(parseExpenseRow)
    const remoteSettlements = tabs.settlements.map(parseSettlementRow)

    const nameToCatId = await ensureCategories(parsedExpenses.map((p) => p.category))
    const remoteExpenses: Expense[] = parsedExpenses.map((p) => ({
      ...(p.expense as Omit<Expense, 'categoryId'>),
      categoryId: nameToCatId.get(p.category.name.toLowerCase())!,
    }))

    // --- estado local ---
    const localExpenses = await db.expenses.where('groupId').equals(groupId).toArray()
    const localSettlements = await db.settlements.where('groupId').equals(groupId).toArray()
    const personIds = new Set<string>([...group.memberIds, ...remotePersons.map((p) => p.id)])
    const localPersons = (await db.persons.bulkGet([...personIds])).filter(
      (p): p is Person => Boolean(p),
    )

    // --- reconciliación LWW ---
    const recE = reconcile(localExpenses, remoteExpenses)
    const recS = reconcile(localSettlements, remoteSettlements)
    const recP = reconcile(localPersons, remotePersons)

    await db.transaction('rw', [db.expenses, db.settlements, db.persons, db.groups], async () => {
      const localExpById = new Map(localExpenses.map((e) => [e.id, e]))
      for (const e of recE.toLocal) {
        // el recibo (foto) es local: se conserva el que ya hubiera
        await db.expenses.put({ ...e, receiptId: localExpById.get(e.id)?.receiptId ?? null })
      }
      for (const s of recS.toLocal) await db.settlements.put(s)
      const localPersonById = new Map(localPersons.map((p) => [p.id, p]))
      for (const p of recP.toLocal) {
        await db.persons.put({ ...p, isMe: localPersonById.get(p.id)?.isMe })
      }

      // meta del grupo por LWW
      if (remoteMeta && remoteMeta.updatedAt > group.updatedAt) {
        await db.groups.update(groupId, {
          name: remoteMeta.name,
          type: remoteMeta.type,
          currency: remoteMeta.currency,
          defaultSplit: remoteMeta.defaultSplit,
          updatedAt: remoteMeta.updatedAt,
        })
      }

      // la membresía se deriva de la tab members (miembros no borrados)
      const activeMembers = mergedState(localPersons, remotePersons).filter(notDeleted)
      await db.groups.update(groupId, { memberIds: activeMembers.map((p) => p.id) })
    })

    // --- subida (reescritura completa de tabs, hojas pequeñas) ---
    const metaIsLocalNewer = !remoteMeta || group.updatedAt > remoteMeta.updatedAt
    if (recE.toRemote.length > 0 || recS.toRemote.length > 0 || recP.toRemote.length > 0 || metaIsLocalNewer) {
      const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c]))
      const freshGroup = (await db.groups.get(groupId))!
      if (metaIsLocalNewer) {
        await overwriteTab(share.spreadsheetId, 'meta', [[groupToMeta(freshGroup)]], token)
      }
      if (recP.toRemote.length > 0) {
        const rows = mergedState(localPersons, remotePersons).map(personToRow)
        await overwriteTab(share.spreadsheetId, 'members', rows, token)
      }
      if (recE.toRemote.length > 0) {
        const rows = mergedState(localExpenses, remoteExpenses).map((e) =>
          expenseToRow(e, catRef(cats.get(e.categoryId))),
        )
        await overwriteTab(share.spreadsheetId, 'expenses', rows, token)
      }
      if (recS.toRemote.length > 0) {
        const rows = mergedState(localSettlements, remoteSettlements).map(settlementToRow)
        await overwriteTab(share.spreadsheetId, 'settlements', rows, token)
      }
    }

    logDebug(
      'sync',
      `grupo "${group.name}": ↓${recE.toLocal.length + recS.toLocal.length + recP.toLocal.length} ↑${recE.toRemote.length + recS.toRemote.length + recP.toRemote.length}`,
    )
    await db.groups.update(groupId, {
      share: { ...share, lastSyncAt: nowISO(), lastError: null },
    })
  } catch (e) {
    if (e instanceof NeedsAuthError && !interactive) {
      // Sin sesión: no molesta con popups, pero deja el motivo visible en la tarjeta
      logDebug('sync', `omitido "${group.name}": sesión de Google expirada`)
      const msg = 'Sesión de Google expirada: toca Sincronizar para reconectar'
      if (share.lastError !== msg) {
        await db.groups.update(groupId, { share: { ...share, lastError: msg } })
      }
      return
    }
    logDebug('sync', `ERROR en grupo "${group.name}"`, e instanceof Error ? e.message : e)
    await db.groups.update(groupId, {
      share: { ...share, lastError: e instanceof Error ? e.message : 'Error de sincronización' },
    })
    if (interactive) throw e
  }
}

// ---------- compartir un grupo ----------

export interface ShareGroupResult {
  spreadsheetId: string
  joinLink: string
  invites: ShareResult
}

export async function shareGroup(
  group: Group,
  invites: Array<{ personId: string | null; email: string }>,
): Promise<ShareGroupResult> {
  logDebug('share', `compartiendo "${group.name}" con ${invites.length} email(s)`)
  const token = await getAccessToken(true)
  logDebug('share', 'token OK, creando hoja de cálculo…')

  // guarda los emails en las personas para futuros matches de identidad
  for (const invite of invites) {
    if (invite.personId) {
      await db.persons.update(invite.personId, { email: invite.email, ...touched() })
    }
  }

  const spreadsheetId = await createSpreadsheet(`Ram Split · ${group.name}`, SHEET_TABS, token)
  logDebug('share', `hoja creada: ${spreadsheetId}, sembrando datos…`)

  const persons = (await db.persons.bulkGet(group.memberIds)).filter((p): p is Person =>
    Boolean(p),
  )
  const expenses = await db.expenses.where('groupId').equals(group.id).toArray()
  const settlements = await db.settlements.where('groupId').equals(group.id).toArray()
  const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c]))

  await overwriteTab(spreadsheetId, 'meta', [[groupToMeta(group)]], token)
  await overwriteTab(spreadsheetId, 'members', persons.map(personToRow), token)
  await overwriteTab(
    spreadsheetId,
    'expenses',
    expenses.map((e) => expenseToRow(e, catRef(cats.get(e.categoryId)))),
    token,
  )
  await overwriteTab(spreadsheetId, 'settlements', settlements.map(settlementToRow), token)

  logDebug('share', 'datos sembrados, compartiendo por Drive…')
  const inviteResult = await shareWithEmails(
    spreadsheetId,
    invites.map((i) => i.email),
    token,
  )
  logDebug('share', 'resultado invitaciones', {
    ok: inviteResult.shared,
    fallidas: inviteResult.failed,
  })

  await db.groups.update(group.id, {
    share: { spreadsheetId, role: 'owner' as const, lastSyncAt: nowISO(), lastError: null },
  })

  return { spreadsheetId, joinLink: buildJoinLink(spreadsheetId), invites: inviteResult }
}

/** Invitar más personas a un grupo ya compartido. */
export async function inviteMore(group: Group, emails: string[]): Promise<ShareResult> {
  if (!group.share) throw new Error('El grupo no está compartido')
  const token = await getAccessToken(true)
  return shareWithEmails(group.share.spreadsheetId, emails, token)
}

// ---------- unirse a un grupo ----------

export type JoinResult =
  | { status: 'joined'; groupId: string }
  | { status: 'chooseIdentity'; groupId: string; members: Person[] }

export async function joinGroup(spreadsheetId: string): Promise<JoinResult> {
  const token = await getAccessToken(true)

  // ¿ya está vinculado (p. ej. el dueño abriendo su propio link)?
  const groups = await db.groups.toArray()
  const linked = groups.find((g) => g.share?.spreadsheetId === spreadsheetId)
  if (linked) {
    await syncGroup(linked.id, true)
    return finishJoin(linked.id)
  }

  const tabs = await batchGetTabs(spreadsheetId, SHEET_TABS, token)
  const metaRaw = tabs.meta[0]?.[0]
  if (!metaRaw) throw new Error('La hoja no tiene el formato de un grupo de Ram Split')
  const meta = parseMeta(metaRaw)

  const existing = await db.groups.get(meta.id)
  if (existing) {
    await db.groups.update(meta.id, {
      share: { spreadsheetId, role: 'member' as const, lastSyncAt: null, lastError: null },
    })
    await syncGroup(meta.id, true)
    return finishJoin(meta.id)
  }

  // personas de la hoja (se conservan sus ids)
  const members = tabs.members.map(parsePersonRow)
  for (const p of members) {
    const local = await db.persons.get(p.id)
    if (!local) await db.persons.put(p)
  }

  await db.groups.put({
    id: meta.id,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    deletedAt: null,
    name: meta.name,
    type: meta.type,
    currency: meta.currency,
    memberIds: members.filter(notDeleted).map((p) => p.id),
    defaultSplit: meta.defaultSplit,
    share: { spreadsheetId, role: 'member' as const, lastSyncAt: null, lastError: null },
  })

  await syncGroup(meta.id, true)
  return finishJoin(meta.id)
}

/** Si mi email coincide con un miembro, adopta esa identidad; si no, hay que preguntar. */
async function finishJoin(groupId: string): Promise<JoinResult> {
  const settings = await db.settings.get('app')
  const group = (await db.groups.get(groupId))!
  const members = (await db.persons.bulkGet(group.memberIds)).filter((p): p is Person =>
    Boolean(p),
  )
  if (settings?.mePersonId && group.memberIds.includes(settings.mePersonId)) {
    return { status: 'joined', groupId } // ya soy miembro
  }
  const myEmail = settings?.googleEmail?.toLowerCase()
  const match = myEmail ? members.find((m) => m.email?.toLowerCase() === myEmail) : undefined
  if (match) {
    await adoptIdentity(match.id)
    return { status: 'joined', groupId }
  }
  return { status: 'chooseIdentity', groupId, members }
}

/**
 * Adopta a un miembro de la hoja como "yo": reescribe todas las referencias
 * locales del antiguo id (gastos, pagos, ítems, grupos) y traslada la marca isMe.
 * Las entidades reescritas bumpean updatedAt para propagarse a otras hojas propias.
 */
export async function adoptIdentity(newMeId: UUID): Promise<void> {
  const settings = await db.settings.get('app')
  const oldMeId = settings?.mePersonId
  if (!oldMeId || oldMeId === newMeId) {
    await db.settings.update('app', { mePersonId: newMeId })
    await db.persons.update(newMeId, { isMe: true })
    return
  }

  const swap = (id: UUID) => (id === oldMeId ? newMeId : id)
  await db.transaction(
    'rw',
    [db.persons, db.expenses, db.settlements, db.groups, db.settings],
    async () => {
      for (const e of await db.expenses.toArray()) {
        const involved =
          e.paidBy.some((p) => p.personId === oldMeId) ||
          e.splits.some((s) => s.personId === oldMeId) ||
          e.items?.some((it) => it.personIds.includes(oldMeId))
        if (!involved) continue
        await db.expenses.update(e.id, {
          paidBy: e.paidBy.map((p) => ({ ...p, personId: swap(p.personId) })),
          splits: e.splits.map((s) => ({ ...s, personId: swap(s.personId) })),
          items: e.items?.map((it) => ({ ...it, personIds: it.personIds.map(swap) })),
          ...touched(),
        })
      }
      for (const s of await db.settlements.toArray()) {
        if (s.fromPersonId !== oldMeId && s.toPersonId !== oldMeId) continue
        await db.settlements.update(s.id, {
          fromPersonId: swap(s.fromPersonId),
          toPersonId: swap(s.toPersonId),
          ...touched(),
        })
      }
      for (const g of await db.groups.toArray()) {
        if (!g.memberIds.includes(oldMeId)) continue
        await db.groups.update(g.id, {
          memberIds: [...new Set(g.memberIds.map(swap))],
          ...touched(),
        })
      }
      await db.persons.update(newMeId, { isMe: true, ...touched() })
      await db.persons.update(oldMeId, { isMe: false, deletedAt: nowISO(), ...touched() })
      await db.settings.update('app', { mePersonId: newMeId })
    },
  )
}

// ---------- programación ----------

export async function syncAllSharedGroups(): Promise<void> {
  const groups = (await db.groups.toArray()).filter((g) => notDeleted(g) && g.share)
  await Promise.allSettled(groups.map((g) => syncGroup(g.id)))
}

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Tras mutar datos de un grupo: sincroniza a los 3 s (agrupa ráfagas de cambios). */
export function notifyGroupMutation(groupId: string | null | undefined): void {
  if (!groupId) return
  logDebug('sync', `cambio local en grupo ${groupId.slice(0, 8)}…, sync en 3 s`)
  const prev = debounceTimers.get(groupId)
  if (prev) clearTimeout(prev)
  debounceTimers.set(
    groupId,
    setTimeout(() => {
      debounceTimers.delete(groupId)
      void syncGroup(groupId).catch(() => {})
    }, 3000),
  )
}
