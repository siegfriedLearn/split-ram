import { describe, expect, it } from 'vitest'
import { mergedState, reconcile } from './merge'

const e = (id: string, updatedAt: string) => ({ id, updatedAt })

describe('reconcile', () => {
  it('sin diferencias no mueve nada', () => {
    const a = [e('1', '2026-07-01T00:00:00Z')]
    const { toLocal, toRemote } = reconcile(a, [...a])
    expect(toLocal).toEqual([])
    expect(toRemote).toEqual([])
  })

  it('lo nuevo remoto baja y lo nuevo local sube', () => {
    const local = [e('local-1', '2026-07-02T00:00:00Z')]
    const remote = [e('remote-1', '2026-07-01T00:00:00Z')]
    const r = reconcile(local, remote)
    expect(r.toLocal.map((x) => x.id)).toEqual(['remote-1'])
    expect(r.toRemote.map((x) => x.id)).toEqual(['local-1'])
  })

  it('gana la última escritura en conflictos', () => {
    const local = [e('1', '2026-07-01T10:00:00Z'), e('2', '2026-07-01T12:00:00Z')]
    const remote = [e('1', '2026-07-01T11:00:00Z'), e('2', '2026-07-01T09:00:00Z')]
    const r = reconcile(local, remote)
    expect(r.toLocal.map((x) => x.id)).toEqual(['1']) // remoto más nuevo
    expect(r.toRemote.map((x) => x.id)).toEqual(['2']) // local más nuevo
  })

  it('un borrado suave más reciente se propaga como cualquier edición', () => {
    type Row = { id: string; updatedAt: string; deletedAt: string | null }
    const local: Row[] = [{ ...e('1', '2026-07-01T00:00:00Z'), deletedAt: null }]
    const remote: Row[] = [{ ...e('1', '2026-07-02T00:00:00Z'), deletedAt: '2026-07-02T00:00:00Z' }]
    const r = reconcile(local, remote)
    expect(r.toLocal).toHaveLength(1)
    expect((r.toLocal[0] as { deletedAt: string | null }).deletedAt).not.toBeNull()
  })
})

describe('mergedState', () => {
  it('combina ambos lados quedándose con la versión más nueva de cada id', () => {
    const local = [e('1', '2026-07-01T10:00:00Z'), e('3', '2026-07-03T00:00:00Z')]
    const remote = [e('1', '2026-07-01T11:00:00Z'), e('2', '2026-07-02T00:00:00Z')]
    const merged = mergedState(local, remote)
    const byId = new Map(merged.map((x) => [x.id, x.updatedAt]))
    expect(byId.get('1')).toBe('2026-07-01T11:00:00Z')
    expect(byId.get('2')).toBe('2026-07-02T00:00:00Z')
    expect(byId.get('3')).toBe('2026-07-03T00:00:00Z')
    expect(merged).toHaveLength(3)
  })
})
