import { useRef, useState, useEffect, useMemo } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import ManualItemsEditor from './ManualItemsEditor'
import AutoRulesBuilder from './AutoRulesBuilder'
import { apiPost, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { Collection, CollectionMode, CollectionAutoRules } from '../../../../shared/types'

type Props = {
  open: boolean
  onClose: () => void
  onSave: () => void
  collection?: Collection | null
}

export default function CollectionModal({ open, onClose, onSave, collection }: Props) {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const isEdit = Boolean(collection)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [priority, setPriority] = useState(0)
  const [status, setStatus] = useState<'visible' | 'hidden'>('visible')
  const [mode, setMode] = useState<CollectionMode>('manual')
  const [items, setItems] = useState<Array<{ type: 'property' | 'complex'; ref_id: string }>>([])
  const [autoRules, setAutoRules] = useState<CollectionAutoRules>({ type: 'property' })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (collection) {
      setTitle(collection.title)
      setDescription(collection.description || '')
      setCoverImage(collection.cover_image || '')
      setPriority(collection.priority)
      setStatus(collection.status)
      setMode(collection.mode)
      setItems(collection.items)
      setAutoRules(collection.auto_rules || { type: 'property' })
    } else {
      // Reset for new collection
      setTitle('')
      setDescription('')
      setCoverImage('')
      setPriority(0)
      setStatus('visible')
      setMode('manual')
      setItems([])
      setAutoRules({ type: 'property' })
    }
    setError(null)
  }, [collection, open])

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Название обязательно')
      return
    }

    if (mode === 'auto' && !autoRules) {
      setError('Необходимо настроить правила для автоматической подборки')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload = {
        title,
        description: description || undefined,
        cover_image: coverImage || undefined,
        priority,
        status,
        mode,
        ...(mode === 'manual' ? { items } : { auto_rules: autoRules }),
      }

      if (isEdit && collection) {
        await apiPut(`/api/admin/collections/${collection.id}`, payload, headers)
      } else {
        await apiPost('/api/admin/collections', payload, headers)
      }

      onSave()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка при сохранении')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (!saving) {
      onClose()
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'x-admin-token': token || '' },
        body: formData,
      })

      const json = await res.json()

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Ошибка загрузки')
      }

      setCoverImage(json.data.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки файла')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={isEdit ? 'Редактировать подборку' : 'Создать подборку'} className="max-w-4xl">
      <div className="space-y-6">
        {/* Basic Info */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-700">Название *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название подборки" />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Описание</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Краткое описание" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-700">Приоритет</label>
              <Input
                type="number"
                inputMode="numeric"
                value={String(priority)}
                onChange={(e) => setPriority(Number(e.target.value || 0))}
                placeholder="0"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Статус</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as 'visible' | 'hidden')}>
                <option value="visible">Видна</option>
                <option value="hidden">Скрыта</option>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700 block mb-2">Обложка</label>
            <div className="space-y-2">
              <Input value={coverImage} onChange={(e) => setCoverImage(e.target.value)} placeholder="https://... или загрузите файл" />
              <div className="flex items-center gap-2">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    disabled={uploading || saving}
                  />
                  <Button type="button" size="sm" variant="secondary" disabled={uploading || saving} onClick={(e) => {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }}>
                    {uploading ? 'Загрузка...' : 'Загрузить файл'}
                  </Button>
                </label>
                {coverImage && (
                  <div className="flex items-center gap-2">
                    <img src={coverImage} alt="Preview" className="h-10 w-10 rounded object-cover" />
                    <button
                      type="button"
                      onClick={() => setCoverImage('')}
                      className="text-xs text-rose-600 hover:text-rose-700"
                    >
                      Удалить
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Mode Selection */}
        <div>
          <label className="text-xs font-medium text-slate-700 block mb-2">Режим подборки *</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setMode('manual')}
              disabled={isEdit}
              className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${
                mode === 'manual'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } ${isEdit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="font-medium text-sm">Ручная</div>
              <div className="text-xs text-slate-600 mt-1">Вручную добавляйте объекты в подборку</div>
            </button>
            <button
              type="button"
              onClick={() => setMode('auto')}
              disabled={isEdit}
              className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${
                mode === 'auto'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } ${isEdit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="font-medium text-sm">Автоматическая</div>
              <div className="text-xs text-slate-600 mt-1">Объекты добавляются по правилам фильтрации</div>
            </button>
          </div>
          {isEdit && <div className="text-xs text-slate-500 mt-1">Режим нельзя изменить после создания</div>}
        </div>

        {/* Mode-specific Editor */}
        <div className="border-t border-slate-200 pt-6">
          {mode === 'manual' ? (
            <ManualItemsEditor value={items} onChange={setItems} collectionId={collection?.id} />
          ) : (
            <AutoRulesBuilder value={autoRules} onChange={setAutoRules} />
          )}
        </div>

        {error && <div className="text-sm text-rose-600">{error}</div>}

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
