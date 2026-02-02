export function normalizePhone(raw: string): { digits: string; pretty: string } {
  const digitsOnly = (raw || '').replace(/\D/g, '')
  const digits = digitsOnly.startsWith('7') ? digitsOnly : digitsOnly.startsWith('8') ? `7${digitsOnly.slice(1)}` : `7${digitsOnly}`
  const cut = digits.slice(0, 11)

  const a = cut.slice(1, 4)
  const b = cut.slice(4, 7)
  const c = cut.slice(7, 9)
  const d = cut.slice(9, 11)
  const pretty = `+7 (${a.padEnd(3, '_')}) ${b.padEnd(3, '_')}-${c.padEnd(2, '_')}-${d.padEnd(2, '_')}`

  return { digits: cut, pretty }
}

export function isValidRuPhoneDigits(digits: string): boolean {
  return /^7\d{10}$/.test(digits)
}

