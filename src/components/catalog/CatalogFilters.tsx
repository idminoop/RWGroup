import { useEffect, useState } from 'react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { apiGet } from '@/lib/api'

export type FiltersState = {
  complexId: string
  bedrooms: string
  priceMin: string
  priceMax: string
  areaMin: string
  areaMax: string
  district: string
  metro: string
  q: string
}

type Props = {
  tab: 'newbuild' | 'secondary' | 'rent'
  value: FiltersState
  onChange: (next: FiltersState) => void
}

const UI = {
  bedrooms: '\u0421\u043f\u0430\u043b\u044c\u043d\u0438',
  studio: '\u0421\u0442\u0443\u0434\u0438\u044f',
  area: '\u041f\u043b\u043e\u0449\u0430\u0434\u044c',
  priceFrom: '\u0426\u0435\u043d\u0430 \u043e\u0442',
  priceTo: '\u0426\u0435\u043d\u0430 \u0434\u043e',
  complexSearch: '\u0416\u041a / \u043f\u043e\u0438\u0441\u043a',
  search: '\u041f\u043e\u0438\u0441\u043a',
  district: '\u0420\u0430\u0439\u043e\u043d',
  metro: '\u041c\u0435\u0442\u0440\u043e',
  m2: '\u043c\u00b2',
}

export default function CatalogFilters({ tab, value, onChange }: Props) {
  const [facets, setFacets] = useState<{ districts: string[]; metros: string[] }>({ districts: [], metros: [] })

  useEffect(() => {
    apiGet<{ districts: string[]; metros: string[] }>('/api/facets').then(setFacets).catch(() => {})
  }, [])

  const getAreaValue = () => {
    if (value.areaMin === '20' && value.areaMax === '40') return '20-40'
    if (value.areaMin === '40' && value.areaMax === '60') return '40-60'
    if (value.areaMin === '60' && value.areaMax === '80') return '60-80'
    if (value.areaMin === '80' && !value.areaMax) return '80+'
    return ''
  }

  const handleAreaChange = (val: string) => {
    let min = ''
    let max = ''
    if (val === '20-40') {
      min = '20'
      max = '40'
    } else if (val === '40-60') {
      min = '40'
      max = '60'
    } else if (val === '60-80') {
      min = '60'
      max = '80'
    } else if (val === '80+') {
      min = '80'
      max = ''
    }
    onChange({ ...value, areaMin: min, areaMax: max })
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select value={value.bedrooms} onChange={(e) => onChange({ ...value, bedrooms: e.target.value })}>
          <option value="">{UI.bedrooms}</option>
          <option value="0">{UI.studio}</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4+</option>
        </Select>

        <Select value={getAreaValue()} onChange={(e) => handleAreaChange(e.target.value)}>
          <option value="">{UI.area}</option>
          <option value="20-40">20-40 {UI.m2}</option>
          <option value="40-60">40-60 {UI.m2}</option>
          <option value="60-80">60-80 {UI.m2}</option>
          <option value="80+">80+ {UI.m2}</option>
        </Select>

        <Input
          placeholder={UI.priceFrom}
          inputMode="numeric"
          value={value.priceMin}
          onChange={(e) => onChange({ ...value, priceMin: e.target.value })}
        />
        <Input
          placeholder={UI.priceTo}
          inputMode="numeric"
          value={value.priceMax}
          onChange={(e) => onChange({ ...value, priceMax: e.target.value })}
        />
        <Input
          placeholder={tab === 'newbuild' ? UI.complexSearch : UI.search}
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select value={value.district} onChange={(e) => onChange({ ...value, district: e.target.value })}>
          <option value="">{UI.district}</option>
          {facets.districts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select value={value.metro} onChange={(e) => onChange({ ...value, metro: e.target.value })}>
          <option value="">{UI.metro}</option>
          {facets.metros.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}
