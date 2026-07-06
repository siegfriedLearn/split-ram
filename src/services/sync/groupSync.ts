import { db, newEntity, notDeleted, touched } from '../../db/db'
import type { Category, Expense, Group, Person, UUID } from '../../db/types'
import { getAccessToken, NeedsAuthError } from '../google/auth'
import {
  batchGetTabs,
  createSpreadsheet,
  ensureFolder,
  fileIntoFolder,
  listFolderSheets,
  listRamSplitSpreadsheets,
  makeFilePublic,
  overwriteTab,
  shareWithEmails,
  uploadToFolder,
  type ShareResult,
} from '../google/sheets'
import { compressImage } from '../../utils/image'
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
import { notifyGroupChanges } from '../notifications'
import { formatMoney } from '../../utils/format'

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

/**
 * Sube un blob local (de la tabla receipts) a la carpeta; cachea la copia.
 * `makePublic` hace el archivo visible por link (para portadas, que todos ven
 * incrustadas); los recibos van privados (solo por acceso a la carpeta).
 */
async function uploadLocalImage(
  localId: string,
  folderId: string,
  name: string,
  token: string,
  makePublic = false,
): Promise<string | null> {
  const local = await db.receipts.get(localId)
  if (!local) return null
  const compressed = await compressImage(local.blob)
  const driveId = await uploadToFolder(folderId, compressed, name, token)
  if (makePublic) await makeFilePublic(driveId, token).catch(() => {})
  await db.driveBlobs.put({ id: driveId, blob: compressed, mimeType: compressed.type, fetchedAt: nowISO() })
  return driveId
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
  let group = await db.groups.get(groupId)
  if (!group?.share) return
  const share = group.share
  try {
    const token = await getAccessToken(interactive)

    // Sube imágenes locales pendientes (recibos y portada) a la carpeta del grupo;
    // marca receiptDriveId/imageDriveId con touched para que se propaguen luego.
    if (share.folderId) {
      if (group.imageLocalId && !group.imageDriveId) {
        const driveId = await uploadLocalImage(
          group.imageLocalId,
          share.folderId,
          `portada-${group.name}`,
          token,
          true, // portada pública por link
        ).catch(() => null)
        if (driveId) await db.groups.update(groupId, { imageDriveId: driveId, ...touched() })
      }
      const pendingReceipts = (await db.expenses.where('groupId').equals(groupId).toArray()).filter(
        (e) => e.receiptId && !e.receiptDriveId,
      )
      for (const e of pendingReceipts) {
        const driveId = await uploadLocalImage(
          e.receiptId!,
          share.folderId,
          `recibo-${e.date}`,
          token,
        ).catch(() => null)
        if (driveId) await db.expenses.update(e.id, { receiptDriveId: driveId, ...touched() })
      }
      group = (await db.groups.get(groupId)) ?? group // refresca updatedAt/imageDriveId
    }

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
      if (remoteMeta && remoteMeta.updatedAt > group!.updatedAt) {
        await db.groups.update(groupId, {
          name: remoteMeta.name,
          type: remoteMeta.type,
          currency: remoteMeta.currency,
          defaultSplit: remoteMeta.defaultSplit,
          imageDriveId: remoteMeta.imageDriveId ?? null,
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

    // Notifica cambios traídos de otros miembros (no en el primer pull del grupo)
    const incoming = recE.toLocal.length + recS.toLocal.length
    if (share.lastSyncAt && incoming > 0) {
      let summary = `${incoming} cambio${incoming === 1 ? '' : 's'} nuevo${incoming === 1 ? '' : 's'}`
      if (recE.toLocal.length === 1 && recS.toLocal.length === 0) {
        const e = recE.toLocal[0]
        const payer = (await db.persons.get(e.paidBy[0]?.personId ?? ''))?.name ?? 'Alguien'
        summary = e.deletedAt
          ? `Se eliminó "${e.description}"`
          : `${payer}: "${e.description}" · ${formatMoney(e.amountCents, e.currency)}`
      }
      void notifyGroupChanges(group!.name, summary)
    }
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
  logDebug('share', `hoja creada: ${spreadsheetId}, organizando en carpetas…`)

  // Organiza en "RAM Split / <grupo> /". La carpeta del grupo es lo que se
  // comparte: así los miembros acceden también a recibos e imagen.
  const rootFolder = await ensureFolder('RAM Split', null, token)
  const groupFolder = await ensureFolder(group.name, rootFolder, token)
  await fileIntoFolder(spreadsheetId, groupFolder, token)

  // Sube la portada del grupo (si el usuario le puso una) a la carpeta
  let imageDriveId = group.imageDriveId ?? null
  if (group.imageLocalId && !imageDriveId) {
    imageDriveId = await uploadLocalImage(
      group.imageLocalId,
      groupFolder,
      `portada-${group.name}`,
      token,
      true, // portada pública por link: todos los miembros la ven
    )
  }
  logDebug('share', 'sembrando datos…')

  const persons = (await db.persons.bulkGet(group.memberIds)).filter((p): p is Person =>
    Boolean(p),
  )
  const expenses = await db.expenses.where('groupId').equals(group.id).toArray()
  const settlements = await db.settlements.where('groupId').equals(group.id).toArray()
  const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c]))

  // Sube los recibos ya existentes antes de sembrar los gastos
  for (const e of expenses) {
    if (e.receiptId && !e.receiptDriveId) {
      const driveId = await uploadLocalImage(e.receiptId, groupFolder, `recibo-${e.date}`, token)
      if (driveId) {
        e.receiptDriveId = driveId
        await db.expenses.update(e.id, { receiptDriveId: driveId })
      }
    }
  }

  const seededGroup = { ...group, imageDriveId }
  await overwriteTab(spreadsheetId, 'meta', [[groupToMeta(seededGroup)]], token)
  await overwriteTab(spreadsheetId, 'members', persons.map(personToRow), token)
  await overwriteTab(
    spreadsheetId,
    'expenses',
    expenses.map((e) => expenseToRow(e, catRef(cats.get(e.categoryId)))),
    token,
  )
  await overwriteTab(spreadsheetId, 'settlements', settlements.map(settlementToRow), token)

  logDebug('share', 'datos sembrados, compartiendo la carpeta por Drive…')
  const inviteResult = await shareWithEmails(
    groupFolder,
    invites.map((i) => i.email),
    token,
  )
  logDebug('share', 'resultado invitaciones', {
    ok: inviteResult.shared,
    fallidas: inviteResult.failed,
  })

  await db.groups.update(group.id, {
    imageDriveId,
    share: {
      spreadsheetId,
      folderId: groupFolder,
      role: 'owner' as const,
      lastSyncAt: nowISO(),
      lastError: null,
    },
  })

  return { spreadsheetId, joinLink: buildJoinLink(groupFolder), invites: inviteResult }
}

/** Invitar más personas a un grupo ya compartido (comparte la carpeta si existe). */
export async function inviteMore(group: Group, emails: string[]): Promise<ShareResult> {
  if (!group.share) throw new Error('El grupo no está compartido')
  const token = await getAccessToken(true)
  const target = group.share.folderId ?? group.share.spreadsheetId
  return shareWithEmails(target, emails, token)
}

// ---------- unirse a un grupo ----------

export type JoinResult =
  | { status: 'joined'; groupId: string }
  | { status: 'chooseIdentity'; groupId: string; members: Person[] }

/**
 * `id` puede ser una carpeta (links nuevos) o una hoja (links antiguos / dueño).
 * Resuelve la hoja y, si es carpeta, guarda folderId para acceder a las imágenes.
 */
export async function joinGroup(id: string): Promise<JoinResult> {
  const token = await getAccessToken(true)

  // ¿ya está vinculado (por carpeta o por hoja)?
  const groups = await db.groups.toArray()
  const linked = groups.find(
    (g) => g.share && (g.share.folderId === id || g.share.spreadsheetId === id),
  )
  if (linked) {
    await syncGroup(linked.id, true)
    return finishJoin(linked.id)
  }

  // ¿es una carpeta con una hoja de Ram Split adentro?
  let folderId: string | null = null
  let spreadsheetId = id
  const sheets = await listFolderSheets(id, token)
  if (sheets.length > 0) {
    folderId = id
    spreadsheetId = sheets[0].id
  }
  // Si no es carpeta accesible, se trata `id` como hoja; batchGetTabs lanzará
  // "sin permiso"/"no se encontró" si no hay acceso → la UI abre el selector.

  const tabs = await batchGetTabs(spreadsheetId, SHEET_TABS, token)
  const metaRaw = tabs.meta[0]?.[0]
  if (!metaRaw) throw new Error('La hoja no tiene el formato de un grupo de Ram Split')
  const meta = parseMeta(metaRaw)

  const share = {
    spreadsheetId,
    folderId,
    role: 'member' as const,
    lastSyncAt: null,
    lastError: null,
  }

  const existing = await db.groups.get(meta.id)
  if (existing) {
    await db.groups.update(meta.id, { share, imageDriveId: meta.imageDriveId ?? null })
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
    imageDriveId: meta.imageDriveId ?? null,
    share,
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

// ---------- buscar mis grupos en Drive ----------

export interface FindGroupsResult {
  reconnected: string[]
  alreadyLinked: number
  needIdentity: number
}

/**
 * Reconecta automáticamente todos los grupos de Ram Split que la cuenta Google
 * puede ver (los que creó o autorizó antes) y que aún no están en este
 * dispositivo. Ideal para un teléfono nuevo: no hay que rehacer nada.
 */
export async function findMyGroups(): Promise<FindGroupsResult> {
  const token = await getAccessToken(true)
  const sheets = await listRamSplitSpreadsheets(token)
  logDebug('find', `Drive reporta ${sheets.length} hoja(s) de Ram Split`)

  const localGroups = await db.groups.toArray()
  const linkedIds = new Set(
    localGroups.filter((g) => g.share).map((g) => g.share!.spreadsheetId),
  )

  const result: FindGroupsResult = { reconnected: [], alreadyLinked: 0, needIdentity: 0 }
  for (const sheet of sheets) {
    if (linkedIds.has(sheet.id)) {
      result.alreadyLinked++
      continue
    }
    try {
      const joined = await joinGroup(sheet.id)
      result.reconnected.push(sheet.name)
      if (joined.status === 'chooseIdentity') result.needIdentity++
    } catch (e) {
      logDebug('find', `no se pudo reconectar ${sheet.name}`, e instanceof Error ? e.message : e)
    }
  }
  logDebug('find', `reconectados ${result.reconnected.length}, ya vinculados ${result.alreadyLinked}`)
  return result
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
