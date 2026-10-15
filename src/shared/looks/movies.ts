/**
 * Grades inspired by well-known films and series, written from what their
 * makers and colourists have said about them and what is on screen. Names
 * are our own; the title is only the `inspiredBy` reference.
 */
import {
  approximates,
  bloom,
  collection,
  gain,
  gamma,
  grain,
  halation,
  hsl,
  hueCurve,
  lift,
  look,
  lumSat,
  matte,
  mono,
  offset,
  presence,
  prim,
  sCurve,
  tone,
  vignette
} from './dsl'
import { tk } from '../i18n'

export const MOVIES = collection('movies', [
  look(
    'rain-city-noir',
    tk('Rain City Noir'),
    {
      tags: ['noir', 'dark', 'moody', 'amber', 'rain', 'the batman', 'batman'],
      inspiredBy: 'The Batman (2022)',
      description: tk('Crushed blacks and amber-red light in a drowned, blue-less city.'),
      version: 2
    },
    sCurve(45),
    tone({ whites: -25, highlights: -25, shadows: -20, blacks: -15 }),
    matte(0, 0.04),
    presence({ saturation: -30 }),
    gamma(28, 25),
    lift(20, 15),
    hueCurve('hueHue', [[30, -1.2]]),
    hueCurve('hueSat', [
      [0, 1.25],
      [30, 1.05],
      [180, 0.4],
      [240, 0.4],
      [120, 0.5],
      [60, 0.7]
    ]),
    hsl({ red: [0, 0, -5], orange: [0, 0, -5], blue: [0, 0, -10] }),
    vignette(-20, { feather: 70 }),
    grain(12, 22, 45)
  ),
  look(
    'bronze-age-epic',
    tk('Bronze Age Epic'),
    {
      tags: ['epic', 'warm', 'large format', 'film', 'the odyssey', 'odyssey', 'nolan', 'imax'],
      inspiredBy: 'The Odyssey (2026), shot on IMAX 65mm film',
      description: tk(
        'Large-format film printed warm: open highlights, rich fire-lit interiors, fine grain.'
      ),
      version: 2
    },
    sCurve(25),
    matte(0, 0.02),
    tone({ highlights: -12 }),
    presence({ saturation: -5 }),
    gamma(30, 20),
    gain(40, 16),
    lift(20, 8),
    hueCurve('hueHue', [
      [240, -1.5],
      [120, 1.5],
      [60, 0.9]
    ]),
    hueCurve('hueSat', [
      [30, 1.05],
      [240, 0.85],
      [120, 0.85],
      [60, 0.91]
    ]),
    grain(4, 12, 25)
  ),
  look(
    'desert-ochre',
    tk('Desert Ochre'),
    {
      tags: ['desert', 'ochre', 'muted', 'epic', 'dune'],
      inspiredBy: 'Dune (2021)',
      description: tk('Ochre haze over muted colour: no green, little blue, soft film texture.'),
      version: 2
    },
    prim({ contrast: 0.97 }),
    matte(0.02),
    presence({ saturation: -28 }),
    offset(35, 18),
    hueCurve('hueSat', [
      [240, 0.7],
      [120, 0.5],
      [60, 0.7]
    ]),
    hsl({ orange: [0, 0, 5] }),
    grain(10, 20, 40)
  ),
  look(
    'golden-spice',
    tk('Golden Spice'),
    {
      tags: ['desert', 'golden', 'warm', 'epic', 'dune', 'part two'],
      inspiredBy: 'Dune: Part Two (2024)',
      description: tk('Hot, golden sand light with firmer contrast.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    presence({ saturation: -10 }),
    offset(35, 20),
    gain(40, 15),
    hueCurve('hueSat', [
      [240, 0.7],
      [120, 0.5],
      [60, 0.7]
    ])
  ),
  look(
    'infrared-arena',
    tk('Infrared Arena'),
    {
      tags: ['bw', 'mono', 'infrared', 'stark', 'dune', 'part two', 'giedi prime'],
      inspiredBy: 'Dune: Part Two (2024), the infrared arena',
      description: tk('Infrared-style mono: glowing skin and foliage, black skies.'),
      version: 3
    },
    mono({ green: 80, yellow: 60, red: 40, orange: 40, blue: -70, aqua: -50 }),
    prim({ contrast: 1.21 }),
    bloom(30)
  ),
  look(
    'orange-haze-city',
    tk('Orange Haze City'),
    {
      tags: ['orange', 'haze', 'dystopia', 'sci-fi', 'blade runner 2049'],
      inspiredBy: 'Blade Runner 2049 (2017), the abandoned city',
      description: tk('Everything drowned in orange dust; only warm colour survives.'),
      version: 3
    },
    prim({ contrast: 0.88 }),
    matte(0.06),
    offset(35, 40),
    lift(30, 30),
    hueCurve('hueSat', [
      [0, 0.7],
      [180, 0.4],
      [240, 0.4],
      [275, 0.4],
      [315, 0.4],
      [120, 0.4],
      [60, 0.64]
    ]),
    tone({ shadows: 5 }),
    bloom(30, { warmth: 40 })
  ),
  look(
    'cold-smog',
    tk('Cold Smog'),
    {
      tags: ['cold', 'smog', 'neon', 'sci-fi', 'blade runner 2049'],
      inspiredBy: 'Blade Runner 2049 (2017), the city at night',
      description: tk('Cold, smoggy and drained, with neon magentas left alive.'),
      version: 3
    },
    prim({ contrast: 0.94 }),
    matte(0.05),
    presence({ saturation: -40 }),
    lift(200, 20),
    gamma(210, 8),
    hueCurve('hueSat', [
      [315, 1.4],
      [275, 1.3]
    ]),
    tone({ shadows: 3 }),
    bloom(20, { warmth: -30 }),
    grain(6, 15, 30)
  ),
  look(
    'wasteland-teal-orange',
    tk('Wasteland Teal Orange'),
    {
      tags: ['teal', 'orange', 'saturated', 'desert', 'action', 'mad max', 'fury road'],
      inspiredBy: 'Mad Max: Fury Road (2015)',
      description: tk('Blazing orange desert against hard teal sky, everything turned up.'),
      version: 2
    },
    prim({ contrast: 1.18, sat: 35 }),
    tone({ blacks: -5 }),
    presence({ clarity: 15 }),
    hueCurve('hueHue', [[240, -6]]),
    hueCurve('hueSat', [
      [30, 1.3],
      [180, 1.25],
      [240, 1.3]
    ]),
    hsl({ orange: [0, 0, -5] })
  ),
  look(
    'black-and-chrome-wasteland',
    tk('Black & Chrome Wasteland'),
    {
      tags: ['bw', 'mono', 'desert', 'contrast', 'mad max', 'fury road', 'black and chrome'],
      inspiredBy: 'Mad Max: Fury Road — Black & Chrome Edition',
      description: tk('Bright sand and skin against black skies, hard and bright.'),
      version: 2
    },
    mono({ orange: 30, yellow: 20, blue: -50, aqua: -40 }),
    prim({ contrast: 1.3 }),
    presence({ clarity: 20 })
  ),
  look(
    'code-green',
    tk('Code Green'),
    {
      tags: ['green', 'sci-fi', 'cyberpunk', 'the matrix', 'matrix'],
      inspiredBy: 'The Matrix (1999), inside the code',
      description: tk('A sickly green cast over hard contrast, reds and blues drained.'),
      version: 2
    },
    prim({ contrast: 1.15 }),
    tone({ blacks: -10 }),
    presence({ saturation: -35 }),
    offset(120, 12),
    gamma(115, 30),
    lift(125, 25),
    hueCurve('hueSat', [
      [0, 0.6],
      [240, 0.6]
    ])
  ),
  look(
    'steel-blue-reality',
    tk('Steel Blue Reality'),
    {
      tags: ['blue', 'cold', 'sci-fi', 'the matrix', 'matrix'],
      inspiredBy: 'The Matrix (1999), the real world',
      description: tk('Cold steel blue over muted colour.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    presence({ saturation: -30 }),
    offset(215, 20)
  ),
  look(
    'sickly-stairway',
    tk('Sickly Stairway'),
    {
      tags: ['sickly', 'green', 'yellow', 'gritty', 'joker'],
      inspiredBy: 'Joker (2019)',
      description: tk('Sodium-lit city: green-teal shadows and nicotine highlights.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: -15 }),
    lift(165, 15),
    gain(55, 12),
    hueCurve('hueSat', [
      [120, 1.05],
      [60, 1.05]
    ]),
    grain(15, 25, 50)
  ),
  look(
    'atomic-colour',
    tk('Atomic Colour'),
    {
      tags: ['film', 'warm', 'large format', 'period', 'oppenheimer', 'nolan'],
      inspiredBy: 'Oppenheimer (2023), the colour sequences',
      description: tk('Warm large-format print with dense blacks.'),
      version: 2
    },
    sCurve(30),
    tone({ blacks: -5 }),
    presence({ saturation: 5 }),
    gain(40, 10),
    hueCurve('hueSat', [[30, 1.05]]),
    grain(4, 12, 25)
  ),
  look(
    'atomic-mono',
    tk('Atomic Mono'),
    {
      tags: ['bw', 'mono', 'contrast', 'large format', 'oppenheimer', 'nolan'],
      inspiredBy: 'Oppenheimer (2023), the black-and-white sequences',
      description: tk('Hard, bright, large-format black and white.'),
      version: 2
    },
    mono({ red: -6, orange: -4, blue: 6 }),
    sCurve(50),
    prim({ contrast: 1.12 }),
    tone({ whites: 25, highlights: 10, blacks: -5 }),
    presence({ clarity: 10 }),
    grain(8, 12, 25)
  ),
  look(
    'dust-and-ice',
    tk('Dust & Ice'),
    {
      tags: ['dust', 'film', 'sci-fi', 'muted', 'interstellar', 'nolan'],
      inspiredBy: 'Interstellar (2014)',
      description: tk('Dusty, warm and slightly muted, on film.'),
      version: 2
    },
    sCurve(20),
    presence({ saturation: -15 }),
    offset(40, 12),
    lift(200, 10),
    hueCurve('hueHue', [
      [120, 3],
      [60, 1.8]
    ]),
    hueCurve('hueSat', [
      [240, 0.8],
      [120, 0.8],
      [60, 0.88]
    ]),
    grain(8, 18, 35)
  ),
  look(
    'border-desert',
    tk('Border Desert'),
    {
      tags: ['desert', 'thriller', 'hard', 'muted', 'sicario'],
      inspiredBy: 'Sicario (2015)',
      description: tk('Hard desert light, deep blacks and muted warmth.'),
      version: 2
    },
    prim({ contrast: 1.15 }),
    tone({ blacks: -10 }),
    presence({ saturation: -25 }),
    offset(35, 10),
    lift(30, 8)
  ),
  look(
    'neon-drive',
    tk('Neon Drive'),
    {
      tags: ['neon', 'night', 'magenta', 'teal', 'synthwave', 'drive'],
      inspiredBy: 'Drive (2011)',
      description: tk('Teal night and hot magenta neon, warm skin.'),
      version: 3
    },
    prim({ contrast: 1.09 }),
    lift(190, 20),
    hueCurve('hueHue', [[315, 3]]),
    hueCurve('hueSat', [
      [315, 1.3],
      [275, 1.2],
      [30, 1.05]
    ]),
    bloom(30, { style: 'glow', threshold: 70, size: 55 })
  ),
  look(
    'green-and-gold-whimsy',
    tk('Green & Gold Whimsy'),
    {
      tags: ['whimsical', 'green', 'gold', 'red', 'paris', 'amelie'],
      inspiredBy: 'Amélie (2001)',
      description: tk('Green and gold everywhere, bright reds, the blues all but gone.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: 10 }),
    gamma(70, 20),
    gain(45, 15),
    hueCurve('hueHue', [
      [240, -7.5],
      [120, -3],
      [60, -1.8]
    ]),
    hueCurve('hueSat', [
      [0, 1.2],
      [240, 0.7],
      [120, 1.15],
      [60, 1.09]
    ])
  ),
  look(
    'crimson-melancholy',
    tk('Crimson Melancholy'),
    {
      tags: ['red', 'romantic', 'moody', 'hong kong', 'in the mood for love', 'wong kar-wai'],
      inspiredBy: 'In the Mood for Love (2000)',
      description: tk('Deep reds and emerald greens under warm lamplight.'),
      version: 3
    },
    prim({ contrast: 1.15 }),
    tone({ blacks: -5 }),
    offset(35, 12),
    hueCurve('hueHue', [
      [120, 3],
      [60, 1.8]
    ]),
    hueCurve('hueSat', [
      [0, 1.3],
      [120, 1.1],
      [60, 1.06]
    ]),
    hsl({ red: [0, 0, -10] }),
    bloom(15, { warmth: 20 }),
    grain(20, 25, 50)
  ),
  look(
    'neon-grain-nights',
    tk('Neon Grain Nights'),
    {
      tags: ['neon', 'night', 'grain', 'hong kong', 'chungking express', 'wong kar-wai'],
      inspiredBy: 'Chungking Express (1994) and Fallen Angels (1995)',
      description: tk('Green-cast night, smeared neon reds and rough grain.'),
      version: 3
    },
    prim({ contrast: 1.18 }),
    lift(160, 20),
    hueCurve('hueSat', [[0, 1.2]]),
    bloom(25, { style: 'glow', threshold: 70, size: 55 }),
    grain(45, 40, 75)
  ),
  look(
    'pastel-hotel',
    tk('Pastel Hotel'),
    {
      tags: ['pastel', 'pink', 'symmetry', 'whimsical', 'grand budapest', 'wes anderson'],
      inspiredBy: 'The Grand Budapest Hotel (2014)',
      description: tk('Candy pinks and lavender, bright and storybook.'),
      version: 2
    },
    prim({ contrast: 0.97 }),
    presence({ saturation: 15 }),
    offset(35, 6),
    hueCurve('hueHue', [[0, 3]]),
    hueCurve('hueSat', [
      [275, 1.3],
      [315, 1.3]
    ]),
    hsl({ red: [0, 0, 10], aqua: [0, 0, 10], purple: [0, 0, 10], magenta: [0, 0, 10] })
  ),
  look(
    'rain-rot',
    tk('Rain Rot'),
    {
      tags: ['dark', 'gritty', 'rain', 'thriller', 'silver retention', 'se7en', 'fincher'],
      inspiredBy: 'Se7en (1995)',
      description: tk('Silver-retained: crushed blacks, drained colour, a sour yellow-green.'),
      version: 2
    },
    sCurve(45),
    prim({ contrast: 1.12 }),
    tone({ blacks: -10 }),
    presence({ saturation: -40 }),
    gamma(70, 12),
    grain(25, 28, 55)
  ),
  look(
    'cyan-rot',
    tk('Cyan Rot'),
    {
      tags: ['cyan', 'green', 'grimy', 'fight club', 'fincher'],
      inspiredBy: 'Fight Club (1999)',
      description: tk('Grimy cyan-green shadows and dirty yellow highlights.'),
      version: 2
    },
    prim({ contrast: 1.18 }),
    presence({ saturation: -30 }),
    lift(160, 20),
    gain(60, 10),
    grain(20, 25, 50)
  ),
  look(
    'amber-dorm',
    tk('Amber Dorm'),
    {
      tags: ['amber', 'warm', 'dim', 'drama', 'the social network', 'fincher'],
      inspiredBy: 'The Social Network (2010)',
      description: tk('Dim amber interiors with the blues held right down.'),
      version: 2
    },
    tone({ whites: -20, highlights: -15 }),
    matte(0, 0.02),
    gamma(50, 22),
    hueCurve('hueHue', [[240, -3]]),
    hueCurve('hueSat', [[240, 0.6]])
  ),
  look(
    'interrogation-olive',
    tk('Interrogation Olive'),
    {
      tags: ['olive', 'muted', 'period', 'crime', 'mindhunter', 'zodiac', 'fincher'],
      inspiredBy: 'Mindhunter (2017–2019) and Zodiac (2007)',
      description: tk('Muted olive-yellow period tone, blues pulled back.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: -25 }),
    gamma(75, 15),
    hueCurve('hueSat', [[240, 0.7]])
  ),
  look(
    'miami-cyan',
    tk('Miami Cyan'),
    {
      tags: ['cyan', 'saturated', 'skin', 'night', 'moonlight'],
      inspiredBy: 'Moonlight (2016)',
      description: tk('Saturated cyans and teals with rich, deep skin.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    presence({ saturation: 15 }),
    lift(185, 20),
    gain(40, 8),
    hueCurve('hueSat', [
      [30, 1.1],
      [180, 1.2]
    ]),
    hsl({ orange: [0, 0, -8] })
  ),
  look(
    'coral-warmth',
    tk('Coral Warmth'),
    {
      tags: ['coral', 'warm', 'soft', 'romantic', 'her'],
      inspiredBy: 'Her (2013)',
      description: tk('Soft coral reds and peaches, no blue at all.'),
      version: 3
    },
    prim({ contrast: 0.91 }),
    matte(0.03),
    offset(25, 10),
    hueCurve('hueHue', [
      [0, 1.5],
      [30, 1.5]
    ]),
    hueCurve('hueSat', [
      [0, 1.15],
      [30, 1.15],
      [240, 0.4],
      [180, 0.6]
    ]),
    tone({ shadows: 4 }),
    bloom(25, { warmth: 25 })
  ),
  look(
    'golden-hour-jet',
    tk('Golden Hour Jet'),
    {
      tags: ['golden hour', 'action', 'warm', 'teal sky', 'top gun', 'maverick'],
      inspiredBy: 'Top Gun: Maverick (2022)',
      description: tk('Big golden-hour warmth against teal sky.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    lift(205, 12),
    gain(40, 22),
    hueCurve('hueHue', [[240, -3]]),
    hueCurve('hueSat', [[30, 1.2]])
  ),
  look(
    'neon-assassin',
    tk('Neon Assassin'),
    {
      tags: ['neon', 'night', 'action', 'teal', 'magenta', 'john wick'],
      inspiredBy: 'John Wick: Chapters 2–4',
      description: tk('Inky blacks, teal shadows and saturated neon.'),
      version: 2
    },
    prim({ contrast: 1.18 }),
    tone({ blacks: -10 }),
    lift(190, 25),
    hueCurve('hueHue', [[240, -4.5]]),
    hueCurve('hueSat', [
      [315, 1.3],
      [275, 1.2],
      [30, 0.9]
    ])
  ),
  look(
    'club-purple',
    tk('Club Purple'),
    {
      tags: ['purple', 'neon', 'party', 'teen', 'euphoria'],
      inspiredBy: 'Euphoria (2019–)',
      description: tk('Purple and magenta club light, saturated and grainy.'),
      version: 3
    },
    prim({ contrast: 1.12 }),
    presence({ saturation: 20 }),
    lift(275, 20),
    gain(320, 10),
    hueCurve('hueSat', [
      [275, 1.3],
      [315, 1.3]
    ]),
    halation(20),
    grain(15, 22, 45)
  ),
  look(
    'dream-pink',
    tk('Dream Pink'),
    {
      tags: ['pink', 'saturated', 'bright', 'plastic', 'barbie'],
      inspiredBy: 'Barbie (2023)',
      description: tk('Bright, saturated and very, very pink.'),
      version: 2
    },
    prim({ contrast: 1.06, sat: 30 }),
    tone({ whites: 10 }),
    hueCurve('hueHue', [
      [0, 4.5],
      [275, 3]
    ]),
    hueCurve('hueSat', [
      [0, 1.2],
      [315, 1.35],
      [275, 1.2]
    ])
  ),
  look(
    'eighties-small-town',
    tk('Eighties Small Town'),
    {
      tags: ['80s', 'nostalgic', 'warm', 'night blue', 'stranger things'],
      inspiredBy: 'Stranger Things (2016–2025)',
      description: tk('Warm interiors, blue nights and soft film blacks.'),
      version: 2
    },
    matte(0.03),
    prim({ contrast: 1.06 }),
    presence({ saturation: 8 }),
    gamma(40, 16),
    lift(215, 22),
    hueCurve('hueSat', [[0, 1.12]]),
    grain(15, 22, 45)
  ),
  look(
    'tobacco-desert',
    tk('Tobacco Desert'),
    {
      tags: ['yellow', 'desert', 'warm', 'crime', 'breaking bad'],
      inspiredBy: 'Breaking Bad (2008–2013)',
      description: tk('Heavy tobacco yellow under vivid desert-blue sky.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    gamma(48, 35),
    gain(50, 25),
    hueCurve('hueHue', [[240, -1.5]]),
    hueCurve('hueSat', [[240, 1.2]])
  ),
  look(
    'sepia-dust-bowl',
    tk('Sepia Dust Bowl'),
    {
      tags: ['sepia', 'dust', 'yellow', 'period', 'o brother'],
      inspiredBy: 'O Brother, Where Art Thou? (2000)',
      description: tk('Green foliage turned to dry gold under a sepia cast.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: -15 }),
    offset(45, 25),
    hueCurve('hueHue', [
      [180, -6],
      [120, -12],
      [60, -7.2]
    ]),
    hueCurve('hueSat', [
      [180, 0.6],
      [120, 0.4],
      [60, 0.64]
    ])
  ),
  look(
    'yellow-border',
    tk('Yellow Border'),
    {
      tags: ['yellow', 'hot', 'grainy', 'crime', 'traffic'],
      inspiredBy: 'Traffic (2000)',
      description: tk('Blown, burning yellow and heavy grain.'),
      version: 2
    },
    prim({ contrast: 1.24 }),
    presence({ saturation: -20 }),
    offset(50, 40),
    grain(40, 38, 70)
  ),
  look(
    'frozen-natural',
    tk('Frozen Natural'),
    {
      tags: ['cold', 'natural light', 'winter', 'wilderness', 'the revenant'],
      inspiredBy: 'The Revenant (2015)',
      description: tk('Cold natural light, muted colour, blue-steel shadows.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: -30 }),
    lift(210, 12),
    hueCurve('hueSat', [[30, 0.9]])
  ),
  look(
    'bleach-war',
    tk('Bleach War'),
    {
      tags: ['war', 'bleach bypass', 'gritty', 'desaturated', 'saving private ryan'],
      inspiredBy: 'Saving Private Ryan (1998)',
      description: tk('Drained, harsh and grainy: colour almost gone.'),
      version: 2
    },
    sCurve(45),
    prim({ contrast: 1.12 }),
    tone({ whites: 15, blacks: -5 }),
    presence({ saturation: -60 }),
    lift(190, 8),
    grain(35, 32, 65),
    // Silver left in: the ends lose colour first.
    lumSat([
      [0, 0.7],
      [0.35, 1],
      [0.65, 1],
      [1, 0.7]
    ])
  ),
  look(
    'wartime-mono',
    tk('Wartime Mono'),
    {
      tags: ['bw', 'mono', 'period', 'drama', "schindler's list"],
      inspiredBy: "Schindler's List (1993)",
      description: tk(
        'Documentary black and white. (The film’s single red coat needs a colour mask.)'
      ),
      version: 2
    },
    mono({ red: -10, orange: -6 }),
    sCurve(25),
    prim({ contrast: 1.06 }),
    tone({ highlights: -15, shadows: -8 }),
    matte(0.02),
    grain(25, 28, 55),
    approximates('selectiveColour')
  ),
  look(
    'frontier-dust',
    tk('Frontier Dust'),
    {
      tags: ['western', 'dust', 'sci-fi', 'warm', 'the mandalorian'],
      inspiredBy: 'The Mandalorian (2019–)',
      description: tk('A dusty, warm western with soft blacks.'),
      version: 2
    },
    prim({ contrast: 1.03 }),
    matte(0.02),
    presence({ saturation: -15 }),
    offset(35, 12),
    grain(8, 18, 35)
  ),
  look(
    'patriarch-amber',
    tk('Patriarch Amber'),
    {
      tags: ['amber', 'dark', 'period', 'crime', 'the godfather'],
      inspiredBy: 'The Godfather (1972)',
      description: tk('Dark amber interiors and deep, falling-off shadows.'),
      version: 2
    },
    prim({ contrast: 1.15 }),
    tone({ whites: -20, highlights: -15, blacks: -10 }),
    presence({ saturation: -10 }),
    gamma(45, 25),
    grain(20, 25, 50)
  ),
  look(
    'grey-dystopia',
    tk('Grey Dystopia'),
    {
      tags: ['grey', 'desaturated', 'dystopia', 'bleak', 'children of men'],
      inspiredBy: 'Children of Men (2006)',
      description: tk('Bleak, grey and almost colourless.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: -45 }),
    lift(170, 10),
    grain(20, 25, 50)
  ),
  look(
    'tokyo-hush',
    tk('Tokyo Hush'),
    {
      tags: ['soft', 'night', 'city', 'dreamy', 'lost in translation'],
      inspiredBy: 'Lost in Translation (2003)',
      description: tk('Soft, hushed city nights with pink and blue neon.'),
      version: 3
    },
    prim({ contrast: 0.91, sat: -5 }),
    matte(0.03),
    hueCurve('hueSat', [
      [315, 1.15],
      [240, 1.15]
    ]),
    tone({ shadows: 3 }),
    bloom(20),
    grain(12, 20, 40)
  ),
  look(
    'milky-overcast',
    tk('Milky Overcast'),
    {
      tags: ['overcast', 'muted', 'soft', 'sci-fi', 'arrival'],
      inspiredBy: 'Arrival (2016)',
      description: tk('Milky, overcast and nearly colourless.'),
      version: 2
    },
    prim({ contrast: 0.85 }),
    matte(0.07, 0.03),
    presence({ saturation: -35 }),
    offset(180, 5)
  ),
  look(
    'kitchen-heat',
    tk('Kitchen Heat'),
    {
      tags: ['kitchen', 'warm', 'fluorescent', 'gritty', 'the bear'],
      inspiredBy: 'The Bear (2022–)',
      description: tk('Hot, greenish-yellow kitchen light and hard contrast.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    presence({ saturation: -12 }),
    gamma(60, 20),
    gain(50, 10),
    hueCurve('hueSat', [[60, 1.1]]),
    grain(10, 20, 40)
  ),
  look(
    'old-money-muted',
    tk('Old Money Muted'),
    {
      tags: ['muted', 'corporate', 'cool', 'drama', 'succession'],
      inspiredBy: 'Succession (2018–2023)',
      description: tk('Expensive, muted and slightly cool.'),
      version: 2
    },
    prim({ contrast: 0.97 }),
    presence({ saturation: -15 }),
    lift(200, 5),
    grain(6, 15, 30)
  ),
  look(
    'candy-arena',
    tk('Candy Arena'),
    {
      tags: ['candy', 'mint', 'pink', 'saturated', 'squid game'],
      inspiredBy: 'Squid Game (2021–2025)',
      description: tk('Mint greens and candy pinks, clean and bright.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: 15 }),
    lift(170, 8),
    hueCurve('hueHue', [
      [0, 3],
      [120, 7.5]
    ]),
    hueCurve('hueSat', [
      [0, 1.15],
      [120, 1.25],
      [180, 1.2],
      [315, 1.4]
    ]),
    hsl({ aqua: [0, 0, 5], magenta: [0, 0, 5] })
  ),
  look(
    'sterile-office',
    tk('Sterile Office'),
    {
      tags: ['sterile', 'office', 'green', 'cold', 'severance'],
      inspiredBy: 'Severance (2022–)',
      description: tk('Clinical green-tinged whites and muted colour, greens kept.'),
      version: 2
    },
    prim({ contrast: 1.03 }),
    tone({ whites: 10 }),
    presence({ saturation: -25 }),
    lift(170, 15),
    gain(165, 5),
    hueCurve('hueSat', [[120, 1.25]])
  ),
  look(
    'orthochromatic-mono',
    tk('Orthochromatic Mono'),
    {
      tags: ['bw', 'mono', 'orthochromatic', 'vintage', 'gritty', 'the lighthouse'],
      inspiredBy: 'The Lighthouse (2019)',
      description: tk('Old orthochromatic stock: dark reds and skin, pale blues, heavy grain.'),
      version: 2
    },
    mono({ red: -80, orange: -50, yellow: -20, blue: 60, aqua: 40 }),
    prim({ contrast: 1.21 }),
    vignette(-20),
    grain(40, 38, 70)
  ),
  look(
    'digital-wide-mono',
    tk('Digital Wide Mono'),
    {
      tags: ['bw', 'mono', 'clean', 'wide', 'roma'],
      inspiredBy: 'Roma (2018)',
      description: tk('A clean, wide-range digital black and white.'),
      version: 2
    },
    mono({ blue: -8, aqua: -4, yellow: 6 }),
    prim({ contrast: 1.03 }),
    tone({ shadows: 22, highlights: -25, whites: 10 }),
    presence({ clarity: 8 })
  ),
  look(
    'vintage-studio-mono',
    tk('Vintage Studio Mono'),
    {
      tags: ['bw', 'mono', 'vintage', 'hollywood', '1930s', 'mank'],
      inspiredBy: 'Mank (2020)',
      description: tk('Classic studio-era black and white with a soft glow.'),
      version: 3
    },
    mono({ red: 6, orange: 6 }),
    prim({ contrast: 1.09 }),
    tone({ highlights: -12, shadows: 4 }),
    matte(0.03),
    vignette(-25, { feather: 70 }),
    bloom(25),
    grain(30, 30, 55)
  ),
  look(
    'magic-hour-primaries',
    tk('Magic Hour Primaries'),
    {
      tags: ['musical', 'primaries', 'dusk', 'purple', 'la la land'],
      inspiredBy: 'La La Land (2016)',
      description: tk('Bold primaries against a purple dusk.'),
      version: 2
    },
    presence({ saturation: 20 }),
    lift(260, 15),
    hueCurve('hueSat', [
      [240, 1.25],
      [60, 1.25],
      [0, 1.25]
    ])
  ),
  look(
    'crimson-chapter',
    tk('Crimson Chapter'),
    {
      tags: ['red', 'wuxia', 'monochromatic', 'epic', 'hero'],
      inspiredBy: 'Hero (2002), the red chapter',
      description: tk('A whole world washed in red.'),
      version: 2
    },
    presence({ saturation: -20 }),
    offset(0, 40),
    hueCurve('hueSat', [[0, 1.3]])
  ),
  look(
    'muted-16mm-romance',
    tk('Muted 16mm Romance'),
    {
      tags: ['16mm', 'muted', 'romance', 'period', 'grain', 'carol'],
      inspiredBy: 'Carol (2015)',
      description: tk('Muted, olive-leaning period colour on grainy 16mm.'),
      version: 2
    },
    matte(0.04),
    prim({ sat: -20 }),
    hueCurve('hueHue', [
      [120, -3],
      [60, -1.8]
    ]),
    hueCurve('hueSat', [
      [120, 0.7],
      [60, 0.82]
    ]),
    grain(35, 35, 60)
  ),
  look(
    'infrared-day-for-night',
    tk('Infrared Day for Night'),
    {
      tags: ['day for night', 'night', 'blue', 'horror', 'nope'],
      inspiredBy: 'Nope (2022)',
      description: tk('Daylight turned to clear blue night.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    tone({ highlights: -45, whites: -45, shadows: -25 }),
    presence({ saturation: -50 }),
    offset(215, 30)
  ),
  look(
    'bright-folk-horror',
    tk('Bright Folk Horror'),
    {
      tags: ['bright', 'pastel', 'summer', 'horror', 'midsommar'],
      inspiredBy: 'Midsommar (2019)',
      description: tk('Relentless bright daylight in soft pastels.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    tone({ whites: 20, shadows: 20 }),
    presence({ saturation: 10 }),
    offset(60, 8)
  ),
  look(
    'shanghai-neon',
    tk('Shanghai Neon'),
    {
      tags: ['neon', 'night', 'cyan', 'spy', 'skyfall', 'bond'],
      inspiredBy: 'Skyfall (2012), the Shanghai tower',
      description: tk('Silhouettes against cyan and blue neon.'),
      version: 2
    },
    prim({ contrast: 1.15 }),
    tone({ blacks: -15 }),
    lift(195, 25),
    gain(190, 10),
    hueCurve('hueSat', [
      [180, 1.25],
      [240, 1.2]
    ])
  ),
  look(
    'overgrown-ruin',
    tk('Overgrown Ruin'),
    {
      tags: ['post-apocalyptic', 'green', 'muted', 'the last of us'],
      inspiredBy: 'The Last of Us (2023–)',
      description: tk('Muted, cool ruins overrun with soft greens.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    matte(0.02),
    presence({ saturation: -22 }),
    lift(190, 15),
    gain(50, 6),
    hueCurve('hueHue', [
      [120, -1.5],
      [60, -4.5]
    ]),
    hueCurve('hueSat', [[120, 1.15]]),
    grain(10, 20, 40)
  )
])
