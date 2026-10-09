/**
 * The recipe field a slider's `read` takes, as a dotted path
 * (`(r) => r.hsl[b][axis]` reads `hsl.blue.luminance`): its getter is run on
 * a stand-in that writes down each property asked for. Lets a row be matched
 * to what the engine said broke, without each slider naming its field.
 */
export function readPath(read: (r: never) => unknown): string {
  const keys: string[] = []
  const stand: object = new Proxy(() => 0, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => 0
      if (typeof k === 'string') keys.push(k)
      return stand
    }
  })
  try {
    read(stand as never)
  } catch {
    // A getter that does more than read: whatever it reached is the path.
  }
  return keys.join('.')
}
