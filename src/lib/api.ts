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
  
  if (!res.ok) {
    // Try to read error message from body if possible
    try {
      const errJson = await res.json()
      if (isApiError(errJson)) throw new Error(errJson.error)
    } catch {
      // ignore parse error for failed requests
    }
    throw new Error(`Request failed: ${res.status} ${res.statusText}`)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (e) {
    throw new Error('Invalid JSON response from server')
  }

  if (isApiError(json)) throw new Error(json.error)
  const r = asRecord(json)
  if (!r || r.success !== true) throw new Error('Invalid API response format')
  return (json as ApiSuccess<T>).data
}

export async function apiPost<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  })
  
  if (!res.ok) {
    try {
      const errJson = await res.json()
      if (isApiError(errJson)) throw new Error(errJson.error)
    } catch {
       // ignore
    }
    throw new Error(`Request failed: ${res.status} ${res.statusText}`)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (e) {
    throw new Error('Invalid JSON response from server')
  }

  if (isApiError(json)) throw new Error(json.error)
  const r = asRecord(json)
  if (!r || r.success !== true) throw new Error('Invalid API response format')
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
