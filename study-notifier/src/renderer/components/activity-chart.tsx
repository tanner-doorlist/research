import { useRef, useEffect } from 'react'
import type { ActivityDay } from '../lib/types'

export function ActivityChart({ data }: { data: ActivityDay[] }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current; if (!c || !data.length) return
    const ctx = c.getContext('2d'); if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = rect.width * dpr; c.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    const w = rect.width, h = rect.height
    const max = Math.max(...data.map((d) => d.count), 1)
    const barW = Math.max(3, (w - (data.length - 1) * 2) / data.length)
    ctx.clearRect(0, 0, w, h)
    data.forEach((d, i) => {
      const x = i * (barW + 2)
      const barH = Math.max(1, (d.count / max) * (h - 2))
      ctx.beginPath(); ctx.roundRect(x, h - barH, barW, barH, 2)
      ctx.fillStyle = d.count > 0 ? 'rgba(124,108,248,0.6)' : 'rgba(255,255,255,0.03)'
      ctx.fill()
    })
  }, [data])

  return <canvas ref={ref} className="w-full h-[48px] rounded-[var(--radius-md)]" />
}
