import { useEffect, useState, type ReactNode } from 'react'
import { AppProvider, useApp } from './state/AppContext'
import { materializeRecurring } from './services/recurringService'
import { syncAllSharedGroups } from './services/sync/groupSync'
import { backupToDrive } from './services/sync/backup'
import { JoinGroupPage } from './features/groups/JoinGroupPage'
import { GroupDetailPage } from './features/groups/GroupDetailPage'
import { IconChart, IconCog, IconReceipt, IconUsers } from './components/icons'
import { ExpensesPage } from './features/expenses/ExpensesPage'
import { GroupsPage } from './features/groups/GroupsPage'
import { AnalyticsPage } from './features/analytics/AnalyticsPage'
import { SettingsPage } from './features/settings/SettingsPage'

type Tab = 'grupos' | 'actividad' | 'analisis' | 'ajustes'

const TABS: Array<{ id: Tab; label: string; icon: (p: { size?: number }) => ReactNode }> = [
  { id: 'grupos', label: 'Grupos', icon: (p) => <IconUsers {...p} /> },
  { id: 'actividad', label: 'Actividad', icon: (p) => <IconReceipt {...p} /> },
  { id: 'analisis', label: 'Análisis', icon: (p) => <IconChart {...p} /> },
  { id: 'ajustes', label: 'Ajustes', icon: (p) => <IconCog {...p} /> },
]

interface Route {
  tab: Tab
  joinId: string | null
  groupId: string | null
}

function readRoute(): Route {
  const hash = location.hash.replace('#/', '')
  const joinMatch = hash.match(/^unirse\/(.+)$/)
  if (joinMatch) return { tab: 'grupos', joinId: joinMatch[1], groupId: null }
  const groupMatch = hash.match(/^grupos\/(.+)$/)
  if (groupMatch) return { tab: 'grupos', joinId: null, groupId: groupMatch[1] }
  return {
    tab: (TABS.some((x) => x.id === hash) ? hash : 'grupos') as Tab,
    joinId: null,
    groupId: null,
  }
}

function useHashRoute(): [Route, (t: Tab) => void] {
  const [route, setRoute] = useState<Route>(readRoute)
  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return [route, (t) => (location.hash = `#/${t}`)]
}

function ThemeEffect() {
  const { settings } = useApp()
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])
  return null
}

function Shell() {
  const [route, setTab] = useHashRoute()
  const tab = route.tab

  useEffect(() => {
    // Al abrir: materializa recurrentes, sincroniza grupos y respalda en Drive
    void materializeRecurring()
    void syncAllSharedGroups()
    void backupToDrive()
    // Polling cada 60 s con la pestaña visible + sync al volver a ella
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void syncAllSharedGroups()
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncAllSharedGroups()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl">
      {/* Sidebar escritorio */}
      <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col gap-1 border-r border-slate-200 p-4 sm:flex dark:border-slate-800">
        <div className="mb-4 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-sm font-black text-white">
            RS
          </div>
          <span className="font-extrabold tracking-tight">Ram Split</span>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              tab === t.id && !route.groupId && !route.joinId
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {t.icon({ size: 18 })}
            {t.label}
          </button>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header móvil */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur sm:hidden dark:border-slate-800 dark:bg-slate-950/90">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs font-black text-white">
            RS
          </div>
          <h1 className="text-base font-extrabold tracking-tight">{current.label}</h1>
        </header>

        <main className="flex-1 px-4 py-4 pb-24 sm:px-6 sm:pb-8">
          {route.joinId ? (
            <JoinGroupPage key={route.joinId} spreadsheetId={route.joinId} />
          ) : route.groupId ? (
            <GroupDetailPage key={route.groupId} groupId={route.groupId} />
          ) : (
            <>
              <h1 className="mb-4 hidden text-xl font-extrabold tracking-tight sm:block">
                {current.label}
              </h1>
              {tab === 'grupos' && <GroupsPage />}
              {tab === 'actividad' && <ExpensesPage />}
              {tab === 'analisis' && <AnalyticsPage />}
              {tab === 'ajustes' && <SettingsPage />}
            </>
          )}
        </main>

        {/* Nav inferior móvil */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden dark:border-slate-800 dark:bg-slate-900/95">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition ${
                tab === t.id ? 'text-brand-600' : 'text-slate-400'
              }`}
            >
              {t.icon({ size: 22 })}
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ThemeEffect />
      <Shell />
    </AppProvider>
  )
}
