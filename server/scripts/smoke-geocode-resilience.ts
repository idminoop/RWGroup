import assert from 'node:assert/strict'
import express from 'express'
import publicRoutes from '../routes/public.js'

type FetchPhase = 'fail' | 'ok'

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch
  let phase: FetchPhase = 'fail'
  let nominatimCalls = 0

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    if (url.startsWith('https://nominatim.openstreetmap.org/search')) {
      nominatimCalls += 1
      if (phase === 'fail') {
        throw new Error('Simulated transient timeout')
      }

      const query = new URL(url).searchParams.get('q') || 'test'
      const payload = [
        {
          lat: '55.7558',
          lon: '37.6176',
          display_name: `${query}, Москва`,
          class: 'building',
          type: 'house',
          importance: 0.92,
          address: {
            city: 'Москва',
            road: 'Тверская улица',
            house_number: '1',
          },
        },
      ]
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return originalFetch(input as RequestInfo | URL, init)
  }) as typeof fetch

  const app = express()
  app.use('/api', publicRoutes)

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const srv = app.listen(0, () => resolve(srv))
  })

  try {
    const address = server.address()
    assert(address && typeof address !== 'string', 'Server address is not available')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const query = encodeURIComponent('ЖК Test, Москва, Тверская 1')
    const url = `${baseUrl}/api/geocode?q=${query}&city=Moscow&moscowFirst=1`

    const firstResponse = await fetch(url)
    const firstJson = await firstResponse.json() as { success: boolean; data: unknown }
    assert.equal(firstJson.success, true)
    assert.equal(firstJson.data, null, 'First response should be null during transient outage')
    const callsAfterFirst = nominatimCalls
    assert(callsAfterFirst > 0, 'Expected at least one Nominatim call on first request')

    phase = 'ok'

    const secondResponse = await fetch(url)
    const secondJson = await secondResponse.json() as {
      success: boolean
      data: { lat: number; lon: number } | null
    }

    assert.equal(secondJson.success, true)
    assert(secondJson.data, 'Second response should recover after transient outage')
    assert.equal(typeof secondJson.data?.lat, 'number')
    assert.equal(typeof secondJson.data?.lon, 'number')
    assert(
      nominatimCalls > callsAfterFirst,
      'Second request should hit Nominatim again (transient null must not be cached)',
    )

    console.log('[smoke-geocode-resilience] OK')
  } finally {
    globalThis.fetch = originalFetch
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

run().catch((error) => {
  console.error('[smoke-geocode-resilience] FAILED', error)
  process.exit(1)
})
