import { useState } from 'react'
import { db } from '../../db/db'
import type { Group } from '../../db/types'
import { useApp } from '../../state/AppContext'
import { Field, Modal } from '../../components/ui'
import { IconCheck, IconCloud, IconCopy, IconRepeat } from '../../components/icons'
import { isGoogleConfigured } from '../../services/google/config'
import { connectGoogle, getAccessToken } from '../../services/google/auth'
import { pickGroupSource } from '../../services/google/picker'
import { spreadsheetUrl } from '../../services/google/sheets'
import {
  buildJoinLink,
  inviteMore,
  joinGroup,
  shareGroup,
  syncGroup,
} from '../../services/sync/groupSync'
import { timeAgo } from '../../utils/format'

export function ShareGroupModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { settings, personById, me } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [extraEmail, setExtraEmail] = useState('')

  // emails editables por miembro (excepto yo), prellenados con person.email
  const [emails, setEmails] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const id of group.memberIds) {
      if (id === me?.id) continue
      out[id] = personById.get(id)?.email ?? ''
    }
    return out
  })

  const connected = settings.googleEmail

  async function handleConnect() {
    setBusy(true)
    setError('')
    try {
      await connectGoogle()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar con Google')
    } finally {
      setBusy(false)
    }
  }

  async function handleShare() {
    setBusy(true)
    setError('')
    try {
      const invites = Object.entries(emails)
        .filter(([, email]) => email.trim())
        .map(([personId, email]) => ({ personId, email: email.trim() }))
      if (extraEmail.trim()) invites.push({ personId: '', email: extraEmail.trim() })
      const result = await shareGroup(
        group,
        invites.map((i) => ({ personId: i.personId || null, email: i.email })),
      )
      const failures = result.invites.failed
      setNotice(
        failures.length === 0
          ? 'Grupo compartido. Google envió las invitaciones por correo. ✅'
          : `Compartido, pero fallaron: ${failures.map((f) => f.email).join(', ')}`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo compartir el grupo')
    } finally {
      setBusy(false)
    }
  }

  async function handleInviteMore() {
    if (!extraEmail.trim()) return
    setBusy(true)
    setError('')
    try {
      const result = await inviteMore(group, [extraEmail.trim()])
      setNotice(
        result.failed.length === 0
          ? `Invitación enviada a ${extraEmail.trim()} ✅`
          : `No se pudo invitar: ${result.failed[0].error}`,
      )
      setExtraEmail('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo invitar')
    } finally {
      setBusy(false)
    }
  }

  async function handleSyncNow() {
    setBusy(true)
    setError('')
    try {
      await syncGroup(group.id, true)
      setNotice('Sincronizado ✅')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al sincronizar')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Reconexión cuando la hoja vinculada ya no existe o se perdió el acceso
   * (p. ej. el dueño volvió a compartir y creó hoja nueva): el usuario elige la
   * carpeta/hoja actual en Drive y joinGroup re-vincula el mismo grupo local
   * (empata por el id interno del grupo — no se pierde nada).
   */
  async function handleReconnect() {
    setBusy(true)
    setError('')
    try {
      const token = await getAccessToken(true)
      const picked = await pickGroupSource(token)
      if (!picked) return
      const result = await joinGroup(picked)
      if (result.groupId !== group.id) {
        setNotice('Elegiste otro grupo distinto; quedó vinculado como grupo aparte.')
      } else {
        setNotice('Grupo reconectado y sincronizado ✅')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reconectar el grupo')
    } finally {
      setBusy(false)
    }
  }

  async function handleUnlink() {
    if (
      !window.confirm(
        'El grupo dejará de sincronizarse en este dispositivo. La hoja de cálculo y los datos de los demás no se tocan. ¿Continuar?',
      )
    )
      return
    await db.groups.update(group.id, { share: null })
    onClose()
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isGoogleConfigured()) {
    return (
      <Modal title="Compartir grupo" onClose={onClose}>
        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            Para compartir grupos necesitas configurar (una sola vez, gratis) un Client ID de
            Google.
          </p>
          <p className="text-slate-500">
            Sigue la guía del <strong>README → "Grupos compartidos (Google Sheets)"</strong>: crear
            un proyecto en Google Cloud, habilitar las APIs de Sheets y Drive, crear un OAuth
            Client ID y ponerlo en <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env</code> como{' '}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">VITE_GOOGLE_CLIENT_ID</code>.
          </p>
        </div>
      </Modal>
    )
  }

  const share = group.share

  return (
    <Modal title={share ? `Grupo compartido: ${group.name}` : `Compartir "${group.name}"`} onClose={onClose}>
      <div className="space-y-4">
        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
            {notice}
          </p>
        )}

        {!connected ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">
              Los gastos del grupo se guardarán en una hoja de Google Sheets de tu Drive. Cada
              miembro entra con su cuenta Google — sin servidores, sin costos.
            </p>
            <button className="btn-primary w-full" onClick={handleConnect} disabled={busy}>
              {busy ? 'Conectando…' : 'Conectar con Google'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Conectado como <strong>{connected}</strong>
          </p>
        )}

        {connected && !share && (
          <>
            <Field label="Invitar por email (cuenta Google de cada miembro)">
              <div className="space-y-1.5">
                {Object.keys(emails).map((personId) => (
                  <div key={personId} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-sm">
                      {personById.get(personId)?.name ?? '?'}
                    </span>
                    <input
                      className="input"
                      type="email"
                      placeholder="email@gmail.com"
                      value={emails[personId]}
                      onChange={(e) =>
                        setEmails((prev) => ({ ...prev, [personId]: e.target.value }))
                      }
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-sm text-slate-400">Otro</span>
                  <input
                    className="input"
                    type="email"
                    placeholder="email@gmail.com (opcional)"
                    value={extraEmail}
                    onChange={(e) => setExtraEmail(e.target.value)}
                  />
                </div>
              </div>
            </Field>
            <button className="btn-primary w-full" onClick={handleShare} disabled={busy}>
              <IconCloud size={16} /> {busy ? 'Creando hoja…' : 'Crear hoja y compartir'}
            </button>
            <p className="text-xs text-slate-400">
              Se crea una hoja "Ram Split · {group.name}" en tu Drive y Google envía la invitación
              por correo. Después compárteles también el link de unión para que el grupo aparezca
              en su app.
            </p>
          </>
        )}

        {connected && share && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <IconCloud size={16} className="text-brand-500" />
              {share.lastError ? (
                <span className="text-red-500">{share.lastError}</span>
              ) : (
                <span className="text-slate-500">
                  {share.lastSyncAt ? `Sincronizado ${timeAgo(share.lastSyncAt)}` : 'Sin sincronizar aún'}
                </span>
              )}
              <button
                className="ml-auto flex items-center gap-1 text-xs font-semibold text-brand-600"
                onClick={handleSyncNow}
                disabled={busy}
              >
                <IconRepeat size={13} /> {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
            </div>
            {share.lastError && /sin permiso|no se encontró/i.test(share.lastError) && (
              <div className="space-y-1.5">
                <button className="btn-secondary w-full" onClick={handleReconnect} disabled={busy}>
                  Reconectar grupo (elegir carpeta en Drive)
                </button>
                <p className="text-xs text-slate-400">
                  Suele pasar cuando el grupo se volvió a compartir: elige la carpeta actual del
                  grupo en "Compartidos conmigo" y todo vuelve a sincronizar.
                </p>
              </div>
            )}

            <Field label="Link de unión (envíalo por WhatsApp)">
              <div className="flex items-center gap-2">
                <input className="input flex-1 text-xs" readOnly value={buildJoinLink(share.spreadsheetId)} />
                <button
                  className="btn-secondary !px-3"
                  onClick={() => copyLink(buildJoinLink(share.spreadsheetId))}
                  aria-label="Copiar link"
                >
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </button>
              </div>
            </Field>

            <Field label="Invitar a alguien más">
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  type="email"
                  placeholder="email@gmail.com"
                  value={extraEmail}
                  onChange={(e) => setExtraEmail(e.target.value)}
                />
                <button className="btn-secondary" onClick={handleInviteMore} disabled={busy || !extraEmail.trim()}>
                  Invitar
                </button>
              </div>
            </Field>

            <div className="flex items-center justify-between text-xs">
              <a
                className="font-semibold text-brand-600 hover:underline"
                href={spreadsheetUrl(share.spreadsheetId)}
                target="_blank"
                rel="noreferrer"
              >
                Abrir hoja de cálculo ↗
              </a>
              <button className="font-semibold text-red-500" onClick={handleUnlink}>
                Desvincular de este dispositivo
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Las fotos de recibos no se sincronizan (quedan en cada dispositivo).
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
