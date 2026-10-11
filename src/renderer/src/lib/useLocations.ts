/**
 * Where projects and exports are saved, for what shows the choice (Settings,
 * the question asked once, the Export dialog): one setting each in the
 * index, so all of them read and change the same thing.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  LOCATION_SETTING,
  type LocationKind,
  type LocationsInfo,
  type SaveLocation
} from '../../../shared/locations'
import { api, errorText } from './api'
import { useLibrary } from '../state/library'

/** Each location and the folder it is now, read once and again after every change. */
export function useLocations(): {
  info: LocationsInfo | null
  save: (kind: LocationKind, v: SaveLocation) => void
} {
  const say = useLibrary((s) => s.say)
  const [info, setInfo] = useState<LocationsInfo | null>(null)
  const load = useCallback(
    () =>
      api.app.locations().then(setInfo, (e) => {
        say(errorText(e), 'error')
      }),
    [say]
  )
  useEffect(() => void load(), [load])
  const save = useCallback(
    (kind: LocationKind, v: SaveLocation): void => {
      // Shown at once; the folder it names follows from main.
      setInfo((i) => (i ? { ...i, [kind]: { location: v, path: i[kind].path } } : i))
      void api.app
        .setSetting(LOCATION_SETTING[kind], v)
        .catch((e) => say(errorText(e), 'error'))
        .then(load)
    },
    [say, load]
  )
  return { info, save }
}
