/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import publicRoutes from './routes/public.js'
import leadsRoutes from './routes/leads.js'
import adminRoutes from './routes/admin.js'
import { ensureSeed } from './lib/seed.js'
import analyticsRoutes from './routes/analytics.js'
import { flushStorage, getStorageDriver, initializeStorage, withPublishedDb } from './lib/storage.js'
import { botPrerender } from './lib/bot-renderer.js'
import { startFeedScheduler } from './lib/feed-scheduler.js'
import { startBackupScheduler } from './lib/backups.js'
import { getMediaStorageDriver } from './lib/media-storage.js'
import path from 'path'
import fs from 'fs'
import { DATA_DIR, UPLOADS_DIR } from './lib/paths.js'

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.K_SERVICE
  )
}

// load env
dotenv.config()

await initializeStorage()
ensureSeed()
await flushStorage()

const schedulerFlag = parseBooleanEnv(process.env.RW_FEED_SCHEDULER_ENABLED)
const schedulerEnabled = schedulerFlag !== undefined ? schedulerFlag : !isServerlessRuntime()
if (schedulerEnabled) {
  startFeedScheduler()
}
const backupSchedulerFlag = parseBooleanEnv(process.env.RW_BACKUP_SCHEDULER_ENABLED)
const backupSchedulerEnabled = backupSchedulerFlag !== undefined ? backupSchedulerFlag : !isServerlessRuntime()
if (backupSchedulerEnabled) {
  startBackupScheduler()
}
console.log(`[runtime] Feed scheduler: ${schedulerEnabled ? 'enabled' : 'disabled'}`)
console.log(`[runtime] Backup scheduler: ${backupSchedulerEnabled ? 'enabled' : 'disabled'}`)
console.log(`[runtime] Media storage driver: ${getMediaStorageDriver()}`)
const storageDriver = getStorageDriver()
console.log(`[runtime] Storage driver: ${storageDriver}`)
console.log(`[runtime] Data dir: ${DATA_DIR}`)
console.log(`[runtime] RW_PG_BOOTSTRAP_FROM_LOCAL: ${process.env.RW_PG_BOOTSTRAP_FROM_LOCAL ?? 'unset'}`)
console.log(`[runtime] RW_SEED_ENABLED: ${process.env.RW_SEED_ENABLED ?? 'unset'}`)

const allowFileStorageInProd = parseBooleanEnv(process.env.RW_ALLOW_FILE_STORAGE_IN_PROD) === true
if (process.env.NODE_ENV === 'production' && storageDriver === 'file' && !allowFileStorageInProd) {
  console.error(
    '[runtime] Refusing to start in production with file storage. Set RW_STORAGE_DRIVER=postgres (recommended) or RW_ALLOW_FILE_STORAGE_IN_PROD=true if you intentionally use a mounted volume.',
  )
  process.exit(1)
}

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Serve uploaded files
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    maxAge: '365d',
    immutable: true,
  }),
)

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api', publicRoutes)
app.use('/api/leads', leadsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/analytics', analyticsRoutes)

/**
 * Sitemap.xml — dynamic generation from published DB
 */
app.get('/sitemap.xml', (req: Request, res: Response) => {
  const SITE_URL = `${req.protocol}://${req.get('host')}`

  try {
    const entries = withPublishedDb((db) => {
      const urls: { loc: string; lastmod?: string; priority?: string }[] = [
        { loc: '/', priority: '1.0' },
        { loc: '/catalog', priority: '0.8' },
        { loc: '/privacy', priority: '0.3' },
      ]

      for (const c of db.complexes) {
        if (c.status !== 'active') continue
        urls.push({
          loc: `/complex/${c.slug || c.id}`,
          lastmod: c.updated_at?.split('T')[0],
          priority: '0.7',
        })
      }

      for (const p of db.properties) {
        if (p.status !== 'active') continue
        urls.push({
          loc: `/property/${p.slug || p.id}`,
          lastmod: p.updated_at?.split('T')[0],
          priority: '0.6',
        })
      }

      for (const col of db.collections) {
        if (col.status !== 'visible') continue
        urls.push({
          loc: `/collection/${col.slug || col.id}`,
          lastmod: col.updated_at?.split('T')[0],
          priority: '0.5',
        })
      }

      return urls
    })

    const urlEntries = entries.map((entry) => {
      let xml = `  <url>\n    <loc>${SITE_URL}${entry.loc}</loc>`
      if (entry.lastmod) xml += `\n    <lastmod>${entry.lastmod}</lastmod>`
      if (entry.priority) xml += `\n    <priority>${entry.priority}</priority>`
      xml += `\n  </url>`
      return xml
    })

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join('\n')}
</urlset>`

    res.set('Content-Type', 'application/xml')
    res.send(sitemap)
  } catch {
    res.status(500).set('Content-Type', 'application/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
    )
  }
})

const DIST_DIR = path.join(process.cwd(), 'dist')
const DIST_INDEX = path.join(DIST_DIR, 'index.html')
const HAS_DIST = fs.existsSync(DIST_INDEX)

if (HAS_DIST) {
  app.use(express.static(DIST_DIR))
  app.use(botPrerender())
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    const isApiOrUpload = req.path.startsWith('/api') || req.path.startsWith('/uploads')
    const isFileRequest = path.extname(req.path) !== ''
    const acceptsHtml = req.headers.accept?.includes('text/html')

    if (isApiOrUpload || isFileRequest || !acceptsHtml) {
      next()
      return
    }

    res.sendFile(DIST_INDEX)
  })
}

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
      data: {
        storage_driver: getStorageDriver(),
        data_dir: DATA_DIR,
      },
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  void error
  void next
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
