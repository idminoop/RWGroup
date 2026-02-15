export function formatPriceRub(value: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(value))} \u20BD`
}

export function formatArea(value: number): string {
  const n = Math.round(value * 10) / 10
  return `${n} \u043c\u00b2`
}
