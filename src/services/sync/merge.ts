/**
 * Reconciliación last-write-wins por entidad, comparando `updatedAt` (ISO 8601,
 * ordenable lexicográficamente). Nunca hay borrados físicos (solo `deletedAt`),
 * así que "falta en el otro lado" siempre significa "es nuevo ahí".
 */
export interface Syncable {
  id: string
  updatedAt: string
}

export interface ReconcileResult<T extends Syncable> {
  /** Entidades remotas que deben aplicarse localmente. */
  toLocal: T[]
  /** Entidades locales que deben subirse. */
  toRemote: T[]
}

export function reconcile<T extends Syncable>(local: T[], remote: T[]): ReconcileResult<T> {
  const localById = new Map(local.map((e) => [e.id, e]))
  const remoteById = new Map(remote.map((e) => [e.id, e]))
  const toLocal: T[] = []
  const toRemote: T[] = []

  for (const r of remote) {
    const l = localById.get(r.id)
    if (!l) toLocal.push(r)
    else if (r.updatedAt > l.updatedAt) toLocal.push(r)
    else if (l.updatedAt > r.updatedAt) toRemote.push(l)
  }
  for (const l of local) {
    if (!remoteById.has(l.id)) toRemote.push(l)
  }
  return { toLocal, toRemote }
}

/** Estado final combinado (para reescribir la hoja completa tras el merge). */
export function mergedState<T extends Syncable>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>()
  for (const e of remote) byId.set(e.id, e)
  for (const e of local) {
    const existing = byId.get(e.id)
    if (!existing || e.updatedAt > existing.updatedAt) byId.set(e.id, e)
  }
  return [...byId.values()]
}
