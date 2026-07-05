import { useState } from 'react'
import { db, newEntity, PERSON_COLORS } from '../db/db'
import type { UUID } from '../db/types'
import { useApp } from '../state/AppContext'
import { IconPlus } from './icons'

/**
 * Alta rápida de una persona sin salir del formulario actual (gasto o grupo).
 * Con `withEmail` muestra también el campo de correo (útil para grupos
 * compartidos: el correo permite reconocer a la persona al unirse).
 */
export function QuickAddPerson({
  onCreated,
  withEmail = false,
}: {
  onCreated: (id: UUID) => void | Promise<void>
  withEmail?: boolean
}) {
  const { persons } = useApp()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    const person = {
      ...newEntity(),
      name: trimmed,
      email: email.trim() || undefined,
      color: PERSON_COLORS[persons.length % PERSON_COLORS.length],
    }
    await db.persons.add(person)
    setName('')
    setEmail('')
    setAdding(false)
    await onCreated(person.id)
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="chip bg-slate-100 text-brand-700 hover:bg-brand-50 dark:bg-slate-800 dark:text-brand-300"
      >
        <IconPlus size={12} /> Nueva persona
      </button>
    )
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void add()
    }
    if (e.key === 'Escape') setAdding(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        className="input min-w-32 flex-1"
        placeholder="Nombre de la persona"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {withEmail && (
        <input
          className="input min-w-40 flex-1"
          type="email"
          placeholder="email@gmail.com (opcional)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      <button type="button" className="btn-secondary" onClick={add} disabled={!name.trim()}>
        Agregar
      </button>
    </div>
  )
}
