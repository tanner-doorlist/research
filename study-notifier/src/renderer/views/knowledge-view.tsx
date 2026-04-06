import { useState, useMemo } from 'react'
import type { KnowledgeLog } from '../lib/types'
import { MarkdownRender } from '../components/markdown-render'
import { Spinner } from '../components/spinner'
import { Search, ArrowLeft, Merge, FolderOpen } from 'lucide-react'
import {
  useKnowledgeLogs, useChromaStatus, useRepos, useKnowledgeLog,
  useRelatedLogs, useCombineLogs, useSearchKnowledge, queryKeys,
} from '../hooks/use-api'
import { useQueryClient } from '@tanstack/react-query'

type Sub = 'list' | 'detail' | 'results'

export function KnowledgeView() {
  const [sub, setSub] = useState<Sub>('list')
  const { data: logs = [] } = useKnowledgeLogs()
  const { data: dbOnline = null } = useChromaStatus()
  const { data: repos = [] } = useRepos()
  const [activeRepo, setActiveRepo] = useState<string | null>(null)
  const [detailFilename, setDetailFilename] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState('')

  const qc = useQueryClient()
  const { data: detail = '' } = useKnowledgeLog(detailFilename, sub === 'detail' && !!detailFilename)
  const { data: relatedData, isLoading: loadingRelated } = useRelatedLogs(detailFilename, sub === 'detail' && !!detailFilename)
  const related = relatedData?.ok ? (relatedData.related ?? []) : []

  const combineMutation = useCombineLogs()
  const searchMutation = useSearchKnowledge()

  const filteredLogs = useMemo(() => {
    if (!activeRepo) return logs
    return logs.filter(l => l.repo === activeRepo)
  }, [logs, activeRepo])

  const openLog = (f: string) => {
    setDetailFilename(f)
    setSub('detail')
    // Invalidate to force fresh fetch for related logs
    qc.invalidateQueries({ queryKey: queryKeys.relatedLogs(f) })
  }

  const combineWith = async (otherFilename: string) => {
    const r = await combineMutation.mutateAsync({ filename1: detailFilename, filename2: otherFilename })
    if (r.ok && r.resultFilename) {
      setDetailFilename(r.resultFilename)
      qc.invalidateQueries({ queryKey: queryKeys.relatedLogs(r.resultFilename) })
      qc.invalidateQueries({ queryKey: queryKeys.knowledgeLog(r.resultFilename) })
    }
  }

  const doSearch = async () => {
    const q = query.trim(); if (!q) return
    setSub('results')
    const r = await searchMutation.mutateAsync(q)
    setResults(r)
  }
  const tags = (s: string | string[]) => Array.isArray(s) ? s.filter(Boolean).join(', ') : s.replace(/[\[\]"]/g, '').split(',').map((t) => t.trim()).filter(Boolean).join(', ')
  const logTitle = (filename: string) => logs.find(l => l.filename === filename)?.problem || filename

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden no-drag">
      <div className="flex items-center gap-2 px-[var(--spacing-x)] h-8 shrink-0 border-b border-border">
        <span className="text-[13px] font-semibold">Knowledge</span>
        <span className="text-[10px] text-text-tertiary">{logs.length} logs</span>
        <span className={`text-[10px] ml-auto ${dbOnline ? 'text-success/70' : dbOnline === false ? 'text-danger/70' : 'text-text-tertiary'}`}>
          {dbOnline ? 'DB connected' : dbOnline === false ? 'DB offline' : '...'}
        </span>
      </div>

      {/* Repo filters — only shown when repos exist */}
      {repos.length > 0 && (
        <div className="flex gap-px px-[var(--spacing-x)] py-1 overflow-x-auto shrink-0 scrollbar-none border-b border-border">
          <RepoFilterPill label="All repos" active={!activeRepo} onClick={() => setActiveRepo(null)} />
          {repos.map(repo => (
            <RepoFilterPill key={repo} label={repo} active={activeRepo === repo} onClick={() => setActiveRepo(activeRepo === repo ? null : repo)} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 px-[var(--spacing-x)] py-1.5 border-b border-border shrink-0">
        <Search size={12} className="text-text-tertiary shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="Semantic search..."
          className="flex-1 bg-surface border border-transparent rounded-[var(--radius-md)] text-text-primary text-[12px] px-2.5 py-1 outline-none focus:border-accent/30 transition-colors" />
        <button onClick={doSearch} className="w-6 h-6 border-none rounded-[var(--radius-md)] bg-accent text-white text-xs cursor-pointer flex items-center justify-center shrink-0">↑</button>
      </div>

      {sub === 'list' && (
        <div className="flex-1 overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="px-[var(--spacing-x)] py-6 text-[12px] text-text-tertiary text-center">{logs.length > 0 ? 'No logs in this repo.' : 'No logs yet.'}</div>
          ) : filteredLogs.map((log) => (
            <div key={log.filename} onClick={() => openLog(log.filename)}
              className="px-[var(--spacing-x)] py-2 cursor-pointer border-b border-white/[0.03] hover:bg-surface transition-colors">
              <div className="text-[12px] font-medium text-text-primary overflow-hidden whitespace-nowrap text-ellipsis">{log.problem}</div>
              <div className="flex gap-2 mt-px text-[10px] text-text-tertiary">
                <span>{log.date || '—'}</span>
                {log.repo && !activeRepo && <span className="text-accent/40">{log.repo}</span>}
                {log.tags && <span className="text-accent/50">{tags(log.tags)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {sub === 'detail' && (
        <div className="flex-1 overflow-y-auto px-[var(--spacing-x)] py-3 flex flex-col gap-2">
          <button onClick={() => { setSub('list'); setDetailFilename('') }} className="bg-transparent border-none text-text-tertiary text-[11px] cursor-pointer text-left p-0 flex items-center gap-1 hover:text-text-secondary">
            <ArrowLeft size={11} /> Back
          </button>
          <div className="text-[12px] leading-[1.7]"><MarkdownRender content={detail} /></div>

          {/* Related notes */}
          <div className="mt-2 pt-2 border-t border-border">
            <span className="text-[11px] font-semibold text-text-secondary">Related notes</span>
            {loadingRelated && <div className="flex items-center gap-2 py-2 text-[11px] text-text-tertiary"><Spinner /> Finding related...</div>}
            {combineMutation.isPending && <div className="flex items-center gap-2 py-2 text-[11px] text-accent"><Spinner /> Combining notes...</div>}
            {!loadingRelated && related.length === 0 && !combineMutation.isPending && (
              <div className="py-2 text-[11px] text-text-tertiary">No related notes found.</div>
            )}
            {related.map(r => (
              <div key={r.filename} className="flex items-center gap-2 py-1.5 border-b border-white/[0.03]">
                <button onClick={() => openLog(r.filename)}
                  className="flex-1 min-w-0 bg-transparent border-none text-left cursor-pointer p-0 text-[11px] text-text-primary hover:text-accent transition-colors truncate">
                  {logTitle(r.filename)}
                </button>
                <span className="text-[10px] text-text-tertiary shrink-0">{r.similarity}%</span>
                <button onClick={() => combineWith(r.filename)} disabled={combineMutation.isPending}
                  title="Combine into this note"
                  className="w-6 h-6 border-none rounded-[var(--radius-md)] bg-transparent text-text-tertiary cursor-pointer flex items-center justify-center hover:bg-surface hover:text-accent transition-colors disabled:opacity-40 shrink-0">
                  <Merge size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub === 'results' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-[var(--spacing-x)] py-1.5 border-b border-border shrink-0">
            <button onClick={() => { setSub('list'); setQuery('') }} className="bg-transparent border-none text-text-tertiary text-[11px] cursor-pointer p-0 flex items-center gap-1 hover:text-text-secondary">
              <ArrowLeft size={11} /> Back
            </button>
            <span className="text-[11px] text-text-tertiary truncate">"{query}"</span>
          </div>
          <div className="flex-1 overflow-y-auto px-[var(--spacing-x)] py-3 text-[12px] leading-[1.7] whitespace-pre-wrap text-text-secondary">
            {searchMutation.isPending ? <div className="flex items-center gap-2 text-text-tertiary py-4"><Spinner /> Searching...</div> : results}
          </div>
        </div>
      )}
    </div>
  )
}

function RepoFilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 h-[22px] px-2 rounded-[var(--radius-sm)] border-none cursor-pointer text-[11px] font-medium transition-colors flex items-center gap-1 ${
        active ? 'bg-accent-subtle text-accent' : 'bg-transparent text-text-tertiary hover:text-text-secondary'
      }`}>{label}</button>
  )
}
