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
import path from 'path'
import fs from 'fs'

// load env
dotenv.config()

ensureSeed()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'server', 'uploads')))

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api', publicRoutes)
app.use('/api/leads', leadsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/analytics', analyticsRoutes)

const DIST_DIR = path.join(process.cwd(), 'dist')
const DIST_INDEX = path.join(DIST_DIR, 'index.html')
const HAS_DIST = fs.existsSync(DIST_INDEX)

if (HAS_DIST) {
  app.use(express.static(DIST_DIR))
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
