/**
 * When background work may use the computer: on mains power, with nobody
 * at it for a while (the owner: Gemma names on import only when idle and on
 * power; the cull signals keep to the same).
 */
import { powerMonitor } from 'electron'

export function idleOnPower(idleSeconds: number): boolean {
  return !powerMonitor.isOnBatteryPower() && powerMonitor.getSystemIdleTime() >= idleSeconds
}
