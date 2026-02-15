import { useEffect, useRef } from 'react'

export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const ref = useRef<HTMLScriptElement | null>(null)

  useEffect(() => {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(data)
    document.head.appendChild(script)
    ref.current = script
    return () => {
      if (ref.current && ref.current.parentNode) {
        ref.current.parentNode.removeChild(ref.current)
      }
    }
  }, [JSON.stringify(data)])

  return null
}
