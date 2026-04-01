import { useState, useEffect } from 'react'
import { useViewState } from './hooks/use-view-state'
import { useAnnoy } from './hooks/use-annoy'
import { Shell } from './components/shell'
import { Titlebar } from './components/titlebar'
import { SettingsPanel } from './components/settings-panel'
import { GapCardToast } from './components/gap-card-toast'
import { PillView } from './views/pill-view'
import { CardView } from './views/card-view'
import { CatalogView } from './views/catalog-view'
import { ChatView } from './views/chat-view'
import { KnowledgeView } from './views/knowledge-view'
import { AnalyticsView } from './views/analytics-view'
import { cn } from './lib/utils'
import type { GapCardSuggestion } from './lib/types'

export default function App() {
  const view = useViewState()
  const shaking = useAnnoy()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [gapSuggestion, setGapSuggestion] = useState<GapCardSuggestion | null>(null)

  // Listen for gap card suggestions from main process
  useEffect(() => {
    const handler = (s: GapCardSuggestion) => setGapSuggestion(s)
    window.api.onGapCardSuggestion(handler)
    return () => window.api.offGapCardSuggestion(handler)
  }, [])

  if (view.type === 'hidden') return null
  if (view.type === 'pill') return <PillView {...view} />

  const isCard = view.type === 'card'
  const showBack = view.type === 'chat'

  return (
    <div className={cn('w-full h-full', shaking && 'animate-shake')}>
      <Shell viewType={view.type}>
        {/* Card view has its own menu — no titlebar */}
        {!isCard && (
          <Titlebar
            viewType={view.type}
            showBack={showBack}
            settingsOpen={settingsOpen}
            onToggleSettings={() => setSettingsOpen(!settingsOpen)}
          />
        )}

        {isCard && view.card && view.stats && (
          <CardView
            card={view.card}
            stats={view.stats}
            sessionDone={view.sessionDone ?? 0}
            sessionTotal={view.sessionTotal ?? 0}
          />
        )}

        {view.type === 'catalog' && view.catalog && view.stats && (
          <CatalogView catalog={view.catalog} stats={view.stats} />
        )}

        {view.type === 'chat' && view.card && (
          <ChatView card={view.card} />
        )}

        {view.type === 'knowledge' && <KnowledgeView />}

        {view.type === 'analytics' && view.analytics && (
          <AnalyticsView analytics={view.analytics} />
        )}

        {!isCard && (
          <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        )}

        {gapSuggestion && (
          <GapCardToast suggestion={gapSuggestion} onDone={() => setGapSuggestion(null)} />
        )}
      </Shell>
    </div>
  )
}
