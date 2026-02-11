export function formatPriceRub(value: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(value))} \u20BD`
}

export function formatArea(value: number): string {
  const n = Math.round(value * 10) / 10
  return `${n} \u043c\u00b2`
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `${Math.round(value / 100_000_000) / 10} \u043c\u043b\u0440\u0434`
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10} \u043c\u043b\u043d`
  if (value >= 1_000) return `${Math.round(value / 100) / 10} \u0442\u044b\u0441`
  return String(value)
}
