/**
 * The develop mark a RAW's pixel step is made with (`params.develop`; see
 * `staleRawStep`): its camera colour's, and `+pd` when the PIXL demosaic
 * develops it (a development kit's). A step whose mark is not today's was
 * made from another develop: its patch or its mask's edge can show, and a
 * rebuild makes it again.
 */
import type { SourceInfo } from '../shared/engine-types'
import { pixlMark } from '../shared/rebuild'
import { developMark } from '../shared/rawcolour'
import { scenePlan, type RawDevelopAsk } from './ai/rawdevelop'
import type { PhotoRow } from './db'
import { colourOf } from './source'

export async function stepDevelopMark(
  row: PhotoRow,
  info: Pick<SourceInfo, 'raw_cfa'>,
  ask: RawDevelopAsk
): Promise<string> {
  const plan = await scenePlan(info.raw_cfa, ask)
  return pixlMark(developMark(colourOf(row)), plan.demosaic === 'pixl')
}
