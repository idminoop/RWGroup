import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL?.trim()

if (!DATABASE_URL) {
  console.error('[smoke] DATABASE_URL is required')
  process.exit(1)
}

const port = Number(process.env.SMOKE_PORT || 3101)
if (!Number.isFinite(port) || port <= 0) {
  console.error('[smoke] SMOKE_PORT must be a positive number')
  process.exit(1)
}

process.env.RW_STORAGE_DRIVER = 'postgres'
process.env.RW_FEED_SCHEDULER_ENABLED = 'false'
process.env.PORT = String(port)

type JsonRecord = Record<string, unknown>

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // Server may still be booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error('Healthcheck timeout')
}

async function requestJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonRecord }> {
  const response = await fetch(url, init)
  const body = (await response.json()) as JsonRecord
  return { status: response.status, body }
}

async function main(): Promise<void> {
  const baseUrl = `http://127.0.0.1:${port}`
  const [{ default: app }, { closeStorage }] = await Promise.all([
    import('../app.js'),
    import('../lib/storage.js'),
  ])

  const server = app.listen(port)

  try {
    await waitForHealth(baseUrl)

    const health = await requestJson(`${baseUrl}/api/health`)
    assert(health.status === 200 && health.body.success === true, 'Health endpoint failed')

    const home = await requestJson(`${baseUrl}/api/home`)
    assert(home.status === 200 && home.body.success === true, 'Public home endpoint failed')
    assert(
      Boolean((home.body.data as JsonRecord | undefined)?.home),
      'Home payload is empty',
    )

    const leadCreate = await requestJson(`${baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        form_type: 'consultation',
        name: 'Postgres Smoke',
        phone: '+7 (999) 123-45-67',
        comment: 'e2e smoke',
        consent: true,
        company: '',
        source: { page: 'smoke-test', block: 'automation' },
      }),
    })
    assert(
      leadCreate.status === 200 && leadCreate.body.success === true,
      'Lead create failed',
    )
    const leadId = (leadCreate.body.data as JsonRecord | undefined)?.id
    assert(typeof leadId === 'string' && leadId.length > 0, 'Lead id missing')

    const login = await requestJson(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'admin' }),
    })
    assert(login.status === 200 && login.body.success === true, 'Admin login failed')
    const token = (login.body.data as JsonRecord | undefined)?.token
    assert(typeof token === 'string' && token.length > 0, 'Admin token missing')

    const adminLeads = await requestJson(`${baseUrl}/api/admin/leads`, {
      headers: { 'x-admin-token': token },
    })
    assert(
      adminLeads.status === 200 && adminLeads.body.success === true,
      'Admin leads endpoint failed',
    )
    const leadsData = adminLeads.body.data
    assert(Array.isArray(leadsData), 'Admin leads payload invalid')
    assert(
      leadsData.some((item) => (item as JsonRecord).id === leadId),
      'Created lead not visible in admin leads',
    )

    const publish = await requestJson(`${baseUrl}/api/admin/publish/apply`, {
      method: 'POST',
      headers: { 'x-admin-token': token },
    })
    assert(
      publish.status === 200 && publish.body.success === true,
      'Publish apply failed',
    )
    const publishedAt = (publish.body.data as JsonRecord | undefined)?.published_at
    assert(typeof publishedAt === 'string' && publishedAt.length > 0, 'published_at missing')

    const pool = new Pool({ connectionString: DATABASE_URL })
    try {
      const [homeDraft, homePublished, leadsDraft, meta] = await Promise.all([
        pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM rw_home_content WHERE scope = 'draft'",
        ),
        pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM rw_home_content WHERE scope = 'published'",
        ),
        pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM rw_leads WHERE scope = 'draft'",
        ),
        pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM rw_storage_meta',
        ),
      ])

      const summary = {
        homeDraft: Number(homeDraft.rows[0]?.count || '0'),
        homePublished: Number(homePublished.rows[0]?.count || '0'),
        leadsDraft: Number(leadsDraft.rows[0]?.count || '0'),
        storageMeta: Number(meta.rows[0]?.count || '0'),
        createdLeadId: leadId,
      }

      assert(summary.homeDraft > 0, 'rw_home_content draft is empty')
      assert(summary.homePublished > 0, 'rw_home_content published is empty')
      assert(summary.leadsDraft > 0, 'rw_leads draft is empty')
      assert(summary.storageMeta > 0, 'rw_storage_meta is empty')

      console.log('[smoke] E2E postgres smoke passed')
      console.log('[smoke] Summary:', JSON.stringify(summary))
    } finally {
      await pool.end()
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    await closeStorage()
  }
}

main().catch((error) => {
  console.error('[smoke] Failed:', error)
  process.exitCode = 1
})
