/**
 * Where projects or exports are saved (shared/locations.ts): the same three
 * choices for each, the folder they name shown as it is on this computer,
 * and a button that opens it. One setting each, so Settings, the question
 * asked once and the Export dialog all show and change the same thing.
 */
import {
  locationMode,
  type LocationKind,
  type LocationsInfo,
  type SaveLocation
} from '../../../shared/locations'
import { api, errorText } from '../lib/api'
import { t } from '../lib/i18n'
import { revealLabel } from '../lib/menus'
import { useLibrary } from '../state/library'
import { Select } from './ui'

/** The three choices for one kind, the folder chosen, and a button to open it. */
export function LocationField({
  kind,
  info,
  save
}: {
  kind: LocationKind
  info: LocationsInfo
  save: (kind: LocationKind, v: SaveLocation) => void
}): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const { location, path } = info[kind]
  const choose = async (): Promise<void> => {
    const folder = await api.library.chooseFolder()
    if (folder) save(kind, { folder })
  }
  const mode = locationMode(location)
  return (
    <>
      <Select
        label={kind === 'projects' ? t('Make projects') : t('Save exports')}
        value={mode}
        options={[
          {
            value: 'beside',
            label: kind === 'projects' ? t('Beside the photo') : t('Beside the original')
          },
          {
            value: 'home',
            label:
              kind === 'projects'
                ? t('In the Pixl Projects folder')
                : t('In the Pixl Projects folder, under Exports')
          },
          { value: 'folder', label: t('In a folder of my choice…') }
        ]}
        onChange={(v) => {
          if (v === 'folder') void choose()
          else save(kind, v)
        }}
      />
      {path && (
        <div className="prefs-row location-path">
          <span className="muted small" title={path}>
            {path}
          </span>
          {mode === 'folder' && <button onClick={() => void choose()}>{t('Change…')}</button>}
          <button
            onClick={() => void api.app.showLocation(kind).catch((e) => say(errorText(e), 'error'))}
          >
            {revealLabel()}
          </button>
        </div>
      )}
    </>
  )
}
