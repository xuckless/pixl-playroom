/**
 * The fields every convert must state, filled in where a request made
 * outside the builders (`blankRequest`, `gradeInputRequest`,
 * `gpuDragRequest`) left them out: a request without one is refused when
 * the engine reads it.
 *
 * - `grade_device` (0.19.2, Phase A §1.1): the CPU's, as 0.19 was.
 * - `hold_refines` (0.21.0, E62): false, no refine planes held, as before.
 */
export function withRequiredFields(method: string, args: unknown[]): unknown[] {
  if (method !== 'convert') return args
  const [request, ...rest] = args
  if (!request || typeof request !== 'object') return args
  if ('grade_device' in request && 'hold_refines' in request) return args
  return [{ grade_device: 'Cpu', hold_refines: false, ...request }, ...rest]
}
