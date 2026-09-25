import { useDevelop, type Tool } from '../state/develop'
import { useUi, type ToolId } from '../state/ui'

export interface ToolInfo {
  id: ToolId
  name: string
  /** The name on the wheel. */
  short: string
  desc: string
  /** A 24-unit SVG path. */
  icon: string
}

/** The develop tools, in the order the wheel turns through them. */
export const TOOLS: ToolInfo[] = [
  {
    id: 'basic',
    name: 'Basic',
    short: 'Basic',
    desc: 'Profile, white balance, tone and presence.',
    icon: 'M4 7h16M4 12h10M4 17h13'
  },
  {
    id: 'curve',
    name: 'Tone Curve',
    short: 'Curve',
    desc: 'Parametric regions and RGB point curves.',
    icon: 'M3 20C8 20 10 4 21 4'
  },
  {
    id: 'hsl',
    name: 'HSL / Colour',
    short: 'HSL',
    desc: 'Eight bands × hue, saturation and luminance; B&W mix when monochrome.',
    icon: 'M12 3a9 9 0 1 0 0 18M12 3v18'
  },
  {
    id: 'grade',
    name: 'Colour Grading',
    short: 'Grade',
    desc: 'Shadow, midtone, highlight and global wheels.',
    icon: 'M7 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
  },
  {
    id: 'detail',
    name: 'Detail',
    short: 'Detail',
    desc: 'Sharpening with masking; noise reduction with the measured σ̂.',
    icon: 'M4 20 20 4M4 12l8-8M12 20l8-8'
  },
  {
    id: 'effects',
    name: 'Effects',
    short: 'Effects',
    desc: 'Post-crop vignette fitted to the frame; seeded grain.',
    icon: 'M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5l6.5-.5z'
  },
  {
    id: 'masks',
    name: 'Masks',
    short: 'Masks',
    desc: 'Brush, gradients, lasso and ranges, each with its own adjustments.',
    icon: 'M4 20c2-6 8-6 10-12M16 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0'
  },
  {
    id: 'crop',
    name: 'Crop & Rotate',
    short: 'Crop',
    desc: 'Aspect, straighten, rotate and flip.',
    icon: 'M6 2v16h16M2 6h16v16'
  },
  {
    id: 'calibration',
    name: 'Calibration',
    short: 'Calib',
    desc: 'Shadow tint; red, green and blue primaries.',
    icon: 'M12 3v18M3 12h18M6 6l12 12M18 6 6 18'
  },
  {
    id: 'advanced',
    name: 'Advanced',
    short: 'Engine',
    desc: 'The engine report, the compiled grade, custom layers.',
    icon: 'M8 9l-4 3 4 3M16 9l4 3-4 3M13 5l-2 14'
  }
]

const CROP_SETTLE_MS = 260
let cropTimer: ReturnType<typeof setTimeout> | undefined

/** Canvas tools that belong to the Masks panel. */
export const MASK_TOOLS: Tool[] = ['brush', 'polygon', 'linear', 'radial', 'range-picker']

/**
 * Show a tool in the right column, and keep the canvas in step: choosing
 * Crop & Rotate opens the crop tool; leaving it closes the tool; leaving
 * Masks puts down any mask tool.
 */
export function selectPanel(id: ToolId, opts: { tool?: Tool } = {}): void {
  const ui = useUi.getState()
  const dev = useDevelop.getState()
  const from = ui.panel
  if (from !== id) {
    ui.setPanel(id)
    // Entering or leaving Masks starts or stops the mask thumbnails.
    if ((from === 'masks') !== (id === 'masks')) dev.pushView()
  }
  if (opts.tool !== undefined) {
    clearTimeout(cropTimer)
    dev.setTool(opts.tool)
    return
  }
  clearTimeout(cropTimer)
  if (id === 'crop' && from !== 'crop') {
    // Only once the wheel has come to rest here: turning past Crop must not
    // flip the loupe into the crop view and back.
    cropTimer = setTimeout(() => {
      if (useUi.getState().panel === 'crop') useDevelop.getState().setTool('crop')
    }, CROP_SETTLE_MS)
  } else if (id !== 'crop' && dev.tool === 'crop') dev.setTool('none')
  if (id !== 'masks' && MASK_TOOLS.includes(dev.tool)) dev.setTool('none')
}

/** Turn the wheel one place (wrapping). */
export function stepPanel(dir: 1 | -1): void {
  const i = TOOLS.findIndex((t) => t.id === useUi.getState().panel)
  const next = TOOLS[(i + dir + TOOLS.length) % TOOLS.length]
  selectPanel(next.id)
}
