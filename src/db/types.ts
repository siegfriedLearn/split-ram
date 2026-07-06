export type UUID = string

/** Todas las entidades llevan UUID + timestamps + borrado suave (listas para sync futura). */
export interface BaseEntity {
  id: UUID
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface Person extends BaseEntity {
  name: string
  email?: string
  color: string
  isMe?: boolean
}

export type GroupType = 'hogar' | 'viaje' | 'pareja' | 'otro'

/** División predeterminada del grupo: se aplica al crear gastos en él. */
export interface GroupDefaultSplit {
  method: 'percent' | 'shares'
  /** Porcentaje o número de partes por persona (personId → valor). */
  values: Record<UUID, number>
}

/** Vínculo de un grupo con su hoja de cálculo compartida en Google Sheets. */
export interface GroupShare {
  spreadsheetId: string
  /** Carpeta del grupo en Drive; al compartirla, los miembros ven recibos e imagen. */
  folderId?: string | null
  role: 'owner' | 'member'
  lastSyncAt: string | null
  /** Último error de sincronización (null si la última sync fue exitosa). */
  lastError?: string | null
}

export interface Group extends BaseEntity {
  name: string
  type: GroupType
  currency: string
  memberIds: UUID[]
  defaultSplit?: GroupDefaultSplit | null
  share?: GroupShare | null
  /** Portada del grupo: id del archivo en Drive (si está compartido) para sincronizar. */
  imageDriveId?: string | null
  /** Copia local de la portada (id en la tabla receipts) antes/después de subirla. */
  imageLocalId?: string | null
}

export interface Category extends BaseEntity {
  name: string
  icon: string
  color: string
  isDefault?: boolean
}

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares' | 'items'

export interface MoneyShare {
  personId: UUID
  amountCents: number
}

export interface ExpenseItem {
  id: UUID
  name: string
  amountCents: number
  personIds: UUID[]
}

export interface Expense extends BaseEntity {
  groupId: UUID | null
  description: string
  /** Monto total en centavos de `currency`. */
  amountCents: number
  currency: string
  /** Tasa congelada al crear: 1 unidad de `currency` = fxRateToBase unidades de moneda base. */
  fxRateToBase: number
  /** Fecha local YYYY-MM-DD. */
  date: string
  categoryId: UUID
  paidBy: MoneyShare[]
  splits: MoneyShare[]
  splitMethod: SplitMethod
  /** Valores crudos ingresados (porcentajes, shares o montos exactos) para reeditar. */
  splitInput?: Record<UUID, number>
  items?: ExpenseItem[]
  notes?: string
  receiptId?: UUID | null
  /** Id del recibo en Drive (si el grupo está compartido); se sincroniza. */
  receiptDriveId?: string | null
  recurringRuleId?: UUID | null
}

export interface Receipt extends BaseEntity {
  blob: Blob
  mimeType: string
}

/** Caché local de un archivo bajado de Drive (recibo o imagen de grupo). */
export interface DriveBlob {
  /** id del archivo en Drive. */
  id: string
  blob: Blob
  mimeType: string
  fetchedAt: string
}

export interface Settlement extends BaseEntity {
  groupId: UUID | null
  fromPersonId: UUID
  toPersonId: UUID
  amountCents: number
  currency: string
  fxRateToBase: number
  date: string
  notes?: string
}

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly'

export interface RecurringTemplate {
  groupId: UUID | null
  description: string
  amountCents: number
  currency: string
  fxRateToBase: number
  categoryId: UUID
  paidBy: MoneyShare[]
  splits: MoneyShare[]
  splitMethod: SplitMethod
  splitInput?: Record<UUID, number>
  notes?: string
}

export interface RecurringRule extends BaseEntity {
  frequency: RecurringFrequency
  /** Próxima fecha en la que debe materializarse un gasto (YYYY-MM-DD). */
  nextDate: string
  /** Día del mes original (1-31); evita que "cada 31" se vuelva "cada 28" tras febrero. */
  dayAnchor: number
  endDate?: string | null
  active: boolean
  template: RecurringTemplate
}

export interface Budget extends BaseEntity {
  categoryId: UUID
  /** Límite mensual en centavos de la moneda base. */
  monthlyLimitCents: number
}

export interface Settings {
  id: 'app'
  baseCurrency: string
  theme: 'light' | 'dark' | 'system'
  mePersonId: UUID | null
  /** Email de la cuenta Google conectada (solo informativo). */
  googleEmail?: string | null
  /** Archivo de respaldo completo en Drive (incluye los gastos sin grupo). */
  backupFileId?: string | null
  lastBackupAt?: string | null
}

export const SUPPORTED_CURRENCIES = [
  'COP',
  'USD',
  'EUR',
  'MXN',
  'ARS',
  'PEN',
  'CLP',
  'BRL',
  'GBP',
  'CAD',
] as const
