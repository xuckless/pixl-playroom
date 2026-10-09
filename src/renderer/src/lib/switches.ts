/** The AI switches (shared/heavy.ts) as main has them, kept current. */
import { useEffect, useState } from 'react'
import type { AiSwitches } from '../../../shared/heavy'
import { api } from './api'

export function useSwitches(): AiSwitches | null {
  const [s, setS] = useState<AiSwitches | null>(null)
  useEffect(() => {
    void api.ai.switches().then(setS, () => undefined)
    return api.ai.onSwitches(setS)
  }, [])
  return s
}
