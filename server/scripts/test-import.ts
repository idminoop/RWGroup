
import { closeStorage, flushStorage, initializeStorage, withDb } from '../lib/storage.js'
import { upsertProperties } from '../lib/import-logic.js'
import { newId } from '../lib/ids.js'

async function main(): Promise<void> {
  await initializeStorage()
  console.log('Testing import...')

  const sourceId = newId()
  const rows = [
    {
      external_id: 'test-1',
      title: 'Test Property',
      price: 10000000,
      bedrooms: 2,
      area_total: 60,
      district: 'Central',
      deal_type: 'sale',
      category: 'newbuild',
    },
  ]

  withDb((db) => {
    db.feed_sources.push({
      id: sourceId,
      name: 'Test Source',
      mode: 'upload',
      format: 'json',
      is_active: true,
      created_at: new Date().toISOString(),
    })

    console.log('Running upsertProperties...')
    const result = upsertProperties(db, sourceId, rows)
    console.log('Result:', result)

    if (result.inserted === 1 && result.errors.length === 0) {
      console.log('SUCCESS: Property inserted.')
    } else {
      console.log('FAILURE: Property not inserted correctly.')
      console.log('Errors:', result.errors)
    }
  })

  await flushStorage()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeStorage()
  })
