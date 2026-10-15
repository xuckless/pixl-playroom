/**
 * Rebuild with the latest develop (an AI job, task `rebuild`;
 * shared/rebuild.ts says what changes). After a Version of the photo as it
 * was ("Before rebuild"): a RAW's denoise goes and its PIXL demosaic master
 * is made; each step to make again is made, in order, on the ones before it
 * (an Enhance or an old denoise by PIXL Enhance, a heal baked again); the
 * masks a model found are found again on the new develop, in place. One
 * History step when it lands, undone like any.
 *
 * The other runners do the work: they are called here in turn (`inline`),
 * not queued as jobs of their own, which would wait behind this one.
 */
import log from 'electron-log/main'
import type { AiResult, AiStage, AiStartRequest } from '../shared/ai'
import { t, tk } from '../shared/i18n'
import { lensCorrection } from '../shared/lens'
import { activeSteps, type PixelStep } from '../shared/pixels'
import { rebuildPlan } from '../shared/rebuild'
import type { BrushComponent, MaskComponentSetting, Recipe } from '../shared/recipe'
import type { RetouchSpot } from '../shared/retouch'
import { Cancelled, type AiContext, type AiRunner } from './ai/jobs'
import { askOf } from './ai/rawdevelop'
import { stepDevelopMark } from './developmark'
import type { EngineClient } from './engine/client'
import { keyOf, parseKey } from './keys'
import type { Library } from './library'
import { pipeline } from './pipeline'
import { ensureBase, pixelDeps } from './pixels/base'
import { freezeMask } from './pixels/freeze'
import { bakeSpot } from './pixels/heal'
import { replacePixelStep } from './pixels/steps'
import { ensureWorking } from './pixels/working'
import { ensureMaster, viewProxies } from './proxy'
import type { DevelopSessions } from './render'
import { colourOf, isLinearRaw, seedOf, versionStamp } from './source'
import { exposureOffsetOf } from '../shared/rawcolour'

type RebuildRequest = Extract<AiStartRequest, { task: 'rebuild' }>

/** A model mask's request again, landing in place of the component that holds it. */
export function findAgain(
  key: string,
  layerId: string,
  c: MaskComponentSetting
): AiStartRequest | null {
  const into = { layerId, mode: c.mode, replace: c.id }
  if (c.kind === 'depth') return { task: 'segment', key, target: 'depth', into }
  if (c.kind !== 'brush' || !c.source) return null
  const s = (c as BrushComponent).source!
  switch (s.kind) {
    case 'segment':
      return { task: 'segment', key, target: s.target, into, ...(s.fine ? { fine: true } : {}) }
    case 'person':
      return { task: 'segment', key, target: s.part as never, into }
    case 'phrase':
      return { task: 'segment', key, target: 'phrase', phrase: s.text, into }
    case 'prompt':
      return s.prompt && s.via
        ? {
            task: 'prompt',
            key,
            prompt: s.prompt,
            via: s.via,
            into,
            ...(s.label ? { label: s.label } : {})
          }
        : null
  }
}

export class RebuildRunner implements AiRunner<RebuildRequest> {
  readonly task = 'rebuild' as const

  constructor(
    private readonly library: Library,
    private readonly engine: EngineClient,
    private readonly sessions: () => DevelopSessions | undefined,
    /** Another job's work run here, its result applied (a mask) as a job's would be. */
    private readonly inline: (req: AiStartRequest, ctx: AiContext) => Promise<AiResult>
  ) {}

  stages(): AiStage[] {
    return [
      { id: 'develop', label: t('Developing'), weight: 0.25 },
      { id: 'steps', label: t('Making the steps again'), weight: 0.6 },
      { id: 'masks', label: t('Finding the masks again'), weight: 0.15 }
    ]
  }

  title(): { title: string; subject?: string } {
    return { title: t('Rebuilding with the latest develop') }
  }

  async run(ctx: AiContext, req: RebuildRequest): Promise<AiResult> {
    const { key } = req
    const sessions = this.sessions()
    const row = await this.library.photoRow(key)
    const info = await this.library.probe(row)
    const isRaw = row.is_raw === 1
    const recipe: Recipe = sessions?.liveRecipe(key) ?? (await this.library.recipe(key))
    const today = await pipeline()
    const mark = isRaw ? await stepDevelopMark(row, info, askOf(recipe)) : null
    const plan = rebuildPlan(recipe, isRaw, today, mark)
    // The photo as it was, to come back to.
    await this.library.addVersion(key, {
      name: tk('Before rebuild'),
      kind: 'auto',
      reason: 'rebuild',
      recipe
    })
    ctx.stage('develop', 0, t('Developing'))
    await this.keep(key, plan.recipe)
    // A RAW's new develop, made once: every step below is made on it.
    if (isRaw && today.pixlDemosaic && !isLinearRaw(info))
      await ensureMaster(this.engine, row, info, askOf(plan.recipe))
    if (ctx.signal.aborted) throw new Cancelled()

    ctx.stage('steps', 0, t('Making the steps again'))
    for (const [i, r] of plan.redo.entries()) {
      if (ctx.signal.aborted) throw new Cancelled()
      const sub = this.part(ctx, i, plan.redo.length)
      if (r.kind === 'enhance')
        await this.inline({ task: 'enhance', key, settings: r.settings, redo: r.id }, sub)
      else await this.rebake(key, r.id)
    }

    ctx.stage('masks', 0, t('Finding the masks again'))
    const now = sessions?.liveRecipe(key) ?? (await this.library.recipe(key))
    for (const [i, m] of plan.masks.entries()) {
      if (ctx.signal.aborted) throw new Cancelled()
      const c = now.layers
        .find((l) => l.id === m.layerId)
        ?.components.find((x) => x.id === m.componentId)
      const again = c && findAgain(key, m.layerId, c)
      if (!again) continue
      try {
        await this.inline(again, this.part(ctx, i, plan.masks.length))
      } catch (err) {
        // A mask its model cannot find again keeps the one it had.
        if (ctx.signal.aborted) throw err
        log.warn('rebuild: a mask was not found again', key, (err as Error).message)
      }
    }
    ctx.commit()
    const { photoId, copyId } = parseKey(key)
    this.library.queueThumb(photoId, copyId, true)
    return { kind: 'step', label: tk('Rebuild') }
  }

  /** A sub-job's view of this job: its progress a share of the stage, its stages not its own. */
  private part(ctx: AiContext, i: number, n: number): AiContext {
    return {
      ...ctx,
      stage: () => undefined,
      progress: (p, estimated) => ctx.progress((i + Math.min(1, Math.max(0, p))) / n, estimated),
      // Kept as the rebuild goes: a Cancel stops it between parts, not after the first.
      commit: () => {
        if (ctx.signal.aborted) throw new Cancelled()
      }
    }
  }

  /** The recipe kept: into the open photo's session, or its saved recipe. */
  private async keep(key: string, recipe: Recipe): Promise<void> {
    const sessions = this.sessions()
    if (sessions?.liveRecipe(key)) {
      sessions.update(key, recipe, false)
      await sessions.flush(key)
      await sessions.workingReady(key)
    } else await this.library.saveRecipe(key, recipe)
  }

  /** A heal baked again on the new develop, in its place (shared/rebuild.ts's `heal`). */
  private async rebake(key: string, id: string): Promise<void> {
    const sessions = this.sessions()
    const recipe = sessions?.liveRecipe(key) ?? (await this.library.recipe(key))
    const old = recipe.pixels.find((p) => p.id === id)
    if (!old || typeof old.params.geometry !== 'string') return
    const spot = JSON.parse(old.params.geometry) as RetouchSpot
    const layerId = old.scope ? (recipe.layers.find((l) => l.name === old.scope)?.id ?? null) : null
    const under = activeSteps(recipe.pixels.slice(0, recipe.pixels.indexOf(old)))
    const row = await this.library.photoRow(key)
    const info = await this.library.probe(row)
    const isRaw = row.is_raw === 1
    const deps = pixelDeps(this.engine, this.library.index, row)
    const px = await viewProxies(this.engine, row, info, askOf(recipe))
    const set = await ensureWorking(deps, versionStamp(row), px, under, () =>
      ensureBase(this.engine, row, info, askOf(recipe))
    )
    const master = set.master!
    const freezeCtx = {
      photoId: row.id,
      isRaw,
      asShot: info.as_shot_white,
      exposureOffset: exposureOffsetOf(colourOf(row)),
      seed: seedOf(row),
      master
    }
    const fresh: PixelStep | null = await bakeSpot(
      {
        ...freezeCtx,
        deps,
        recipe,
        lens: lensCorrection(recipe.lens),
        freeze: (r, l) => freezeMask(deps, freezeCtx, r, l),
        store: (file, i) => this.library.index.putBlob(keyOf(row.id, null), file, i)
      },
      spot,
      layerId
    )
    // A stroke that changes nothing on the new develop keeps its old patch.
    if (!fresh) return
    await replacePixelStep(this.library, sessions, key, {
      ...old,
      blob: fresh.blob,
      rect: fresh.rect,
      width: fresh.width,
      height: fresh.height,
      params: {
        ...old.params,
        ...fresh.params,
        ...(isRaw ? { develop: await stepDevelopMark(row, info, askOf(recipe)) } : {})
      }
    })
  }
}
