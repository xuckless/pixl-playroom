/**
 * History's and Versions' labels in the language shown now. Labels are
 * stored in English (a history outlives a change of language); one made of a
 * name and a setting ("Sky: Exposure", "Version: Before print") is
 * translated a side at a time.
 */
import { t, tk } from './i18n'

/** The words before a label's colon, where the label carries a name or a value after it. */
const STEP_HEADS = [
  tk('White balance'),
  tk('Curve preset'),
  tk('Profile'),
  tk('Colour grade'),
  tk('Snapshot'),
  tk('Version'),
  tk('Back to'),
  tk('Before look'),
  tk('Mask mode'),
  tk('Camera colour'),
  tk('Look'),
  tk('Upright'),
  tk('Targeted')
]
void STEP_HEADS

export function stepLabel(label: string): string {
  const whole = t(label)
  if (whole !== label) return whole
  const i = label.indexOf(': ')
  return i > 0 ? `${t(label.slice(0, i))}: ${t(label.slice(i + 2))}` : whole
}
