/**
 * Older saved layouts brought up to date (the `playroom.ui` store's
 * `migrate`). Kept apart from the store so it can be tested on its own.
 */
import type { CardId } from '../../../shared/cards'

/** Where each tool of the old wheel lives now, as a card. */
const CARD_OF_PANEL: Record<string, CardId> = {
  basic: 'light',
  curve: 'curve',
  hsl: 'mixer',
  grade: 'grading',
  detail: 'detail',
  lens: 'optics',
  effects: 'effects',
  calibration: 'calibration'
}

type Saved = Record<string, unknown>

export function migrateUi(persisted: unknown, version: number): Saved {
  let p: Saved = { ...((persisted ?? {}) as Saved) }
  // 2: the overlay's default view became Molten glass; whoever kept the old
  // default (colour) gets the new one once.
  const overlay = p.maskOverlay as Saved | undefined
  if (version < 2 && overlay?.mode === 'color') p.maskOverlay = { ...overlay, mode: 'glass' }
  // 3: the wheel's one tool became a stack of cards; the tool last shown
  // becomes the card that is open and focused. AI denoise's default model
  // became DRUNet: one left at the old default (SCUNet) moves with it.
  if (version < 3) {
    const denoise = p.denoise as Saved | undefined
    if (denoise?.model === 'scunet-color-real') p.denoise = { ...denoise, model: 'drunet-color' }
    const { panel, previousPanel: _previous, ...rest } = p
    void _previous
    p = rest
    const card = typeof panel === 'string' ? CARD_OF_PANEL[panel] : undefined
    if (card) {
      p.focusCard = card
      p.cardsOpen = { wb: true, light: true, presence: true, colour: true, [card]: true }
    }
  }
  return p
}
