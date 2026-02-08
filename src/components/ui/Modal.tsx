import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  className?: string
}

export default function Modal({ open, title, onClose, children, className }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        className={cn('flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl', className)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

