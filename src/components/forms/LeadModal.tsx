import { useEffect, useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import { useUiStore } from '@/store/useUiStore'
import { apiPost } from '@/lib/api'
import { formatPhoneRu, isValidPhoneDigits } from '@/utils/phone'
import { cn } from '@/lib/utils'
import { trackEvent } from '@/lib/analytics'

type LeadPayload = {
  form_type: 'consultation' | 'buy_sell' | 'view_details' | 'partner'
  tab?: 'buy' | 'sell'
  name: string
  phone: string
  comment?: string
  consent: boolean
  company?: string
  source: { page: string; block?: string; object_id?: string; object_type?: 'property' | 'complex' | 'collection' }
}

export default function LeadModal() {
  const modal = useUiStore((s) => s.leadModal)
  const close = useUiStore((s) => s.closeLeadModal)

  const [tab, setTab] = useState<'buy' | 'sell'>('buy')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [comment, setComment] = useState('')
  const [consent, setConsent] = useState(true)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = useMemo(() => {
    if (modal.type === 'consultation') return 'Получить консультацию'
    if (modal.type === 'buy_sell') return 'Купить / Продать'
    if (modal.type === 'view_details') return 'Записаться на просмотр / Узнать детали'
    return 'Стать партнёром'
  }, [modal.type])

  const needsComment = modal.type === 'partner'
  const needsTabs = modal.type === 'buy_sell'

  useEffect(() => {
    if (!modal.open) return
    if (modal.type !== 'buy_sell') return
    if (!modal.initialTab) return
    setTab(modal.initialTab)
  }, [modal.open, modal.type, modal.initialTab])

  const { digits, pretty } = formatPhoneRu(phone)
  const phoneOk = isValidPhoneDigits(digits)
  const canSubmit = name.trim().length > 0 && phoneOk && consent && !loading

  const reset = () => {
    setDone(false)
    setError(null)
  }

  const onClose = () => {
    close()
    setTimeout(() => {
      setName('')
      setPhone('')
      setComment('')
      setConsent(true)
      setLoading(false)
      setDone(false)
      setError(null)
      setTab('buy')
    }, 0)
  }

  const submit = async () => {
    reset()
    setLoading(true)
    try {
      const payload: LeadPayload = {
        form_type: modal.type,
        tab: needsTabs ? tab : undefined,
        name: name.trim(),
        phone: pretty,
        comment: needsComment ? comment.trim() : undefined,
        consent,
        company: '',
        source: modal.source,
      }
      await apiPost<unknown>('/api/leads', payload)
      trackEvent('form_submit', { form_type: payload.form_type, tab: payload.tab || '', page: payload.source.page, block: payload.source.block || '' })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={modal.open} title={title} onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <div className="text-sm text-slate-700">Заявка отправлена. Я свяжусь с вами в ближайшее время.</div>
          <Button onClick={onClose}>Закрыть</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {needsTabs && (
            <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-1 sm:w-auto">
              <button
                type="button"
                onClick={() => setTab('buy')}
                className={cn(
                  'h-9 flex-1 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none',
                  tab === 'buy' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                )}
              >
                Купить
              </button>
              <button
                type="button"
                onClick={() => setTab('sell')}
                className={cn(
                  'h-9 flex-1 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none',
                  tab === 'sell' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                )}
              >
                Продать
              </button>
            </div>
          )}

          <div className="grid gap-3">
            <div>
              <div className="mb-1 text-xs font-medium text-slate-700">Имя</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Как к вам обращаться" />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-slate-700">Телефон</div>
              <Input
                value={pretty}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="+7 (___) ___-__-__"
              />
              {!phoneOk && digits.length > 3 ? <div className="mt-1 text-xs text-rose-600">Введите корректный номер</div> : null}
            </div>
            {needsComment ? (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-700">Комментарий</div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-400"
                  placeholder="Коротко опишите запрос"
                />
              </div>
            ) : null}

            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                Я согласен(на) на обработку персональных данных и принимаю{' '}
                <a className="text-sky-600 hover:underline" href="/privacy">
                  политику конфиденциальности
                </a>
                .
              </span>
            </label>
          </div>

          {error ? <div className="text-sm text-rose-600">{error}</div> : null}

          <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
              Отмена
            </Button>
            <Button onClick={submit} disabled={!canSubmit} loading={loading} className="w-full sm:w-auto">
              {loading ? 'Отправка…' : 'Отправить'}
            </Button>
          </div>

          <div className="text-xs text-slate-500">Антиспам активен. Источник: {modal.source.block || modal.source.page}</div>
        </div>
      )}
    </Modal>
  )
}
