/**
 * The wheel remembers its tool per photo: turning to HSL on one photo and
 * Masks on another brings each back when it is opened again. Kept in the
 * index's settings (per machine, like the edit history), most recent last,
 * capped so it never grows without bound.
 */
import { api } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useUi, type ToolId } from '../state/ui'
import { selectPanel, TOOLS } from './tools'

const SETTING = 'wheel.byPhoto'
const LIMIT = 500

let memory: Promise<Map<string, ToolId>> | null = null
let writeTimer: ReturnType<typeof setTimeout> | undefined

function load(): Promise<Map<string, ToolId>> {
  memory ??= api.app
    .getSetting<[string, ToolId][]>(SETTING)
    .then((rows) => new Map(Array.isArray(rows) ? rows : []))
    .catch(() => new Map())
  return memory
}

async function remember(key: string, panel: ToolId): Promise<void> {
  const map = await load()
  if (map.get(key) === panel) return
  // Re-insert so the map's order is least recently changed first.
  map.delete(key)
  map.set(key, panel)
  while (map.size > LIMIT) map.delete(map.keys().next().value as string)
  clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    void api.app.setSetting(SETTING, [...map]).catch(() => {})
  }, 500)
}

async function recall(key: string): Promise<ToolId | null> {
  const panel = (await load()).get(key)
  // A tool that no longer exists, or Crop (opening straight into the crop
  // view would change the picture under the user), leaves the wheel be.
  if (!panel || panel === 'crop' || !TOOLS.some((t) => t.id === panel)) return null
  return panel
}

/** Start remembering; returns the unsubscribe. Call once, from the app shell. */
export function startWheelMemory(): () => void {
  const offSession = useDevelop.subscribe((s, prev) => {
    const key = s.session?.key
    if (!key || key === prev.session?.key) return
    void recall(key).then((panel) => {
      if (panel && useDevelop.getState().session?.key === key) selectPanel(panel)
    })
  })
  const offPanel = useUi.subscribe((s, prev) => {
    const key = useDevelop.getState().session?.key
    if (key && s.panel !== prev.panel) void remember(key, s.panel)
  })
  return () => {
    offSession()
    offPanel()
  }
}
