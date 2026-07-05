import { useState } from 'react'
import type { Person } from '../../db/types'
import { useApp } from '../../state/AppContext'
import { Avatar } from '../../components/ui'
import { IconCloud } from '../../components/icons'
import { isGoogleConfigured } from '../../services/google/config'
import { connectGoogle } from '../../services/google/auth'
import { adoptIdentity, joinGroup } from '../../services/sync/groupSync'

type Step =
  | { kind: 'start' }
  | { kind: 'busy'; label: string }
  | { kind: 'chooseIdentity'; groupId: string; members: Person[] }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export function JoinGroupPage({ spreadsheetId }: { spreadsheetId: string }) {
  const { settings } = useApp()
  const [step, setStep] = useState<Step>({ kind: 'start' })

  function goToGroups() {
    location.hash = '#/grupos'
  }

  async function handleJoin() {
    setStep({ kind: 'busy', label: 'Conectando con Google…' })
    try {
      if (!settings.googleEmail) await connectGoogle()
      setStep({ kind: 'busy', label: 'Leyendo el grupo compartido…' })
      const result = await joinGroup(spreadsheetId)
      if (result.status === 'chooseIdentity') {
        setStep({ kind: 'chooseIdentity', groupId: result.groupId, members: result.members })
      } else {
        setStep({ kind: 'done' })
      }
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : 'No se pudo unir al grupo' })
    }
  }

  async function handlePickIdentity(personId: string) {
    setStep({ kind: 'busy', label: 'Configurando tu identidad…' })
    try {
      await adoptIdentity(personId)
      setStep({ kind: 'done' })
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : 'No se pudo adoptar la identidad' })
    }
  }

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-600 text-white">
        <IconCloud size={32} />
      </div>
      <h2 className="text-xl font-extrabold">Unirse a un grupo compartido</h2>

      {!isGoogleConfigured() && (
        <p className="text-sm text-red-500">
          Esta instalación no tiene configurado el Client ID de Google (ver README).
        </p>
      )}

      {step.kind === 'start' && (
        <>
          <p className="text-sm leading-relaxed text-slate-500">
            Te invitaron a un grupo de gastos compartidos. Conéctate con la cuenta Google a la que
            te compartieron la hoja y el grupo aparecerá en tu app.
          </p>
          <button className="btn-primary w-full" onClick={handleJoin} disabled={!isGoogleConfigured()}>
            Conectar con Google y unirme
          </button>
          <button className="text-xs font-semibold text-slate-400" onClick={goToGroups}>
            Cancelar
          </button>
        </>
      )}

      {step.kind === 'busy' && <p className="animate-pulse text-sm text-slate-500">{step.label}</p>}

      {step.kind === 'chooseIdentity' && (
        <>
          <p className="text-sm text-slate-500">¿Quién eres tú en este grupo?</p>
          <div className="w-full space-y-2">
            {step.members.map((m) => (
              <button
                key={m.id}
                className="card flex w-full items-center gap-3 px-4 py-3 text-left transition hover:ring-2 hover:ring-brand-500"
                onClick={() => handlePickIdentity(m.id)}
              >
                <Avatar person={m} size={32} />
                <span className="text-sm font-semibold">{m.name}</span>
                {m.email && <span className="ml-auto text-xs text-slate-400">{m.email}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {step.kind === 'done' && (
        <>
          <p className="text-sm text-emerald-600">¡Listo! Ya haces parte del grupo. 🎉</p>
          <button className="btn-primary w-full" onClick={goToGroups}>
            Ver mis grupos
          </button>
        </>
      )}

      {step.kind === 'error' && (
        <>
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            {step.message}
          </p>
          <button className="btn-secondary w-full" onClick={() => setStep({ kind: 'start' })}>
            Reintentar
          </button>
        </>
      )}
    </div>
  )
}
