import type { ViewType } from '../lib/types'
import { cn } from '../lib/utils'
import { Settings, X, ArrowLeft } from 'lucide-react'

interface Props { viewType: ViewType; showBack: boolean; settingsOpen: boolean; onToggleSettings: () => void }

const TABS = [
  { key: 'catalog', label: 'Catalog' },
  { key: 'knowledge', label: 'Logs' },
  { key: 'analytics', label: 'Stats' },
] as const

export function Titlebar({ viewType, showBack, settingsOpen, onToggleSettings }: Props) {
  return (
    <div className="h-10 shrink-0 flex items-center gap-1 px-[var(--spacing-x)] drag-region border-b border-border">
      <div className="flex gap-px items-center no-drag">
        {showBack && (
          <button onClick={() => window.api.backToCard()} title="Back"
            className="w-7 h-7 border-none rounded-[var(--radius-md)] cursor-pointer text-[13px] flex items-center justify-center bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors mr-1">
            <ArrowLeft size={14} />
          </button>
        )}
        {TABS.map((tab) => (
          <button key={tab.key}
            onClick={() => {
              if (tab.key === 'catalog') window.api.openCatalog()
              else if (tab.key === 'knowledge') window.api.openKnowledge()
              else if (tab.key === 'analytics') window.api.openAnalytics()
            }}
            className={cn(
              'h-7 px-2.5 border-none rounded-[var(--radius-md)] cursor-pointer text-[12px] font-medium transition-colors',
              viewType === tab.key
                ? 'bg-surface-hover text-text-primary'
                : 'bg-transparent text-text-tertiary hover:text-text-secondary'
            )}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <div className="flex gap-px items-center no-drag">
        <button onClick={onToggleSettings} title="Settings"
          className={cn(
            'w-7 h-7 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center transition-colors',
            settingsOpen ? 'bg-accent-subtle text-accent' : 'bg-transparent text-text-tertiary hover:text-text-secondary hover:bg-surface'
          )}>
          <Settings size={14} />
        </button>
        <button onClick={() => window.api.dismiss()} title="Close"
          className="w-7 h-7 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-text-tertiary hover:text-text-secondary hover:bg-surface transition-colors">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
