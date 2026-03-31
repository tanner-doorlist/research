import { useEffect, useState } from 'react'

export function useAnnoy() {
  const [shaking, setShaking] = useState(false)

  useEffect(() => {
    const handler = () => {
      setShaking(true)
      setTimeout(() => setShaking(false), 400)
    }
    window.api.onAnnoy(handler)
    return () => window.api.offAnnoy(handler)
  }, [])

  return shaking
}
