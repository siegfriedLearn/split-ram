import { useRef, useState } from 'react'
import { db, touched } from '../../db/db'
import { SUPPORTED_CURRENCIES } from '../../db/types'
import { useExpenses, useRecurringRules, useSettlements } from '../../db/hooks'
import { useApp } from '../../state/AppContext'
import { Field } from '../../components/ui'
import { IconDownload, IconRepeat, IconTrash, IconUpload } from '../../components/icons'
import { formatDate, formatMoney } from '../../utils/format'
import { nowISO } from '../../utils/id'
import type { ExportContext } from '../export/exporters'
import { isGoogleConfigured } from '../../services/google/config'
import { connectGoogle, disconnectGoogle } from '../../services/google/auth'
import { clearDebugLog, getDebugLog } from '../../utils/logger'

const FREQ_LABELS = { weekly: 'Semanal', monthly: 'Mensual', yearly: 'Anual' }

export function SettingsPage() {
  const { settings, me, personById, categoryById, groupById } = useApp()
  const expenses = useExpenses()
  const settlements = useSettlements()
  const rules = useRecurringRules()
  const [meName, setMeName] = useState(me?.name ?? 'Yo')
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  function fullContext(): ExportContext {
    return {
      expenses: expenses ?? [],
      settlements: settlements ?? [],
      personById,
      categoryById,
      groupById,
      baseCurrency: settings.baseCurrency,
      meId: me?.id ?? null,
      periodLabel: 'Todo el historial',
    }
  }

  async function saveMeName() {
    if (!me || !meName.trim() || meName.trim() === me.name) return
    await db.persons.update(me.id, { name: meName.trim(), ...touched() })
    setMessage('Nombre actualizado')
  }

  async function handleImport(file: File) {
    if (
      !window.confirm(
        'Importar un respaldo REEMPLAZA todos los datos actuales. ¿Quieres continuar?',
      )
    )
      return
    setImporting(true)
    setMessage('')
    try {
      const { importBackupJSON } = await import('../export/exporters')
      await importBackupJSON(file)
      setMessage('Respaldo restaurado correctamente ✅')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo importar el respaldo')
    } finally {
      setImporting(false)
      if (importRef.current) importRef.current.value = ''
    }
  }

  async function wipeAll() {
    if (!window.confirm('Esto borra TODOS los datos de la app. ¿Continuar?')) return
    if (!window.confirm('Última confirmación: ¿borrar todo definitivamente?')) return
    await db.delete()
    location.reload()
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
          {message}
        </p>
      )}

      <section className="card space-y-4 p-4">
        <h3 className="text-sm font-bold">Perfil y preferencias</h3>
        <Field label="Mi nombre">
          <div className="flex gap-2">
            <input className="input" value={meName} onChange={(e) => setMeName(e.target.value)} />
            <button className="btn-secondary" onClick={saveMeName}>
              Guardar
            </button>
          </div>
        </Field>
        <Field label="Moneda base">
          <select
            className="input"
            value={settings.baseCurrency}
            onChange={(e) => db.settings.update('app', { baseCurrency: e.target.value })}
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-400">
            Los gastos ya guardados conservan la tasa de cambio con la que se registraron.
          </p>
        </Field>
        <Field label="Tema">
          <select
            className="input"
            value={settings.theme}
            onChange={(e) =>
              db.settings.update('app', { theme: e.target.value as typeof settings.theme })
            }
          >
            <option value="system">Según el sistema</option>
            <option value="light">Claro</option>
            <option value="dark">Oscuro</option>
          </select>
        </Field>
      </section>

      <section className="card space-y-3 p-4">
        <h3 className="text-sm font-bold">Cuenta Google (grupos compartidos)</h3>
        {!isGoogleConfigured() ? (
          <p className="text-xs text-slate-400">
            Sin configurar. Sigue la guía del README ("Grupos compartidos") para habilitar la
            sincronización vía Google Sheets — gratis y sin servidores.
          </p>
        ) : settings.googleEmail ? (
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm">
              Conectado como <strong>{settings.googleEmail}</strong>
            </p>
            <button
              className="btn-secondary shrink-0"
              onClick={async () => {
                await disconnectGoogle()
                setMessage('Cuenta Google desconectada')
              }}
            >
              Desconectar
            </button>
          </div>
        ) : (
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                const email = await connectGoogle()
                setMessage(`Conectado como ${email} ✅`)
              } catch (e) {
                setMessage(e instanceof Error ? e.message : 'No se pudo conectar')
              }
            }}
          >
            Conectar con Google
          </button>
        )}
        <p className="text-xs text-slate-400">
          Los grupos compartidos se sincronizan vía hojas de Google Sheets en tu Drive. Las fotos
          de recibos no se sincronizan.
        </p>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-sm font-bold text-slate-500 dark:text-slate-400">
          Gastos recurrentes
        </h3>
        {(rules ?? []).length === 0 ? (
          <p className="card p-4 text-sm text-slate-500">
            No hay recurrentes. Al crear un gasto elige "Repetir" para automatizarlo.
          </p>
        ) : (
          <div className="card divide-y divide-slate-100 dark:divide-slate-800">
            {(rules ?? []).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <IconRepeat size={18} className="shrink-0 text-brand-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.template.description}</p>
                  <p className="text-xs text-slate-500">
                    {FREQ_LABELS[r.frequency]} ·{' '}
                    {formatMoney(r.template.amountCents, r.template.currency)} · Próximo:{' '}
                    {formatDate(r.nextDate)}
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={(e) =>
                      db.recurringRules.update(r.id, { active: e.target.checked, ...touched() })
                    }
                  />
                  Activo
                </label>
                <button
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  onClick={async () => {
                    if (window.confirm('¿Eliminar esta recurrencia? Los gastos ya creados se conservan.'))
                      await db.recurringRules.update(r.id, { deletedAt: nowISO(), ...touched() })
                  }}
                  aria-label="Eliminar recurrencia"
                >
                  <IconTrash size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h3 className="text-sm font-bold">Exportar todo</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            onClick={async () => (await import('../export/exporters')).exportCSV(fullContext())}
          >
            <IconDownload size={16} /> CSV
          </button>
          <button
            className="btn-secondary"
            onClick={async () => (await import('../export/exporters')).exportXLSX(fullContext())}
          >
            <IconDownload size={16} /> Excel
          </button>
          <button
            className="btn-secondary"
            onClick={async () => (await import('../export/exporters')).exportBackupJSON()}
          >
            <IconDownload size={16} /> Respaldo JSON
          </button>
        </div>
        <p className="text-xs text-slate-400">
          El respaldo JSON incluye todo (grupos, gastos, recibos, presupuestos) y puede
          restaurarse abajo. Para el PDF con gráficos ve a la pestaña Análisis.
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h3 className="text-sm font-bold">Restaurar respaldo</h3>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleImport(f)
          }}
        />
        <button
          className="btn-secondary"
          onClick={() => importRef.current?.click()}
          disabled={importing}
        >
          <IconUpload size={16} /> {importing ? 'Importando…' : 'Importar JSON'}
        </button>
      </section>

      <DiagnosticsSection />

      <section className="card space-y-3 border-red-100 p-4 dark:border-red-950">
        <h3 className="text-sm font-bold text-red-600">Zona de peligro</h3>
        <button
          className="btn-secondary !bg-red-50 !text-red-600 hover:!bg-red-100 dark:!bg-red-950 dark:!text-red-300"
          onClick={wipeAll}
        >
          <IconTrash size={16} /> Borrar todos los datos
        </button>
      </section>

      <p className="pb-4 text-center text-xs text-slate-400">
        Ram Split · Tus datos viven solo en este dispositivo (IndexedDB) · Haz respaldos JSON
      </p>
    </div>
  )
}

function DiagnosticsSection() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // se relee al abrir y tras limpiar
  const [version, setVersion] = useState(0)
  const lines = getDebugLog()
  void version

  async function copyAll() {
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Diagnóstico</h3>
        <button
          className="text-xs font-semibold text-brand-600"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Ocultar' : `Ver registro (${lines.length})`}
        </button>
      </div>
      {open && (
        <>
          <pre className="max-h-64 overflow-auto rounded-xl bg-slate-100 p-3 text-[10px] leading-relaxed whitespace-pre-wrap dark:bg-slate-800">
            {lines.length > 0 ? lines.join('\n') : 'Sin eventos registrados todavía.'}
          </pre>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={copyAll} disabled={lines.length === 0}>
              {copied ? 'Copiado ✓' : 'Copiar todo'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                clearDebugLog()
                setVersion((v) => v + 1)
              }}
            >
              Limpiar
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Registra los pasos de conexión con Google y sincronización. Si algo falla, copia esto
            y compártelo para diagnosticar.
          </p>
        </>
      )}
    </section>
  )
}
