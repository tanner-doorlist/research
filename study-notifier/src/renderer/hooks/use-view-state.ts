import { useState, useEffect } from 'react'
import type { ViewState } from '../lib/types'

export function useViewState(): ViewState {
  const [view, setView] = useState<ViewState>({ type: 'hidden' })

  useEffect(() => {
    window.api.getView().then((v: ViewState) => {
      if (v && v.type !== 'hidden') setView(v)
      else window.api.openCatalog()
    })

    const handler = (v: ViewState) => setView(v)
    window.api.onView(handler)
    return () => window.api.offView(handler)
  }, [])

  return view
}
