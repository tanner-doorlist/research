export type ViewType = 'hidden' | 'pill' | 'card' | 'catalog' | 'chat' | 'knowledge' | 'analytics'

export interface Card {
  id: string
  type: 'qa' | 'concept'
  front: string
  back: string
  tags: string[]
  when?: string
  how?: string
  example?: string
}

export interface Stats {
  total: number
  seen: number
  due: number
  streak: number
  totalGot: number
  totalMiss: number
}

export interface CatalogItem {
  id: string
  type: 'qa' | 'concept'
  front: string
  got: number
  miss: number
  accuracy: number | null
  dueLabel: string
  streak: number
  tags: string[]
  retired: boolean
  flagged: boolean
}

export interface Settings {
  intervalMinutes: number
  annoyanceLevel: number
  cardsPerSession: number
  launchAtLogin: boolean
  retireThreshold: number
  anthropicApiKey?: string
  openaiApiKey?: string
}

export interface AnalyticsData {
  totalReviews: number
  overallAccuracy: number
  streak: number
  daysActive: number
  categoryStats: CategoryStat[]
  activityByDay: ActivityDay[]
}

export interface CategoryStat {
  tag: string
  got: number
  miss: number
  total: number
  accuracy: number
}

export interface ActivityDay {
  date: string
  count: number
}

export interface KnowledgeLog {
  filename: string
  date: string
  problem: string
  tags: string
}

export interface ViewState {
  type: ViewType
  card?: Card
  stats?: Stats
  catalog?: CatalogItem[]
  sessionDone?: number
  sessionTotal?: number
  analytics?: AnalyticsData
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
  score?: number
}

export interface ConversationSession {
  id: string
  startedAt: number
  score: number | null
  messages: ConversationMessage[]
}

export interface ElectronAPI {
  expand: () => void
  dismiss: () => void
  snooze: (mins: number) => void
  openCatalog: () => void
  openCardFromCatalog: (cardId: string) => void
  openChat: (card: Card) => void
  backToCard: () => void
  openKnowledge: () => void
  openAnalytics: () => void

  answer: (cardId: string, correct: boolean) => void
  saveSettings: (s: Partial<Settings>) => void
  getSettings: () => Promise<Settings>
  getStats: () => Promise<Stats>
  getCatalog: () => Promise<CatalogItem[]>

  editCardChat: (messages: { role: string; content: string }[], card: Card) => Promise<string>
  applyCardEdit: (cardId: string, front: string, back: string) => Promise<{ ok: boolean }>
  chatSend: (messages: { role: string; content: string }[], card: Card) => Promise<string>
  autoTagCards: () => Promise<{ ok: boolean; error?: string }>
  deleteCard: (cardId: string) => Promise<{ ok: boolean; undoToken?: string }>
  undoDelete: (token: string) => Promise<{ ok: boolean }>
  flagCard: (cardId: string) => Promise<{ ok: boolean }>
  unflagCard: (cardId: string) => Promise<{ ok: boolean }>
  unretireCard: (cardId: string) => Promise<{ ok: boolean }>
  indexCards: () => Promise<{ ok: boolean; count?: number; error?: string }>
  semanticSearchCards: (query: string) => Promise<{ ok: boolean; orderedIds?: string[]; error?: string }>
  setCardTags: (cardId: string, tags: string[]) => Promise<{ ok: boolean }>
  bulkDelete: (cardIds: string[]) => Promise<{ ok: boolean; deleted?: number }>
  bulkSetTags: (cardIds: string[], tags: string[]) => Promise<{ ok: boolean; updated?: number }>
  bulkFlag: (cardIds: string[]) => Promise<{ ok: boolean }>
  bulkMerge: (cardIds: string[]) => Promise<{ ok: boolean; newCardId?: string; error?: string }>
  evaluateAnswer: (cardId: string, answer: string, refCardIds?: string[], isFollowUp?: boolean) => Promise<{ ok: boolean; score?: number; feedback?: string; error?: string }>
  recordAnswer: (cardId: string, correct: boolean) => Promise<{ ok: boolean }>
  overrideAnswer: (cardId: string, wasCorrect: boolean, nowCorrect: boolean) => Promise<{ ok: boolean }>
  getSessions: (cardId: string) => Promise<ConversationSession[]>
  getCurrentSession: (cardId: string) => Promise<ConversationSession | null>
  startSession: (cardId: string) => Promise<ConversationSession>
  clearConversation: (cardId: string) => Promise<{ ok: boolean }>

  getView: () => Promise<ViewState>
  onView: (cb: (v: ViewState) => void) => void
  offView: (cb: (v: ViewState) => void) => void
  onAnnoy: (cb: () => void) => void
  offAnnoy: (cb: () => void) => void

  getKnowledgeLogs: () => Promise<KnowledgeLog[]>
  getKnowledgeLog: (filename: string) => Promise<string | null>
  searchKnowledge: (query: string) => Promise<string>
  getChromaStatus: () => Promise<boolean>
  getRelatedLogs: (filename: string) => Promise<{ ok: boolean; related?: { filename: string; similarity: number }[]; error?: string }>
  combineLogs: (filename1: string, filename2: string) => Promise<{ ok: boolean; resultFilename?: string; error?: string }>

  getAnalytics: () => Promise<AnalyticsData>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
