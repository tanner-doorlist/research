import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Card, Settings } from '../lib/types'

// ── Query keys ──────────────────────────────────────────────────────

export const queryKeys = {
  repos: ['repos'] as const,
  settings: ['settings'] as const,
  knowledgeLogs: ['knowledge-logs'] as const,
  chromaStatus: ['chroma-status'] as const,
  catalog: ['catalog'] as const,
  analytics: ['analytics'] as const,
  sessions: (cardId: string) => ['sessions', cardId] as const,
  currentSession: (cardId: string) => ['current-session', cardId] as const,
  knowledgeLog: (filename: string) => ['knowledge-log', filename] as const,
  relatedLogs: (filename: string) => ['related-logs', filename] as const,
}

// ── Queries ─────────────────────────────────────────────────────────

export function useRepos() {
  return useQuery({
    queryKey: queryKeys.repos,
    queryFn: () => window.api.getRepos(),
  })
}

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => window.api.getSettings(),
    enabled,
  })
}

export function useKnowledgeLogs() {
  return useQuery({
    queryKey: queryKeys.knowledgeLogs,
    queryFn: () => window.api.getKnowledgeLogs(),
  })
}

export function useChromaStatus() {
  return useQuery({
    queryKey: queryKeys.chromaStatus,
    queryFn: () => window.api.getChromaStatus(),
  })
}

export function useCatalog() {
  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: () => window.api.getCatalog(),
  })
}

export function useSessions(cardId: string) {
  return useQuery({
    queryKey: queryKeys.sessions(cardId),
    queryFn: () => window.api.getSessions(cardId),
  })
}

export function useCurrentSession(cardId: string) {
  return useQuery({
    queryKey: queryKeys.currentSession(cardId),
    queryFn: () => window.api.getCurrentSession(cardId),
  })
}

export function useKnowledgeLog(filename: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.knowledgeLog(filename),
    queryFn: () => window.api.getKnowledgeLog(filename),
    enabled,
  })
}

export function useRelatedLogs(filename: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.relatedLogs(filename),
    queryFn: () => window.api.getRelatedLogs(filename),
    enabled,
  })
}

// ── Mutations ───────────────────────────────────────────────────────

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Partial<Settings>) => {
      window.api.saveSettings(s)
      return Promise.resolve()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.settings }),
  })
}

export function useAutoTagCards() {
  return useMutation({
    mutationFn: () => window.api.autoTagCards(),
  })
}

export function useConfigureMcp() {
  return useMutation({
    mutationFn: () => window.api.configureMcp(),
  })
}

export function useIndexCards() {
  return useMutation({
    mutationFn: () => window.api.indexCards(),
  })
}

export function useBulkDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardIds: string[]) => window.api.bulkDelete(cardIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useBulkSetTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cardIds, tags }: { cardIds: string[]; tags: string[] }) =>
      window.api.bulkSetTags(cardIds, tags),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useBulkFlag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardIds: string[]) => window.api.bulkFlag(cardIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useBulkMerge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardIds: string[]) => window.api.bulkMerge(cardIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useDeleteCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) => window.api.deleteCard(cardId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useFlagCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) => window.api.flagCard(cardId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useUnflagCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) => window.api.unflagCard(cardId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useUnretireCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) => window.api.unretireCard(cardId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useUndoDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => window.api.undoDelete(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useSetCardTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cardId, tags }: { cardId: string; tags: string[] }) =>
      window.api.setCardTags(cardId, tags),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useApplyCardEdit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cardId, front, back }: { cardId: string; front: string; back: string }) =>
      window.api.applyCardEdit(cardId, front, back),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.catalog }),
  })
}

export function useEvaluateAnswer() {
  return useMutation({
    mutationFn: ({ cardId, answer, refCardIds, isFollowUp }: {
      cardId: string; answer: string; refCardIds?: string[]; isFollowUp?: boolean
    }) => window.api.evaluateAnswer(cardId, answer, refCardIds, isFollowUp),
  })
}

export function useRecordAnswer() {
  return useMutation({
    mutationFn: ({ cardId, correct }: { cardId: string; correct: boolean }) =>
      window.api.recordAnswer(cardId, correct),
  })
}

export function useOverrideAnswer() {
  return useMutation({
    mutationFn: ({ cardId, wasCorrect, nowCorrect }: { cardId: string; wasCorrect: boolean; nowCorrect: boolean }) =>
      window.api.overrideAnswer(cardId, wasCorrect, nowCorrect),
  })
}

export function useClearConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) => window.api.clearConversation(cardId),
    onSuccess: (_data, cardId) => {
      qc.invalidateQueries({ queryKey: queryKeys.sessions(cardId) })
      qc.invalidateQueries({ queryKey: queryKeys.currentSession(cardId) })
    },
  })
}

export function useChatSend() {
  return useMutation({
    mutationFn: ({ messages, card }: { messages: { role: string; content: string }[]; card: Card }) =>
      window.api.chatSend(messages, card),
  })
}

export function useEditCardChat() {
  return useMutation({
    mutationFn: ({ messages, card }: { messages: { role: string; content: string }[]; card: Card }) =>
      window.api.editCardChat(messages, card),
  })
}

export function useSemanticSearchCards() {
  return useMutation({
    mutationFn: (query: string) => window.api.semanticSearchCards(query),
  })
}

export function useCombineLogs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ filename1, filename2 }: { filename1: string; filename2: string }) =>
      window.api.combineLogs(filename1, filename2),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.knowledgeLogs }),
  })
}

export function useSearchKnowledge() {
  return useMutation({
    mutationFn: (query: string) => window.api.searchKnowledge(query),
  })
}

export function useApproveGapCard() {
  return useMutation({
    mutationFn: (id: string) => window.api.approveGapCard(id),
  })
}

export function useDenyGapCard() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      window.api.denyGapCard(id, reason),
  })
}
