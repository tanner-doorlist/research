const { contextBridge, ipcRenderer } = require('electron')

const api = {
  expand:     ()               => ipcRenderer.send('expand'),
  dismiss:    ()               => ipcRenderer.send('dismiss'),
  snooze:     (mins)           => ipcRenderer.send('snooze', mins),
  openCatalog:()               => ipcRenderer.send('catalog'),
  openCardFromCatalog:(cardId) => ipcRenderer.send('open-card-from-catalog', cardId),
  openChat:   (card)           => ipcRenderer.send('chat', card),
  backToCard: ()               => ipcRenderer.send('back-to-card'),

  answer:     (cardId, correct)=> ipcRenderer.send('answer', { cardId, correct }),

  saveSettings:(s)             => ipcRenderer.send('settings:save', s),
  getSettings: ()              => ipcRenderer.invoke('settings:get'),

  getStats:    ()              => ipcRenderer.invoke('stats:get'),
  getCatalog:  ()              => ipcRenderer.invoke('catalog:get'),

  editCardChat:(messages, card)=> ipcRenderer.invoke('edit-card-chat', { card, messages }),
  applyCardEdit:(cardId, front, back)=> ipcRenderer.invoke('apply-card-edit', { cardId, front, back }),
  chatSend:    (messages, card)=> ipcRenderer.invoke('chat-send', { messages, card }),
  autoTagCards: ()              => ipcRenderer.invoke('auto-tag-cards'),
  deleteCard:  (cardId)        => ipcRenderer.invoke('delete-card', { cardId }),
  undoDelete:  (token)         => ipcRenderer.invoke('undo-delete', { token }),
  flagCard:    (cardId)        => ipcRenderer.invoke('flag-card', { cardId }),
  unflagCard:  (cardId)        => ipcRenderer.invoke('unflag-card', { cardId }),
  unretireCard:(cardId)        => ipcRenderer.invoke('unretire-card', { cardId }),

  devFireNotification: () => ipcRenderer.invoke('dev:fire-notification'),
  devSeedCards:        () => ipcRenderer.invoke('dev:seed-cards'),
  getView:     ()   => ipcRenderer.invoke('get-view'),
  onView:      (cb) => { const wrapped = (_, d) => cb(d); cb._wrapped = wrapped; ipcRenderer.on('view', wrapped) },
  offView:     (cb) => { ipcRenderer.removeListener('view', cb._wrapped || cb) },
  onAnnoy:     (cb) => { const wrapped = () => cb(); cb._wrapped = wrapped; ipcRenderer.on('annoy', wrapped) },
  offAnnoy:    (cb) => { ipcRenderer.removeListener('annoy', cb._wrapped || cb) },

  openKnowledge:    ()         => ipcRenderer.send('knowledge'),
  getKnowledgeLogs: ()         => ipcRenderer.invoke('knowledge:get-logs'),
  getKnowledgeLog:  (filename) => ipcRenderer.invoke('knowledge:get-log', { filename }),
  searchKnowledge:  (query)    => ipcRenderer.invoke('knowledge:search', { query }),
  getRepos:         ()         => ipcRenderer.invoke('repos:get'),
  getChromaStatus:  ()         => ipcRenderer.invoke('knowledge:chroma-status'), // legacy name — actually checks Postgres
  getDbStatus:      ()         => ipcRenderer.invoke('knowledge:chroma-status'),
  getRelatedLogs:   (filename) => ipcRenderer.invoke('knowledge:related', { filename }),
  combineLogs:      (f1, f2)   => ipcRenderer.invoke('knowledge:combine', { filename1: f1, filename2: f2 }),

  openAnalytics:        ()               => ipcRenderer.send('analytics'),
  getAnalytics:         ()               => ipcRenderer.invoke('analytics:get'),
  indexCards:           ()               => ipcRenderer.invoke('cards:index-embeddings'),
  semanticSearchCards:  (query)          => ipcRenderer.invoke('cards:semantic-search', { query }),
  setCardTags:          (cardId, tags)   => ipcRenderer.invoke('cards:set-tags', { cardId, tags }),
  bulkDelete:           (cardIds)        => ipcRenderer.invoke('bulk-delete', { cardIds }),
  bulkSetTags:          (cardIds, tags)  => ipcRenderer.invoke('bulk-set-tags', { cardIds, tags }),
  bulkFlag:             (cardIds)        => ipcRenderer.invoke('bulk-flag', { cardIds }),
  bulkMerge:            (cardIds)        => ipcRenderer.invoke('bulk-merge', { cardIds }),
  evaluateAnswer:       (cardId, answer, refCardIds, isFollowUp) => ipcRenderer.invoke('answer:evaluate', { cardId, answer, refCardIds, isFollowUp }),
  recordAnswer:         (cardId, correct) => ipcRenderer.invoke('answer:record', { cardId, correct }),
  overrideAnswer:       (cardId, wasCorrect, nowCorrect) => ipcRenderer.invoke('answer:override', { cardId, wasCorrect, nowCorrect }),
  getSessions:          (cardId) => ipcRenderer.invoke('conversation:get-sessions', { cardId }),
  getCurrentSession:    (cardId) => ipcRenderer.invoke('conversation:get-current', { cardId }),
  startSession:         (cardId) => ipcRenderer.invoke('conversation:start', { cardId }),
  clearConversation:    (cardId) => ipcRenderer.invoke('conversation:clear', { cardId }),
  onGapCardSuggestion:  (cb) => { const wrapped = (_, d) => cb(d); cb._wrapped = wrapped; ipcRenderer.on('gap-card-suggestion', wrapped) },
  offGapCardSuggestion: (cb) => { ipcRenderer.removeListener('gap-card-suggestion', cb._wrapped || cb) },
  approveGapCard:       (id) => ipcRenderer.invoke('gap-card:approve', { id }),
  denyGapCard:          (id, reason) => ipcRenderer.invoke('gap-card:deny', { id, reason }),
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (_) {
  /* bridge failed — renderer will show retry / error state */
}
