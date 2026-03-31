import { useState, useMemo, useRef } from 'react'
import type { CatalogItem, Stats } from '../lib/types'
import { stripMarkdownPreview } from '../lib/markdown'
import { Search } from 'lucide-react'

interface Props { catalog: CatalogItem[]; stats: Stats }

export function CatalogView({ catalog, stats }: Props) {
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [semanticMode, setSemanticMode] = useState(false)
  const [semanticOrder, setSemanticOrder] = useState<string[] | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    catalog.forEach((item) => item.tags?.forEach((t) => { if (t && t !== 'concept') tags.add(t) }))
    return [...tags].sort()
  }, [catalog])

  const filtered = useMemo(() => {
    let items = catalog
    if (activeTag) items = items.filter((item) => item.tags?.includes(activeTag))
    if (search.trim()) {
      if (semanticMode && semanticOrder) {
        const m = new Map(semanticOrder.map((id, i) => [id, i]))
        items = items.filter((item) => m.has(item.id)).sort((a, b) => (m.get(a.id) ?? 999) - (m.get(b.id) ?? 999))
      } else {
        const q = search.toLowerCase()
        items = items.filter((item) => stripMarkdownPreview(item.front).toLowerCase().includes(q) || item.tags?.some((t) => t.toLowerCase().includes(q)))
      }
    }
    return items
  }, [catalog, search, activeTag, semanticMode, semanticOrder])

  const onSearch = (value: string) => {
    setSearch(value); setSemanticMode(false); setSemanticOrder(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (value.trim().length >= 3) {
      searchTimer.current = setTimeout(async () => {
        const r = await window.api.semanticSearchCards(value)
        if (r.ok && r.orderedIds) { setSemanticMode(true); setSemanticOrder(r.orderedIds) }
      }, 600)
    }
  }

  const totalAns = (stats.totalGot || 0) + (stats.totalMiss || 0)
  const acc = totalAns > 0 ? Math.round((stats.totalGot / totalAns) * 100) : 0

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden no-drag">
      {/* Stats */}
      <div className="flex items-center gap-4 px-[var(--spacing-x)] h-8 shrink-0 text-[11px] text-text-tertiary border-b border-border">
        <span><span className="text-text-primary font-medium">{stats.total}</span> cards</span>
        <span><span className="text-text-primary font-medium">{stats.due}</span> due</span>
        <span><span className="text-accent font-medium">{stats.streak}</span> streak</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px]">{acc}%</span>
          <div className="w-12 h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full bg-accent/70 rounded-full transition-[width] duration-500" style={{ width: `${acc}%` }} />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-[var(--spacing-x)] py-1.5 shrink-0">
        <div className="flex items-center gap-2 px-2.5 h-7 bg-surface border border-transparent rounded-[var(--radius-md)] transition-all focus-within:border-accent/30 focus-within:bg-accent/[0.04]">
          <Search size={12} className="text-text-tertiary shrink-0" />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search..."
            className="flex-1 min-w-0 h-full p-0 border-none bg-transparent text-text-primary text-[12px] outline-none placeholder:text-text-tertiary" />
          {semanticMode && <span className="text-[9px] text-accent font-medium tracking-wide uppercase shrink-0">AI</span>}
        </div>
      </div>

      {/* Tags */}
      {allTags.length > 0 && (
        <div className="flex gap-px px-[var(--spacing-x)] pb-1.5 overflow-x-auto shrink-0 scrollbar-none">
          <Pill label="All" active={!activeTag} onClick={() => setActiveTag(null)} />
          {allTags.map((tag) => <Pill key={tag} label={tag} active={activeTag === tag} onClick={() => setActiveTag(activeTag === tag ? null : tag)} />)}
        </div>
      )}

      <div className="h-px bg-border shrink-0" />

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-[var(--spacing-x)] py-8 text-center text-[12px] text-text-tertiary">
            {catalog.length > 0 ? 'No matching cards.' : 'No cards yet.'}
          </div>
        ) : filtered.map((item, i) => <Row key={item.id} item={item} last={i === filtered.length - 1} />)}
      </div>
    </div>
  )
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 h-[22px] px-2 rounded-[var(--radius-sm)] border-none cursor-pointer text-[11px] font-medium transition-colors ${
        active ? 'bg-accent-subtle text-accent' : 'bg-transparent text-text-tertiary hover:text-text-secondary'
      }`}>{label}</button>
  )
}

function Row({ item, last }: { item: CatalogItem; last: boolean }) {
  const c = item.accuracy === null ? 'bg-text-tertiary'
    : item.accuracy >= 80 ? 'bg-success' : item.accuracy >= 50 ? 'bg-warning' : 'bg-danger'

  return (
    <div onClick={() => window.api.openCardFromCatalog(item.id)}
      className={`flex items-start gap-3 px-[var(--spacing-x)] py-2 cursor-pointer no-drag transition-colors hover:bg-surface ${!last ? 'border-b border-white/[0.03]' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full mt-[7px] shrink-0 ${item.type === 'concept' ? 'bg-warning/60' : 'bg-accent/50'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium leading-snug text-text-primary line-clamp-2">
          {stripMarkdownPreview(item.front)}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-text-tertiary">
          {item.tags?.length > 0 && <span className="truncate max-w-[140px]">{item.tags.join(', ')}</span>}
          {item.tags?.length > 0 && <span className="text-white/10">·</span>}
          <span>{item.got}✓ {item.miss}✗</span>
          <div className={`w-6 h-[2px] rounded-full ${c} opacity-50`} style={{ width: `${Math.max(6, (item.accuracy ?? 0) * 0.24)}px` }} />
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-text-tertiary mt-[3px]">{item.dueLabel}</span>
    </div>
  )
}
