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
  // becomes the card that is open and focused.
  if (version < 3) {
    const { panel, previousPanel: _previous, ...rest } = p
    void _previous
    p = rest
    const card = typeof panel === 'string' ? CARD_OF_PANEL[panel] : undefined
    if (card) {
      p.focusCard = card
      p.cardsOpen = { wb: true, light: true, presence: true, colour: true, [card]: true }
    }
  }
  // 4: AI denoise's default model became DRUNet; whoever has SCUNet (the old
  // default, and nearly always never chosen) moves to it once.
  if (version < 4) {
    const denoise = p.denoise as Saved | undefined
    if (denoise?.model === 'scunet-color-real') p.denoise = { ...denoise, model: 'drunet-color' }
  }
  // 5: Full HDR (engine 0.18) starts off, whatever a layout held under the name.
  if (version < 5) p.fullHdr = false
  // 6: the masks window became a column of the left pane: no floating
  // place, dock or fold to keep.
  if (version < 6 && p.masksWin && typeof p.masksWin === 'object')
    p.masksWin = { open: (p.masksWin as Saved).open === true }
  // 7: the flat UI became the default (the owner: it looks better); every
  // layout takes it once, and Settings can turn the glass back on.
  if (version < 7) p.alwaysFlat = true
  // 8: Full HDR starts on (the owner): it shows wherever the screen can, and
  // 0.4.0/0.4.1 could not turn it on at all on a Mac (no display reader).
  if (version < 8) p.fullHdr = true
  return p
}
