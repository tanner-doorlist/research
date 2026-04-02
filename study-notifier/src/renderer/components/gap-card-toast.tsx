import { useState } from 'react'
import type { GapCardSuggestion } from '../lib/types'
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import { useApproveGapCard, useDenyGapCard } from '../hooks/use-api'

interface Props {
  suggestion: GapCardSuggestion
  onDone: () => void
}

export function GapCardToast({ suggestion, onDone }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const approveMut = useApproveGapCard()
  const denyMut = useDenyGapCard()
  const loading = approveMut.isPending || denyMut.isPending

  const approve = async () => {
    await approveMut.mutateAsync(suggestion.id)
    onDone()
  }

  const deny = async () => {
    if (!denying) { setDenying(true); return }
    await denyMut.mutateAsync({ id: suggestion.id, reason: reason.trim() || undefined })
    onDone()
  }

  return (
    <div className="absolute bottom-3 left-3 right-3 bg-[rgba(30,30,34,0.97)] backdrop-blur-xl border border-border rounded-[var(--radius-lg)] shadow-[0_4px_24px_rgba(0,0,0,0.5)] z-50 animate-fade-up overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1.5">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-accent font-medium uppercase tracking-wider mb-0.5">Suggested gap card</div>
          <div className="text-[12px] text-text-primary leading-snug line-clamp-2">{suggestion.front}</div>
        </div>
        <button onClick={() => setExpanded(!expanded)}
          className="w-5 h-5 border-none rounded bg-transparent text-text-tertiary cursor-pointer flex items-center justify-center hover:text-text-secondary shrink-0 mt-0.5">
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
      </div>

      {/* Expanded: show answer + source */}
      {expanded && (
        <div className="px-3 pb-1.5 border-t border-border/50 mt-1 pt-1.5">
          <div className="text-[11px] text-text-secondary leading-snug mb-1">{suggestion.back}</div>
          <div className="text-[9px] text-text-tertiary">
            From: {suggestion.sourceCardFront.slice(0, 80)}{suggestion.sourceCardFront.length > 80 ? '...' : ''}
          </div>
        </div>
      )}

      {/* Deny reason input */}
      {denying && (
        <div className="px-3 pb-1.5">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && deny()}
            placeholder="Why deny? (optional, helps improve suggestions)"
            autoFocus
            className="w-full bg-surface border border-border rounded-[var(--radius-md)] text-text-primary text-[11px] px-2 py-1.5 outline-none focus:border-accent/40 transition-colors"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-3 pb-2.5 pt-1">
        <button onClick={approve} disabled={loading}
          className="flex items-center gap-1 h-6 px-2.5 border-none rounded-[var(--radius-md)] bg-success/20 text-success text-[11px] font-medium cursor-pointer hover:bg-success/30 transition-colors disabled:opacity-40">
          <Check size={11} /> Add
        </button>
        <button onClick={deny} disabled={loading}
          className="flex items-center gap-1 h-6 px-2.5 border-none rounded-[var(--radius-md)] bg-danger/20 text-danger text-[11px] font-medium cursor-pointer hover:bg-danger/30 transition-colors disabled:opacity-40">
          <X size={11} /> {denying ? 'Confirm deny' : 'Deny'}
        </button>
        {denying && (
          <button onClick={() => setDenying(false)} disabled={loading}
            className="h-6 px-2 border-none rounded-[var(--radius-md)] bg-transparent text-text-tertiary text-[11px] cursor-pointer hover:text-text-secondary transition-colors">
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
