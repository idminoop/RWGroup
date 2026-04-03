import { FileText, Search, Eye, Scale, Key } from 'lucide-react'
import { Heading } from '@/components/ui/Typography'
import { cn } from '@/lib/utils'

const steps = [
  {
    id: '01',
    title: 'Консультация',
    description: 'Обсуждаем ваши цели, бюджет и предпочтения',
    icon: FileText,
  },
  {
    id: '02',
    title: 'План действий',
    description: 'Формируем стратегию и подборку объектов',
    icon: Search,
  },
  {
    id: '03',
    title: 'Договор',
    description: 'Фиксируем условия и начинаем работу',
    icon: Eye,
  },
  {
    id: '04',
    title: 'Сопровождение',
    description: 'Показы, переговоры, юридическая проверка',
    icon: Scale,
  },
  {
    id: '05',
    title: 'Закрытие сделки',
    description: 'Подписание документов и передача ключей',
    icon: Key,
  },
]

export default function Roadmap() {
  return (
    <section className="relative overflow-hidden bg-[#0E1B26] py-24">
      <div className="mx-auto max-w-7xl px-4 relative z-10">
        <Heading size="h2" className="text-center mb-16 text-white">
          Дорожная карта сделки с недвижимостью
        </Heading>

        <div className="relative">
          {/* Connecting Line (Desktop) */}
          <div className="hidden md:block absolute top-6 left-0 h-1 w-full bg-[#C2A87A]/30" />
          
          <div className="grid grid-cols-1 md:grid-cols-5 gap-10 md:gap-4 relative">
            {steps.map((step) => (
              <div key={step.id} className="flex flex-col items-center text-center group">
                {/* Number Circle */}
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold z-10 mb-6 transition-all duration-500",
                  "bg-[#0A1720] border-2 border-[#C2A87A]/70 text-[#C2A87A] group-hover:bg-[#C2A87A] group-hover:text-[#0F1D28]"
                )}>
                  {step.id}
                </div>

                {/* Icon Circle */}
                <div className="mb-6 relative">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[#2D4357] bg-[#132533] transition-all duration-500 group-hover:border-[#C2A87A] group-hover:shadow-[0_0_20px_rgba(194,168,122,0.3)]">
                    <step.icon className="h-10 w-10 text-[#C2A87A] transition-transform duration-500 group-hover:scale-110" />
                  </div>
                  {/* Decorative triangle/arrow below number pointing to icon (optional, simplistic version here) */}
                  <div className="absolute -top-3 left-1/2 h-0 w-0 -translate-x-1/2 border-b-[8px] border-b-[#2D4357] border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent md:hidden" />
                </div>

                {/* Content */}
                <div className="max-w-[200px]">
                  <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-300">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
