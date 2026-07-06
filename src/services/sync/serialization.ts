import type {
  Expense,
  Group,
  GroupDefaultSplit,
  GroupType,
  Person,
  Settlement,
} from '../../db/types'

/**
 * Formato de fila común en la hoja: [id, updatedAt, deletedAt, json].
 * El JSON lleva la entidad completa menos campos locales (isMe, receiptId)
 * y menos los tres primeros campos (van en columnas propias para el merge).
 */

export const SHEET_TABS = ['meta', 'members', 'expenses', 'settlements'] as const

export interface CategoryRef {
  name: string
  icon: string
  color: string
}

function baseRow(e: { id: string; updatedAt: string; deletedAt?: string | null }, payload: object): string[] {
  return [e.id, e.updatedAt, e.deletedAt ?? '', JSON.stringify(payload)]
}

function parseBase(row: string[]): { id: string; updatedAt: string; deletedAt: string | null; payload: Record<string, unknown> } {
  const [id, updatedAt, deletedAt, json] = row
  return {
    id,
    updatedAt,
    deletedAt: deletedAt ? deletedAt : null,
    payload: JSON.parse(json) as Record<string, unknown>,
  }
}

// ---------- Personas (tab members) ----------

export function personToRow(p: Person): string[] {
  // isMe es local de cada dispositivo: nunca viaja a la hoja
  return baseRow(p, {
    createdAt: p.createdAt,
    name: p.name,
    email: p.email ?? null,
    color: p.color,
  })
}

export function parsePersonRow(row: string[]): Person {
  const { id, updatedAt, deletedAt, payload } = parseBase(row)
  return {
    id,
    updatedAt,
    deletedAt,
    createdAt: (payload.createdAt as string) ?? updatedAt,
    name: payload.name as string,
    email: (payload.email as string | null) ?? undefined,
    color: (payload.color as string) ?? '#94a3b8',
  }
}

// ---------- Gastos (tab expenses) ----------

export interface ParsedExpenseRow {
  expense: Omit<Expense, 'categoryId'>
  category: CategoryRef
}

export function expenseToRow(e: Expense, category: CategoryRef): string[] {
  const {
    id: _id,
    updatedAt: _u,
    deletedAt: _d,
    categoryId: _c,
    receiptId: _r, // los recibos (fotos) no se sincronizan
    ...rest
  } = e
  return baseRow(e, { ...rest, category })
}

export function parseExpenseRow(row: string[]): ParsedExpenseRow {
  const { id, updatedAt, deletedAt, payload } = parseBase(row)
  const { category, ...rest } = payload as Record<string, unknown> & { category: CategoryRef }
  return {
    category,
    expense: {
      ...(rest as unknown as Omit<Expense, 'categoryId' | 'id' | 'updatedAt' | 'deletedAt'>),
      id,
      updatedAt,
      deletedAt,
      receiptId: null,
    },
  }
}

// ---------- Pagos (tab settlements) ----------

export function settlementToRow(s: Settlement): string[] {
  const { id: _id, updatedAt: _u, deletedAt: _d, ...rest } = s
  return baseRow(s, rest)
}

export function parseSettlementRow(row: string[]): Settlement {
  const { id, updatedAt, deletedAt, payload } = parseBase(row)
  return { ...(payload as unknown as Omit<Settlement, 'id' | 'updatedAt' | 'deletedAt'>), id, updatedAt, deletedAt }
}

// ---------- Grupo (tab meta, celda A1) ----------

export interface GroupMeta {
  version: 1
  id: string
  createdAt: string
  updatedAt: string
  name: string
  type: GroupType
  currency: string
  defaultSplit: GroupDefaultSplit | null
  imageDriveId?: string | null
}

export function groupToMeta(g: Group): string {
  const meta: GroupMeta = {
    version: 1,
    id: g.id,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    name: g.name,
    type: g.type,
    currency: g.currency,
    defaultSplit: g.defaultSplit ?? null,
    imageDriveId: g.imageDriveId ?? null,
  }
  return JSON.stringify(meta)
}

export function parseMeta(raw: string): GroupMeta {
  const meta = JSON.parse(raw) as GroupMeta
  if (meta.version !== 1 || !meta.id || !meta.name) {
    throw new Error('La hoja no tiene el formato de un grupo de Ram Split')
  }
  return meta
}
