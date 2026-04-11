import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { Agent } from 'undici'

const DEFAULT_FEED_FETCH_TIMEOUT_MS = 20_000
const DEFAULT_FEED_FETCH_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_FEED_FETCH_MAX_REDIRECTS = 5
const DEFAULT_FEED_MAX_ROWS = 50_000
const DEFAULT_FEED_CONNECT_TIMEOUT_MS = 30_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

type FeedFetchOptions = {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  connectTimeoutMs?: number
}

type FeedFetchRequestInit = RequestInit & {
  dispatcher?: Agent
}

const FEED_FETCH_AGENT_CACHE = new Map<number, Agent>()

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function parseBooleanEnv(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined
  const value = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return undefined
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, '')
}

function parseAllowedHosts(raw: string | undefined): Set<string> | null {
  if (!raw) return null
  const hosts = raw
    .split(',')
    .map((part) => normalizeHostname(part))
    .filter(Boolean)
  if (!hosts.length) return null
  return new Set(hosts)
}

function isPrivateOrLocalIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some((part) => !Number.isFinite(part))) return false

  const [a, b] = octets
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

function isPrivateOrLocalIpv6(address: string): boolean {
  const normalized = address.trim().toLowerCase()
  if (!normalized) return true
  if (normalized === '::' || normalized === '::1') return true

  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    if (net.isIP(mapped) === 4) {
      return isPrivateOrLocalIpv4(mapped)
    }
  }

  const firstHextetRaw = normalized.split(':')[0]
  if (!firstHextetRaw) return false

  const firstHextet = Number.parseInt(firstHextetRaw, 16)
  if (!Number.isFinite(firstHextet)) return false
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true
  return false
}

function isPrivateOrLocalIp(address: string): boolean {
  const version = net.isIP(address)
  if (version === 4) return isPrivateOrLocalIpv4(address)
  if (version === 6) return isPrivateOrLocalIpv6(address)
  return false
}

function toReadableError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error('Feed request failed')
}

function extractErrorDetails(error: unknown, seen = new WeakSet<object>()): string | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  if (seen.has(record)) return 'circular'
  seen.add(record)
  const parts: string[] = []

  const code = typeof record.code === 'string' ? record.code : null
  const errno = typeof record.errno === 'string' || typeof record.errno === 'number' ? String(record.errno) : null
  const syscall = typeof record.syscall === 'string' ? record.syscall : null
  const hostname = typeof record.hostname === 'string' ? record.hostname : null
  const address = typeof record.address === 'string' ? record.address : null
  const port = typeof record.port === 'number' || typeof record.port === 'string' ? String(record.port) : null
  const message = typeof record.message === 'string' ? record.message : null

  if (code) parts.push(`code=${code}`)
  if (errno) parts.push(`errno=${errno}`)
  if (syscall) parts.push(`syscall=${syscall}`)
  if (hostname) parts.push(`host=${hostname}`)
  if (address) parts.push(`address=${address}`)
  if (port) parts.push(`port=${port}`)
  if (message) parts.push(`message=${message}`)

  const cause = record.cause
  const nested = extractErrorDetails(cause, seen)
  if (nested) parts.push(`cause={${nested}}`)

  if (!parts.length) return null
  return parts.join(', ')
}

function getFeedFetchAgent(connectTimeoutMs: number): Agent {
  const normalizedTimeoutMs = Math.max(1, Math.floor(connectTimeoutMs))
  const cached = FEED_FETCH_AGENT_CACHE.get(normalizedTimeoutMs)
  if (cached) return cached

  const agent = new Agent({
    connect: {
      timeout: normalizedTimeoutMs,
    },
  })
  FEED_FETCH_AGENT_CACHE.set(normalizedTimeoutMs, agent)
  return agent
}

async function validateFeedUrl(
  parsedUrl: URL,
  allowPrivateHosts: boolean,
  allowedHosts: Set<string> | null,
): Promise<void> {
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Unsupported feed URL protocol: ${parsedUrl.protocol}`)
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Feed URL must not contain credentials')
  }

  const hostname = normalizeHostname(parsedUrl.hostname)
  if (!hostname) {
    throw new Error('Feed URL host is missing')
  }

  if (allowedHosts && !allowedHosts.has(hostname)) {
    throw new Error(`Feed host is not allowed: ${hostname}`)
  }

  if (allowPrivateHosts) return

  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    throw new Error(`Private/local feed host is blocked: ${hostname}`)
  }

  if (isPrivateOrLocalIp(hostname)) {
    throw new Error(`Private/local feed host is blocked: ${hostname}`)
  }

  try {
    const records = await lookup(hostname, { all: true, verbatim: true })
    for (const record of records) {
      if (isPrivateOrLocalIp(record.address)) {
        throw new Error(`Private/local feed host is blocked: ${hostname}`)
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Private/local feed host is blocked')) {
      throw error
    }
    throw new Error(`Feed host lookup failed: ${hostname}`)
  }
}

async function fetchWithRedirectPolicy(
  url: URL,
  signal: AbortSignal,
  maxRedirects: number,
  connectTimeoutMs: number,
  allowPrivateHosts: boolean,
  allowedHosts: Set<string> | null,
): Promise<Response> {
  let currentUrl = url
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await validateFeedUrl(currentUrl, allowPrivateHosts, allowedHosts)
    const requestInit: FeedFetchRequestInit = {
      method: 'GET',
      signal,
      redirect: 'manual',
      dispatcher: getFeedFetchAgent(connectTimeoutMs),
    }
    const response = await fetch(currentUrl, requestInit)

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) {
      throw new Error(`Feed redirect without location header (status ${response.status})`)
    }
    if (hop === maxRedirects) {
      throw new Error(`Feed has too many redirects (limit ${maxRedirects})`)
    }
    currentUrl = new URL(location, currentUrl)
  }

  throw new Error('Feed redirect chain exceeded limit')
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLengthRaw = response.headers.get('content-length')
  if (contentLengthRaw) {
    const contentLength = Number.parseInt(contentLengthRaw, 10)
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Feed is too large: ${contentLength} bytes (limit ${maxBytes})`)
    }
  }

  if (!response.body) {
    const fallback = Buffer.from(await response.arrayBuffer())
    if (fallback.length > maxBytes) {
      throw new Error(`Feed is too large: ${fallback.length} bytes (limit ${maxBytes})`)
    }
    return fallback
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel('Feed too large')
      } catch {
        // Ignore cancellation errors.
      }
      throw new Error(`Feed is too large: exceeded ${maxBytes} bytes`)
    }

    chunks.push(Buffer.from(value))
  }

  return Buffer.concat(chunks, total)
}

export function getFeedFetchTimeoutMs(): number {
  return parsePositiveInt(process.env.RW_FEED_FETCH_TIMEOUT_MS) ?? DEFAULT_FEED_FETCH_TIMEOUT_MS
}

export function getFeedFetchMaxBytes(): number {
  return parsePositiveInt(process.env.RW_FEED_FETCH_MAX_BYTES) ?? DEFAULT_FEED_FETCH_MAX_BYTES
}

export function getFeedFetchMaxRedirects(): number {
  return parsePositiveInt(process.env.RW_FEED_FETCH_MAX_REDIRECTS) ?? DEFAULT_FEED_FETCH_MAX_REDIRECTS
}

export function getFeedConnectTimeoutMs(): number {
  return parsePositiveInt(process.env.RW_FEED_CONNECT_TIMEOUT_MS) ?? DEFAULT_FEED_CONNECT_TIMEOUT_MS
}

export function getFeedMaxRows(): number {
  return parsePositiveInt(process.env.RW_FEED_MAX_ROWS) ?? DEFAULT_FEED_MAX_ROWS
}

export function assertFeedRowLimit(rowsCount: number): void {
  const limit = getFeedMaxRows()
  if (rowsCount > limit) {
    throw new Error(`Feed has too many rows: ${rowsCount} (limit ${limit})`)
  }
}

export async function fetchFeedBuffer(url: string, options?: FeedFetchOptions): Promise<Buffer> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Invalid feed URL')
  }

  const timeoutMs = options?.timeoutMs ?? getFeedFetchTimeoutMs()
  const maxBytes = options?.maxBytes ?? getFeedFetchMaxBytes()
  const maxRedirects = options?.maxRedirects ?? getFeedFetchMaxRedirects()
  const configuredConnectTimeoutMs = options?.connectTimeoutMs ?? getFeedConnectTimeoutMs()
  const connectTimeoutMs = Math.max(1, Math.min(timeoutMs, configuredConnectTimeoutMs))
  const allowPrivateHosts = parseBooleanEnv(process.env.RW_FEED_FETCH_ALLOW_PRIVATE_HOSTS) === true
  const allowedHosts = parseAllowedHosts(process.env.RW_FEED_FETCH_ALLOWED_HOSTS)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchWithRedirectPolicy(
      parsedUrl,
      controller.signal,
      maxRedirects,
      connectTimeoutMs,
      allowPrivateHosts,
      allowedHosts,
    )

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`)
    }

    return await readResponseBody(response, maxBytes)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Feed request timeout after ${timeoutMs} ms`)
    }
    const readable = toReadableError(error)
    const details = extractErrorDetails(error)
    if (details && !readable.message.includes(details)) {
      throw new Error(`${readable.message} (${details})`)
    }
    throw readable
  } finally {
    clearTimeout(timeoutId)
  }
}
