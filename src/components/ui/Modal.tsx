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
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={cn('flex min-w-0 max-h-[92svh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl sm:max-h-[90vh]', className)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4">
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
        <div className="min-h-0 overflow-x-auto overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">{children}</div>
      </div>
    </div>
  )
}

