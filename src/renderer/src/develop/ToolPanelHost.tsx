import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, type ComponentType } from 'react'
import { AdvancedPanel } from '../panels/advanced'
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
import { MasksPanel } from '../panels/masks/MaskTool'
import { useUi, type ToolId } from '../state/ui'

const PANELS: Record<ToolId, ComponentType> = {
  basic: BasicPanel,
  curve: ToneCurvePanel,
  hsl: HslPanel,
  grade: ColorGradePanel,
  detail: DetailPanel,
  effects: EffectsPanel,
  masks: MasksPanel,
  crop: GeometryPanel,
  calibration: CalibrationPanel,
  advanced: AdvancedPanel
}

/** Exactly one tool, springing in as the wheel lands on it. */
export function ToolPanelHost(): React.JSX.Element {
  const panel = useUi((s) => s.panel)
  const Panel = PANELS[panel]
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [panel])
  return (
    <div className="panels" ref={scroller}>
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
