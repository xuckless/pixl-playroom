/**
 * The catalog's shelves. A collection belongs to a family (the browser's
 * chips, in this order: camera colour first); a camera maker's looks are a
 * collection of their own, labelled as inspired by it, never as its.
 */

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
  { id: 'camera', label: 'Camera colour' },
  { id: 'cinema', label: 'Cinema' },
  { id: 'film-colour', label: 'Colour film' },
  { id: 'film-bw', label: 'B&W film' },
  { id: 'movies', label: 'Movies & TV' },
  { id: 'smart', label: 'Smart looks' },
  { id: 'bw', label: 'Black & white' },
  { id: 'creative', label: 'Creative' },
  { id: 'essentials', label: 'Essentials' }
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
    label: 'Fujifilm-inspired',
    family: 'camera',
    blurb: 'Slide, negative and cinema colour in the spirit of the film simulations.'
  },
  {
    id: 'camera/leica',
    label: 'Leica-inspired',
    family: 'camera',
    blurb: 'Restrained contrast, long highlights and toned monochromes.'
  },
  {
    id: 'camera/hasselblad',
    label: 'Hasselblad-inspired',
    family: 'camera',
    blurb: 'Natural, accurate colour with a gentle film curve.'
  },
  {
    id: 'camera/canon',
    label: 'Canon-inspired',
    family: 'camera',
    blurb: 'Warm, friendly colour and flattering skin.'
  },
  {
    id: 'camera/nikon',
    label: 'Nikon-inspired',
    family: 'camera',
    blurb: 'Picture-control looks, from neutral to the creative set.'
  },
  {
    id: 'camera/sony',
    label: 'Sony-inspired',
    family: 'camera',
    blurb: 'Creative-look styles and cine skin tones.'
  },
  {
    id: 'camera/ricoh',
    label: 'Ricoh-inspired',
    family: 'camera',
    blurb: 'Street looks: positive and negative film, bleach bypass, gritty mono.'
  },
  {
    id: 'camera/panasonic',
    label: 'Panasonic-inspired',
    family: 'camera',
    blurb: 'Classic-neo colour, cine gammas and dynamic monochromes.'
  },
  {
    id: 'camera/other',
    label: 'More cameras',
    family: 'camera',
    blurb: 'OM, Pentax and phone photographic styles.'
  },
  {
    id: 'cinema',
    label: 'Cinema cameras & print',
    family: 'cinema',
    blurb: 'Cine-camera colour science, camera negative and theatre print film.'
  },
  {
    id: 'film/colour',
    label: 'Colour film stocks',
    family: 'film-colour',
    blurb: 'Portrait, consumer, slide and tungsten stocks.'
  },
  {
    id: 'film/instant',
    label: 'Instant film',
    family: 'film-colour',
    blurb: 'Instant colour and mono, fresh and faded.'
  },
  {
    id: 'film/bw',
    label: 'B&W film stocks',
    family: 'film-bw',
    blurb: 'Press, fine-grain and night stocks.'
  },
  {
    id: 'movies',
    label: 'Movies & TV',
    family: 'movies',
    blurb: 'Grades inspired by well-known films and series.'
  },
  {
    id: 'bw',
    label: 'Black & white',
    family: 'bw',
    blurb: 'Filters, toning and printing styles.'
  },
  {
    id: 'creative',
    label: 'Creative',
    family: 'creative',
    blurb: 'Seasons, moods and colour play.'
  },
  {
    id: 'smart',
    label: 'Smart looks',
    family: 'smart',
    blurb:
      'Looks that mask as they go: the sky, the subject, skin, a colour, an object; AI denoise.'
  },
  {
    id: 'essentials',
    label: 'Essentials',
    family: 'essentials',
    blurb: 'Everyday starting points.'
  }
]

export const COLLECTION_BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]))
