import type { Stats } from '../lib/types'

export function StatsRow({ stats }: { stats: Stats }) {
  return (
    <div className="flex gap-0 px-[var(--spacing-x)] py-[var(--spacing-gap)] shrink-0 border-b border-border-subtle">
      <StatItem label="Due" value={stats.due} />
      <div className="w-px bg-glass-border self-stretch" />
      <StatItem label="Seen" value={stats.seen} />
      <div className="w-px bg-glass-border self-stretch" />
      <StatItem label="Total" value={stats.total} />
      <div className="w-px bg-glass-border self-stretch" />
      <StatItem label="Got" value={stats.totalGot || 0} className="text-success" />
      <div className="w-px bg-glass-border self-stretch" />
      <StatItem label="Missed" value={stats.totalMiss || 0} className="text-danger" />
    </div>
  )
}

function StatItem({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-px">
      <span className={`text-[14px] font-bold ${className || ''}`}>{value}</span>
      <span className="text-[9px] text-text-dim uppercase tracking-wider">{label}</span>
    </div>
  )
}
