/**
 * The colour channels' own colours, from the theme's tokens (styles/tokens.css):
 * one red, green and blue for every histogram, curve and number, and Y (luma,
 * a curve's master) in the ink. CSS values, so in SVG they go in `style`
 * (`style={{ fill }}`), where var() works.
 */
export const CHANNEL_COLOURS = ['var(--ch-r)', 'var(--ch-g)', 'var(--ch-b)'] as const

export const LUMA_COLOUR = 'var(--ch-y)'
