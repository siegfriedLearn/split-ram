import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, notDeleted } from '../db/db'
import type { Category, Group, Person, Settings } from '../db/types'

export interface AppData {
  settings: Settings
  /** Personas activas (para selectores). */
  persons: Person[]
  /** Incluye borradas, para resolver nombres históricos. */
  personById: Map<string, Person>
  categories: Category[]
  categoryById: Map<string, Category>
  groups: Group[]
  groupById: Map<string, Group>
  me: Person | undefined
}

const AppCtx = createContext<AppData | null>(null)

export function useApp(): AppData {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp debe usarse dentro de <AppProvider>')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const allPersons = useLiveQuery(() => db.persons.toArray(), [])
  const allCategories = useLiveQuery(() => db.categories.toArray(), [])
  const allGroups = useLiveQuery(() => db.groups.toArray(), [])

  const value = useMemo<AppData | null>(() => {
    if (!settings || !allPersons || !allCategories || !allGroups) return null
    const persons = allPersons.filter(notDeleted)
    const personById = new Map(allPersons.map((p) => [p.id, p]))
    const categories = allCategories.filter(notDeleted).sort((a, b) => a.name.localeCompare(b.name, 'es'))
    const categoryById = new Map(allCategories.map((c) => [c.id, c]))
    const groups = allGroups.filter(notDeleted)
    const groupById = new Map(allGroups.map((g) => [g.id, g]))
    const me = personById.get(settings.mePersonId ?? '') ?? persons.find((p) => p.isMe)
    return { settings, persons, personById, categories, categoryById, groups, groupById, me }
  }, [settings, allPersons, allCategories, allGroups])

  if (!value) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="animate-pulse text-2xl font-bold text-brand-600">Ram Split</div>
      </div>
    )
  }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
