import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, type ComponentType } from 'react'
import {
  BasicPanel,
  CalibrationPanel,
  ColorGradePanel,
  DetailPanel,
  EffectsPanel,
  GeometryPanel,
  HslPanel,
  ToneCurvePanel
} from '../panels/global'
import { EnhancePanel } from '../panels/enhance'
import { HealPanel } from '../panels/heal'
import { LensPanel } from '../panels/lens'
import { Icon } from '../components/icons'
import { useDevelop } from '../state/develop'
import { useScope } from '../state/scope'
import { useUi, type ToolId } from '../state/ui'

const PANELS: Record<ToolId, ComponentType> = {
  basic: BasicPanel,
  curve: ToneCurvePanel,
  hsl: HslPanel,
  grade: ColorGradePanel,
  detail: DetailPanel,
  lens: LensPanel,
  effects: EffectsPanel,
  heal: HealPanel,
  crop: GeometryPanel,
  calibration: CalibrationPanel,
  enhance: EnhancePanel
}

/** The tools whose settings a selected mask carries (see `scope.ts`). */
const SCOPED: ToolId[] = [
  'basic',
  'curve',
  'hsl',
  'grade',
  'detail',
  'effects',
  'calibration',
  // Strokes, and deblur and restore, keep inside the mask.
  'heal',
  'enhance'
]

/**
 * Which part of the photo the panel edits: with a mask selected, a chip in
 * the mask's own overlay colour (× edits the whole photo again); on a tool a
 * mask cannot carry, a note that it edits the whole photo.
 */
function ScopeChip({ panel }: { panel: ToolId }): React.JSX.Element | null {
  const { layer } = useScope()
  const overlayHue = useUi((s) => s.maskOverlay.hue)
  if (!layer) return null
  const hue = layer.overlayHue ?? overlayHue
  if (!SCOPED.includes(panel))
    return <p className="scope-note muted small">This tool always edits the whole photo.</p>
  return (
    <div className="scope-chip" style={{ ['--scope-hue' as string]: hue }}>
      <span className="scope-dot" />
      <span className="scope-text">
        Editing <b>{layer.name}</b>
      </span>
      <button
        className="icon sm ghost"
        title="Edit the whole photo (Esc)"
        aria-label="Edit the whole photo"
        onClick={() => useDevelop.getState().setLayer(null)}
      >
        <Icon name="close" />
      </button>
    </div>
  )
}

/** Exactly one tool, springing in as the wheel lands on it. */
export function ToolPanelHost(): React.JSX.Element {
  const panel = useUi((s) => s.panel)
  const Panel = PANELS[panel]
  const layer = useScope().layer
  const overlayHue = useUi((s) => s.maskOverlay.hue)
  const scoped = layer !== null && SCOPED.includes(panel)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [panel])
  return (
    <div
      className={`panels${scoped ? ' scoped' : ''}`}
      ref={scroller}
      style={layer ? { ['--scope-hue' as string]: layer.overlayHue ?? overlayHue } : undefined}
    >
      <ScopeChip panel={panel} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={panel}
          className="panel-motion"
          initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(4px)', transition: { duration: 0.14 } }}
          transition={{
            default: { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 },
            // A spring would overshoot the blur below zero.
            filter: { type: 'tween', duration: 0.28, ease: 'easeOut' }
          }}
        >
          <Panel />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
