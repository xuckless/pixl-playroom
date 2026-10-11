/**
 * Photos opened on their own (File → Open Photo…, Recent Photos): the
 * library shows only them, not their folders, and the first goes straight
 * to Develop. Their edits are saved where Settings → Projects says, as any
 * photo's are.
 */
import { api, errorText } from './api'
import { t } from './i18n'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

/** Ask for photos (or projects) and open them. */
export async function choosePhotos(): Promise<void> {
  const paths = await api.library.choosePhotos().catch((err) => {
    useLibrary.getState().say(errorText(err), 'error')
    return [] as string[]
  })
  if (paths.length) await openPhotos(paths)
}

/** Open these files (photos, or projects standing for theirs) on their own. */
export async function openPhotos(files: string[]): Promise<void> {
  const lib = useLibrary.getState()
  try {
    const paths = await api.library.photoPaths(files)
    if (paths.length === 0) {
      lib.say(t('Playroom cannot open that file'), 'error')
      return
    }
    if (!(await lib.openSource({ kind: 'photos', paths }))) return
    lib.rememberPhotos(paths)
    const first = useLibrary.getState().items.find((i) => i.path === paths[0] && !i.copyId)
    if (!first) return
    useLibrary.setState({ selection: [first.key], focus: first.key })
    // Its file is not there now (a drive unplugged): shown in the library, as any missing photo is.
    if (first.offline) return
    lib.setView('develop')
    await useDevelop.getState().open(first.key)
  } catch (err) {
    lib.say(errorText(err), 'error')
  }
}
