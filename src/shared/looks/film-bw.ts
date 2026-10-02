/** Press, fine-grain and night black-and-white stocks. */
import { collection, fade, grain, look, mono, presence, rolloff, sCurve, tone, wheel } from './dsl'

export const FILM_BW = collection('film/bw', [
  look(
    'gritty-press-400',
    'Gritty Press 400',
    {
      tags: ['bw', 'mono', 'film', 'press', 'grain', 'kodak', 'tri-x', '400'],
      inspiredBy: 'Kodak Tri-X 400',
      description: 'The reportage classic: mid-tone bite and rough grain.'
    },
    mono({ red: -8, orange: -6, blue: 10, aqua: 5 }),
    sCurve(38),
    tone({ blacks: -8, whites: 5 }),
    grain(35, 35, 60)
  ),
  look(
    'pushed-press-1600',
    'Pushed Press 1600',
    {
      tags: ['bw', 'mono', 'film', 'pushed', 'night', 'grain', 'kodak', 'tri-x'],
      inspiredBy: 'Kodak Tri-X pushed to 1600',
      description: 'Pushed hard: inky shadows and big grain.'
    },
    mono({ red: -5, blue: 8 }),
    sCurve(50),
    tone({ contrast: 25, blacks: -25, shadows: -15, whites: 10 }),
    grain(55, 45, 75)
  ),
  look(
    'smooth-mono-100',
    'Smooth Mono 100',
    {
      tags: ['bw', 'mono', 'film', 'fine grain', 'kodak', 't-max', '100'],
      inspiredBy: 'Kodak T-MAX 100',
      description: 'Smooth, modern and nearly grainless.'
    },
    mono({ red: 14, orange: 10, blue: -4 }),
    tone({ contrast: 6, highlights: -10, shadows: 6 }),
    wheel('global', 220, 4),
    grain(6, 12, 25)
  ),
  look(
    'smooth-mono-400',
    'Smooth Mono 400',
    {
      tags: ['bw', 'mono', 'film', 'kodak', 't-max', '400'],
      inspiredBy: 'Kodak T-MAX 400',
      description: 'Clean modern mono with a little more grain.'
    },
    mono({ red: 10, orange: 8 }),
    sCurve(22),
    tone({ whites: 8, blacks: -4 }),
    grain(15, 20, 40)
  ),
  look(
    'night-mono-3200',
    'Night Mono 3200',
    {
      tags: ['bw', 'mono', 'film', 'night', 'grain', 'kodak', 't-max', 'p3200'],
      inspiredBy: 'Kodak T-MAX P3200',
      description: 'Low-light mono with soft blacks and large grain.'
    },
    mono({ red: 8, orange: 6 }),
    tone({ contrast: 22, shadows: -12 }),
    fade(0.03),
    grain(60, 50, 70)
  ),
  look(
    'classic-press-400',
    'Classic Press 400',
    {
      tags: ['bw', 'mono', 'film', 'press', 'ilford', 'hp5', '400'],
      inspiredBy: 'Ilford HP5 Plus',
      description: 'Forgiving, classic mono with medium grain.'
    },
    mono({ orange: 4, blue: 4 }),
    sCurve(15),
    tone({ highlights: -12, shadows: 12 }),
    grain(30, 32, 55)
  ),
  look(
    'fine-classic-125',
    'Fine Classic 125',
    {
      tags: ['bw', 'mono', 'film', 'fine grain', 'ilford', 'fp4', '125'],
      inspiredBy: 'Ilford FP4 Plus',
      description: 'Traditional, fine-grained mono.'
    },
    mono({ yellow: 10, orange: 8, red: 4, blue: -4 }),
    sCurve(18),
    tone({ highlights: -14, shadows: 8 }),
    grain(10, 18, 35)
  ),
  look(
    'ultra-fine-50',
    'Ultra-Fine 50',
    {
      tags: ['bw', 'mono', 'film', 'fine grain', 'contrast', 'ilford', 'pan f', '50'],
      inspiredBy: 'Ilford Pan F Plus 50',
      description: 'Contrasty, deep and almost grainless.'
    },
    mono({ red: -15, orange: -10, blue: 6 }),
    sCurve(40),
    tone({ contrast: 10, blacks: -10 }),
    grain(4, 10, 20)
  ),
  look(
    'modern-fine-100',
    'Modern Fine 100',
    {
      tags: ['bw', 'mono', 'film', 'fine grain', 'ilford', 'delta', '100'],
      inspiredBy: 'Ilford Delta 100',
      description: 'Crisp modern tabular-grain mono.'
    },
    mono({ yellow: 5, green: 5, blue: -6 }),
    sCurve(18),
    tone({ whites: 14, blacks: -8 }),
    presence({ clarity: 14 }),
    grain(6, 12, 25)
  ),
  look(
    'night-grain-3200',
    'Night Grain 3200',
    {
      tags: ['bw', 'mono', 'film', 'night', 'grain', 'ilford', 'delta', '3200'],
      inspiredBy: 'Ilford Delta 3200',
      description: 'Soft, grainy and atmospheric.'
    },
    mono({ orange: 6 }),
    tone({ contrast: -8, shadows: 12, highlights: -12 }),
    fade(0.05),
    grain(65, 55, 80)
  ),
  look(
    'chromogenic-mono',
    'Chromogenic Mono',
    {
      tags: ['bw', 'mono', 'film', 'c41', 'smooth', 'ilford', 'xp2'],
      inspiredBy: 'Ilford XP2 Super',
      description: 'Smooth, faintly warm mono from colour chemistry.'
    },
    mono({ orange: 8, yellow: 4 }),
    tone({ contrast: -12, highlights: -18, shadows: 8 }),
    rolloff(0.03),
    wheel('global', 35, 7),
    grain(8, 15, 30)
  ),
  look(
    'budget-classic-100',
    'Budget Classic 100',
    {
      tags: ['bw', 'mono', 'film', 'vintage', 'foma', 'fomapan', '100'],
      inspiredBy: 'Fomapan 100 Classic',
      description: 'Old-fashioned tonality with soft highlights.'
    },
    mono({ red: -18, orange: -10, blue: 14, aqua: 8 }),
    tone({ contrast: 15, highlights: -15 }),
    fade(0.015),
    grain(15, 22, 45)
  ),
  look(
    'smooth-sky-100',
    'Smooth Sky 100',
    {
      tags: ['bw', 'mono', 'film', 'fine grain', 'sky', 'fuji', 'acros ii', '100'],
      inspiredBy: 'Fujifilm Neopan Acros II 100',
      description: 'Fine grain and gently deepened skies.'
    },
    mono({ blue: -32, aqua: -18, yellow: 8 }),
    sCurve(30),
    tone({ blacks: -10, highlights: -6 }),
    grain(8, 12, 25)
  )
])
