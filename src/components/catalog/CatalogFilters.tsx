import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

export type FiltersState = {
  bedrooms: string
  priceMin: string
  priceMax: string
  areaMin: string
  areaMax: string
  q: string
}

type Props = {
  tab: 'newbuild' | 'secondary' | 'rent'
  value: FiltersState
  onChange: (next: FiltersState) => void
}

export default function CatalogFilters({ tab, value, onChange }: Props) {
  // Helper to determine current area value for Select
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
    if (val === '20-40') { min = '20'; max = '40' }
    else if (val === '40-60') { min = '40'; max = '60' }
    else if (val === '60-80') { min = '60'; max = '80' }
    else if (val === '80+') { min = '80'; max = '' }
    
    onChange({ ...value, areaMin: min, areaMax: max })
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Select value={value.bedrooms} onChange={(e) => onChange({ ...value, bedrooms: e.target.value })}>
        <option value="">Спальни</option>
        <option value="0">Студия</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4+</option>
      </Select>
      
      <Select value={getAreaValue()} onChange={(e) => handleAreaChange(e.target.value)}>
        <option value="">Площадь</option>
        <option value="20-40">20-40 м²</option>
        <option value="40-60">40-60 м²</option>
        <option value="60-80">60-80 м²</option>
        <option value="80+">80+ м²</option>
      </Select>

      <Input
        placeholder="Цена от"
        inputMode="numeric"
        value={value.priceMin}
        onChange={(e) => onChange({ ...value, priceMin: e.target.value })}
      />
      <Input
        placeholder="Цена до"
        inputMode="numeric"
        value={value.priceMax}
        onChange={(e) => onChange({ ...value, priceMax: e.target.value })}
      />
      <Input
        placeholder={tab === 'newbuild' ? 'ЖК / метро / район / поиск' : 'Метро / район / поиск'}
        value={value.q}
        onChange={(e) => onChange({ ...value, q: e.target.value })}
      />
    </div>
  )
}
