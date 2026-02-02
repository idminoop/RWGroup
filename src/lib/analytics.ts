type EventParams = Record<string, string | number | boolean | null | undefined>

type GtagFn = (command: 'event', eventName: string, params?: Record<string, unknown>) => void
type YmFn = (counterId: string | number, method: 'reachGoal', goalName: string, params?: Record<string, unknown>) => void

declare global {
  interface Window {
    gtag?: GtagFn
    ym?: YmFn
  }
}

export function trackEvent(name: string, params?: EventParams) {
  const ts = Date.now()

  const gtag = window.gtag
  if (gtag) {
    gtag('event', name, params || {})
  }

  const ym = window.ym
  const ymId = import.meta.env.VITE_YM_ID
  if (ym && ymId) {
    ym(ymId, 'reachGoal', name, params || {})
  }

  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, params: params || {}, ts }),
  }).catch(() => {})
}
