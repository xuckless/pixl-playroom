/** Crop aspect presets; "Original" (-1) is the frame's own aspect as the user has turned it. */
export const ASPECTS: { value: string; label: string; ratio: number | null }[] = [
  { value: 'free', label: 'Free', ratio: null },
  { value: 'original', label: 'Original', ratio: -1 },
  { value: '1:1', label: '1 : 1', ratio: 1 },
  { value: '4:5', label: '4 : 5', ratio: 4 / 5 },
  { value: '5:4', label: '5 : 4', ratio: 5 / 4 },
  { value: '3:2', label: '3 : 2', ratio: 3 / 2 },
  { value: '2:3', label: '2 : 3', ratio: 2 / 3 },
  { value: '16:9', label: '16 : 9', ratio: 16 / 9 },
  { value: '9:16', label: '9 : 16', ratio: 9 / 16 }
]

/** The preset a recipe's aspect corresponds to. */
export function aspectValue(aspect: number | null): string {
  if (aspect === null) return 'free'
  return (
    ASPECTS.find((a) => a.ratio !== null && a.ratio > 0 && Math.abs(a.ratio - aspect) < 1e-3)
      ?.value ?? 'original'
  )
}
