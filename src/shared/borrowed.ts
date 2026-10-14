/**
 * The borrowed models PIXL's own replace (engine 0.20.0, decision 35):
 * FBCNN, NAFNet SIDD and GoPro and DRUNet by PIXL Enhance, PMRID by the
 * PIXL demosaic. Where the roster offers the PIXL model, Settings → AI
 * models stops listing the one it replaces, unless it is downloaded (so it
 * can still be removed). Hidden from the list only: it stays installed,
 * fetchable and runnable where a look, a re-run or a saved step asks for
 * it (not `held`, which would make it neither: the 0.20.0 audit's B2).
 * DemosaicNet stays listed: it is the develop when the PIXL demosaic is off
 * or refused.
 */
import { PIXL_DEMOSAIC } from './pixldemosaic'
import { PIXL_ENHANCE } from './pixlenhance'

export const REPLACED_BY: Readonly<Record<string, string>> = {
  'fbcnn-color-blind': PIXL_ENHANCE,
  'nafnet-sidd-w32': PIXL_ENHANCE,
  'nafnet-gopro-w32': PIXL_ENHANCE,
  'drunet-color': PIXL_ENHANCE,
  pmrid: PIXL_DEMOSAIC.Bayer
}

/** Whether Settings lists a model: not one the roster's PIXL model replaces, unless downloaded. */
export function listed(id: string, installed: boolean, offered: (id: string) => boolean): boolean {
  const by = REPLACED_BY[id]
  return installed || !by || !offered(by)
}
