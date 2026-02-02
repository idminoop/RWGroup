import { cn } from '@/lib/utils'

type Tab = 'newbuild' | 'secondary' | 'rent'

export default function CatalogTabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; title: string }[] = [
    { key: 'newbuild', title: 'Новостройки' },
    { key: 'secondary', title: 'Вторичка' },
    { key: 'rent', title: 'Аренда' },
  ]
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            'h-9 rounded-md px-3 text-sm font-medium transition-colors',
            value === t.key ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
          )}
        >
          {t.title}
        </button>
      ))}
    </div>
  )
}

