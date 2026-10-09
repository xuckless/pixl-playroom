/**
 * Gemma's names for the open photo, as chips atop the Masks pane ("building
 * ★, sky, trees, crow"): a tap masks the thing with the tool Playroom's map
 * picks (shared/naming.ts `routeName`), never Gemma's own choice. The user
 * takes a chip off, or types a name, which goes through the same map. Names
 * are suggestions: nothing is masked until a chip is tapped.
 */
import { useEffect, useState } from 'react'
import {
  cleanLabel,
  peopleIn,
  routeName,
  withAdded,
  withRemoved,
  type NamedThing,
  type PhotoNames
} from '../../../../shared/naming'
import { Icon } from '../../components/icons'
import { api, errorText } from '../../lib/api'
import { t } from '../../lib/i18n'
import { useSwitches } from '../../lib/switches'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { startMaskTool, startPhrase } from './model'

/** Mask what a chip names, with Playroom's own tool for it. */
function maskFor(thing: NamedThing, people: number): void {
  const r = routeName(thing, people)
  switch (r.kind) {
    case 'scene':
      return startMaskTool(r.target)
    case 'subject':
      return startMaskTool('subject')
    case 'part':
    case 'face':
      return startMaskTool(`part:${r.part}`)
    case 'person':
      useLibrary.getState().say(t('Click {{name}} on the photo', { name: thing.label }), 'info')
      return startMaskTool('objects')
    case 'phrase':
      return startPhrase(r.text)
  }
}

/** The open photo's chips: a fresh set for each photo. */
export function NameChips(): React.JSX.Element | null {
  const key = useDevelop((s) => s.session?.key ?? null)
  const photoId = useDevelop((s) => s.session?.item.photoId ?? null)
  if (!key || photoId === null) return null
  return <Chips key={key} photoKey={key} photoId={photoId} />
}

function Chips({
  photoKey: key,
  photoId
}: {
  photoKey: string
  photoId: number
}): React.JSX.Element | null {
  const say = useLibrary((s) => s.say)
  const switches = useSwitches()
  const [inBuild, setInBuild] = useState(false)
  const [names, setNames] = useState<PhotoNames | null>(null)
  const [naming, setNaming] = useState(false)
  const [typing, setTyping] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void api.names.get(key).then(
      (n) => live && setNames(n),
      () => undefined
    )
    // Gemma in this build at all (0.4.0-beta ships without it).
    void api.brain.status().then(
      (b) => live && setInBuild(b.supported),
      () => undefined
    )
    const off = api.names.onEvent((e) => {
      if (e.photoId === photoId) setNames(e.names)
    })
    return () => {
      live = false
      off()
    }
  }, [key, photoId])

  const gemma = inBuild && switches?.enabled !== false && switches?.heavy.gemma.on === true
  if (!names && !gemma) return null

  const save = (n: PhotoNames | null): void => {
    setNames(n)
    void api.names.edit(key, n).catch((err) => say(errorText(err), 'error'))
  }
  const nameNow = (): void => {
    setNaming(true)
    void api.names
      .name(key)
      .then((n) => {
        if (n) setNames(n)
        else say(t('Gemma gave no usable names for this photo'), 'info')
      })
      .catch((err) => say(errorText(err), 'error'))
      .finally(() => setNaming(false))
  }
  const addTyped = (): void => {
    const text = typing?.trim()
    setTyping(null)
    if (!text) return
    const n = withAdded(names, text, new Date().toISOString())
    if (!n) return
    save(n)
    const thing = n.things.find((x) => x.label === cleanLabel(text))
    if (thing) maskFor(thing, peopleIn(n.things))
  }
  const things = names?.things ?? []
  const people = peopleIn(things)

  return (
    <div className="name-chips" aria-label={t('Things in this photo')}>
      {things.map((thing) => (
        <span key={thing.label} className={`name-chip${thing.subject ? ' subject' : ''}`}>
          <button
            className="nc-mask"
            title={`${t('Mask {{name}}', { name: thing.label })}${thing.intent ? `: ${thing.intent}` : ''}${thing.user ? '' : ` (${t('named by Gemma')})`}`}
            onClick={() => maskFor(thing, people)}
          >
            {thing.label}
            {thing.subject && <span className="nc-star"> ★</span>}
          </button>
          <button
            className="nc-off"
            aria-label={t('Take {{name}} off', { name: thing.label })}
            title={t('Take it off the list')}
            onClick={() => names && save(withRemoved(names, thing.label))}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      {typing !== null ? (
        <input
          className="nc-type"
          autoFocus
          aria-label={t('Name a thing to mask')}
          placeholder={t('Name a thing…')}
          maxLength={40}
          spellCheck={false}
          value={typing}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={() => setTyping(null)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') addTyped()
            if (e.key === 'Escape') setTyping(null)
          }}
        />
      ) : (
        <button className="nc-add" title={t('Name a thing to mask')} onClick={() => setTyping('')}>
          <Icon name="plus" />
        </button>
      )}
      {!names && gemma && (
        <button className="nc-name" disabled={naming} onClick={nameNow}>
          {naming ? t('Gemma is looking…') : t('Name what’s in it')}
        </button>
      )}
    </div>
  )
}
