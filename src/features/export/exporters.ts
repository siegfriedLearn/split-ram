import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db } from '../../db/db'
import type { Category, Expense, Group, Person, Settlement, UUID } from '../../db/types'
import { toBaseCents } from '../../domain/balances'
import { sumByCategory } from '../../domain/analytics'
import { formatMoney } from '../../utils/format'
import { todayISO } from '../../utils/id'

export interface ExportContext {
  expenses: Expense[]
  settlements: Settlement[]
  personById: Map<UUID, Person>
  categoryById: Map<UUID, Category>
  groupById: Map<UUID, Group>
  baseCurrency: string
  meId: UUID | null
  periodLabel: string
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function personName(ctx: ExportContext, id: UUID): string {
  return ctx.personById.get(id)?.name ?? '?'
}

/** Filas de gastos con montos en unidades (no centavos) para hojas de cálculo. */
function buildExpenseRows(ctx: ExportContext) {
  return ctx.expenses.map((e) => {
    const mine = ctx.meId ? (e.splits.find((s) => s.personId === ctx.meId)?.amountCents ?? 0) : 0
    return {
      Fecha: e.date,
      Descripción: e.description,
      Categoría: ctx.categoryById.get(e.categoryId)?.name ?? '',
      Grupo: e.groupId ? (ctx.groupById.get(e.groupId)?.name ?? '') : '',
      Moneda: e.currency,
      Monto: e.amountCents / 100,
      [`Monto (${ctx.baseCurrency})`]: toBaseCents(e.amountCents, e.fxRateToBase) / 100,
      [`Mi parte (${ctx.baseCurrency})`]: toBaseCents(mine, e.fxRateToBase) / 100,
      'Pagado por': e.paidBy.map((p) => personName(ctx, p.personId)).join(', '),
      'Dividido entre': e.splits
        .map((s) => `${personName(ctx, s.personId)}: ${(s.amountCents / 100).toFixed(2)}`)
        .join('; '),
      Método: e.splitMethod,
      Notas: e.notes ?? '',
    }
  })
}

function buildCategoryRows(ctx: ExportContext) {
  const totals = sumByCategory(ctx.expenses, 'total', ctx.meId)
  const mine = sumByCategory(ctx.expenses, 'mine', ctx.meId)
  const grandTotal = [...totals.values()].reduce((s, v) => s + v, 0)
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([catId, cents]) => ({
      Categoría: ctx.categoryById.get(catId)?.name ?? '',
      [`Total (${ctx.baseCurrency})`]: cents / 100,
      [`Mi parte (${ctx.baseCurrency})`]: (mine.get(catId) ?? 0) / 100,
      'Porcentaje': grandTotal > 0 ? Number(((cents / grandTotal) * 100).toFixed(1)) : 0,
    }))
}

function buildSettlementRows(ctx: ExportContext) {
  return ctx.settlements.map((s) => ({
    Fecha: s.date,
    'Quién pagó': personName(ctx, s.fromPersonId),
    'Quién recibió': personName(ctx, s.toPersonId),
    Moneda: s.currency,
    Monto: s.amountCents / 100,
    Grupo: s.groupId ? (ctx.groupById.get(s.groupId)?.name ?? '') : '',
  }))
}

export function exportCSV(ctx: ExportContext) {
  const sheet = XLSX.utils.json_to_sheet(buildExpenseRows(ctx))
  // BOM para que Excel abra el CSV con acentos correctos
  // BOM para que Excel abra el CSV con acentos correctos
  const csv = '﻿' + XLSX.utils.sheet_to_csv(sheet)
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `ram-split-gastos-${todayISO()}.csv`)
}

export function exportXLSX(ctx: ExportContext) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildExpenseRows(ctx)), 'Gastos')
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(buildCategoryRows(ctx)),
    'Resumen por categoría',
  )
  if (ctx.settlements.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildSettlementRows(ctx)), 'Pagos')
  }
  XLSX.writeFile(wb, `ram-split-${todayISO()}.xlsx`)
}

async function svgToPngDataUrl(
  svg: SVGSVGElement,
  scale = 2,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const rect = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(rect.width))
  clone.setAttribute('height', String(rect.height))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const xml = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('No se pudo rasterizar el gráfico'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const c2d = canvas.getContext('2d')!
  c2d.fillStyle = '#ffffff'
  c2d.fillRect(0, 0, canvas.width, canvas.height)
  c2d.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/png'), width: rect.width, height: rect.height }
}

/** Reporte PDF: resumen, tabla por categoría, gráficos (si hay) y detalle de gastos. */
export async function exportPDF(ctx: ExportContext, chartContainerIds: string[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  let y = 18

  doc.setFontSize(18)
  doc.setTextColor('#0f766e')
  doc.text('Ram Split — Reporte de gastos', margin, y)
  y += 7
  doc.setFontSize(10)
  doc.setTextColor('#475569')
  doc.text(`Período: ${ctx.periodLabel} · Generado: ${todayISO()}`, margin, y)
  y += 8

  const totalBase = ctx.expenses.reduce((s, e) => s + toBaseCents(e.amountCents, e.fxRateToBase), 0)
  const mineBase = ctx.meId
    ? ctx.expenses.reduce((s, e) => {
        const mine = e.splits.find((sp) => sp.personId === ctx.meId)?.amountCents ?? 0
        return s + toBaseCents(mine, e.fxRateToBase)
      }, 0)
    : 0
  doc.setFontSize(12)
  doc.setTextColor('#0f172a')
  doc.text(`Total: ${formatMoney(totalBase, ctx.baseCurrency)}`, margin, y)
  doc.text(`Mi parte: ${formatMoney(mineBase, ctx.baseCurrency)}`, pageWidth / 2, y)
  y += 8

  const catRows = buildCategoryRows(ctx)
  autoTable(doc, {
    startY: y,
    head: [['Categoría', `Total (${ctx.baseCurrency})`, `Mi parte (${ctx.baseCurrency})`, '%']],
    body: catRows.map((r) => Object.values(r).map(String)),
    theme: 'striped',
    headStyles: { fillColor: '#0f766e' },
    styles: { fontSize: 8 },
    margin: { left: margin, right: margin },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  for (const id of chartContainerIds) {
    const svg = document.getElementById(id)?.querySelector('svg')
    if (!svg) continue
    try {
      const png = await svgToPngDataUrl(svg)
      const drawWidth = pageWidth - margin * 2
      const drawHeight = (png.height / png.width) * drawWidth
      if (y + drawHeight > doc.internal.pageSize.getHeight() - 15) {
        doc.addPage()
        y = 18
      }
      doc.addImage(png.dataUrl, 'PNG', margin, y, drawWidth, drawHeight)
      y += drawHeight + 8
    } catch {
      // Si un gráfico no se puede rasterizar, el reporte sigue sin él
    }
  }

  const rows = buildExpenseRows(ctx)
  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Descripción', 'Categoría', 'Grupo', 'Monto', `En ${ctx.baseCurrency}`, 'Mi parte']],
    body: rows.map((r) => [
      r['Fecha'],
      r['Descripción'],
      r['Categoría'],
      r['Grupo'],
      `${r['Moneda']} ${r['Monto']}`,
      String(r[`Monto (${ctx.baseCurrency})`]),
      String(r[`Mi parte (${ctx.baseCurrency})`]),
    ]),
    theme: 'striped',
    headStyles: { fillColor: '#0f766e' },
    styles: { fontSize: 7 },
    margin: { left: margin, right: margin },
  })

  doc.save(`ram-split-reporte-${todayISO()}.pdf`)
}

// ---------- Respaldo y restauración JSON ----------

interface BackupReceipt {
  id: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  mimeType: string
  base64: string
}

interface BackupFile {
  app: 'ram-split'
  version: 1
  exportedAt: string
  data: {
    persons: unknown[]
    groups: unknown[]
    categories: unknown[]
    expenses: unknown[]
    settlements: unknown[]
    recurringRules: unknown[]
    budgets: unknown[]
    settings: unknown[]
    receipts: BackupReceipt[]
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mimeType })
}

/** Construye el objeto de respaldo. `includeReceipts=false` lo deja liviano (sin imágenes). */
export async function buildBackup(includeReceipts = true): Promise<BackupFile> {
  const receipts = includeReceipts ? await db.receipts.toArray() : []
  return {
    app: 'ram-split',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      persons: await db.persons.toArray(),
      groups: await db.groups.toArray(),
      categories: await db.categories.toArray(),
      expenses: await db.expenses.toArray(),
      settlements: await db.settlements.toArray(),
      recurringRules: await db.recurringRules.toArray(),
      budgets: await db.budgets.toArray(),
      settings: await db.settings.toArray(),
      receipts: await Promise.all(
        receipts.map(async (r) => ({
          id: r.id,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          deletedAt: r.deletedAt,
          mimeType: r.mimeType,
          base64: await blobToBase64(r.blob),
        })),
      ),
    },
  }
}

export async function exportBackupJSON() {
  const backup = await buildBackup(true)
  downloadBlob(
    new Blob([JSON.stringify(backup)], { type: 'application/json' }),
    `ram-split-respaldo-${todayISO()}.json`,
  )
}

export async function importBackupJSON(file: File): Promise<void> {
  const parsed = JSON.parse(await file.text()) as BackupFile
  if (parsed.app !== 'ram-split' || parsed.version !== 1 || !parsed.data) {
    throw new Error('El archivo no es un respaldo válido de Ram Split')
  }
  const d = parsed.data
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
    await db.persons.bulkAdd(d.persons as never[])
    await db.groups.bulkAdd(d.groups as never[])
    await db.categories.bulkAdd(d.categories as never[])
    await db.expenses.bulkAdd(d.expenses as never[])
    await db.settlements.bulkAdd(d.settlements as never[])
    await db.recurringRules.bulkAdd(d.recurringRules as never[])
    await db.budgets.bulkAdd(d.budgets as never[])
    await db.settings.bulkAdd(d.settings as never[])
    await db.receipts.bulkAdd(
      d.receipts.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        deletedAt: r.deletedAt,
        mimeType: r.mimeType,
        blob: base64ToBlob(r.base64, r.mimeType),
      })),
    )
  })
}
