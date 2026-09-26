/** Messages between the main process (`client.ts`) and the index host (`host.ts`). */

export interface IndexRequest {
  kind: 'request'
  id: number
  method: string
  args: unknown[]
}

export type IndexResponse =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: { message: string; code: string } }

/** What the index finds out on its own, after a call has answered. */
export type IndexEvent = { name: 'changed'; folder: string }

export type HostToMain = { kind: 'hello' } | IndexResponse | ({ kind: 'event' } & IndexEvent)
export type MainToHost = IndexRequest
