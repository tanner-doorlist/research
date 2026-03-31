import { useAnnoy } from '../hooks/use-annoy'
import { stripMarkdownPreview } from '../lib/markdown'
import { cn } from '../lib/utils'
import type { ViewState } from '../lib/types'

export function PillView({ card, sessionDone, sessionTotal }: ViewState) {
  const shaking = useAnnoy()
  if (!card) return null
  const pct = sessionTotal && sessionTotal > 0 ? (sessionDone! / sessionTotal) * 100 : 0

  return (
    <div className={cn('fixed inset-0 overflow-hidden', shaking && 'animate-shake')}>
      <div className="glass absolute inset-0 flex items-center gap-3 px-[var(--spacing-x)] drag-region">
        <span className="text-lg shrink-0">🧠</span>
        <span className="flex-1 text-[13px] font-medium leading-snug overflow-hidden line-clamp-2 text-text-primary">
          {stripMarkdownPreview(card.front)}
        </span>
        <div className="flex gap-1.5 shrink-0 no-drag">
          <button onClick={() => window.api.snooze(5)}
            className="h-7 px-3 border border-border rounded-[var(--radius-md)] cursor-pointer text-[12px] font-medium bg-transparent text-text-secondary hover:bg-surface hover:text-text-primary active:scale-95 transition-all">
            Later
          </button>
          <button onClick={() => window.api.expand()}
            className="h-7 px-3 border-none rounded-[var(--radius-md)] cursor-pointer text-[12px] font-medium bg-accent text-white hover:brightness-110 active:scale-95 transition-all">
            Answer
          </button>
        </div>
        <div className="absolute bottom-1.5 left-[var(--spacing-x)] right-[var(--spacing-x)] h-px bg-white/[0.06] rounded-full overflow-hidden">
          <div className="h-full bg-accent/60 rounded-full transition-[width] duration-400 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
