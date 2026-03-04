import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const baseDatabaseUrl = process.env.DATABASE_URL?.trim()
if (!baseDatabaseUrl) {
  console.error('[smoke:feed] DATABASE_URL is required')
  process.exit(1)
}

const appPort = Number(process.env.SMOKE_PORT || 3102)
if (!Number.isFinite(appPort) || appPort <= 0) {
  console.error('[smoke:feed] SMOKE_PORT must be a positive number')
  process.exit(1)
}

type JsonRecord = Record<string, unknown>

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function requestJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonRecord }> {
  const response = await fetch(url, init)
  const body = (await response.json()) as JsonRecord
  return { status: response.status, body }
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // Server may still be booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Healthcheck timeout')
}

async function waitForCondition(
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 15_000,
  intervalMs = 150,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timeout while waiting for condition: ${description}`)
}

function buildDatabaseUrl(baseUrl: string, dbName: string): string {
  const parsed = new URL(baseUrl)
  parsed.pathname = `/${dbName}`
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

async function createTempDatabase(baseUrl: string): Promise<{ dbName: string; dbUrl: string }> {
  const dbName = `rwgroup_feed_smoke_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const adminUrl = buildDatabaseUrl(baseUrl, 'postgres')
  const adminPool = new Pool({ connectionString: adminUrl })
  try {
    await adminPool.query(`CREATE DATABASE ${dbName}`)
  } finally {
    await adminPool.end()
  }
  return { dbName, dbUrl: buildDatabaseUrl(baseUrl, dbName) }
}

async function dropTempDatabase(baseUrl: string, dbName: string): Promise<void> {
  const adminUrl = buildDatabaseUrl(baseUrl, 'postgres')
  const adminPool = new Pool({ connectionString: adminUrl })
  try {
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [dbName],
    )
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`)
  } finally {
    await adminPool.end()
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-admin-token': token,
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return String(value || '')
}

async function main(): Promise<void> {
  const { dbName, dbUrl } = await createTempDatabase(baseDatabaseUrl)
  const baseUrl = `http://127.0.0.1:${appPort}`
  const dbPool = new Pool({ connectionString: dbUrl })

  process.env.RW_STORAGE_DRIVER = 'postgres'
  process.env.RW_FEED_SCHEDULER_ENABLED = 'false'
  process.env.RW_BACKUP_SCHEDULER_ENABLED = 'false'
  process.env.RW_SEED_ENABLED = 'true'
  process.env.RW_FEED_FETCH_TIMEOUT_MS = '300'
  process.env.RW_FEED_FETCH_MAX_BYTES = '2048'
  process.env.RW_FEED_MAX_ROWS = '2'
  process.env.RW_FEED_FETCH_ALLOW_PRIVATE_HOSTS = 'false'
  process.env.DATABASE_URL = dbUrl
  process.env.PORT = String(appPort)

  const feedServer = createServer((req, res) => {
    if (req.url === '/ok.json') {
      const payload = JSON.stringify([
        {
          external_id: 'URL-1',
          complex_external_id: 'URL-C-1',
          complex_title: 'URL ЖК',
          title: 'URL lot',
          district: 'Test district',
          bedrooms: 1,
          price: 1000000,
          area_total: 30,
          deal_type: 'sale',
          category: 'newbuild',
        },
      ])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(payload)
      return
    }

    if (req.url === '/huge.json') {
      const payload = `[${' '.repeat(4096)}]`
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      })
      res.end(payload)
      return
    }

    if (req.url === '/slow.json') {
      setTimeout(() => {
        const payload = JSON.stringify([])
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(payload)
      }, 3000)
      return
    }

    if (req.url === '/too-many.json') {
      const payload = JSON.stringify([
        { external_id: 'MANY-1', bedrooms: 1, price: 1, area_total: 1 },
        { external_id: 'MANY-2', bedrooms: 1, price: 1, area_total: 1 },
        { external_id: 'MANY-3', bedrooms: 1, price: 1, area_total: 1 },
      ])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(payload)
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false }))
  })

  await new Promise<void>((resolve, reject) => {
    feedServer.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

  const feedAddress = feedServer.address()
  assert(feedAddress && typeof feedAddress === 'object', 'Feed test server failed to start')
  const feedBaseUrl = `http://127.0.0.1:${feedAddress.port}`

  const [{ default: app }, { closeStorage }] = await Promise.all([
    import('../app.js'),
    import('../lib/storage.js'),
  ])
  const server = app.listen(appPort)

  try {
    await waitForHealth(baseUrl)

    const token = process.env.ADMIN_TOKEN || 'dev-token'

    const metaBeforeResult = await dbPool.query<{ draft_updated_at: Date | string }>(
      'SELECT draft_updated_at FROM rw_storage_meta WHERE id = 1',
    )
    const metaBefore = toIso(metaBeforeResult.rows[0]?.draft_updated_at)
    assert(Boolean(metaBefore), 'draft_updated_at missing before read checks')

    const readEndpoints = [
      `${baseUrl}/api/admin/home`,
      `${baseUrl}/api/admin/feeds`,
      `${baseUrl}/api/admin/import/runs`,
      `${baseUrl}/api/admin/users`,
      `${baseUrl}/api/admin/catalog/items?type=property&page=1&limit=10`,
    ]
    for (const endpoint of readEndpoints) {
      const response = await requestJson(endpoint, { headers: { 'x-admin-token': token } })
      assert(
        response.status === 200 && response.body.success === true,
        `Read endpoint failed: ${endpoint}; status=${response.status}; body=${JSON.stringify(response.body)}`,
      )
    }

    const metaAfterResult = await dbPool.query<{ draft_updated_at: Date | string }>(
      'SELECT draft_updated_at FROM rw_storage_meta WHERE id = 1',
    )
    const metaAfter = toIso(metaAfterResult.rows[0]?.draft_updated_at)
    assert(metaAfter === metaBefore, 'Read endpoints unexpectedly changed draft_updated_at')

    const createFeed = async (name: string): Promise<string> => {
      const response = await requestJson(`${baseUrl}/api/admin/feeds`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          name,
          mode: 'upload',
          format: 'json',
        }),
      })
      assert(response.status === 200 && response.body.success === true, `Feed create failed: ${name}`)
      const id = (response.body.data as JsonRecord | undefined)?.id
      assert(typeof id === 'string', `Feed id missing for ${name}`)
      return id
    }

    const feedA = await createFeed('Smoke Feed A')
    const feedB = await createFeed('Smoke Feed B')
    const feedBlocked = await createFeed('Smoke Feed Blocked')
    const feedRowsLimit = await createFeed('Smoke Feed Rows Limit')
    const feedHuge = await createFeed('Smoke Feed Huge')
    const feedSlow = await createFeed('Smoke Feed Slow')

    const importRows = async (sourceId: string, rows: unknown[]): Promise<{ status: number; body: JsonRecord }> => {
      return requestJson(`${baseUrl}/api/admin/import/run`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          source_id: sourceId,
          entity: 'property',
          rows: JSON.stringify(rows),
        }),
      })
    }

    const rowsA = [
      {
        external_id: 'P-1',
        complex_external_id: 'C-1',
        complex_title: 'ЖК Без Риска',
        title: 'Квартира 1',
        district: 'ЦАО',
        bedrooms: 2,
        price: 15000000,
        area_total: 50,
        deal_type: 'sale',
        category: 'newbuild',
      },
    ]
    const rowsB = [
      {
        external_id: 'P-1',
        complex_external_id: 'C-2',
        complex_title: 'ЖК Без Риска',
        title: 'Квартира 1',
        district: 'ЦАО',
        bedrooms: 2,
        price: 15100000,
        area_total: 50,
        deal_type: 'sale',
        category: 'newbuild',
      },
    ]

    const importA = await importRows(feedA, rowsA)
    assert(importA.status === 200 && importA.body.success === true, 'Import A failed')

    const importB = await importRows(feedB, rowsB)
    assert(importB.status === 200 && importB.body.success === true, 'Import B failed')

    const importAEmpty = await importRows(feedA, [])
    assert(importAEmpty.status === 200 && importAEmpty.body.success === true, 'Import A(empty) failed')

    await waitForCondition(
      async () => {
        const probe = await dbPool.query(
          "SELECT COUNT(*)::int AS count FROM rw_properties WHERE scope = 'draft' AND external_id = 'P-1'",
        )
        return Number(probe.rows[0]?.count || 0) > 0
      },
      'property import persistence for external_id P-1',
    )

    const propertyCheck = await dbPool.query<{
      source_id: string
      status: string
    }>(
      "SELECT source_id, status FROM rw_properties WHERE scope = 'draft' AND external_id = 'P-1'",
    )
    assert(
      propertyCheck.rows.length === 1,
      `Expected one deduplicated property row for P-1, got ${propertyCheck.rows.length}: ${JSON.stringify(propertyCheck.rows)}`,
    )
    assert(propertyCheck.rows[0].source_id === feedB, 'Property ownership should move to latest source')
    assert(propertyCheck.rows[0].status === 'active', 'Property should remain active after Feed A empty import')

    const complexCheck = await dbPool.query<{
      id: string
      source_id: string
      status: string
    }>(
      "SELECT id, source_id, status FROM rw_complexes WHERE scope = 'draft' AND external_id = 'C-2'",
    )
    assert(complexCheck.rows.length === 1, 'Expected one deduplicated complex row for title')
    assert(complexCheck.rows[0].source_id === feedB, 'Complex ownership should move to latest source')
    assert(complexCheck.rows[0].status === 'active', 'Complex should remain active after Feed A empty import')

    const deleteComplex = await requestJson(
      `${baseUrl}/api/admin/catalog/items/complex/${complexCheck.rows[0].id}`,
      {
        method: 'DELETE',
        headers: { 'x-admin-token': token },
      },
    )
    assert(deleteComplex.status === 200 && deleteComplex.body.success === true, 'Complex hard-delete via catalog failed')

    await waitForCondition(
      async () => {
        const probe = await dbPool.query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM rw_properties WHERE scope = 'draft' AND external_id = 'P-1'",
        )
        return Number(probe.rows[0]?.count || 0) === 0
      },
      'hard-delete persistence for property P-1',
    )

    const deletedPropertyProbe = await dbPool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM rw_properties WHERE scope = 'draft' AND external_id = 'P-1'",
    )
    assert(Number(deletedPropertyProbe.rows[0]?.count || 0) === 0, 'Property should be physically deleted')

    const deletedComplexProbe = await dbPool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM rw_complexes WHERE scope = 'draft' AND id = $1",
      [complexCheck.rows[0].id],
    )
    assert(Number(deletedComplexProbe.rows[0]?.count || 0) === 0, 'Complex should be physically deleted')

    const restoreImport = await importRows(feedB, rowsB)
    assert(restoreImport.status === 200 && restoreImport.body.success === true, 'Re-import after delete failed')

    await waitForCondition(
      async () => {
        const probe = await dbPool.query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM rw_properties WHERE scope = 'draft' AND external_id = 'P-1'",
        )
        return Number(probe.rows[0]?.count || 0) === 1
      },
      're-import persistence for property P-1 after hard-delete',
    )

    const restoredProbe = await dbPool.query<{ complex_status: string; property_status: string }>(
      `SELECT
         c.status AS complex_status,
         p.status AS property_status
       FROM rw_complexes c
       JOIN rw_properties p ON p.complex_id = c.id
       WHERE c.scope = 'draft' AND p.scope = 'draft' AND p.external_id = 'P-1'`,
    )
    assert(restoredProbe.rows.length === 1, 'Re-import probe row for P-1 is missing')
    assert(restoredProbe.rows[0].complex_status === 'active', 'Complex should be active after re-import')
    assert(restoredProbe.rows[0].property_status === 'active', 'Property should be active after re-import')

    const blockedImport = await requestJson(`${baseUrl}/api/admin/import/run`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        source_id: feedBlocked,
        entity: 'property',
        url: `${feedBaseUrl}/ok.json`,
      }),
    })
    assert(blockedImport.status === 500, 'Local/private host must be blocked by default')
    const blockedDetails = String(blockedImport.body.details || '').toLowerCase()
    assert(blockedDetails.includes('private/local'), 'Blocked-host error must mention private/local host policy')

    process.env.RW_FEED_FETCH_ALLOW_PRIVATE_HOSTS = 'true'

    const rowsLimitImport = await requestJson(`${baseUrl}/api/admin/import/run`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        source_id: feedRowsLimit,
        entity: 'property',
        url: `${feedBaseUrl}/too-many.json`,
      }),
    })
    assert(rowsLimitImport.status === 500, 'Too-many-rows feed should fail with 500')
    const rowsLimitDetails = String(rowsLimitImport.body.details || '')
    assert(rowsLimitDetails.toLowerCase().includes('too many rows'), 'Rows-limit error must mention row limit')

    const hugeImport = await requestJson(`${baseUrl}/api/admin/import/run`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        source_id: feedHuge,
        entity: 'property',
        url: `${feedBaseUrl}/huge.json`,
      }),
    })
    assert(hugeImport.status === 500, 'Huge feed should fail with 500')
    const hugeDetails = String(hugeImport.body.details || '')
    assert(hugeDetails.toLowerCase().includes('too large'), 'Huge feed error must mention size limit')

    const slowImport = await requestJson(`${baseUrl}/api/admin/import/run`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        source_id: feedSlow,
        entity: 'property',
        url: `${feedBaseUrl}/slow.json`,
      }),
    })
    assert(slowImport.status === 500, 'Slow feed should fail with 500')
    const slowDetails = String(slowImport.body.details || '')
    assert(slowDetails.toLowerCase().includes('timeout'), 'Slow feed error must mention timeout')

    await waitForCondition(
      async () => {
        const probe = await dbPool.query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM rw_import_runs WHERE scope = 'draft' AND source_id IN ($1, $2)",
          [feedHuge, feedSlow],
        )
        return Number(probe.rows[0]?.count || 0) >= 2
      },
      'failed import runs persistence for huge/slow feeds',
    )

    const failedRuns = await dbPool.query<{ source_id: string; status: string }>(
      "SELECT source_id, status FROM rw_import_runs WHERE scope = 'draft' AND source_id IN ($1, $2) ORDER BY started_at DESC",
      [feedHuge, feedSlow],
    )
    assert(
      failedRuns.rows.some((row) => row.source_id === feedHuge && row.status === 'failed'),
      'Failed run for huge feed is missing',
    )
    assert(
      failedRuns.rows.some((row) => row.source_id === feedSlow && row.status === 'failed'),
      'Failed run for slow feed is missing',
    )

    const policyRuns = await dbPool.query<{ source_id: string; status: string }>(
      "SELECT source_id, status FROM rw_import_runs WHERE scope = 'draft' AND source_id IN ($1, $2) ORDER BY started_at DESC",
      [feedBlocked, feedRowsLimit],
    )
    assert(
      policyRuns.rows.some((row) => row.source_id === feedBlocked && row.status === 'failed'),
      'Failed run for blocked-host feed is missing',
    )
    assert(
      policyRuns.rows.some((row) => row.source_id === feedRowsLimit && row.status === 'failed'),
      'Failed run for rows-limit feed is missing',
    )

    const health = await requestJson(`${baseUrl}/api/health`)
    assert(health.status === 200 && health.body.success === true, 'Server is not healthy after failure scenarios')

    const summary = {
      dbName,
      dedupPropertySource: propertyCheck.rows[0].source_id,
      dedupComplexSource: complexCheck.rows[0].source_id,
      failedImportRuns: failedRuns.rows.length,
      policyFailedRuns: policyRuns.rows.length,
      draftUpdatedAtStableOnRead: metaBefore === metaAfter,
    }
    console.log('[smoke:feed] Feed import smoke passed')
    console.log('[smoke:feed] Summary:', JSON.stringify(summary))
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    await new Promise<void>((resolve) => {
      feedServer.close(() => resolve())
    })
    await closeStorage()
    await dbPool.end()
    await dropTempDatabase(baseDatabaseUrl, dbName)
  }
}

main().catch((error) => {
  console.error('[smoke:feed] Failed:', error)
  process.exitCode = 1
})
