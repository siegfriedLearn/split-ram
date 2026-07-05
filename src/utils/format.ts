const ZERO_DECIMAL_CURRENCIES = new Set(['COP', 'CLP', 'JPY', 'KRW', 'PYG', 'VND'])

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2
}

/** Formatea centavos como moneda. */
export function formatMoney(cents: number, currency: string): string {
  const decimals = currencyDecimals(currency)
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(cents / 100)
}

/** Parsea texto de usuario ("12.345,50" o "12345.50") a centavos. NaN si inválido. */
export function parseAmountToCents(input: string): number {
  let s = input.trim().replace(/\s/g, '')
  if (!s) return NaN
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // El separador que aparece más a la derecha es el decimal
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (lastComma > -1) {
    // Solo comas: si parece separador de miles (grupos de 3) lo quitamos
    const afterComma = s.length - lastComma - 1
    s = afterComma === 3 && s.indexOf(',') !== lastComma ? s.replace(/,/g, '') : s.replace(',', '.')
  }
  const value = Number(s)
  if (!Number.isFinite(value)) return NaN
  return Math.round(value * 100)
}

export function centsToInput(cents: number, currency: string): string {
  const decimals = currencyDecimals(currency)
  return (cents / 100).toFixed(decimals)
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatPercent(fraction: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 }).format(fraction)
}

/** "hace 3 min", "hace 2 h", "hace 5 días" a partir de un ISO timestamp. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'hace un momento'
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`
  return `hace ${Math.floor(seconds / 86400)} días`
}
