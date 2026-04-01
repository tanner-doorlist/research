import { useState } from 'react'
import type { AnalyticsData } from '../lib/types'
import { ActivityChart } from '../components/activity-chart'
import { Zap, Target, Calendar, TrendingUp, Brain, BarChart3 } from 'lucide-react'
import { Spinner } from '../components/spinner'

export function AnalyticsView({ analytics }: { analytics: AnalyticsData }) {
  const [indexing, setIndexing] = useState(false)
  const indexCards = async () => {
    setIndexing(true)
    try { const r = await window.api.indexCards(); if (!r.ok) alert(r.error || 'Failed') }
    finally { setIndexing(false) }
  }

  const totalAnswered = analytics.categoryStats.reduce((n, c) => n + c.got + c.miss, 0)
  const bestCategory = analytics.categoryStats.length > 0
    ? [...analytics.categoryStats].sort((a, b) => b.accuracy - a.accuracy)[0]
    : null
  const weakCategory = analytics.categoryStats.length > 0
    ? [...analytics.categoryStats].filter(c => c.total >= 2).sort((a, b) => a.accuracy - b.accuracy)[0]
    : null

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden no-drag">
      {/* Stat cards grid */}
      <div className="grid grid-cols-2 gap-2 px-[var(--spacing-x)] pt-3 pb-2 shrink-0">
        <StatCard icon={<BarChart3 size={13} />} label="Reviews" value={analytics.totalReviews} color="accent" />
        <StatCard icon={<Target size={13} />} label="Accuracy" value={`${analytics.overallAccuracy}%`}
          color={analytics.overallAccuracy >= 80 ? 'success' : analytics.overallAccuracy >= 50 ? 'warning' : 'danger'} />
        <StatCard icon={<Zap size={13} />} label="Best Streak" value={analytics.streak} color="accent" />
        <StatCard icon={<Calendar size={13} />} label="Days Active" value={analytics.daysActive} color="accent" />
      </div>

      {/* Highlights */}
      {(bestCategory || weakCategory) && (
        <div className="px-[var(--spacing-x)] pb-2 shrink-0 flex gap-2">
          {bestCategory && (
            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-md)] bg-success/[0.06] border border-success/10">
              <TrendingUp size={11} className="text-success shrink-0" />
              <div className="min-w-0">
                <div className="text-[9px] text-success/70 uppercase tracking-wider font-medium">Strongest</div>
                <div className="text-[11px] text-success font-medium truncate">{bestCategory.tag} — {bestCategory.accuracy}%</div>
              </div>
            </div>
          )}
          {weakCategory && weakCategory.tag !== bestCategory?.tag && (
            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-md)] bg-warning/[0.06] border border-warning/10">
              <Brain size={11} className="text-warning shrink-0" />
              <div className="min-w-0">
                <div className="text-[9px] text-warning/70 uppercase tracking-wider font-medium">Needs work</div>
                <div className="text-[11px] text-warning font-medium truncate">{weakCategory.tag} — {weakCategory.accuracy}%</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity chart */}
      <div className="px-[var(--spacing-x)] pb-3 shrink-0">
        <div className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-2">Activity — 30 days</div>
        <ActivityChart data={analytics.activityByDay} />
      </div>

      <div className="h-px bg-border mx-[var(--spacing-x)] shrink-0" />

      {/* Category breakdown */}
      <div className="px-[var(--spacing-x)] py-3 shrink-0">
        <div className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-2.5">By category</div>
        <div className="flex flex-col gap-2.5">
          {analytics.categoryStats.map((cat) => {
            const pct = totalAnswered > 0 ? Math.round((cat.total / totalAnswered) * 100) : 0
            const accColor = cat.accuracy >= 80 ? 'var(--color-success)' : cat.accuracy >= 50 ? 'var(--color-warning)' : 'var(--color-danger)'
            return (
              <div key={cat.tag} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-text-primary flex-1 truncate">{cat.tag}</span>
                  <span className="text-[10px] font-mono tabular-nums" style={{ color: accColor }}>{cat.accuracy}%</span>
                  <span className="text-[10px] text-text-tertiary tabular-nums">{cat.got}✓ {cat.miss}✗</span>
                </div>
                <div className="flex gap-0.5 h-[4px] rounded-full overflow-hidden bg-white/[0.04]">
                  <div className="h-full rounded-l-full transition-[width] duration-500 bg-success/60"
                    style={{ width: `${cat.total > 0 ? (cat.got / cat.total) * 100 : 0}%` }} />
                  <div className="h-full rounded-r-full transition-[width] duration-500 bg-danger/50"
                    style={{ width: `${cat.total > 0 ? (cat.miss / cat.total) * 100 : 0}%` }} />
                </div>
                <div className="text-[9px] text-text-tertiary">{pct}% of all reviews · {cat.total} total</div>
              </div>
            )
          })}
          {analytics.categoryStats.length === 0 && (
            <div className="text-[12px] text-text-tertiary py-2">No review data yet.</div>
          )}
        </div>
      </div>

      <div className="h-px bg-border mx-[var(--spacing-x)] shrink-0" />

      {/* Index button */}
      <div className="px-[var(--spacing-x)] py-3 shrink-0">
        <button onClick={indexCards} disabled={indexing}
          className="w-full h-7 border border-border rounded-[var(--radius-md)] bg-transparent text-text-secondary text-[12px] font-medium cursor-pointer hover:bg-surface hover:text-text-primary disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
          {indexing ? <><Spinner /> Indexing...</> : 'Index for semantic search'}
        </button>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    accent: 'text-accent bg-accent/[0.06] border-accent/10',
    success: 'text-success bg-success/[0.06] border-success/10',
    warning: 'text-warning bg-warning/[0.06] border-warning/10',
    danger: 'text-danger bg-danger/[0.06] border-danger/10',
  }
  const cls = colorMap[color] || colorMap.accent
  return (
    <div className={`flex flex-col gap-1 px-3 py-2 rounded-[var(--radius-md)] border ${cls}`}>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[9px] uppercase tracking-wider font-medium opacity-70">{label}</span>
      </div>
      <span className="text-[18px] font-semibold tabular-nums leading-tight">{value}</span>
    </div>
  )
}
