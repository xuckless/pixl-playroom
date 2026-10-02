/**
 * The looks the left rail lists before My Looks takes over: the starter set
 * of the catalog (`looks/`). A built-in carries only the sliders it sets (its
 * `fields`): applying "Soft portrait" lifts the shadows and softens the
 * skin, and leaves the photo's exposure, whites and the rest as they were.
 */
import type { Preset } from './ipc'
import { LOOK_BY_ID, STARTER_LOOK_IDS } from './looks/catalog'

export const BUILTIN_PRESETS: Preset[] = STARTER_LOOK_IDS.map((id) => {
  const look = LOOK_BY_ID.get(id)
  if (!look) throw new Error(`starter look ${id} is not in the catalog`)
  return look
})
