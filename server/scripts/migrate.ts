import { closeStorage, flushStorage, initializeStorage } from '../lib/storage.js'

async function main(): Promise<void> {
  await initializeStorage()
  await flushStorage()
  console.log('[migrate] Storage initialized and migrations applied')
}

main()
  .catch((error) => {
    console.error('[migrate] Failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeStorage()
  })
