/**
 * A prompt as an AI job: SAM 2.1 selects what a click, a box or strokes
 * point at (select/service.ts), for a smart look's object or sky and for a
 * photo not open in the develop view. The mask lands like Select Subject's
 * (ai/apply.ts), into the mask it was asked for, its prompt kept on it.
 * The Objects tool on the open photo does not come here: it commits its
 * selection straight into the recipe.
 */
import { midSentence, t } from '../../shared/i18n'
import type { AiResult, AiStartRequest } from '../../shared/ai'
import { estimate } from '../../shared/ai'
import { Cancelled, type AiContext, type AiRunner } from './jobs'
import { ModelMissing, type ModelStore } from './models'
import { SAM_MODEL, type SelectService } from '../select/service'
import { isCancelled } from '../engine/client'

type PromptRequest = Extract<AiStartRequest, { task: 'prompt' }>

/** About how long the encoder takes on a photo's proxy, on the CPU. */
const EMBED_MS = 1500

export class PromptRunner implements AiRunner<PromptRequest> {
  readonly task = 'prompt' as const
  readonly lane = 'select' as const

  constructor(
    private readonly select: SelectService,
    private readonly models: ModelStore
  ) {}

  stages(): { id: string; label: string; weight: number }[] {
    return [
      { id: 'model', label: t('Model'), weight: 0.1 },
      { id: 'analyse', label: t('Analyse'), weight: 0.75 },
      { id: 'refine', label: t('Refine'), weight: 0.15 }
    ]
  }

  title(req: PromptRequest): { title: string; subject: string } {
    return { title: t('Selecting'), subject: req.label ? t(req.label) : t('Object') }
  }

  async run(ctx: AiContext, req: PromptRequest): Promise<Extract<AiResult, { kind: 'mask' }>> {
    ctx.stage('model', 0, t('Loading the model'))
    if (!(await this.models.installed(SAM_MODEL)))
      throw new ModelMissing(this.models.entry(SAM_MODEL))
    let tick: ReturnType<typeof setInterval> | null = null
    try {
      const made = await this.select.oneShot(
        req.key,
        req.prompt,
        { label: req.label, via: req.via },
        ctx.signal,
        (stage) => {
          if (tick) clearInterval(tick)
          if (stage === 'embed') {
            ctx.stage(
              'analyse',
              0,
              t('Finding the {{subject}}', {
                subject: midSentence(req.label ?? 'object')
              })
            )
            const t0 = Date.now()
            tick = setInterval(() => ctx.progress(estimate(Date.now() - t0, EMBED_MS), true), 200)
          } else ctx.stage('refine', 0, t('Refining the edges'))
        }
      )
      return {
        kind: 'mask',
        ref: made.ref,
        width: made.width,
        height: made.height,
        label: req.label ? t(req.label) : t('Object'),
        source: made.source,
        ...(req.into ? { into: { ...req.into } } : {})
      }
    } catch (err) {
      if (ctx.signal.aborted || isCancelled(err)) throw new Cancelled()
      throw err
    } finally {
      if (tick) clearInterval(tick)
    }
  }
}
