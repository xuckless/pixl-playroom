import { tk } from '../../lib/i18n'
import type { ExpandedScope } from '../../../../shared/scopes'

/** Each scope's name, as ◀ ▶ shows it. */
export const SCOPE_LABEL: Record<ExpandedScope, string> = {
  histogram: tk('Histogram'),
  parade: tk('RGB parade'),
  waveform: tk('Waveform'),
  vectorscope: tk('Vectorscope'),
  hue: tk('Colours'),
  cie: 'CIE 1976',
  metrics: tk('Metrics')
}
