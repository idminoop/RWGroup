import fs from 'fs/promises'
import path from 'path'
import { PutObjectCommand, S3Client, type ObjectCannedACL } from '@aws-sdk/client-s3'
import { newId } from './ids.js'
import { UPLOADS_DIR } from './paths.js'

type MediaStorageDriver = 'local' | 's3'

type UploadImageInput = {
  buffer: Buffer
  originalName: string
  mimeType?: string
  folder?: string
}

type UploadImageResult = {
  url: string
  key: string
  driver: MediaStorageDriver
}

type S3UploadConfig = {
  bucket: string
  region: string
  endpoint?: string
  forcePathStyle: boolean
  accessKeyId?: string
  secretAccessKey?: string
  prefix?: string
  cacheControl: string
  cdnBaseUrl?: string
  acl?: ObjectCannedACL
}

const DEFAULT_S3_REGION = 'us-east-1'
const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const DEFAULT_S3_PREFIX = 'media'

const IMAGE_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

let s3Client: S3Client | null = null
let warnedMissingS3Config = false
let warnedS3Fallback = false

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function normalizeSegment(value: string | undefined): string {
  if (!value) return ''
  return value.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

function joinKey(...parts: Array<string | undefined>): string {
  return parts.map(normalizeSegment).filter(Boolean).join('/')
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, '')
}

function hasS3Config(): boolean {
  return Boolean((process.env.RW_S3_BUCKET || '').trim())
}

function resolveDriver(): MediaStorageDriver {
  const raw = (process.env.RW_MEDIA_STORAGE_DRIVER || 'auto').trim().toLowerCase()
  if (raw === 'local') return 'local'
  if (raw === 's3') {
    if (hasS3Config()) return 's3'
    if (!warnedMissingS3Config) {
      warnedMissingS3Config = true
      console.warn('[media-storage] RW_MEDIA_STORAGE_DRIVER=s3 set, but RW_S3_BUCKET is missing. Falling back to local storage.')
    }
    return 'local'
  }
  return hasS3Config() ? 's3' : 'local'
}

function resolveExt(originalName: string, mimeType?: string): string {
  const ext = path.extname(originalName || '').toLowerCase()
  if (IMAGE_CONTENT_TYPE_BY_EXT[ext]) return ext

  const normalizedMime = (mimeType || '').toLowerCase().trim()
  if (normalizedMime === 'image/jpeg') return '.jpg'
  if (normalizedMime === 'image/jpg') return '.jpg'
  if (normalizedMime === 'image/png') return '.png'
  if (normalizedMime === 'image/webp') return '.webp'
  if (normalizedMime === 'image/gif') return '.gif'
  if (normalizedMime === 'image/svg+xml') return '.svg'
  if (normalizedMime === 'image/avif') return '.avif'

  return '.jpg'
}

function resolveContentType(ext: string, mimeType?: string): string {
  const normalizedMime = (mimeType || '').toLowerCase().trim()
  if (normalizedMime.startsWith('image/')) return normalizedMime
  return IMAGE_CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream'
}

function loadS3Config(): S3UploadConfig {
  const bucket = (process.env.RW_S3_BUCKET || '').trim()
  if (!bucket) {
    throw new Error('RW_S3_BUCKET is required when RW_MEDIA_STORAGE_DRIVER=s3')
  }

  const accessKeyId = (process.env.RW_S3_ACCESS_KEY_ID || '').trim() || undefined
  const secretAccessKey = (process.env.RW_S3_SECRET_ACCESS_KEY || '').trim() || undefined
  const endpoint = normalizeBaseUrl(process.env.RW_S3_ENDPOINT)
  const cdnBaseUrl = normalizeBaseUrl(process.env.RW_MEDIA_CDN_BASE_URL || process.env.RW_S3_PUBLIC_BASE_URL)
  const prefix = normalizeSegment(process.env.RW_S3_PREFIX || DEFAULT_S3_PREFIX)
  const cacheControl = (process.env.RW_MEDIA_CACHE_CONTROL || DEFAULT_CACHE_CONTROL).trim() || DEFAULT_CACHE_CONTROL
  const aclRaw = (process.env.RW_S3_ACL || '').trim()
  const acl = aclRaw ? (aclRaw as ObjectCannedACL) : undefined

  return {
    bucket,
    region: (process.env.RW_S3_REGION || DEFAULT_S3_REGION).trim() || DEFAULT_S3_REGION,
    endpoint,
    forcePathStyle: parseBooleanEnv(process.env.RW_S3_FORCE_PATH_STYLE, false),
    accessKeyId,
    secretAccessKey,
    prefix: prefix || undefined,
    cacheControl,
    cdnBaseUrl,
    acl,
  }
}

function getS3Client(config: S3UploadConfig): S3Client {
  if (s3Client) return s3Client
  const shouldUseStaticCredentials = Boolean(config.accessKeyId && config.secretAccessKey)
  s3Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: shouldUseStaticCredentials
      ? {
          accessKeyId: config.accessKeyId as string,
          secretAccessKey: config.secretAccessKey as string,
        }
      : undefined,
  })
  return s3Client
}

function encodeObjectKey(key: string): string {
  return key
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function resolveS3PublicUrl(config: S3UploadConfig, objectKey: string): string {
  const encodedKey = encodeObjectKey(objectKey)
  if (config.cdnBaseUrl) return `${config.cdnBaseUrl}/${encodedKey}`

  if (config.endpoint) {
    if (config.forcePathStyle) {
      return `${config.endpoint}/${config.bucket}/${encodedKey}`
    }
    const endpointUrl = new URL(config.endpoint)
    return `${endpointUrl.protocol}//${config.bucket}.${endpointUrl.host}/${encodedKey}`
  }

  const host =
    config.region === 'us-east-1'
      ? `${config.bucket}.s3.amazonaws.com`
      : `${config.bucket}.s3.${config.region}.amazonaws.com`
  return `https://${host}/${encodedKey}`
}

async function uploadToLocal(input: UploadImageInput, ext: string): Promise<UploadImageResult> {
  const filename = `${newId()}${ext}`
  const relativeKey = joinKey(input.folder, filename)
  const localFilePath = path.join(UPLOADS_DIR, ...relativeKey.split('/'))

  await fs.mkdir(path.dirname(localFilePath), { recursive: true })
  await fs.writeFile(localFilePath, input.buffer)

  return {
    url: `/uploads/${relativeKey}`,
    key: relativeKey,
    driver: 'local',
  }
}

async function uploadToS3(input: UploadImageInput, ext: string): Promise<UploadImageResult> {
  const config = loadS3Config()
  const client = getS3Client(config)

  const filename = `${newId()}${ext}`
  const relativeKey = joinKey(input.folder, filename)
  const objectKey = joinKey(config.prefix, relativeKey)

  const commandInput: {
    Bucket: string
    Key: string
    Body: Buffer
    ContentType: string
    CacheControl: string
    ACL?: ObjectCannedACL
  } = {
    Bucket: config.bucket,
    Key: objectKey,
    Body: input.buffer,
    ContentType: resolveContentType(ext, input.mimeType),
    CacheControl: config.cacheControl,
  }

  if (config.acl) {
    commandInput.ACL = config.acl
  }

  await client.send(new PutObjectCommand(commandInput))

  return {
    url: resolveS3PublicUrl(config, objectKey),
    key: objectKey,
    driver: 's3',
  }
}

export async function uploadImage(input: UploadImageInput): Promise<UploadImageResult> {
  const ext = resolveExt(input.originalName, input.mimeType)
  const driver = resolveDriver()
  if (driver === 's3') {
    try {
      return uploadToS3(input, ext)
    } catch (error) {
      if (!warnedS3Fallback) {
        warnedS3Fallback = true
        const message = error instanceof Error ? error.message : 'Unknown S3 error'
        console.warn(`[media-storage] S3 upload failed (${message}). Falling back to local storage.`)
      }
      return uploadToLocal(input, ext)
    }
  }
  return uploadToLocal(input, ext)
}

export function getMediaStorageDriver(): MediaStorageDriver {
  return resolveDriver()
}
