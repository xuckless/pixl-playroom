import { useEffect, useState } from 'react'
import type { GateState } from '../../../shared/gate'
import { api } from './api'

/** The gate main says stands in front of the window (shared/gate.ts); null until it has said. */
export function useGate(): GateState | null {
  const [gate, setGate] = useState<GateState | null>(null)
  useEffect(() => {
    void api.app.gate().then(setGate)
    return api.app.onGate(setGate)
  }, [])
  return gate
}
