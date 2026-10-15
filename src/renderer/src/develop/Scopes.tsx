import { Icon } from '../components/icons'
import { ExpandButton } from '../components/charts'
import { InfoTip } from '../components/InfoTip'
import { t, tk } from '../lib/i18n'
import type { Tip } from '../components/InfoTip'
import { withKey } from '../lib/commands'
import { cycleScope, type ScopeKind } from '../../../shared/scopes'
import { useUi } from '../state/ui'
import { useDevelop } from '../state/develop'
import { useScopesView } from '../state/scopesView'
import { ScopeOptions, ScopeView } from './scopes/ScopeView'
import { SCOPE_LABEL } from './scopes/labels'

/** From the picture on screen: said in every binned scope's note. */
const BINNED_NOTE = tk(
  'Read from the picture on screen: preview resolution, Display P3. Exact full-resolution scopes wait on the engine.'
)

const TIPS: Partial<Record<ScopeKind, Tip>> = {
  waveform: {
    what: tk(
      'Brightness across the photo: each column of the picture is a column here, its pixels plotted by brightness on Resolve’s 0–1023 scale. Y is luma; RGB lays the three channels over one another.'
    ),
    expect: tk('Above 1023 is an HDR picture’s headroom, shaded.'),
    tip: BINNED_NOTE
  },
  parade: {
    what: tk(
      'The waveform of red, green and blue side by side. Where the three line up, that part of the photo is neutral: a white or grey that should be neutral and isn’t shows as one channel higher.'
    ),
    tip: BINNED_NOTE
  },
  vectorscope: {
    what: tk(
      'Hue around the circle and saturation outwards from the middle. The boxes are 75% red, yellow, green, cyan, blue and magenta; the line is where skin falls.'
    ),
    expect: tk('2× shows the middle of it, for skin and pastels.'),
    tip: BINNED_NOTE
  },
  cie: {
    what: tk(
      'Where the photo’s colours fall among every colour the eye sees, with Display P3 for reference.'
    ),
    tip: BINNED_NOTE
  }
}

/**
 * While a proof is shown the scopes (and Clipping, and the pickers) read
 * it, as Lightroom's proof histogram does: said beside the scope's name.
 */
export function ProofTag(): React.JSX.Element | null {
  const shown = useDevelop((s) => s.proof && !!s.picture?.proof && !s.picture.proof.warnOnly)
  return shown ? (
    <span className="proof-tag" title={t('Measuring the proof.')}>
      {t('Proof')}
    </span>
  ) : null
}

/**
 * The scope at the top of the right column, as DaVinci Resolve keeps one:
 * ◀ ▶ step through the histogram, RGB parade, waveform, vectorscope, the
 * colour chart and the CIE chart; the corner button opens them at full size,
 * one, two or four at once.
 */
export function Scopes(): React.JSX.Element {
  const kind = useUi((s) => s.scopes.inline)
  const setScopes = useUi((s) => s.setScopes)
  const open = useScopesView((v) => v.open)
  const step = (d: 1 | -1): void => setScopes({ inline: cycleScope(kind, d) })
  return (
    <div className="scopes">
      <div className="scope-head">
        <button
          className="icon sm"
          aria-label={withKey(t('Previous scope'), 'scopes.prev')}
          title={withKey(t('Previous scope'), 'scopes.prev')}
          onClick={() => step(-1)}
        >
          <Icon name="chevronLeft" />
        </button>
        <span className="scope-name">{t(SCOPE_LABEL[kind])}</span>
        <button
          className="icon sm"
          aria-label={withKey(t('Next scope'), 'scopes.next')}
          title={withKey(t('Next scope'), 'scopes.next')}
          onClick={() => step(1)}
        >
          <Icon name="chevronRight" />
        </button>
        <ProofTag />
        <span className="spacer" />
        <ScopeOptions kind={kind} />
        {TIPS[kind] && <InfoTip label={t(SCOPE_LABEL[kind])} tip={TIPS[kind]} />}
        <ExpandButton label={t('Expand the scopes')} onClick={() => open()} />
      </div>
      <ScopeView kind={kind} />
    </div>
  )
}
