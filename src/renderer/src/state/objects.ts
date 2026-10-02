/**
 * The Objects tool (and the Sky tool, which is it asking for one click on
 * the sky): SAM 2.1 selecting what the user points at. Its way of pointing,
 * what it is selecting, and where its selection on the open photo stands.
 * The canvas side is views/loupe/ObjectsTool.tsx; committing and cancelling
 * are lib/objects.ts.
 */
import { create } from 'zustand'
import type { SelectPlane } from '../../../shared/prompt'

/**
 * How the tool points: Auto (hover shows what is under the pointer; a click
 * takes it), Box (drag around it) or Brush (scribble over it).
 */
export type ObjectsMode = 'auto' | 'box' | 'brush'
export type ObjectsTarget = 'object' | 'sky'

interface ObjectsState {
  mode: ObjectsMode
  target: ObjectsTarget
  /** The selection on the open photo once its embedding is made, with the photo's key. */
  selId: string | null
  key: string | null
  /** 'loading' while the photo is analysed (about a second); 'working' while a click is answered. */
  status: 'idle' | 'loading' | 'ready' | 'working'
  /** What is selected so far (a click, a box or a stroke has landed), as the last answer. */
  plane: SelectPlane | null
  /** How the selection was made, for the mask's record. */
  via: 'click' | 'box' | 'brush' | 'sky'
  begin(target: ObjectsTarget): void
  setMode(mode: ObjectsMode): void
}

export const useObjects = create<ObjectsState>((set) => ({
  mode: 'auto',
  target: 'object',
  selId: null,
  key: null,
  status: 'idle',
  plane: null,
  via: 'click',
  begin(target) {
    set({ target, plane: null, via: target === 'sky' ? 'sky' : 'click' })
  },
  setMode(mode) {
    set({ mode })
  }
}))
