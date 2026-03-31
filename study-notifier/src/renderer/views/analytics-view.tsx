import { useState } from 'react'
import type { AnalyticsData } from '../lib/types'
import { ActivityChart } from '../components/activity-chart'

export function AnalyticsView({ analytics }: { analytics: AnalyticsData }) {
  const [indexing, setIndexing] = useState(false)
  const indexCards = async () => { setIndexing(true); try { const r = await window.api.indexCards(); if (!r.ok) alert(r.error || 'Failed') } finally { setIndexing(false) } }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden no-drag">
      {/* Summary row */}
      <div className="flex items-center gap-4 px-[var(--spacing-x)] h-8 shrink-0 border-b border-border text-[11px] text-text-tertiary">
        <span><span className="text-text-primary font-medium">{analytics.totalReviews}</span> reviews</span>
        <span><span className="text-text-primary font-medium">{analytics.overallAccuracy}%</span> accuracy</span>
        <span><span className="text-accent font-medium">{analytics.streak}</span> streak</span>
        <span className="ml-auto"><span className="text-text-primary font-medium">{analytics.daysActive}</span> days</span>
      </div>

      <div className="px-[var(--spacing-x)] py-2 shrink-0">
        <button onClick={indexCards} disabled={indexing}
          className="w-full h-7 border border-border rounded-[var(--radius-md)] bg-transparent text-text-secondary text-[12px] font-medium cursor-pointer hover:bg-surface hover:text-text-primary disabled:opacity-40 transition-colors">
          {indexing ? 'Indexing...' : 'Index for semantic search'}
        </button>
      </div>

      <div className="px-[var(--spacing-x)] pb-3 shrink-0">
        <div className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-2">Activity — 30 days</div>
        <ActivityChart data={analytics.activityByDay} />
      </div>

      <div className="px-[var(--spacing-x)] pb-4 shrink-0">
        <div className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-2">By category</div>
        {analytics.categoryStats.map((cat) => (
          <div key={cat.tag} className="flex flex-col gap-1 mb-2">
            <div className="flex justify-between items-baseline">
              <span className="text-[12px] font-medium text-text-primary">{cat.tag}</span>
              <span className="text-[10px] text-text-tertiary">{cat.accuracy}% · {cat.got}/{cat.got + cat.miss}</span>
            </div>
            <div className="h-[3px] bg-white/[0.04] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${cat.accuracy}%`, background: cat.accuracy >= 80 ? 'var(--color-success)' : cat.accuracy >= 50 ? 'var(--color-warning)' : 'var(--color-danger)', opacity: 0.7 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
