export type ApiSuccess<T> = { success: true; data: T }
export type ApiError = { success: false; error: string; details?: string }

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : null
}

function isApiError(x: unknown): x is ApiError {
  const r = asRecord(x)
  return !!r && r.success === false && typeof r.error === 'string'
}

const API_DEBUG_QUERY_PARAM = 'debugApi'
let apiRequestSeq = 0

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

function nextApiRequestId(): string {
  apiRequestSeq = (apiRequestSeq + 1) % 100000
  return String(apiRequestSeq).padStart(5, '0')
}

function shouldDebugApi(_url: string): boolean {
  if (typeof window === 'undefined') return false
  const qs = new URLSearchParams(window.location.search || '')
  if (qs.get(API_DEBUG_QUERY_PARAM) === '1') return true
  if (qs.get(API_DEBUG_QUERY_PARAM) === '0') return false
  return false
}

function summarizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return { type: 'array', size: value.length }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    return { type: 'object', keys: keys.slice(0, 20), totalKeys: keys.length }
  }
  return value
}

function logApiStart(debug: boolean, requestId: string, method: string, url: string, body?: unknown): void {
  if (!debug) return
  if (body === undefined) {
    console.info(`[api:${requestId}] -> ${method} ${url}`)
    return
  }
  console.info(`[api:${requestId}] -> ${method} ${url}`, { body: summarizeValue(body) })
}

function logApiResult(
  debug: boolean,
  requestId: string,
  method: string,
  url: string,
  status: number,
  statusText: string,
  durationMs: number
): void {
  if (!debug) return
  console.info(`[api:${requestId}] <- ${method} ${url}`, {
    status,
    statusText,
    durationMs: Number(durationMs.toFixed(1)),
  })
}

function logApiFailure(
  debug: boolean,
  requestId: string,
  method: string,
  url: string,
  error: unknown,
  meta?: Record<string, unknown>
): void {
  if (!debug) return
  const errorInfo = error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) }
  console.error(`[api:${requestId}] !! ${method} ${url}`, { ...meta, error: errorInfo })
}

async function parseErrorPayload(response: Response): Promise<{ message: string; details?: string; raw?: unknown } | null> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const payload = await response.json() as unknown
      if (isApiError(payload)) return { message: payload.error, details: payload.details, raw: payload }
      const obj = asRecord(payload)
      if (obj && typeof obj.error === 'string') {
        return {
          message: obj.error,
          details: typeof obj.details === 'string' ? obj.details : undefined,
          raw: payload,
        }
      }
      return { message: `Request failed: ${response.status} ${response.statusText}`, raw: payload }
    } catch {
      return null
    }
  }

  try {
    const text = await response.text()
    if (text.trim()) return { message: `Request failed: ${response.status} ${response.statusText}`, raw: text.slice(0, 1000) }
  } catch {
    // ignore body parse errors for error responses
  }
  return null
}

async function requestJson<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  options?: { body?: unknown; headers?: Record<string, string> }
): Promise<T> {
  const debug = shouldDebugApi(url)
  const requestId = nextApiRequestId()
  const startedAt = nowMs()
  logApiStart(debug, requestId, method, url, options?.body)

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(options?.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options?.headers || {}),
      },
      ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch (error) {
    logApiFailure(debug, requestId, method, url, error, {
      durationMs: Number((nowMs() - startedAt).toFixed(1)),
      stage: 'network',
    })
    throw error
  }

  logApiResult(debug, requestId, method, url, response.status, response.statusText, nowMs() - startedAt)

  if (!response.ok) {
    const parsedError = await parseErrorPayload(response)
    const message = parsedError?.message || `Request failed: ${response.status} ${response.statusText}`
    logApiFailure(debug, requestId, method, url, new Error(message), {
      status: response.status,
      statusText: response.statusText,
      details: parsedError?.details,
      responseBody: summarizeValue(parsedError?.raw),
      stage: 'response_error',
    })
    throw new Error(message)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    logApiFailure(debug, requestId, method, url, error, { stage: 'json_parse' })
    throw new Error('Invalid JSON response from server')
  }

  if (isApiError(json)) {
    logApiFailure(debug, requestId, method, url, new Error(json.error), { stage: 'api_error_payload' })
    throw new Error(json.error)
  }

  const record = asRecord(json)
  if (!record || record.success !== true) {
    logApiFailure(debug, requestId, method, url, new Error('Invalid API response format'), {
      stage: 'shape_validation',
      responseBody: summarizeValue(json),
    })
    throw new Error('Invalid API response format')
  }

  const data = (json as ApiSuccess<T>).data
  if (debug) console.info(`[api:${requestId}] ok`, { data: summarizeValue(data) })
  return data
}

export async function apiGet<T>(url: string, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>('GET', url, { headers })
}

export async function apiPost<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>('POST', url, { body, headers })
}

export async function apiPut<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>('PUT', url, { body, headers })
}

export async function apiDelete<T>(url: string, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>('DELETE', url, { headers })
}
