import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { apiGet, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import {
  buildAutoLandingConfig,
  createLandingFact,
  createLandingTag,
  FACT_IMAGE_PRESETS,
  inferFeaturePresetKey,
  LANDING_FEATURE_PRESETS,
  normalizeLandingConfig,
} from '@/lib/complexLanding'
import type {
  Complex,
  ComplexLandingConfig,
  ComplexLandingFact,
  ComplexLandingTag,
  Property,
} from '../../../../shared/types'

type ComplexListItem = Pick<Complex, 'id' | 'title' | 'status' | 'district' | 'price_from' | 'images'>

type ComplexDetailsResponse = {
  complex: Complex
  properties: Property[]
}

async function uploadImage(token: string, file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const resp = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'x-admin-token': token || '' },
    body: formData,
  })
  const json = await resp.json()
  if (!json.success) throw new Error(json.error || 'Upload failed')
  return json.data.url as string
}

function toMetroString(value: string[]): string {
  return value.join(', ')
}

function fromMetroString(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getMinPositive(values: Array<number | undefined>): number | undefined {
  let min: number | undefined
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    if (typeof min !== 'number' || value < min) min = value
  }
  return min
}

export default function AdminComplexSettingsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('complexId') || ''

  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [complexes, setComplexes] = useState<ComplexListItem[]>([])
  const [pickerFilter, setPickerFilter] = useState('')

  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [draftComplex, setDraftComplex] = useState<Complex | null>(null)
  const [draftLanding, setDraftLanding] = useState<ComplexLandingConfig | null>(null)
  const [linkedProperties, setLinkedProperties] = useState<Property[]>([])
  const [saving, setSaving] = useState(false)
  const [activePlanId, setActivePlanId] = useState('')

  const filteredComplexes = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase()
    if (!q) return complexes
    return complexes.filter((item) => item.title.toLowerCase().includes(q) || item.district.toLowerCase().includes(q))
  }, [complexes, pickerFilter])

  const activePlan = useMemo(() => {
    if (!draftLanding) return null
    return draftLanding.plans.items.find((item) => item.id === activePlanId) || draftLanding.plans.items[0] || null
  }, [activePlanId, draftLanding])

  const activePlanImages = useMemo(() => {
    if (!activePlan) return []
    if (Array.isArray(activePlan.preview_images) && activePlan.preview_images.length) return activePlan.preview_images
    if (activePlan.preview_image) return [activePlan.preview_image]
    return []
  }, [activePlan])

  const selectedFeaturePresetKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const feature of draftLanding?.feature_ticker || []) {
      const key = inferFeaturePresetKey(feature)
      if (key) keys.add(key)
    }
    return keys
  }, [draftLanding])

  useEffect(() => {
    if (!draftLanding?.plans.items.length) {
      setActivePlanId('')
      return
    }
    if (!draftLanding.plans.items.some((item) => item.id === activePlanId)) {
      setActivePlanId(draftLanding.plans.items[0].id)
    }
  }, [activePlanId, draftLanding])

  const loadComplexes = useCallback(() => {
    setListLoading(true)
    setListError(null)
    apiGet<{ items: ComplexListItem[]; total: number; page: number; limit: number }>(
      '/api/admin/catalog/items?type=complex&page=1&limit=500',
      headers
    )
      .then((res) => setComplexes(res.items))
      .catch((e) => setListError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setListLoading(false))
  }, [headers])

  useEffect(() => {
    loadComplexes()
  }, [loadComplexes])

  useEffect(() => {
    if (!selectedId) return
    setDetailsLoading(true)
    setDetailsError(null)
    apiGet<ComplexDetailsResponse>(`/api/admin/catalog/complex/${selectedId}`, headers)
      .then((res) => {
        const minPrice = getMinPositive(res.properties.map((item) => item.status === 'active' ? item.price : undefined))
        const minArea = getMinPositive(res.properties.map((item) => item.status === 'active' ? item.area_total : undefined))
        const normalizedComplex: Complex = {
          ...res.complex,
          price_from: typeof res.complex.price_from === 'number' ? res.complex.price_from : minPrice,
          area_from: typeof res.complex.area_from === 'number' ? res.complex.area_from : minArea,
        }
        setDraftComplex(normalizedComplex)
        setLinkedProperties(res.properties)
        setDraftLanding(normalizeLandingConfig(res.complex.landing, normalizedComplex, res.properties))
      })
      .catch((e) => setDetailsError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setDetailsLoading(false))
  }, [headers, selectedId])

  const setSelectedComplex = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('complexId', id)
    else next.delete('complexId')
    setSearchParams(next)
  }

  const patchLanding = (updater: (value: ComplexLandingConfig) => ComplexLandingConfig) => {
    setDraftLanding((prev) => (prev ? updater(prev) : prev))
  }

  const patchTag = (id: string, patch: Partial<ComplexLandingTag>) => {
    patchLanding((cfg) => ({
      ...cfg,
      tags: cfg.tags.map((tag) => (tag.id === id ? { ...tag, ...patch } : tag)),
    }))
  }

  const patchFact = (id: string, patch: Partial<ComplexLandingFact>) => {
    patchLanding((cfg) => ({
      ...cfg,
      facts: cfg.facts.map((fact) => (fact.id === id ? { ...fact, ...patch } : fact)),
    }))
  }

  const toggleFeaturePreset = (presetKey: string) => {
    patchLanding((cfg) => {
      const preset = LANDING_FEATURE_PRESETS.find((item) => item.key === presetKey)
      if (!preset) return cfg

      const exists = cfg.feature_ticker.some((item) => inferFeaturePresetKey(item) === presetKey)
      if (exists) {
        return {
          ...cfg,
          feature_ticker: cfg.feature_ticker.filter((item) => inferFeaturePresetKey(item) !== presetKey),
        }
      }

      const next = [
        ...cfg.feature_ticker,
        {
          id: `feature_${preset.key}`,
          title: preset.title,
          image: preset.image,
          preset_key: preset.key,
        },
      ]
      next.sort((a, b) => {
        const aKey = inferFeaturePresetKey(a)
        const bKey = inferFeaturePresetKey(b)
        const aIndex = aKey ? LANDING_FEATURE_PRESETS.findIndex((item) => item.key === aKey) : Number.MAX_SAFE_INTEGER
        const bIndex = bKey ? LANDING_FEATURE_PRESETS.findIndex((item) => item.key === bKey) : Number.MAX_SAFE_INTEGER
        return aIndex - bIndex
      })
      return { ...cfg, feature_ticker: next }
    })
  }

  const save = async () => {
    if (!draftComplex || !draftLanding) return
    setSaving(true)
    try {
      await apiPut(`/api/admin/catalog/items/complex/${draftComplex.id}`, {
        title: draftComplex.title,
        district: draftComplex.district,
        metro: draftComplex.metro,
        description: draftComplex.description,
        status: draftComplex.status,
        images: draftComplex.images,
        price_from: draftComplex.price_from,
        area_from: draftComplex.area_from,
        developer: draftComplex.developer,
        handover_date: draftComplex.handover_date,
        class: draftComplex.class,
        finish_type: draftComplex.finish_type,
        landing: draftLanding,
      }, headers)
      alert('Настройки ЖК сохранены')
      loadComplexes()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const resetAuto = () => {
    if (!draftComplex) return
    setDraftLanding(buildAutoLandingConfig(draftComplex, linkedProperties))
  }

  const openPreview = () => {
    if (!draftComplex || !draftLanding) return
    const key = `rw_complex_landing_draft_v2_${draftComplex.id}`
    window.localStorage.setItem(key, JSON.stringify(draftLanding))
    window.open(`/complex/${draftComplex.id}?previewDraft=1`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">Настройка ЖК</div>
            <div className="mt-1 text-sm text-slate-600">
              Визуальный редактор страницы ЖК: первый экран, теги, факты, фишки и планировки.
            </div>
          </div>
          <div className="flex min-w-[280px] flex-wrap gap-2">
            <Input
              value={pickerFilter}
              onChange={(e) => setPickerFilter(e.target.value)}
              placeholder="Фильтр по названию/району..."
              className="min-w-[220px] flex-1"
            />
            <Select value={selectedId} onChange={(e) => setSelectedComplex(e.target.value)} className="min-w-[260px] flex-1">
              <option value="">Выберите ЖК...</option>
              {filteredComplexes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} — {item.district}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {listLoading && <div className="mt-2 text-sm text-slate-500">Загрузка списка ЖК...</div>}
        {listError && <div className="mt-2 text-sm text-rose-600">{listError}</div>}
      </div>

      {!selectedId ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Выберите ЖК в выпадающем списке, чтобы начать настройку.
        </div>
      ) : detailsLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Загрузка ЖК...</div>
      ) : detailsError || !draftComplex || !draftLanding ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{detailsError || 'Не удалось открыть ЖК'}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-900">{draftComplex.title}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={resetAuto}>Автосборка из фида</Button>
              <Button size="sm" variant="secondary" onClick={openPreview}>Предпросмотр</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить'}</Button>
            </div>
          </div>

          <article className="space-y-6 rounded-2xl border border-slate-900/30 bg-[#05131c] p-4 text-white md:p-6">
            <section className="space-y-3 rounded-2xl border border-white/10 bg-[#081b27] p-3 md:p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Название ЖК</label>
                  <Input
                    value={draftComplex.title}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => setDraftComplex((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Цена от</label>
                  <Input
                    type="number"
                    value={String(draftComplex.price_from || '')}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => setDraftComplex((prev) => (prev ? { ...prev, price_from: e.target.value ? Number(e.target.value) : undefined } : prev))}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Район</label>
                  <Input
                    value={draftComplex.district}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => setDraftComplex((prev) => (prev ? { ...prev, district: e.target.value } : prev))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Метро</label>
                  <Input
                    value={toMetroString(draftComplex.metro)}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => setDraftComplex((prev) => (prev ? { ...prev, metro: fromMetroString(e.target.value) } : prev))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">CTA кнопка</label>
                  <Input
                    value={draftLanding.cta_label || ''}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => patchLanding((cfg) => ({ ...cfg, cta_label: e.target.value }))}
                  />
                </div>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-3xl border border-white/10">
              {draftLanding.hero_image ? (
                <img src={draftLanding.hero_image} alt="" className="h-[420px] w-full object-cover" />
              ) : (
                <div className="flex h-[420px] w-full items-center justify-center bg-white/5 text-sm text-white/50">
                  Добавьте фото первого экрана
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#05131c] via-[#05131c]/70 to-transparent" />

              <div className="absolute left-4 right-4 top-4 grid gap-2 rounded-xl border border-white/15 bg-black/35 p-3 backdrop-blur md:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Фото первого экрана (URL)</label>
                  <Input
                    value={draftLanding.hero_image || ''}
                    className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                    onChange={(e) => patchLanding((cfg) => ({ ...cfg, hero_image: e.target.value }))}
                  />
                </div>
                <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
                  Загрузить
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={async (e) => {
                      if (!e.target.files?.[0]) return
                      try {
                        const url = await uploadImage(token || '', e.target.files[0])
                        patchLanding((cfg) => ({ ...cfg, hero_image: url }))
                      } catch (err) {
                        alert(err instanceof Error ? err.message : 'Upload error')
                      } finally {
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 md:p-6">
                <div className="mb-3 flex flex-wrap gap-2">
                  {draftLanding.tags.map((tag) => (
                    <div key={tag.id} className="flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-1">
                      <Input
                        value={tag.label}
                        className="h-6 min-w-[90px] border-0 bg-transparent px-1 text-xs text-white"
                        onChange={(e) => patchTag(tag.id, { label: e.target.value })}
                      />
                      <button
                        type="button"
                        className="rounded px-1 text-xs text-white/70 hover:bg-white/15 hover:text-white"
                        onClick={() => patchLanding((cfg) => ({ ...cfg, tags: cfg.tags.filter((item) => item.id !== tag.id) }))}
                      >
                        x
                      </button>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={() => patchLanding((cfg) => ({ ...cfg, tags: [...cfg.tags, createLandingTag()] }))}>
                    + Тег
                  </Button>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Факты и карточки</h3>
                <Button size="sm" variant="secondary" onClick={() => patchLanding((cfg) => ({ ...cfg, facts: [...cfg.facts, createLandingFact()] }))}>
                  + Карточка
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {draftLanding.facts.map((fact, index) => (
                  <article key={fact.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs text-white/60">Блок факта</div>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={() => patchLanding((cfg) => ({ ...cfg, facts: cfg.facts.filter((item) => item.id !== fact.id) }))}
                      >
                        Удалить
                      </button>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        value={fact.title}
                        className="border-white/20 bg-white/5 text-white"
                        onChange={(e) => patchFact(fact.id, { title: e.target.value })}
                        placeholder="Заголовок"
                      />
                      <Input
                        value={fact.value}
                        className="border-white/20 bg-white/5 text-white"
                        onChange={(e) => patchFact(fact.id, { value: e.target.value })}
                        placeholder="Значение"
                      />
                    </div>
                    <Input
                      value={fact.subtitle || ''}
                      className="mt-2 border-white/20 bg-white/5 text-white"
                      onChange={(e) => patchFact(fact.id, { subtitle: e.target.value })}
                      placeholder="Подпись (опционально)"
                    />
                    {index >= 6 ? (
                      <>
                        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                          <Input
                            value={fact.image || ''}
                            className="border-white/20 bg-white/5 text-white"
                            onChange={(e) => patchFact(fact.id, { image: e.target.value })}
                            placeholder="Фон карточки (URL)"
                          />
                          <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
                            Файл
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*"
                              onChange={async (e) => {
                                if (!e.target.files?.[0]) return
                                try {
                                  const url = await uploadImage(token || '', e.target.files[0])
                                  patchFact(fact.id, { image: url })
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : 'Upload error')
                                } finally {
                                  e.target.value = ''
                                }
                              }}
                            />
                          </label>
                        </div>
                        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                          {FACT_IMAGE_PRESETS.map((preset, idx) => (
                            <button
                              key={`${fact.id}_preset_${idx}`}
                              type="button"
                              onClick={() => patchFact(fact.id, { image: preset })}
                              className={`h-12 w-16 shrink-0 overflow-hidden rounded border ${
                                fact.image === preset ? 'border-amber-300' : 'border-white/20'
                              }`}
                              title={`Пресет ${idx + 1}`}
                            >
                              <img src={preset} alt="" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/50">
                        Для боковых фактов фото не используется.
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Бегущая лента фишек</h3>
                <div className="text-xs text-white/55">Просто включите нужные пресеты</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {LANDING_FEATURE_PRESETS.map((preset) => {
                  const enabled = selectedFeaturePresetKeys.has(preset.key)
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => toggleFeaturePreset(preset.key)}
                      className={`group overflow-hidden rounded-xl border text-left transition ${
                        enabled
                          ? 'border-amber-300/70 bg-amber-100/10'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/30'
                      }`}
                    >
                      <div className="relative h-28 w-full overflow-hidden">
                        <img src={preset.image} alt={preset.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#05131c] via-transparent to-transparent" />
                      </div>
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="text-sm text-white">{preset.title}</div>
                        <div className={`rounded-full px-2 py-0.5 text-xs ${enabled ? 'bg-amber-300/30 text-amber-100' : 'bg-white/10 text-white/65'}`}>
                          {enabled ? 'Вкл' : 'Выкл'}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Заголовок блока планировок</label>
                  <Input
                    value={draftLanding.plans.title || ''}
                    className="border-white/20 bg-white/5 text-white"
                    onChange={(e) => patchLanding((cfg) => ({ ...cfg, plans: { ...cfg.plans, title: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">CTA кнопка</label>
                  <Input
                    value={draftLanding.plans.cta_label || ''}
                    className="border-white/20 bg-white/5 text-white"
                    onChange={(e) => patchLanding((cfg) => ({ ...cfg, plans: { ...cfg.plans, cta_label: e.target.value } }))}
                  />
                </div>
              </div>
              <Input
                value={draftLanding.plans.description || ''}
                className="border-white/20 bg-white/5 text-white"
                onChange={(e) => patchLanding((cfg) => ({ ...cfg, plans: { ...cfg.plans, description: e.target.value } }))}
                placeholder="Описание блока"
              />
              <div className="text-xs text-white/55">
                Данные по планировкам собираются автоматически из фида: тип, цена от, площадь от, число вариантов и превью-планы.
              </div>

              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.04] text-white/70">
                    <tr>
                      <th className="px-2 py-2 text-left">Тип</th>
                      <th className="px-2 py-2 text-left">Цена от</th>
                      <th className="px-2 py-2 text-left">Площадь от</th>
                      <th className="px-2 py-2 text-left">Варианты</th>
                      <th className="px-2 py-2 text-left">Превью</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftLanding.plans.items.map((item) => (
                      <tr key={item.id} className="border-t border-white/10">
                        <td className="px-2 py-2 text-white">{item.name}</td>
                        <td className="px-2 py-2 text-white/85">{item.price || 'Цена по запросу'}</td>
                        <td className="px-2 py-2 text-white/70">{item.area || 'от -'}</td>
                        <td className="px-2 py-2 text-white/70">{item.variants || 0}</td>
                        <td className="px-2 py-2">
                          <Button size="sm" variant="secondary" onClick={() => setActivePlanId(item.id)}>
                            Смотреть
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 text-sm font-semibold text-white">{activePlan?.name || 'Выберите формат'}</div>
                {!activePlanImages.length ? (
                  <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-white/20 text-sm text-white/45">
                    Для выбранного формата нет превью-планов
                  </div>
                ) : (
                  <div className="space-y-2">
                    <img src={activePlanImages[0]} alt={activePlan?.name} className="h-[220px] w-full rounded-lg object-cover" />
                    {activePlanImages.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {activePlanImages.map((src, index) => (
                          <img key={`${activePlan?.id}_image_${index}`} src={src} alt="" className="h-16 w-24 shrink-0 rounded border border-white/15 object-cover" />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </article>
        </>
      )}
    </div>
  )
}
