/** Press, fine-grain and night black-and-white stocks. */
import { collection, fade, grain, look, mono, presence, sCurve, tone, wheel } from './dsl'

export const FILM_BW = collection('film/bw', [
  look(
    'gritty-press-400',
    'Gritty Press 400',
    {
      tags: ['bw', 'mono', 'film', 'press', 'grain', 'kodak', 'tri-x', '400'],
      inspiredBy: 'Kodak Tri-X 400',
      description: 'The reportage classic: mid-tone bite and rough grain.'
    },
    mono({ red: 5, orange: 5, blue: -5 }),
    sCurve(35),
    tone({ blacks: -5 }),
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
    mono(),
    sCurve(50),
    tone({ contrast: 25, blacks: -25 }),
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
    mono(),
    tone({ contrast: 5 }),
    wheel('global', 220, 3),
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
    mono(),
    tone({ contrast: 10 }),
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
    mono(),
    tone({ contrast: 15 }),
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
    mono(),
    tone({ contrast: 10 }),
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
    mono(),
    tone({ contrast: 12 }),
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
    mono(),
    sCurve(40),
    tone({ contrast: 10, blacks: -5 }),
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
    mono(),
    tone({ contrast: 10 }),
    presence({ clarity: 5 }),
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
    mono(),
    tone({ contrast: -5 }),
    fade(0.04),
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
    mono(),
    tone({ contrast: -10 }),
    wheel('global', 35, 4),
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
    mono({ red: -5, blue: 5 }),
    tone({ contrast: 15, highlights: -10 }),
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
    mono({ blue: -10, aqua: -5 }),
    tone({ contrast: 12 }),
    grain(8, 12, 25)
  )
])
