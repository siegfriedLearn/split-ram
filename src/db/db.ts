import Dexie, { type Table } from 'dexie'
import type {
  Person,
  Group,
  Category,
  Expense,
  Receipt,
  Settlement,
  RecurringRule,
  Budget,
  Settings,
} from './types'
import { uuid, nowISO } from '../utils/id'

export class RamSplitDB extends Dexie {
  persons!: Table<Person, string>
  groups!: Table<Group, string>
  categories!: Table<Category, string>
  expenses!: Table<Expense, string>
  receipts!: Table<Receipt, string>
  settlements!: Table<Settlement, string>
  recurringRules!: Table<RecurringRule, string>
  budgets!: Table<Budget, string>
  settings!: Table<Settings, string>

  constructor() {
    super('ram-split')
    this.version(1).stores({
      persons: 'id, name',
      groups: 'id, name',
      categories: 'id, name',
      expenses: 'id, date, groupId, categoryId, recurringRuleId',
      receipts: 'id',
      settlements: 'id, date, groupId',
      recurringRules: 'id, nextDate',
      budgets: 'id, categoryId',
      settings: 'id',
    })
    this.on('populate', () => seed(this))
  }
}

export const DEFAULT_CATEGORIES: Array<Pick<Category, 'name' | 'icon' | 'color'>> = [
  { name: 'Arriendo y hogar', icon: '🏠', color: '#0ea5e9' },
  { name: 'Servicios', icon: '💡', color: '#eab308' },
  { name: 'Mercado', icon: '🛒', color: '#22c55e' },
  { name: 'Restaurantes', icon: '🍽️', color: '#f97316' },
  { name: 'Transporte', icon: '🚗', color: '#6366f1' },
  { name: 'Entretenimiento', icon: '🎬', color: '#ec4899' },
  { name: 'Viajes', icon: '✈️', color: '#14b8a6' },
  { name: 'Salud', icon: '💊', color: '#ef4444' },
  { name: 'Educación', icon: '📚', color: '#8b5cf6' },
  { name: 'Compras', icon: '🛍️', color: '#d946ef' },
  { name: 'Mascotas', icon: '🐾', color: '#a16207' },
  { name: 'Regalos', icon: '🎁', color: '#f43f5e' },
  { name: 'Suscripciones', icon: '📱', color: '#64748b' },
  { name: 'Otros', icon: '📦', color: '#94a3b8' },
]

export const PERSON_COLORS = [
  '#0d9488',
  '#6366f1',
  '#f97316',
  '#ec4899',
  '#22c55e',
  '#eab308',
  '#ef4444',
  '#8b5cf6',
  '#0ea5e9',
  '#a16207',
]

function stamp() {
  const now = nowISO()
  return { createdAt: now, updatedAt: now, deletedAt: null }
}

async function seed(db: RamSplitDB) {
  const meId = uuid()
  await db.persons.add({ id: meId, name: 'Yo', color: PERSON_COLORS[0], isMe: true, ...stamp() })
  await db.categories.bulkAdd(
    DEFAULT_CATEGORIES.map((c) => ({ id: uuid(), ...c, isDefault: true, ...stamp() })),
  )
  await db.settings.add({
    id: 'app',
    baseCurrency: 'COP',
    theme: 'system',
    mePersonId: meId,
  })
}

export const db = new RamSplitDB()

/** Crea los campos base de una entidad nueva. */
export function newEntity() {
  return { id: uuid(), ...stamp() }
}

/** Marca updatedAt al editar. */
export function touched() {
  return { updatedAt: nowISO() }
}

export function notDeleted<T extends { deletedAt?: string | null }>(x: T): boolean {
  return !x.deletedAt
}
