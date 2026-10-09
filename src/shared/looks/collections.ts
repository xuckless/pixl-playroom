/**
 * The catalog's shelves. A collection belongs to a family (the browser's
 * chips, in this order: camera colour first); a camera maker's looks are a
 * collection of their own, labelled as inspired by it, never as its.
 */

import { tk } from '../i18n'

export type LookFamily =
  | 'camera'
  | 'cinema'
  | 'film-colour'
  | 'film-bw'
  | 'movies'
  | 'smart'
  | 'bw'
  | 'creative'
  | 'essentials'

export const FAMILIES: { id: LookFamily; label: string }[] = [
  { id: 'camera', label: tk('Camera colour') },
  { id: 'cinema', label: tk('Cinema') },
  { id: 'film-colour', label: tk('Colour film') },
  { id: 'film-bw', label: tk('B&W film') },
  { id: 'movies', label: tk('Movies & TV') },
  { id: 'smart', label: tk('Smart looks') },
  { id: 'bw', label: tk('Black & white') },
  { id: 'creative', label: tk('Creative') },
  { id: 'essentials', label: tk('Essentials') }
]

export interface LookCollection {
  id: string
  label: string
  family: LookFamily
  blurb: string
}

export const COLLECTIONS: LookCollection[] = [
  {
    id: 'camera/fujifilm',
    label: tk('Fujifilm-inspired'),
    family: 'camera',
    blurb: tk('Slide, negative and cinema colour in the spirit of the film simulations.')
  },
  {
    id: 'camera/leica',
    label: tk('Leica-inspired'),
    family: 'camera',
    blurb: tk('Restrained contrast, long highlights and toned monochromes.')
  },
  {
    id: 'camera/hasselblad',
    label: tk('Hasselblad-inspired'),
    family: 'camera',
    blurb: tk('Natural, accurate colour with a gentle film curve.')
  },
  {
    id: 'camera/canon',
    label: tk('Canon-inspired'),
    family: 'camera',
    blurb: tk('Warm, friendly colour and flattering skin.')
  },
  {
    id: 'camera/nikon',
    label: tk('Nikon-inspired'),
    family: 'camera',
    blurb: tk('Picture-control looks, from neutral to the creative set.')
  },
  {
    id: 'camera/sony',
    label: tk('Sony-inspired'),
    family: 'camera',
    blurb: tk('Creative-look styles and cine skin tones.')
  },
  {
    id: 'camera/ricoh',
    label: tk('Ricoh-inspired'),
    family: 'camera',
    blurb: tk('Street looks: positive and negative film, bleach bypass, gritty mono.')
  },
  {
    id: 'camera/panasonic',
    label: tk('Panasonic-inspired'),
    family: 'camera',
    blurb: tk('Classic-neo colour, cine gammas and dynamic monochromes.')
  },
  {
    id: 'camera/other',
    label: tk('More cameras'),
    family: 'camera',
    blurb: tk('OM, Pentax and phone photographic styles.')
  },
  {
    id: 'cinema',
    label: tk('Cinema cameras & print'),
    family: 'cinema',
    blurb: tk('Cine-camera colour science, camera negative and theatre print film.')
  },
  {
    id: 'film/colour',
    label: tk('Colour film stocks'),
    family: 'film-colour',
    blurb: tk('Portrait, consumer, slide and tungsten stocks.')
  },
  {
    id: 'film/instant',
    label: tk('Instant film'),
    family: 'film-colour',
    blurb: tk('Instant colour and mono, fresh and faded.')
  },
  {
    id: 'film/bw',
    label: tk('B&W film stocks'),
    family: 'film-bw',
    blurb: tk('Press, fine-grain and night stocks.')
  },
  {
    id: 'movies',
    label: tk('Movies & TV'),
    family: 'movies',
    blurb: tk('Grades inspired by well-known films and series.')
  },
  {
    id: 'bw',
    label: tk('Black & white'),
    family: 'bw',
    blurb: tk('Filters, toning and printing styles.')
  },
  {
    id: 'creative',
    label: tk('Creative'),
    family: 'creative',
    blurb: tk('Seasons, moods and colour play.')
  },
  {
    id: 'smart',
    label: tk('Smart looks'),
    family: 'smart',
    blurb: tk(
      'Looks that mask as they go: the sky, the subject, skin, a colour, an object; AI denoise.'
    )
  },
  {
    id: 'essentials',
    label: tk('Essentials'),
    family: 'essentials',
    blurb: tk('Everyday starting points.')
  }
]

export const COLLECTION_BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]))
