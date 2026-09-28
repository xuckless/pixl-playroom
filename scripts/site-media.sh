#!/usr/bin/env bash
# Builds the media the website (site/) ships. The outputs are committed, so
# this only needs to run again when a source changes.
#
#   scripts/site-media.sh [step ...]      steps: fonts brand hero pairs shots formats og (default: all)
#
# Sources (override with the env vars):
#   REC_DIR    screen recordings of the app, *.mov    (~/Downloads/PIXL-Recordings)
#   AFTER_DIR  the edited photos, IMG_<n>-edit.jpg    (~/Downloads/Send-to-Friends)
#   CARD_DIR   the CR2 originals and their sidecars   (/Volumes/Untitled/DCIM/100CANON)
#   ICON_DIR   PNG/ICO web icons from the brand kit    (~/Downloads/PIXL-brand-assets/web)
#
# Needs ffmpeg (with libx264 and libvpx-vp9), ImageMagick 7 and node. The
# "pairs" and "shots" steps drive the built app (pnpm exec electron-vite build)
# and "og" runs Electron. The card is only ever read: its files are copied to a
# scratch folder before the app touches them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site/assets"
REC_DIR="${REC_DIR:-$HOME/Downloads/PIXL-Recordings}"
AFTER_DIR="${AFTER_DIR:-$HOME/Downloads/Send-to-Friends}"
CARD_DIR="${CARD_DIR:-/Volumes/Untitled/DCIM/100CANON}"
ICON_DIR="${ICON_DIR:-$HOME/Downloads/PIXL-brand-assets/web}"
# The before/after pairs, in the order the site shows them.
PAIRS=(3218 3252 3223 3291 3258 3271 3272 3273 3274 3292 3293)
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/pixl-site.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

fonts() {
  local fs="$ROOT/node_modules/@fontsource-variable"
  mkdir -p "$SITE/fonts"
  cp "$fs/space-grotesk/files/space-grotesk-latin-wght-normal.woff2" "$SITE/fonts/space-grotesk.woff2"
  cp "$fs/manrope/files/manrope-latin-wght-normal.woff2" "$SITE/fonts/manrope.woff2"
  cp "$fs/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2" "$SITE/fonts/jetbrains-mono.woff2"
}

brand() {
  mkdir -p "$SITE/brand"
  cp "$ROOT/build/brand/icons/favicon.svg" "$SITE/brand/favicon.svg"
  cp "$ROOT/build/brand/lockups/playroom-lockup-horizontal-dark.svg" "$SITE/brand/"
  cp "$ROOT/build/brand/lockups/playroom-lockup-stacked-dark.svg" "$SITE/brand/"
  cp "$ROOT/build/brand/lockups/engine-lockup-horizontal-dark.svg" "$SITE/brand/"
  cp "$ROOT/build/brand/marks/playroom-mark-glass.svg" "$SITE/brand/"
  cp "$ROOT/build/brand/marks/engine-mark-glass.svg" "$SITE/brand/"
  for f in favicon.ico apple-touch-icon.png icon-192.png icon-512-maskable.png; do
    cp "$ICON_DIR/$f" "$SITE/brand/$f"
  done
}

# The hero loop: the three recordings of Develop's before/after wipe, cropped to
# the photo (the recordings have a black edge), cross-faded, muted.
hero() {
  mkdir -p "$SITE/media"
  local recs=() f
  for f in "$REC_DIR"/*.mov; do recs+=("$f"); done
  [ "${#recs[@]}" -ge 3 ] || { echo "hero: need 3 recordings in $REC_DIR" >&2; return 1; }
  # Copy them to plain names (macOS puts a narrow no-break space before "PM").
  cp "${recs[0]}" "$SCRATCH/r1.mov"; cp "${recs[1]}" "$SCRATCH/r2.mov"; cp "${recs[2]}" "$SCRATCH/r3.mov"
  local v="crop=2148:1428:4:20,fps=30,scale=1600:-2:flags=lanczos,setsar=1,format=yuv420p,settb=AVTB"
  local graph="[0:v]$v[a];[1:v]$v[b];[2:v]$v[c];[a][b]xfade=transition=fade:duration=0.8:offset=8.2[ab];[ab][c]xfade=transition=fade:duration=0.8:offset=16.4[v]"
  local inputs=(-ss 1.0 -t 9.0 -i "$SCRATCH/r2.mov" -ss 1.0 -t 9.0 -i "$SCRATCH/r3.mov" -ss 1.5 -t 8.3 -i "$SCRATCH/r1.mov")
  ffmpeg -v error -y "${inputs[@]}" -filter_complex "$graph" -map "[v]" -an \
    -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -movflags +faststart "$SITE/media/hero.mp4"
  ffmpeg -v error -y "${inputs[@]}" -filter_complex "$graph" -map "[v]" -an \
    -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 "$SITE/media/hero.webm"
  # Poster: mid-wipe on the first clip, so a still (or reduced motion) still shows the idea.
  ffmpeg -v error -y -ss 4.2 -i "$SITE/media/hero.mp4" -frames:v 1 "$SCRATCH/poster.png"
  magick "$SCRATCH/poster.png" -quality 80 "$SITE/media/hero-poster.webp"
  magick "$SCRATCH/poster.png" -resize 1200x -quality 80 "$SITE/media/hero-poster.jpg"
}

# Before/after pairs. "After" is the exported edit. "Before" is rendered by the
# app from the CR2 with no edits but the edit's crop and orientation.
pairs() {
  mkdir -p "$SITE/pairs" "$SCRATCH/raws" "$SCRATCH/befores"
  local n
  for n in "${PAIRS[@]}"; do
    cp "$CARD_DIR/IMG_$n.CR2" "$CARD_DIR/IMG_$n.CR2.playroom.json" "$SCRATCH/raws/"
  done
  PLAYROOM_USER_DATA="$SCRATCH/profile" node "$ROOT/scripts/site-befores.mjs" "$SCRATCH/raws" "$SCRATCH/befores"
  for n in "${PAIRS[@]}"; do
    local b="$SCRATCH/befores/IMG_$n-before.jpg" a="$AFTER_DIR/IMG_$n-edit.jpg" side src s
    [ "$(magick identify -format '%wx%h' "$b")" = "$(magick identify -format '%wx%h' "$a")" ] ||
      echo "pairs: $n before and after differ in size" >&2
    for side in before after; do
      src="$b"; [ "$side" = after ] && src="$a"
      for s in 2400 1200; do
        magick "$src" -auto-orient -colorspace sRGB -resize "${s}x${s}" -strip -interlace JPEG -quality 82 "$SITE/pairs/$n-$side-$s.jpg"
        magick "$src" -auto-orient -colorspace sRGB -resize "${s}x${s}" -strip -quality 80 "$SITE/pairs/$n-$side-$s.webp"
      done
    done
    magick "$a" -auto-orient -colorspace sRGB -resize 240x160^ -gravity center -extent 240x160 -strip -quality 78 "$SITE/pairs/$n-thumb.webp"
  done
  # Captions come from the CR2s' EXIF (printed for pasting into index.html).
  (cd "$ROOT" && node -e '
    const exifr = require("exifr"); const dir = process.argv[1]; const ids = process.argv.slice(2);
    (async () => { for (const n of ids) {
      const e = await exifr.parse(`${dir}/IMG_${n}.CR2`, { pick: ["Model", "FNumber", "ExposureTime", "ISO", "FocalLength"] });
      const t = e.ExposureTime < 1 ? `1/${Math.round(1 / e.ExposureTime)}` : e.ExposureTime;
      console.log(`${n}: IMG_${n} · ${e.Model} · ${e.FocalLength} mm · f/${e.FNumber} · ${t} s · ISO ${e.ISO}`);
    } })()' "$SCRATCH/raws" "${PAIRS[@]}")
}

# App screenshots (placeholders until the final UI lands): drive the built app
# on the same photos, at 1600×1000 (16:10).
shots() {
  mkdir -p "$SITE/shots" "$SCRATCH/raws" "$SCRATCH/shots"
  local n
  for n in "${PAIRS[@]}"; do
    cp "$CARD_DIR/IMG_$n.CR2" "$CARD_DIR/IMG_$n.CR2.playroom.json" "$SCRATCH/raws/"
  done
  local drive=(env SCREENSHOT_DIR="$SCRATCH/shots" node "$ROOT/scripts/drive.mjs")
  printf '%s\n' launch "folder $SCRATCH/raws" 'wait 45000' 'ss library' 'open IMG_3273.CR2' \
    'panel masks' 'wait 1500' 'click-text Mask 1' 'wait 2500' 'ss develop-masks' quit |
    PLAYROOM_USER_DATA="$SCRATCH/p1" "${drive[@]}"
  printf '%s\n' launch "folder $SCRATCH/raws" 'open IMG_3218.CR2' 'panel grade' 'wait 2500' 'ss develop' \
    "eval window.__playroom.useLibrary.getState().setDialog('enhance')" 'wait 2500' \
    "eval [...document.querySelectorAll('p.error')].map(e => (e.remove(), 'x')).length" 'wait 800' 'ss enhance' quit |
    PLAYROOM_USER_DATA="$SCRATCH/p2" "${drive[@]}"
  local s
  for s in library develop develop-masks enhance; do
    magick "$SCRATCH/shots/$s.png" -resize 1600x1000 -quality 82 "$SITE/shots/$s.webp"
  done
}

# The formats strip: the app's own document icons (pnpm doc-icons), small.
formats() {
  mkdir -p "$SITE/formats"
  for f in raw dng jxl heic jpg tiff; do
    magick "$ROOT/build/doc-icons/png/$f-256.png" -resize 96x96 -strip \
      -define png:compression-level=9 "$SITE/formats/$f.png"
  done
}

# The link card, rendered from build/brand/og.html by brand-art.mjs.
og() {
  (cd "$ROOT" && pnpm exec electron scripts/brand-art.mjs og)
}

steps=("$@")
[ "${#steps[@]}" -gt 0 ] || steps=(fonts brand hero pairs shots formats og)
for s in "${steps[@]}"; do
  echo "== $s"
  "$s"
done
