import SiteLayout from '@/components/layout/SiteLayout'

export default function PrivacyPage() {
  return (
    <SiteLayout>
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="text-2xl font-semibold tracking-tight">Политика конфиденциальности</div>
          <div className="mt-4 space-y-4 text-sm text-slate-700">
            <p>
              Мы обрабатываем персональные данные (имя, телефон, комментарий) только для связи с вами по вашему запросу.
              Отправляя форму на сайте, вы даёте согласие на обработку персональных данных.
            </p>
            <p>
              Данные не передаются третьим лицам, кроме случаев, необходимых для исполнения вашего запроса или предусмотренных законом.
            </p>
            <p>Чтобы отозвать согласие или уточнить детали — свяжитесь с нами по телефону, указанному на сайте.</p>
          </div>
        </div>
      </div>
    </SiteLayout>
  )
}

