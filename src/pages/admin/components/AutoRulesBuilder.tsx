import { useMemo, useState } from 'react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import { apiPost } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { CollectionAutoRules, Category, Property, Complex } from '../../../../shared/types'

type Props = {
  value: CollectionAutoRules
  onChange: (rules: CollectionAutoRules) => void
}

type PreviewData = {
  total: number
  items: Array<{ type: 'property' | 'complex'; ref: Property | Complex }>
}

export default function AutoRulesBuilder({ value, onChange }: Props) {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const update = (partial: Partial<CollectionAutoRules>) => {
    onChange({ ...value, ...partial })
  }

  const handlePreview = async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const res = await apiPost<PreviewData>('/api/admin/collections/preview-auto', { rules: value, limit: 12 }, headers)
      setPreview(res)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Ошибка')
      setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-slate-700">Тип объектов</label>
        <Select value={value.type} onChange={(e) => update({ type: e.target.value as 'property' | 'complex' })}>
          <option value="property">Лоты (Properties)</option>
          <option value="complex">ЖК (Complexes)</option>
        </Select>
      </div>

      {value.type === 'property' && (
        <div>
          <label className="text-xs font-medium text-slate-700">Категория</label>
          <Select value={value.category || ''} onChange={(e) => update({ category: e.target.value as Category || undefined })}>
            <option value="">Все</option>
            <option value="newbuild">Новостройка</option>
            <option value="secondary">Вторичная</option>
            <option value="rent">Аренда</option>
          </Select>
        </div>
      )}

      {value.type === 'property' && (
        <div>
          <label className="text-xs font-medium text-slate-700">Спальни</label>
          <Select value={value.bedrooms !== undefined ? String(value.bedrooms) : ''} onChange={(e) => update({ bedrooms: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Любое</option>
            <option value="0">Студия</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4+</option>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-700">Цена от</label>
          <Input
            type="number"
            inputMode="numeric"
            value={value.priceMin !== undefined ? String(value.priceMin) : ''}
            onChange={(e) => update({ priceMin: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Мин. цена"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Цена до</label>
          <Input
            type="number"
            inputMode="numeric"
            value={value.priceMax !== undefined ? String(value.priceMax) : ''}
            onChange={(e) => update({ priceMax: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Макс. цена"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-700">Площадь от</label>
          <Input
            type="number"
            inputMode="numeric"
            value={value.areaMin !== undefined ? String(value.areaMin) : ''}
            onChange={(e) => update({ areaMin: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Мин. площадь"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Площадь до</label>
          <Input
            type="number"
            inputMode="numeric"
            value={value.areaMax !== undefined ? String(value.areaMax) : ''}
            onChange={(e) => update({ areaMax: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Макс. площадь"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-700">Район</label>
        <Input
          value={value.district || ''}
          onChange={(e) => update({ district: e.target.value || undefined })}
          placeholder="Название района"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-slate-700">Текстовый поиск</label>
        <Input
          value={value.q || ''}
          onChange={(e) => update({ q: e.target.value || undefined })}
          placeholder="Поиск по названию, району, метро"
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="text-sm text-slate-600">
          {previewLoading ? (
            'Загрузка...'
          ) : previewError ? (
            <span className="text-rose-600">{previewError}</span>
          ) : preview ? (
            <span>Найдено объектов: <span className="font-semibold text-slate-900">{preview.total}</span></span>
          ) : (
            'Нажмите "Предпросмотр" чтобы увидеть объекты'
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={handlePreview} disabled={previewLoading}>
          Предпросмотр
        </Button>
      </div>

      {preview && preview.items.length > 0 && (
        <div className="max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {preview.items.map((item, idx) => (
              <div key={idx}>
                {item.type === 'property' ? (
                  <PropertyCard item={item.ref as Property} />
                ) : (
                  <ComplexCard item={item.ref as Complex} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
