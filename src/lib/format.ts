export function formatPriceRub(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(value)) + ' ₽'
}

export function formatArea(value: number): string {
  const n = Math.round(value * 10) / 10
  return `${n} м²`
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `${Math.round(value / 100_000_000) / 10} млрд`
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10} млн`
  if (value >= 1_000) return `${Math.round(value / 100) / 10} тыс`
  return String(value)
}

