const TTL_MS = 12 * 60 * 60 * 1000

interface CachedRates {
  fetchedAt: number
  rates: Record<string, number>
}

/**
 * Tasa de cambio: 1 unidad de `from` = X unidades de `to`.
 * Usa open.er-api.com (gratis, sin API key, incluye COP) con caché de 12 h.
 */
export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1
  const rates = await getRates(from)
  const rate = rates[to]
  if (!rate) throw new Error(`No hay tasa disponible de ${from} a ${to}`)
  return rate
}

async function getRates(base: string): Promise<Record<string, number>> {
  const cacheKey = `fx:${base}`
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as CachedRates
      if (Date.now() - parsed.fetchedAt < TTL_MS) return parsed.rates
    }
  } catch {
    // caché corrupta: se ignora y se vuelve a pedir
  }
  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`)
  if (!res.ok) throw new Error('No se pudo obtener la tasa de cambio (¿sin conexión?)')
  const data = (await res.json()) as { result: string; rates?: Record<string, number> }
  if (data.result !== 'success' || !data.rates) {
    throw new Error('Respuesta inválida del servicio de tasas de cambio')
  }
  localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), rates: data.rates }))
  return data.rates
}
