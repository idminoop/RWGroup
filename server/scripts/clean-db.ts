
import { closeStorage, flushStorage, initializeStorage, withDb } from '../lib/storage.js'

async function main(): Promise<void> {
  await initializeStorage()

  withDb((db) => {
    console.log(`Before: ${db.properties.length} properties, ${db.complexes.length} complexes, ${db.feed_sources.length} feeds`)
    db.properties = []
    db.complexes = []
    db.feed_sources = []
    console.log(`After: ${db.properties.length} properties, ${db.complexes.length} complexes, ${db.feed_sources.length} feeds`)
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
