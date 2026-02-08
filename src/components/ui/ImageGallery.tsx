import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  images: string[]
  initialIndex?: number
  open: boolean
  onClose: () => void
  title?: string
}

export default function ImageGallery({ images, initialIndex = 0, open, onClose, title }: Props) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    setCurrentIndex(initialIndex)
    setZoom(1)
  }, [initialIndex, open])

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1))
    setZoom(1)
  }, [images.length])

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
    setZoom(1)
  }, [images.length])

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.5, 3))
  }

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.5, 1))
  }

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
      if (e.key === '+' || e.key === '=') handleZoomIn()
      if (e.key === '-' || e.key === '_') handleZoomOut()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, handlePrev, handleNext, onClose])

  if (!open || images.length === 0) return null

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-4">
        <div className="text-white">
          {title && <div className="text-lg font-semibold">{title}</div>}
          <div className="text-sm text-white/70">
            {currentIndex + 1} / {images.length}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          aria-label="Закрыть"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Main Image */}
      <div className="flex h-full items-center justify-center p-16">
        <img
          src={images[currentIndex]}
          alt={`${currentIndex + 1}`}
          className="max-h-full max-w-full object-contain transition-transform duration-300"
          style={{ transform: `scale(${zoom})` }}
        />
      </div>

      {/* Navigation Controls */}
      {images.length > 1 && (
        <>
          <button
            onClick={handlePrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
            aria-label="Предыдущее фото"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
            aria-label="Следующее фото"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Zoom Controls */}
      <div className="absolute bottom-24 right-4 flex flex-col gap-2">
        <button
          onClick={handleZoomIn}
          disabled={zoom >= 3}
          className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Приблизить"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <button
          onClick={handleZoomOut}
          disabled={zoom <= 1}
          className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Отдалить"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
          <div className="mx-auto flex max-w-4xl gap-2 overflow-x-auto pb-2">
            {images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCurrentIndex(idx)
                  setZoom(1)
                }}
                className={cn(
                  'h-16 w-24 shrink-0 overflow-hidden rounded border-2 transition-all',
                  idx === currentIndex ? 'border-white scale-105' : 'border-transparent opacity-60 hover:opacity-100',
                )}
              >
                <img src={img} alt={`Миниатюра ${idx + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
