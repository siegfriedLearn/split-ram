import { describe, expect, it } from 'vitest'
import { extractAmountCents, extractDate } from './ocr'

describe('extractAmountCents', () => {
  it('prefiere el número de la línea TOTAL', () => {
    expect(extractAmountCents('SUBTOTAL 38.571\nIVA 7.329\nTOTAL: $ 45.900')).toBe(4590000)
  })

  it('entiende "total a pagar" con comas de miles', () => {
    expect(extractAmountCents('Pan 4,500\nLeche 6,200\nTOTAL A PAGAR 10,700')).toBe(1070000)
  })

  it('sin línea de total usa el número mayor', () => {
    expect(extractAmountCents('Cafe 8.000\nJugo 5.500')).toBe(800000)
  })

  it('interpreta decimales de dos cifras', () => {
    expect(extractAmountCents('TOTAL 12.345,67')).toBe(1234567)
  })

  it('devuelve null si no hay números útiles', () => {
    expect(extractAmountCents('gracias por su compra')).toBeNull()
  })
})

describe('extractDate', () => {
  it('parsea dd/mm/yyyy', () => {
    expect(extractDate('Fecha: 04/07/2026 14:33')).toBe('2026-07-04')
  })

  it('parsea dd-mm-yy', () => {
    expect(extractDate('01-06-26')).toBe('2026-06-01')
  })

  it('rechaza fechas inválidas', () => {
    expect(extractDate('99/99/2026')).toBeNull()
    expect(extractDate('sin fecha')).toBeNull()
  })
})
