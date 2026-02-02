export type ApiSuccess<T> = { success: true; data: T }
export type ApiError = { success: false; error: string; details?: string }

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : null
}

function isApiError(x: unknown): x is ApiError {
  const r = asRecord(x)
  return !!r && r.success === false && typeof r.error === 'string'
}

export async function apiGet<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json', ...(headers || {}) } })
  const json = (await res.json()) as unknown
  if (!res.ok) throw new Error('Request failed')
  if (isApiError(json)) throw new Error(json.error)
  const r = asRecord(json)
  if (!r || r.success !== true) throw new Error('Request failed')
  return (json as ApiSuccess<T>).data
}

export async function apiPost<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as unknown
  if (!res.ok) throw new Error('Request failed')
  if (isApiError(json)) throw new Error(json.error)
  const r = asRecord(json)
  if (!r || r.success !== true) throw new Error('Request failed')
  return (json as ApiSuccess<T>).data
}

export async function apiPut<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as unknown
  if (!res.ok) throw new Error('Request failed')
  if (isApiError(json)) throw new Error(json.error)
  const r = asRecord(json)
  if (!r || r.success !== true) throw new Error('Request failed')
  return (json as ApiSuccess<T>).data
}
