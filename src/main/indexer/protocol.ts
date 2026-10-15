/** Messages between the main process (`client.ts`) and the index host (`host.ts`). */

export interface IndexRequest {
  kind: 'request'
  id: number
  method: string
  args: unknown[]
}

export type IndexResponse =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | {
      kind: 'response'
      id: number
      ok: false
      /** `values`: what a message for the user names (`{{folder}}`), filled in where it is translated. */
      error: { message: string; code: string; values?: Record<string, string> }
    }

/**
 * What the index finds out on its own, after a call has answered. `sources`:
 * keywords, collections or descriptive metadata changed (the sidebar's lists).
 */
export type IndexEvent =
  /**
   * `photos`: only these photos' facts changed (their EXIF or sidecar read
   * in), not what the folder holds; without it, the listing itself.
   */
  | { name: 'changed'; folder: string; photos?: number[] }
  | { name: 'sources' }
  /** A photo got its project: its original can now be embedded in it (main's job). */
  | { name: 'project'; key: string }

export type HostToMain = { kind: 'hello' } | IndexResponse | ({ kind: 'event' } & IndexEvent)
export type MainToHost = IndexRequest
