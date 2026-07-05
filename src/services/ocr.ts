export interface ReceiptScan {
  amountCents: number | null
  date: string | null
  text: string
}

/**
 * OCR del recibo 100% en el navegador (tesseract.js, importado bajo demanda).
 * Heurística: busca el número en líneas con "total"/"a pagar"; si no, el mayor número.
 */
export async function scanReceipt(image: File | Blob): Promise<ReceiptScan> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('spa')
  try {
    const { data } = await worker.recognize(image)
    const text = data.text ?? ''
    return { amountCents: extractAmountCents(text), date: extractDate(text), text }
  } finally {
    await worker.terminate()
  }
}

const NUMBER_RE = /\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?/g

function parseOcrNumber(raw: string): number | null {
  let s = raw
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  const lastSep = Math.max(lastComma, lastDot)
  if (lastSep > -1) {
    const decimals = s.length - lastSep - 1
    if (decimals === 2) {
      s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1)
    } else {
      s = s.replace(/[.,]/g, '')
    }
  }
  const value = Number(s)
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null
}

export function extractAmountCents(text: string): number | null {
  const lines = text.split('\n')
  const totalLines = lines.filter((l) => /total|a\s*pagar|importe|valor\s*total/i.test(l))
  const candidates: number[] = []
  for (const line of totalLines.length > 0 ? totalLines : lines) {
    for (const m of line.match(NUMBER_RE) ?? []) {
      const cents = parseOcrNumber(m)
      if (cents !== null && cents >= 100) candidates.push(cents)
    }
  }
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

export function extractDate(text: string): string | null {
  const m = text.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = Number(m[3])
  if (y < 100) y += 2000
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
