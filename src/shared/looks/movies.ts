/**
 * Grades inspired by well-known films and series, written from what their
 * makers and colourists have said about them and what is on screen. Names
 * are our own; the title is only the `inspiredBy` reference.
 */
import {
  approximates,
  bloomApprox,
  collection,
  fade,
  foliage,
  grain,
  halationApprox,
  hsl,
  look,
  mono,
  presence,
  rolloff,
  sCurve,
  split,
  tone,
  vignette,
  wheel
} from './dsl'
import { tk } from '../i18n'

export const MOVIES = collection('movies', [
  look(
    'rain-city-noir',
    tk('Rain City Noir'),
    {
      tags: ['noir', 'dark', 'moody', 'amber', 'rain', 'the batman', 'batman'],
      inspiredBy: 'The Batman (2022)',
      description: tk('Crushed blacks and amber-red light in a drowned, blue-less city.')
    },
    sCurve(45),
    tone({ whites: -25, highlights: -25, shadows: -20, blacks: -15 }),
    rolloff(0.04),
    presence({ saturation: -30 }),
    wheel('midtones', 28, 25),
    wheel('shadows', 20, 15),
    hsl({ red: [0, 25, -5], orange: [-4, 5, -5], aqua: [0, -60, 0], blue: [0, -60, -10] }),
    foliage(0, -50, 0),
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
      )
    },
    sCurve(25),
    rolloff(0.02),
    tone({ highlights: -12 }),
    presence({ saturation: -5 }),
    wheel('midtones', 30, 20),
    wheel('highlights', 40, 16),
    wheel('shadows', 20, 8),
    hsl({ orange: [0, 5, 0], blue: [-5, -15, 0] }),
    foliage(5, -15, 0),
    grain(4, 12, 25)
  ),
  look(
    'desert-ochre',
    tk('Desert Ochre'),
    {
      tags: ['desert', 'ochre', 'muted', 'epic', 'dune'],
      inspiredBy: 'Dune (2021)',
      description: tk('Ochre haze over muted colour: no green, little blue, soft film texture.')
    },
    tone({ contrast: -5 }),
    fade(0.02),
    presence({ saturation: -28 }),
    wheel('global', 35, 18),
    hsl({ orange: [0, 0, 5], blue: [0, -30, 0] }),
    foliage(0, -50, 0),
    grain(10, 20, 40)
  ),
  look(
    'golden-spice',
    tk('Golden Spice'),
    {
      tags: ['desert', 'golden', 'warm', 'epic', 'dune', 'part two'],
      inspiredBy: 'Dune: Part Two (2024)',
      description: tk('Hot, golden sand light with firmer contrast.')
    },
    tone({ contrast: 15 }),
    presence({ saturation: -10 }),
    wheel('global', 35, 20),
    wheel('highlights', 40, 15),
    hsl({ blue: [0, -30, 0] }),
    foliage(0, -50, 0)
  ),
  look(
    'infrared-arena',
    tk('Infrared Arena'),
    {
      tags: ['bw', 'mono', 'infrared', 'stark', 'dune', 'part two', 'giedi prime'],
      inspiredBy: 'Dune: Part Two (2024), the infrared arena',
      description: tk('Infrared-style mono: glowing skin and foliage, black skies.')
    },
    mono({ green: 80, yellow: 60, red: 40, orange: 40, blue: -70, aqua: -50 }),
    tone({ contrast: 35 }),
    bloomApprox(20)
  ),
  look(
    'orange-haze-city',
    tk('Orange Haze City'),
    {
      tags: ['orange', 'haze', 'dystopia', 'sci-fi', 'blade runner 2049'],
      inspiredBy: 'Blade Runner 2049 (2017), the abandoned city',
      description: tk('Everything drowned in orange dust; only warm colour survives.')
    },
    tone({ contrast: -20 }),
    fade(0.06),
    wheel('global', 35, 40),
    wheel('shadows', 30, 30),
    hsl({
      red: [0, -30, 0],
      aqua: [0, -60, 0],
      blue: [0, -60, 0],
      purple: [0, -60, 0],
      magenta: [0, -60, 0]
    }),
    foliage(0, -60, 0),
    bloomApprox(30)
  ),
  look(
    'cold-smog',
    tk('Cold Smog'),
    {
      tags: ['cold', 'smog', 'neon', 'sci-fi', 'blade runner 2049'],
      inspiredBy: 'Blade Runner 2049 (2017), the city at night',
      description: tk('Cold, smoggy and drained, with neon magentas left alive.')
    },
    tone({ contrast: -10 }),
    fade(0.05),
    presence({ saturation: -40 }),
    wheel('shadows', 200, 20),
    wheel('midtones', 210, 8),
    hsl({ magenta: [0, 40, 0], purple: [0, 30, 0] }),
    bloomApprox(20),
    grain(6, 15, 30)
  ),
  look(
    'wasteland-teal-orange',
    tk('Wasteland Teal Orange'),
    {
      tags: ['teal', 'orange', 'saturated', 'desert', 'action', 'mad max', 'fury road'],
      inspiredBy: 'Mad Max: Fury Road (2015)',
      description: tk('Blazing orange desert against hard teal sky, everything turned up.')
    },
    tone({ contrast: 30, blacks: -5 }),
    presence({ saturation: 35, clarity: 15 }),
    hsl({ orange: [0, 30, -5], aqua: [0, 25, 0], blue: [-20, 30, 0] })
  ),
  look(
    'black-and-chrome-wasteland',
    tk('Black & Chrome Wasteland'),
    {
      tags: ['bw', 'mono', 'desert', 'contrast', 'mad max', 'fury road', 'black and chrome'],
      inspiredBy: 'Mad Max: Fury Road — Black & Chrome Edition',
      description: tk('Bright sand and skin against black skies, hard and bright.')
    },
    mono({ orange: 30, yellow: 20, blue: -50, aqua: -40 }),
    tone({ contrast: 50 }),
    presence({ clarity: 20 })
  ),
  look(
    'code-green',
    tk('Code Green'),
    {
      tags: ['green', 'sci-fi', 'cyberpunk', 'the matrix', 'matrix'],
      inspiredBy: 'The Matrix (1999), inside the code',
      description: tk('A sickly green cast over hard contrast, reds and blues drained.')
    },
    tone({ contrast: 25, blacks: -10 }),
    presence({ saturation: -35 }),
    wheel('global', 120, 12),
    wheel('midtones', 115, 30),
    wheel('shadows', 125, 25),
    hsl({ red: [0, -40, 0], blue: [0, -40, 0] })
  ),
  look(
    'steel-blue-reality',
    tk('Steel Blue Reality'),
    {
      tags: ['blue', 'cold', 'sci-fi', 'the matrix', 'matrix'],
      inspiredBy: 'The Matrix (1999), the real world',
      description: tk('Cold steel blue over muted colour.')
    },
    tone({ contrast: 15 }),
    presence({ saturation: -30 }),
    wheel('global', 215, 20)
  ),
  look(
    'sickly-stairway',
    tk('Sickly Stairway'),
    {
      tags: ['sickly', 'green', 'yellow', 'gritty', 'joker'],
      inspiredBy: 'Joker (2019)',
      description: tk('Sodium-lit city: green-teal shadows and nicotine highlights.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: -15 }),
    split(165, 15, 55, 12),
    hsl({ green: [0, 5, 0], yellow: [0, 5, 0] }),
    grain(15, 25, 50)
  ),
  look(
    'atomic-colour',
    tk('Atomic Colour'),
    {
      tags: ['film', 'warm', 'large format', 'period', 'oppenheimer', 'nolan'],
      inspiredBy: 'Oppenheimer (2023), the colour sequences',
      description: tk('Warm large-format print with dense blacks.')
    },
    sCurve(30),
    tone({ blacks: -5 }),
    presence({ saturation: 5 }),
    wheel('highlights', 40, 10),
    hsl({ orange: [0, 5, 0] }),
    grain(4, 12, 25)
  ),
  look(
    'atomic-mono',
    tk('Atomic Mono'),
    {
      tags: ['bw', 'mono', 'contrast', 'large format', 'oppenheimer', 'nolan'],
      inspiredBy: 'Oppenheimer (2023), the black-and-white sequences',
      description: tk('Hard, bright, large-format black and white.')
    },
    mono({ red: -6, orange: -4, blue: 6 }),
    sCurve(50),
    tone({ contrast: 20, whites: 25, highlights: 10, blacks: -5 }),
    presence({ clarity: 10 }),
    grain(8, 12, 25)
  ),
  look(
    'dust-and-ice',
    tk('Dust & Ice'),
    {
      tags: ['dust', 'film', 'sci-fi', 'muted', 'interstellar', 'nolan'],
      inspiredBy: 'Interstellar (2014)',
      description: tk('Dusty, warm and slightly muted, on film.')
    },
    sCurve(20),
    presence({ saturation: -15 }),
    wheel('global', 40, 12),
    wheel('shadows', 200, 10),
    hsl({ blue: [0, -20, 0] }),
    foliage(10, -20, 0),
    grain(8, 18, 35)
  ),
  look(
    'border-desert',
    tk('Border Desert'),
    {
      tags: ['desert', 'thriller', 'hard', 'muted', 'sicario'],
      inspiredBy: 'Sicario (2015)',
      description: tk('Hard desert light, deep blacks and muted warmth.')
    },
    tone({ contrast: 25, blacks: -10 }),
    presence({ saturation: -25 }),
    wheel('global', 35, 10),
    wheel('shadows', 30, 8)
  ),
  look(
    'neon-drive',
    tk('Neon Drive'),
    {
      tags: ['neon', 'night', 'magenta', 'teal', 'synthwave', 'drive'],
      inspiredBy: 'Drive (2011)',
      description: tk('Teal night and hot magenta neon, warm skin.')
    },
    tone({ contrast: 15 }),
    wheel('shadows', 190, 20),
    hsl({ magenta: [10, 30, 0], purple: [0, 20, 0], orange: [0, 5, 0] }),
    bloomApprox(20)
  ),
  look(
    'green-and-gold-whimsy',
    tk('Green & Gold Whimsy'),
    {
      tags: ['whimsical', 'green', 'gold', 'red', 'paris', 'amelie'],
      inspiredBy: 'Amélie (2001)',
      description: tk('Green and gold everywhere, bright reds, the blues all but gone.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: 10 }),
    wheel('midtones', 70, 20),
    wheel('highlights', 45, 15),
    hsl({ red: [0, 20, 0], blue: [-25, -30, 0] }),
    foliage(-10, 15, 0)
  ),
  look(
    'crimson-melancholy',
    tk('Crimson Melancholy'),
    {
      tags: ['red', 'romantic', 'moody', 'hong kong', 'in the mood for love', 'wong kar-wai'],
      inspiredBy: 'In the Mood for Love (2000)',
      description: tk('Deep reds and emerald greens under warm lamplight.')
    },
    tone({ contrast: 25, blacks: -5 }),
    wheel('global', 35, 12),
    hsl({ red: [0, 30, -10] }),
    foliage(10, 10, 0),
    bloomApprox(15),
    grain(20, 25, 50)
  ),
  look(
    'neon-grain-nights',
    tk('Neon Grain Nights'),
    {
      tags: ['neon', 'night', 'grain', 'hong kong', 'chungking express', 'wong kar-wai'],
      inspiredBy: 'Chungking Express (1994) and Fallen Angels (1995)',
      description: tk('Green-cast night, smeared neon reds and rough grain.')
    },
    tone({ contrast: 30 }),
    wheel('shadows', 160, 20),
    hsl({ red: [0, 20, 0] }),
    bloomApprox(15),
    grain(45, 40, 75)
  ),
  look(
    'pastel-hotel',
    tk('Pastel Hotel'),
    {
      tags: ['pastel', 'pink', 'symmetry', 'whimsical', 'grand budapest', 'wes anderson'],
      inspiredBy: 'The Grand Budapest Hotel (2014)',
      description: tk('Candy pinks and lavender, bright and storybook.')
    },
    tone({ contrast: -5 }),
    presence({ saturation: 15 }),
    wheel('global', 35, 6),
    hsl({
      red: [10, 0, 10],
      aqua: [0, 0, 10],
      purple: [0, 30, 10],
      magenta: [0, 30, 10]
    })
  ),
  look(
    'rain-rot',
    tk('Rain Rot'),
    {
      tags: ['dark', 'gritty', 'rain', 'thriller', 'silver retention', 'se7en', 'fincher'],
      inspiredBy: 'Se7en (1995)',
      description: tk('Silver-retained: crushed blacks, drained colour, a sour yellow-green.')
    },
    sCurve(45),
    tone({ contrast: 20, blacks: -10 }),
    presence({ saturation: -40 }),
    wheel('midtones', 70, 12),
    grain(25, 28, 55)
  ),
  look(
    'cyan-rot',
    tk('Cyan Rot'),
    {
      tags: ['cyan', 'green', 'grimy', 'fight club', 'fincher'],
      inspiredBy: 'Fight Club (1999)',
      description: tk('Grimy cyan-green shadows and dirty yellow highlights.')
    },
    tone({ contrast: 30 }),
    presence({ saturation: -30 }),
    split(160, 20, 60, 10),
    grain(20, 25, 50)
  ),
  look(
    'amber-dorm',
    tk('Amber Dorm'),
    {
      tags: ['amber', 'warm', 'dim', 'drama', 'the social network', 'fincher'],
      inspiredBy: 'The Social Network (2010)',
      description: tk('Dim amber interiors with the blues held right down.')
    },
    tone({ whites: -20, highlights: -15 }),
    rolloff(0.02),
    wheel('midtones', 50, 22),
    hsl({ blue: [-10, -40, 0] })
  ),
  look(
    'interrogation-olive',
    tk('Interrogation Olive'),
    {
      tags: ['olive', 'muted', 'period', 'crime', 'mindhunter', 'zodiac', 'fincher'],
      inspiredBy: 'Mindhunter (2017–2019) and Zodiac (2007)',
      description: tk('Muted olive-yellow period tone, blues pulled back.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: -25 }),
    wheel('midtones', 75, 15),
    hsl({ blue: [0, -30, 0] })
  ),
  look(
    'miami-cyan',
    tk('Miami Cyan'),
    {
      tags: ['cyan', 'saturated', 'skin', 'night', 'moonlight'],
      inspiredBy: 'Moonlight (2016)',
      description: tk('Saturated cyans and teals with rich, deep skin.')
    },
    tone({ contrast: 20 }),
    presence({ saturation: 15 }),
    split(185, 20, 40, 8),
    hsl({ orange: [0, 10, -8], aqua: [0, 20, 0] })
  ),
  look(
    'coral-warmth',
    tk('Coral Warmth'),
    {
      tags: ['coral', 'warm', 'soft', 'romantic', 'her'],
      inspiredBy: 'Her (2013)',
      description: tk('Soft coral reds and peaches, no blue at all.')
    },
    tone({ contrast: -15 }),
    fade(0.03),
    wheel('global', 25, 10),
    hsl({ red: [5, 15, 0], orange: [5, 15, 0], blue: [0, -60, 0], aqua: [0, -40, 0] }),
    bloomApprox(25)
  ),
  look(
    'golden-hour-jet',
    tk('Golden Hour Jet'),
    {
      tags: ['golden hour', 'action', 'warm', 'teal sky', 'top gun', 'maverick'],
      inspiredBy: 'Top Gun: Maverick (2022)',
      description: tk('Big golden-hour warmth against teal sky.')
    },
    tone({ contrast: 20 }),
    split(205, 12, 40, 22),
    hsl({ orange: [0, 20, 0], blue: [-10, 0, 0] })
  ),
  look(
    'neon-assassin',
    tk('Neon Assassin'),
    {
      tags: ['neon', 'night', 'action', 'teal', 'magenta', 'john wick'],
      inspiredBy: 'John Wick: Chapters 2–4',
      description: tk('Inky blacks, teal shadows and saturated neon.')
    },
    tone({ contrast: 30, blacks: -10 }),
    wheel('shadows', 190, 25),
    hsl({ magenta: [0, 30, 0], purple: [0, 20, 0], blue: [-15, 0, 0], orange: [0, -10, 0] })
  ),
  look(
    'club-purple',
    tk('Club Purple'),
    {
      tags: ['purple', 'neon', 'party', 'teen', 'euphoria'],
      inspiredBy: 'Euphoria (2019–)',
      description: tk('Purple and magenta club light, saturated and grainy.')
    },
    tone({ contrast: 20 }),
    presence({ saturation: 20 }),
    split(275, 20, 320, 10),
    hsl({ purple: [0, 30, 0], magenta: [0, 30, 0] }),
    halationApprox(20),
    grain(15, 22, 45)
  ),
  look(
    'dream-pink',
    tk('Dream Pink'),
    {
      tags: ['pink', 'saturated', 'bright', 'plastic', 'barbie'],
      inspiredBy: 'Barbie (2023)',
      description: tk('Bright, saturated and very, very pink.')
    },
    tone({ contrast: 10, whites: 10 }),
    presence({ saturation: 30 }),
    hsl({ red: [15, 20, 0], magenta: [0, 35, 0], purple: [10, 20, 0] })
  ),
  look(
    'eighties-small-town',
    tk('Eighties Small Town'),
    {
      tags: ['80s', 'nostalgic', 'warm', 'night blue', 'stranger things'],
      inspiredBy: 'Stranger Things (2016–2025)',
      description: tk('Warm interiors, blue nights and soft film blacks.')
    },
    fade(0.03),
    tone({ contrast: 10 }),
    presence({ saturation: 8 }),
    wheel('midtones', 40, 16),
    wheel('shadows', 215, 22),
    hsl({ red: [0, 12, 0] }),
    grain(15, 22, 45)
  ),
  look(
    'tobacco-desert',
    tk('Tobacco Desert'),
    {
      tags: ['yellow', 'desert', 'warm', 'crime', 'breaking bad'],
      inspiredBy: 'Breaking Bad (2008–2013)',
      description: tk('Heavy tobacco yellow under vivid desert-blue sky.')
    },
    tone({ contrast: 20 }),
    wheel('midtones', 48, 35),
    wheel('highlights', 50, 25),
    hsl({ blue: [-5, 20, 0] })
  ),
  look(
    'sepia-dust-bowl',
    tk('Sepia Dust Bowl'),
    {
      tags: ['sepia', 'dust', 'yellow', 'period', 'o brother'],
      inspiredBy: 'O Brother, Where Art Thou? (2000)',
      description: tk('Green foliage turned to dry gold under a sepia cast.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: -15 }),
    wheel('global', 45, 25),
    hsl({ aqua: [-20, -40, 0] }),
    foliage(-40, -60, 0)
  ),
  look(
    'yellow-border',
    tk('Yellow Border'),
    {
      tags: ['yellow', 'hot', 'grainy', 'crime', 'traffic'],
      inspiredBy: 'Traffic (2000)',
      description: tk('Blown, burning yellow and heavy grain.')
    },
    tone({ contrast: 40 }),
    presence({ saturation: -20 }),
    wheel('global', 50, 40),
    grain(40, 38, 70)
  ),
  look(
    'frozen-natural',
    tk('Frozen Natural'),
    {
      tags: ['cold', 'natural light', 'winter', 'wilderness', 'the revenant'],
      inspiredBy: 'The Revenant (2015)',
      description: tk('Cold natural light, muted colour, blue-steel shadows.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: -30 }),
    wheel('shadows', 210, 12),
    hsl({ orange: [0, -10, 0] })
  ),
  look(
    'bleach-war',
    tk('Bleach War'),
    {
      tags: ['war', 'bleach bypass', 'gritty', 'desaturated', 'saving private ryan'],
      inspiredBy: 'Saving Private Ryan (1998)',
      description: tk('Drained, harsh and grainy: colour almost gone.')
    },
    sCurve(45),
    tone({ contrast: 20, whites: 15, blacks: -5 }),
    presence({ saturation: -60 }),
    wheel('shadows', 190, 8),
    grain(35, 32, 65)
  ),
  look(
    'wartime-mono',
    tk('Wartime Mono'),
    {
      tags: ['bw', 'mono', 'period', 'drama', "schindler's list"],
      inspiredBy: "Schindler's List (1993)",
      description: tk(
        'Documentary black and white. (The film’s single red coat needs a colour mask.)'
      )
    },
    mono({ red: -10, orange: -6 }),
    sCurve(25),
    tone({ contrast: 10, highlights: -15, shadows: -8 }),
    fade(0.02),
    grain(25, 28, 55),
    approximates('selectiveColour')
  ),
  look(
    'frontier-dust',
    tk('Frontier Dust'),
    {
      tags: ['western', 'dust', 'sci-fi', 'warm', 'the mandalorian'],
      inspiredBy: 'The Mandalorian (2019–)',
      description: tk('A dusty, warm western with soft blacks.')
    },
    tone({ contrast: 5 }),
    fade(0.02),
    presence({ saturation: -15 }),
    wheel('global', 35, 12),
    grain(8, 18, 35)
  ),
  look(
    'patriarch-amber',
    tk('Patriarch Amber'),
    {
      tags: ['amber', 'dark', 'period', 'crime', 'the godfather'],
      inspiredBy: 'The Godfather (1972)',
      description: tk('Dark amber interiors and deep, falling-off shadows.')
    },
    tone({ contrast: 25, whites: -20, highlights: -15, blacks: -10 }),
    presence({ saturation: -10 }),
    wheel('midtones', 45, 25),
    grain(20, 25, 50)
  ),
  look(
    'grey-dystopia',
    tk('Grey Dystopia'),
    {
      tags: ['grey', 'desaturated', 'dystopia', 'bleak', 'children of men'],
      inspiredBy: 'Children of Men (2006)',
      description: tk('Bleak, grey and almost colourless.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: -45 }),
    wheel('shadows', 170, 10),
    grain(20, 25, 50)
  ),
  look(
    'tokyo-hush',
    tk('Tokyo Hush'),
    {
      tags: ['soft', 'night', 'city', 'dreamy', 'lost in translation'],
      inspiredBy: 'Lost in Translation (2003)',
      description: tk('Soft, hushed city nights with pink and blue neon.')
    },
    tone({ contrast: -15 }),
    fade(0.03),
    presence({ saturation: -5 }),
    hsl({ magenta: [0, 15, 0], blue: [0, 15, 0] }),
    bloomApprox(20),
    grain(12, 20, 40)
  ),
  look(
    'milky-overcast',
    tk('Milky Overcast'),
    {
      tags: ['overcast', 'muted', 'soft', 'sci-fi', 'arrival'],
      inspiredBy: 'Arrival (2016)',
      description: tk('Milky, overcast and nearly colourless.')
    },
    tone({ contrast: -25 }),
    fade(0.07),
    rolloff(0.03),
    presence({ saturation: -35 }),
    wheel('global', 180, 5)
  ),
  look(
    'kitchen-heat',
    tk('Kitchen Heat'),
    {
      tags: ['kitchen', 'warm', 'fluorescent', 'gritty', 'the bear'],
      inspiredBy: 'The Bear (2022–)',
      description: tk('Hot, greenish-yellow kitchen light and hard contrast.')
    },
    tone({ contrast: 20 }),
    presence({ saturation: -12 }),
    wheel('midtones', 60, 20),
    wheel('highlights', 50, 10),
    hsl({ yellow: [0, 10, 0] }),
    grain(10, 20, 40)
  ),
  look(
    'old-money-muted',
    tk('Old Money Muted'),
    {
      tags: ['muted', 'corporate', 'cool', 'drama', 'succession'],
      inspiredBy: 'Succession (2018–2023)',
      description: tk('Expensive, muted and slightly cool.')
    },
    tone({ contrast: -5 }),
    presence({ saturation: -15 }),
    wheel('shadows', 200, 5),
    grain(6, 15, 30)
  ),
  look(
    'candy-arena',
    tk('Candy Arena'),
    {
      tags: ['candy', 'mint', 'pink', 'saturated', 'squid game'],
      inspiredBy: 'Squid Game (2021–2025)',
      description: tk('Mint greens and candy pinks, clean and bright.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: 15 }),
    wheel('shadows', 170, 8),
    hsl({ red: [10, 15, 0], green: [25, 25, 0], aqua: [0, 20, 5], magenta: [0, 40, 5] })
  ),
  look(
    'sterile-office',
    tk('Sterile Office'),
    {
      tags: ['sterile', 'office', 'green', 'cold', 'severance'],
      inspiredBy: 'Severance (2022–)',
      description: tk('Clinical green-tinged whites and muted colour, greens kept.')
    },
    tone({ contrast: 5, whites: 10 }),
    presence({ saturation: -25 }),
    split(170, 15, 165, 5),
    hsl({ green: [0, 25, 0] })
  ),
  look(
    'orthochromatic-mono',
    tk('Orthochromatic Mono'),
    {
      tags: ['bw', 'mono', 'orthochromatic', 'vintage', 'gritty', 'the lighthouse'],
      inspiredBy: 'The Lighthouse (2019)',
      description: tk('Old orthochromatic stock: dark reds and skin, pale blues, heavy grain.')
    },
    mono({ red: -80, orange: -50, yellow: -20, blue: 60, aqua: 40 }),
    tone({ contrast: 35 }),
    vignette(-20),
    grain(40, 38, 70)
  ),
  look(
    'digital-wide-mono',
    tk('Digital Wide Mono'),
    {
      tags: ['bw', 'mono', 'clean', 'wide', 'roma'],
      inspiredBy: 'Roma (2018)',
      description: tk('A clean, wide-range digital black and white.')
    },
    mono({ blue: -8, aqua: -4, yellow: 6 }),
    tone({ contrast: 5, shadows: 22, highlights: -25, whites: 10 }),
    presence({ clarity: 8 })
  ),
  look(
    'vintage-studio-mono',
    tk('Vintage Studio Mono'),
    {
      tags: ['bw', 'mono', 'vintage', 'hollywood', '1930s', 'mank'],
      inspiredBy: 'Mank (2020)',
      description: tk('Classic studio-era black and white with a soft glow.')
    },
    mono({ red: 6, orange: 6 }),
    tone({ contrast: 15, highlights: -12 }),
    fade(0.03),
    vignette(-25, { feather: 70 }),
    bloomApprox(25),
    grain(30, 30, 55)
  ),
  look(
    'magic-hour-primaries',
    tk('Magic Hour Primaries'),
    {
      tags: ['musical', 'primaries', 'dusk', 'purple', 'la la land'],
      inspiredBy: 'La La Land (2016)',
      description: tk('Bold primaries against a purple dusk.')
    },
    presence({ saturation: 20 }),
    wheel('shadows', 260, 15),
    hsl({ blue: [0, 25, 0], yellow: [0, 25, 0], red: [0, 25, 0] })
  ),
  look(
    'crimson-chapter',
    tk('Crimson Chapter'),
    {
      tags: ['red', 'wuxia', 'monochromatic', 'epic', 'hero'],
      inspiredBy: 'Hero (2002), the red chapter',
      description: tk('A whole world washed in red.')
    },
    presence({ saturation: -20 }),
    wheel('global', 0, 40),
    hsl({ red: [0, 30, 0] })
  ),
  look(
    'muted-16mm-romance',
    tk('Muted 16mm Romance'),
    {
      tags: ['16mm', 'muted', 'romance', 'period', 'grain', 'carol'],
      inspiredBy: 'Carol (2015)',
      description: tk('Muted, olive-leaning period colour on grainy 16mm.')
    },
    fade(0.04),
    presence({ saturation: -20 }),
    foliage(-10, -30, 0),
    grain(35, 35, 60)
  ),
  look(
    'infrared-day-for-night',
    tk('Infrared Day for Night'),
    {
      tags: ['day for night', 'night', 'blue', 'horror', 'nope'],
      inspiredBy: 'Nope (2022)',
      description: tk('Daylight turned to clear blue night.')
    },
    tone({ contrast: 20, highlights: -45, whites: -45, shadows: -25 }),
    presence({ saturation: -50 }),
    wheel('global', 215, 30)
  ),
  look(
    'bright-folk-horror',
    tk('Bright Folk Horror'),
    {
      tags: ['bright', 'pastel', 'summer', 'horror', 'midsommar'],
      inspiredBy: 'Midsommar (2019)',
      description: tk('Relentless bright daylight in soft pastels.')
    },
    tone({ contrast: -10, whites: 20, shadows: 20 }),
    presence({ saturation: 10 }),
    wheel('global', 60, 8)
  ),
  look(
    'shanghai-neon',
    tk('Shanghai Neon'),
    {
      tags: ['neon', 'night', 'cyan', 'spy', 'skyfall', 'bond'],
      inspiredBy: 'Skyfall (2012), the Shanghai tower',
      description: tk('Silhouettes against cyan and blue neon.')
    },
    tone({ contrast: 25, blacks: -15 }),
    split(195, 25, 190, 10),
    hsl({ aqua: [0, 25, 0], blue: [0, 20, 0] })
  ),
  look(
    'overgrown-ruin',
    tk('Overgrown Ruin'),
    {
      tags: ['post-apocalyptic', 'green', 'muted', 'the last of us'],
      inspiredBy: 'The Last of Us (2023–)',
      description: tk('Muted, cool ruins overrun with soft greens.')
    },
    tone({ contrast: 10 }),
    fade(0.02),
    presence({ saturation: -22 }),
    split(190, 15, 50, 6),
    hsl({ green: [-5, 15, 0], yellow: [-15, 0, 0] }),
    grain(10, 20, 40)
  )
])
