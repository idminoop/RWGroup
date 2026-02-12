import { Button } from '@/components/ui/Button'

type Tab = 'newbuild' | 'secondary' | 'rent'

const TABS: { key: Tab; title: string }[] = [
  { key: 'newbuild', title: '\u041d\u043e\u0432\u043e\u0441\u0442\u0440\u043e\u0439\u043a\u0438' },
  { key: 'secondary', title: '\u0412\u0442\u043e\u0440\u0438\u0447\u043a\u0430' },
  { key: 'rent', title: '\u0410\u0440\u0435\u043d\u0434\u0430' },
]

export default function CatalogTabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="inline-flex w-full flex-wrap gap-1 rounded-lg border border-slate-700 bg-surface p-1 sm:w-auto sm:flex-nowrap">
      {TABS.map((t) => (
        <Button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          variant={value === t.key ? 'default' : 'ghost'}
          size="sm"
          className={value === t.key ? 'flex-1 sm:flex-none' : 'flex-1 text-slate-400 hover:bg-white/5 hover:text-white sm:flex-none'}
        >
          {t.title}
        </Button>
      ))}
    </div>
  )
}
