"use strict";
const concepts = require("./concepts-DZXwTWWX.js");
const MATRICES = {
  Normal: [
    [1, 0],
    [0, 1]
  ],
  FlipHorizontal: [
    [-1, 0],
    [0, 1]
  ],
  Rotate180: [
    [-1, 0],
    [0, -1]
  ],
  FlipVertical: [
    [1, 0],
    [0, -1]
  ],
  Transpose: [
    [0, 1],
    [1, 0]
  ],
  Rotate90: [
    [0, -1],
    [1, 0]
  ],
  Transverse: [
    [0, -1],
    [-1, 0]
  ],
  Rotate270: [
    [0, 1],
    [-1, 0]
  ]
};
const EXIF_ORDER = [
  "Normal",
  "FlipHorizontal",
  "Rotate180",
  "FlipVertical",
  "Transpose",
  "Rotate90",
  "Transverse",
  "Rotate270"
];
function fromExif(value) {
  return EXIF_ORDER[value - 1] ?? "Normal";
}
function mul$1(a, b) {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]]
  ];
}
function fromMatrix(m) {
  for (const o of EXIF_ORDER) {
    const n = MATRICES[o];
    if (n[0][0] === m[0][0] && n[0][1] === m[0][1] && n[1][0] === m[1][0] && n[1][1] === m[1][1])
      return o;
  }
  return "Normal";
}
function compose(first, after) {
  return fromMatrix(mul$1(MATRICES[after], MATRICES[first]));
}
function userOrientation(quarterTurns, flipHorizontal) {
  const turns = (quarterTurns % 4 + 4) % 4;
  let o = ["Normal", "Rotate90", "Rotate180", "Rotate270"][turns];
  if (flipHorizontal) o = compose(o, "FlipHorizontal");
  return o;
}
function swapsAxes(o) {
  return MATRICES[o][0][0] === 0;
}
function transformPoint(o, p) {
  const m = MATRICES[o];
  const cx = p.x - 0.5;
  const cy = p.y - 0.5;
  return { x: m[0][0] * cx + m[0][1] * cy + 0.5, y: m[1][0] * cx + m[1][1] * cy + 0.5 };
}
function sourceOf(o, dx, dy, w, h) {
  switch (o) {
    case "Normal":
      return [dx, dy];
    case "FlipHorizontal":
      return [w - 1 - dx, dy];
    case "Rotate180":
      return [w - 1 - dx, h - 1 - dy];
    case "FlipVertical":
      return [dx, h - 1 - dy];
    case "Transpose":
      return [dy, dx];
    case "Rotate90":
      return [dy, h - 1 - dx];
    case "Transverse":
      return [w - 1 - dy, h - 1 - dx];
    case "Rotate270":
      return [w - 1 - dy, dx];
  }
}
function orientPlane(o, data, w, h) {
  if (o === "Normal") return { data, width: w, height: h };
  const [ow, oh] = swapsAxes(o) ? [h, w] : [w, h];
  const out = new Uint8Array(ow * oh);
  for (let dy = 0; dy < oh; dy++) {
    for (let dx = 0; dx < ow; dx++) {
      const [sx, sy] = sourceOf(o, dx, dy, w, h);
      out[dy * ow + dx] = data[sy * w + sx];
    }
  }
  return { data: out, width: ow, height: oh };
}
const NO_ADD = { hue: 0, saturation: 0, amount: 0 };
const ADD_MAX = { light: 0.5, wash: 0.5 };
const ADD_SPACE = { light: "LinearSrgb", wash: "DisplayP3" };
const clamp$2 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round4 = (v) => Math.round(v * 1e4) / 1e4;
function hsvToRgb(hue, saturation) {
  const h = (hue % 360 + 360) % 360 / 60;
  const s = clamp$2(saturation, 0, 1);
  const f = (n) => {
    const k = (n + h) % 6;
    return 1 - s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}
function addColorOp(s, kind) {
  if (!(s.amount > 0)) return null;
  const [r, g, b] = hsvToRgb(s.hue, s.saturation / 100);
  return {
    AddColor: {
      color: { r: round4(r), g: round4(g), b: round4(b) },
      space: ADD_SPACE[kind],
      amount: round4(clamp$2(s.amount, 0, 100) / 100 * ADD_MAX[kind])
    }
  };
}
const FISHEYE_TYPES = [
  "fisheye",
  "equisolid",
  "orthographic",
  "stereographic",
  "fisheye_thoby"
];
const PROJECTION = {
  fisheye: "Equidistant",
  equisolid: "Equisolid",
  orthographic: "Orthographic",
  stereographic: "Stereographic",
  fisheye_thoby: { Thoby: { k1: 1.47, k2: 0.713 } }
};
const isFisheye = (type) => FISHEYE_TYPES.includes(type ?? "");
const isNum$1 = (v) => typeof v === "number" && Number.isFinite(v);
const nums = (v, n) => Array.isArray(v) && v.every(isNum$1) && (n === void 0 || v.length === n);
const DIST_ARITY = { poly3: 1, poly5: 2, ptlens: 3 };
const TCA_ARITY = { linear: 1, poly3: 3 };
function validateProfile(v, id) {
  if (typeof v !== "object" || v === null) return concepts.t("not a JSON object");
  const p = v;
  if (typeof p.maker !== "string" || typeof p.model !== "string")
    return concepts.t("`maker` and `model` must be strings");
  if (!["HalfShorterSide", "HalfDiagonal", "FarthestCorner", "Lensfun"].includes(p.unit))
    return concepts.t("`unit` must be HalfShorterSide, HalfDiagonal, FarthestCorner or Lensfun");
  const cal = p.calibration;
  if (p.unit === "Lensfun" && !(cal && isNum$1(cal.crop) && cal.crop > 0 && isNum$1(cal.aspect) && cal.aspect > 0))
    return concepts.t("a `Lensfun` profile needs `calibration`: its camera’s `crop` and `aspect`");
  const list = (key) => {
    const x = p[key];
    if (x === void 0) return [];
    if (!Array.isArray(x) || !x.every((e) => typeof e === "object" && e !== null))
      return concepts.t("`{{key}}` must be a list of samples", { key });
    return x;
  };
  const dist = list("distortion");
  const tca = list("tca");
  const vig = list("vignetting");
  const fish = list("fisheye");
  for (const l of [dist, tca, vig, fish]) if (typeof l === "string") return l;
  for (const s of fish) {
    const n = s.model === "none" ? 0 : DIST_ARITY[s.model];
    if (!isNum$1(s.focal) || n === void 0 || !nums(s.k, n))
      return concepts.t(
        "each fisheye sample needs `focal`, `model` (none, poly3, poly5, ptlens) and its `k`"
      );
    if (s.realFocal !== void 0 && !(isNum$1(s.realFocal) && s.realFocal > 0))
      return concepts.t("a fisheye sample’s `realFocal` must be a positive number");
  }
  for (const s of dist) {
    const n = DIST_ARITY[s.model];
    if (!isNum$1(s.focal) || !n || !nums(s.k, n))
      return concepts.t("each distortion sample needs `focal`, `model` (poly3, poly5, ptlens) and its `k`");
  }
  for (const s of tca) {
    const n = TCA_ARITY[s.model];
    if (!isNum$1(s.focal) || !n || !nums(s.red, n) || !nums(s.blue, n))
      return concepts.t("each tca sample needs `focal`, `model` (linear, poly3), `red` and `blue`");
  }
  for (const s of vig) {
    if (!isNum$1(s.focal) || !isNum$1(s.aperture) || !nums(s.k) || s.k.length < 1)
      return concepts.t("each vignetting sample needs `focal`, `aperture` and `k`");
    if (s.k.length > 3) return concepts.t("vignetting takes at most three coefficients");
  }
  const fisheyeLens = isFisheye(typeof p.type === "string" ? p.type : void 0);
  if (!dist.length && !tca.length && !vig.length && !fisheyeLens)
    return concepts.t("the profile corrects nothing");
  return {
    id,
    maker: p.maker,
    model: p.model,
    aliases: Array.isArray(p.aliases) ? p.aliases.filter((a) => typeof a === "string") : [],
    mount: typeof p.mount === "string" ? p.mount : void 0,
    mounts: Array.isArray(p.mounts) ? p.mounts.filter((m) => typeof m === "string") : void 0,
    type: typeof p.type === "string" ? p.type : void 0,
    focal: nums(p.focal) ? p.focal : void 0,
    source: typeof p.source === "string" ? p.source : void 0,
    unit: p.unit,
    calibration: p.unit === "Lensfun" ? { crop: cal.crop, aspect: cal.aspect } : void 0,
    distortion: dist,
    tca,
    vignetting: vig,
    ...fisheyeLens ? { fisheye: fish } : {}
  };
}
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function profileName(p) {
  return p.model.toLowerCase().startsWith(p.maker.toLowerCase()) ? p.model : `${p.maker} ${p.model}`;
}
function bare(name, maker) {
  const n = squash(name);
  const m = maker ? squash(maker) : "";
  return m && n.startsWith(m) && n.length > m.length ? n.slice(m.length) : n;
}
function findCamera(camera, cameras) {
  if (!camera?.model) return null;
  const want = bare(camera.model, camera.make);
  if (!want) return null;
  const names = (c) => [c.model, ...c.aliases ?? []].map((n) => bare(n, c.maker));
  const makerOk = (c) => !camera.make || squash(c.maker).startsWith(squash(camera.make).slice(0, 4));
  return cameras.find((c) => makerOk(c) && names(c).includes(want)) ?? null;
}
function shotCrop(lens, camera) {
  if (lens?.focal_mm && lens.focal_35mm && lens.focal_35mm >= lens.focal_mm * 0.9)
    return { value: Math.round(lens.focal_35mm / lens.focal_mm * 1e3) / 1e3, from: "exif" };
  if (camera) return { value: camera.crop, from: "camera" };
  return null;
}
function mountsFor(mount, mounts) {
  if (!mount) return null;
  const out = /* @__PURE__ */ new Set([mount]);
  for (const c of mounts.find((m) => m.name === mount)?.compat ?? []) out.add(c);
  return out;
}
function focalRange(p) {
  if (p.focal?.length) return [p.focal[0], p.focal[p.focal.length - 1]];
  const m = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*mm/i.exec(p.model);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return lo > 0 && hi >= lo ? [lo, hi] : null;
}
function lensScore(p, want, focal, mounts, crop) {
  const range = focalRange(p);
  if (focal && range) {
    const [lo, hi] = range;
    if (focal < lo * 0.97 || focal > hi * 1.03) return 0;
  }
  let best = 0;
  for (const n of [p.model, ...p.aliases ?? []].map((x) => bare(x, p.maker))) {
    if (!n) continue;
    if (n === want) best = Math.max(best, 100);
    else {
      const [short, long] = n.length < want.length ? [n, want] : [want, n];
      if (short.length >= 6 && long.includes(short))
        best = Math.max(best, 40 + 40 * (short.length / long.length));
    }
  }
  if (!best) return 0;
  if (mounts && (p.mounts ?? (p.mount ? [p.mount] : [])).some((m) => mounts.has(m))) best += 5;
  if (crop && p.calibration) best += 4 / (1 + Math.abs(Math.log(p.calibration.crop / crop)) * 8);
  return best;
}
function matchProfile(lens, profiles, context = {}) {
  const want = lens?.model ? bare(lens.model, lens.make) : "";
  if (!want) return null;
  let best = null;
  let score = 0;
  for (const p of profiles) {
    const s = lensScore(
      p,
      want,
      lens?.focal_mm ?? null,
      context.mounts ?? null,
      context.crop ?? null
    );
    if (s > score) {
      best = p;
      score = s;
    }
  }
  return best;
}
function lensfunUnits(calibration, photo) {
  const a = Math.max(photo.width, photo.height) / Math.max(1, Math.min(photo.width, photo.height));
  const ac = calibration.aspect;
  const k = photo.crop / calibration.crop;
  const long = a / Math.hypot(a, 1);
  return {
    geometry: round6(k * (1 / Math.hypot(ac, 1)) * 0.5 / long),
    vignetting: round6(k * 0.5 / long)
  };
}
function interpolate(samples, x, key, k) {
  const sorted = [...samples].sort((a2, b2) => key(a2) - key(b2));
  if (sorted.length === 0) return [];
  if (x === null || sorted.length === 1) return k(sorted[Math.floor(sorted.length / 2)]);
  if (x <= key(sorted[0])) return k(sorted[0]);
  const last = sorted[sorted.length - 1];
  if (x >= key(last)) return k(last);
  const i = sorted.findIndex((s) => key(s) >= x);
  const a = sorted[i - 1];
  const b = sorted[i];
  const t2 = (x - key(a)) / (key(b) - key(a));
  return k(a).map((v, j) => v + t2 * (k(b)[j] - v));
}
function resolveProfile(p, lens, photo) {
  const known = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  const focal = known(lens?.focal_mm);
  const aperture = known(lens?.f_number);
  const distanceM = known(lens?.focus_distance_m);
  let distortion = null;
  if (p.distortion?.length) {
    const model = p.distortion[0].model;
    const k = interpolate(
      p.distortion.filter((s) => s.model === model),
      focal,
      (s) => s.focal,
      (s) => s.k
    );
    distortion = model === "poly3" ? { Poly3: { k1: k[0] } } : model === "poly5" ? { Poly5: { k1: k[0], k2: k[1] } } : { PtLens: { a: k[0], b: k[1], c: k[2] } };
  }
  let tca = null;
  if (p.tca?.length) {
    const model = p.tca[0].model;
    const same = p.tca.filter((s) => s.model === model);
    const red = interpolate(
      same,
      focal,
      (s) => s.focal,
      (s) => s.red
    );
    const blue = interpolate(
      same,
      focal,
      (s) => s.focal,
      (s) => s.blue
    );
    tca = model === "linear" ? { Scale: { red: red[0], blue: blue[0] } } : {
      Poly3: {
        red: { v: red[0], c: red[1], b: red[2] },
        blue: { v: blue[0], c: blue[1], b: blue[2] }
      }
    };
  }
  let vignetting = null;
  if (p.vignetting?.length) {
    const stops = (n) => 2 * Math.log2(n);
    const far = (x) => x.distance ?? Infinity;
    const byDistance = (list) => {
      if (!list.some((x) => x.distance !== void 0)) return list;
      const at = (x) => distanceM === null ? -far(x) : Math.abs(Math.log(Math.min(far(x), 1e3) / Math.max(0.05, distanceM)));
      const best = Math.min(...list.map(at));
      return list.filter((x) => at(x) - best < 1e-6);
    };
    const byAperture = aperture === null ? p.vignetting : (() => {
      const best = Math.min(
        ...p.vignetting.map((s) => Math.abs(stops(s.aperture) - stops(aperture)))
      );
      return p.vignetting.filter(
        (s) => Math.abs(Math.abs(stops(s.aperture) - stops(aperture)) - best) < 1e-6
      );
    })();
    const nearest = byDistance(byAperture.length > 0 ? byAperture : p.vignetting);
    vignetting = nearest.length > 0 ? interpolate(
      nearest,
      focal,
      (s) => s.focal,
      (s) => s.k
    ) : null;
  }
  const out = {
    name: profileName(p),
    focal,
    aperture,
    unit: p.unit,
    distortion,
    tca,
    vignetting,
    ...isFisheye(p.type) ? { fisheye: resolveFisheye(p, p.type, focal) } : {}
  };
  if (p.unit === "Lensfun" && p.calibration && photo) {
    const crop = photo.crop ?? { value: p.calibration.crop, from: "calibration" };
    const u = lensfunUnits(p.calibration, {
      crop: crop.value,
      width: photo.width,
      height: photo.height
    });
    out.geometryUnit = { Focal: { x: u.geometry, y: u.geometry } };
    out.vignettingUnit = { Focal: { x: u.vignetting, y: u.vignetting } };
    out.crop = crop;
  }
  return out;
}
function resolveFisheye(p, type, focal) {
  const samples = p.fisheye ?? [];
  const model = samples.find((s) => s.model !== "none")?.model ?? "none";
  const same = samples.filter((s) => s.model === model);
  const real = same.length > 0 ? interpolate(
    same,
    focal,
    (s) => s.focal,
    (s) => [s.realFocal ?? s.focal]
  )[0] : focal ?? (p.focal?.length ? p.focal[0] : null);
  if (!real || !(real > 0)) return null;
  const k = model === "none" ? [] : interpolate(
    same,
    focal,
    (s) => s.focal,
    (s) => s.k
  );
  const polynomial = model === "poly3" ? { Poly3: { k1: round6(k[0]) } } : model === "poly5" ? { Poly5: { k1: round6(k[0]), k2: round6(k[1]) } } : model === "ptlens" ? { PtLens: { a: round6(k[0]), b: round6(k[1]), c: round6(k[2]) } } : null;
  const inUnit = p.unit === "Lensfun" && p.calibration ? real * p.calibration.crop * Math.hypot(p.calibration.aspect, 1) / FULL_FRAME_HALF_DIAGONAL : real;
  return { projection: PROJECTION[type], focal: round6(inUnit), polynomial };
}
const FULL_FRAME_HALF_DIAGONAL = Math.hypot(36, 24) / 2;
function defaultLens() {
  return {
    profile: {
      enabled: false,
      id: null,
      resolved: null,
      distortion: 100,
      vignetting: 100,
      defish: false,
      field: 100
    },
    distortion: 0,
    vignetting: 0,
    vignettingMidpoint: 50,
    removeCa: false,
    ca: null,
    defringe: { purpleAmount: 0, purpleHue: 300, greenAmount: 0, greenHue: 115 }
  };
}
const MANUAL_GEOMETRY = {
  centre: { x: 0.5, y: 0.5 },
  unit: "HalfDiagonal"
};
const MANUAL_K1 = 0.15;
const MANUAL_VIGNETTE = 0.6;
const clamp$1 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const geometryOf = (unit2) => ({ centre: { x: 0.5, y: 0.5 }, unit: unit2 });
function profileGeometry(p, what) {
  const unit2 = what === "geometry" ? p.geometryUnit : p.vignettingUnit;
  if (unit2) return geometryOf(unit2);
  if (p.unit === "Lensfun")
    return geometryOf(what === "geometry" ? "HalfShorterSide" : "HalfDiagonal");
  return geometryOf(p.unit);
}
function defishing(l) {
  return l.profile.enabled && l.profile.defish && !!l.profile.resolved?.fisheye;
}
function multiply(a, b) {
  const pa = [1, ...a];
  const pb = [1, ...b];
  const out = new Array(pa.length + pb.length - 1).fill(0);
  pa.forEach((x, i) => pb.forEach((y, j) => out[i + j] += x * y));
  return out.slice(1);
}
function manualFalloff(amount, midpoint) {
  const s = clamp$1(amount, -100, 100) / 100 * MANUAL_VIGNETTE;
  const m = clamp$1(midpoint, 0, 100) / 100;
  return [-s * (1 - m), -s * m];
}
function lensCorrection(l) {
  const p = l.profile.enabled ? l.profile.resolved : null;
  let distortion = null;
  if (p?.fisheye && defishing(l)) {
    distortion = {
      model: { Fisheye: p.fisheye },
      geometry: profileGeometry(p, "geometry"),
      amount: round6(clamp$1(l.profile.distortion / 100, 0, 2)),
      scale: round6(clamp$1((l.profile.field ?? 100) / 100, 0.5, 1))
    };
  } else if (p?.distortion && l.profile.distortion > 0) {
    distortion = {
      model: p.distortion,
      geometry: profileGeometry(p, "geometry"),
      amount: round6(clamp$1(l.profile.distortion / 100, 0, 2)),
      scale: 1
    };
  } else if (l.distortion !== 0) {
    distortion = {
      model: { Poly3: { k1: round6(-clamp$1(l.distortion, -100, 100) / 100 * MANUAL_K1) } },
      geometry: MANUAL_GEOMETRY,
      amount: 1,
      scale: 1
    };
  }
  let lateral = null;
  if (l.removeCa && l.ca) lateral = { ...l.ca, amount: 1, planes: "Frame" };
  else if (l.removeCa && p?.tca)
    lateral = {
      model: p.tca,
      geometry: profileGeometry(p, "geometry"),
      amount: 1,
      // The source's own primaries: 0.16.0's, and valid for every source.
      planes: "Frame"
    };
  const profileVig = p?.vignetting && l.profile.vignetting > 0 ? p.vignetting.map((k) => k * clamp$1(l.profile.vignetting / 100, 0, 2)) : null;
  const manualVig = l.vignetting !== 0 ? manualFalloff(l.vignetting, l.vignettingMidpoint) : null;
  let vignetting = null;
  if (profileVig || manualVig) {
    const k = profileVig && manualVig ? multiply(profileVig, manualVig) : profileVig ?? manualVig;
    vignetting = {
      k: k.slice(0, 5).map(round6),
      apply: "Divide",
      at: "Source",
      geometry: profileVig && p ? profileGeometry(p, "vignetting") : MANUAL_GEOMETRY,
      amount: 1
    };
  }
  if (!distortion && !lateral && !vignetting) return null;
  const warps = distortion !== null || lateral !== null;
  return {
    distortion,
    lateral_ca: lateral,
    vignetting,
    outside: warps ? "Crop" : null,
    resampler: warps ? "Lanczos3" : null
  };
}
const FRINGE_WIDTH = 50;
const FRINGE_SOFTNESS = 15;
function defringeOp(l) {
  const d = l.defringe;
  if (!(d.purpleAmount > 0) && !(d.greenAmount > 0)) return null;
  const band = (hue, amount) => ({
    hue: { centre: (hue % 360 + 360) % 360, width: FRINGE_WIDTH, softness: FRINGE_SOFTNESS },
    amount: clamp$1(amount / 100, 0, 1)
  });
  return {
    Defringe: {
      purple: band(d.purpleHue, d.purpleAmount),
      green: band(d.greenHue, d.greenAmount),
      edges: { sigma: 6e-4, low: 0.03, high: 0.1 }
    }
  };
}
const DEFAULT_FOCAL = 35 / 43.27;
function defaultUpright() {
  return {
    mode: "off",
    suggested: null,
    guides: [],
    focal: DEFAULT_FOCAL,
    vertical: 0,
    horizontal: 0,
    rotate: 0,
    aspect: 0,
    scale: 100,
    offsetX: 0,
    offsetY: 0
  };
}
function equivalentFocal(lens, crop) {
  if (lens?.focal_35mm && lens.focal_35mm > 0) return lens.focal_35mm;
  if (lens?.focal_mm && lens.focal_mm > 0 && crop && crop > 0)
    return Math.round(lens.focal_mm * crop * 10) / 10;
  return null;
}
const MAX_TILT = 40;
const MAX_ROTATE = 10;
const MAX_OFFSET = 0.25;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round5 = (v) => Math.round(v * 1e5) / 1e5;
function uprightTransform(u, w, h) {
  const s = u.suggested;
  const t = {
    vertical: round5(clamp((s?.vertical ?? 0) + u.vertical / 100 * MAX_TILT, -80, 80)),
    horizontal: round5(clamp((s?.horizontal ?? 0) + u.horizontal / 100 * MAX_TILT, -80, 80)),
    rotate: round5(clamp((s?.rotate ?? 0) + u.rotate / 100 * MAX_ROTATE, -45, 45)),
    focal: round5(clamp(s?.focal ?? u.focal, 0.05, 20)),
    aspect: round5(clamp((s?.aspect ?? 0) + u.aspect / 100, -1, 1)),
    scale: round5(clamp((s?.scale ?? 1) * (clamp(u.scale, 50, 150) / 100), 0.1, 10)),
    offset: {
      x: round5(clamp((s?.offset.x ?? 0) + u.offsetX / 100 * MAX_OFFSET, -1, 1)),
      y: round5(clamp((s?.offset.y ?? 0) + u.offsetY / 100 * MAX_OFFSET, -1, 1))
    }
  };
  const identity = t.vertical === 0 && t.horizontal === 0 && t.rotate === 0 && t.aspect === 0 && t.scale === 1 && t.offset.x === 0 && t.offset.y === 0;
  if (identity) return null;
  if (w > 0 && h > 0) {
    const centre = apply(homography({ ...t, offset: { x: 0, y: 0 } }, w, h), w / 2, h / 2);
    if (centre) {
      t.offset = {
        x: round5(clamp(t.offset.x - (centre.x - w / 2) / w, -1, 1)),
        y: round5(clamp(t.offset.y - (centre.y - h / 2) / h, -1, 1))
      };
    }
  }
  return t;
}
function mul(a, b) {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det
  ];
}
function homography(t, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const f = t.focal * Math.hypot(w, h);
  const rad = Math.PI / 180;
  const [a, b, g] = [t.vertical * rad, t.horizontal * rad, t.rotate * rad];
  const Rx = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const Ry = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
  const Rz = [Math.cos(g), -Math.sin(g), 0, Math.sin(g), Math.cos(g), 0, 0, 0, 1];
  const R = mul(Rz, mul(Rx, Ry));
  const toRay = [1, 0, -cx, 0, 1, -cy, 0, 0, f];
  const project = [f, 0, cx, 0, f, cy, 0, 0, 1];
  const sx = t.scale * Math.pow(2, t.aspect / 2);
  const sy = t.scale * Math.pow(2, -t.aspect / 2);
  const after = [
    sx,
    0,
    cx - sx * cx + t.offset.x * w,
    0,
    sy,
    cy - sy * cy + t.offset.y * h,
    0,
    0,
    1
  ];
  return mul(after, mul(project, mul(R, toRay)));
}
function apply(m, x, y) {
  const X = m[0] * x + m[1] * y + m[2];
  const Y = m[3] * x + m[4] * y + m[5];
  const W = m[6] * x + m[7] * y + m[8];
  if (!(W > 1e-9)) return null;
  return { x: X / W, y: Y / W };
}
function canvasToFrame(t, w, h, p) {
  const q = apply(invert3(homography(t, w, h)), p.x * w, p.y * h);
  return q ? { x: q.x / w, y: q.y / h } : null;
}
function cropFitsWarp(crop, degrees, t, w, h) {
  const th = degrees * Math.PI / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const inv = t ? invert3(homography(t, w, h)) : null;
  const corners = [
    [crop.x, crop.y],
    [crop.x + crop.width, crop.y],
    [crop.x, crop.y + crop.height],
    [crop.x + crop.width, crop.y + crop.height]
  ];
  return corners.every(([nx, ny]) => {
    const qx = nx * w - w / 2;
    const qy = ny * h - h / 2;
    let px = c * qx + s * qy + w / 2;
    let py = -s * qx + c * qy + h / 2;
    if (inv) {
      const q = apply(inv, px, py);
      if (!q) return false;
      px = q.x;
      py = q.y;
    }
    return px >= -0.5 && px <= w + 0.5 && py >= -0.5 && py <= h + 0.5;
  });
}
const PIXEL_LABEL = {
  denoise: concepts.tk("AI Denoise"),
  enhance: concepts.tk("Enhance"),
  retouch: concepts.tk("Heal")
};
const RAW_DEVELOP_REV = "s";
const ENGINE_RENDER_REV = 3;
const HEX64 = /^[0-9a-f]{64}$/;
function normalisePixelStep(v) {
  if (!v || typeof v !== "object") return null;
  const s = v;
  if (typeof s.id !== "string" || typeof s.blob !== "string" || !HEX64.test(s.blob)) return null;
  if (s.kind !== "denoise" && s.kind !== "enhance" && s.kind !== "retouch") return null;
  const num2 = (x, d) => typeof x === "number" && Number.isFinite(x) ? x : d;
  return {
    id: s.id,
    kind: s.kind,
    label: typeof s.label === "string" ? s.label : PIXEL_LABEL[s.kind],
    blob: s.blob,
    alpha: typeof s.alpha === "string" && HEX64.test(s.alpha) ? s.alpha : null,
    scope: typeof s.scope === "string" ? s.scope : null,
    opacity: Math.max(0, Math.min(100, num2(s.opacity, 100))),
    width: Math.max(1, Math.round(num2(s.width, 1))),
    height: Math.max(1, Math.round(num2(s.height, 1))),
    rect: rectOf(s.rect),
    params: s.params && typeof s.params === "object" ? s.params : {}
  };
}
function rectOf(v) {
  if (!v || typeof v !== "object") return null;
  const r = v;
  const n = (x2) => typeof x2 === "number" && Number.isFinite(x2) ? Math.round(x2) : null;
  const x = n(r.x);
  const y = n(r.y);
  const w = n(r.w);
  const h = n(r.h);
  return x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0 ? { x, y, w, h } : null;
}
function stackSignature(steps) {
  return JSON.stringify(
    steps.map((s) => [s.blob, s.alpha, Math.round(s.opacity * 10) / 10, s.rect])
  );
}
function pixelStepRefusal(info) {
  return info.is_hdr ? concepts.t("HDR photos cannot take AI pixel steps yet") : null;
}
function replaceStep(steps, step) {
  return steps.map((s) => s.id === step.id ? step : s);
}
function placeStep(steps, step, basedOn) {
  if (!basedOn) return [...steps, step];
  const after = basedOn.at(-1);
  const i = after === void 0 ? 0 : steps.findIndex((s) => s.id === after) + 1;
  if (after !== void 0 && i === 0) return [...steps, step];
  return [...steps.slice(0, i), step, ...steps.slice(i)];
}
const EDGE_SHIFT_SPAN = 0.03;
const HARDEST = 10;
function isPlainEdge(e) {
  return !e || Math.round(e.shift) === 0 && Math.round(e.harden) === 0 && !e.inside;
}
function normaliseEdge(value) {
  if (!value || typeof value !== "object") return void 0;
  const v = value;
  const n = (x, lo, hi) => typeof x === "number" && Number.isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x))) : 0;
  const e = {
    shift: n(v.shift, -100, 100),
    harden: n(v.harden, 0, 100),
    ...v.inside === true ? { inside: true } : {}
  };
  return isPlainEdge(e) ? void 0 : e;
}
function edgeKey(e) {
  if (!e || Math.round(e.shift) === 0 && Math.round(e.harden) === 0) return "";
  return `-e${Math.round(e.shift)}h${Math.round(e.harden)}`;
}
function shiftPixels(shift, w, h) {
  return Math.round(Math.abs(shift) / 100 * EDGE_SHIFT_SPAN * Math.min(w, h));
}
function filterLine(src, out, start, stride, n, r, grow, pad, g, hb) {
  const pick = grow ? Math.max : Math.min;
  const size = 2 * r + 1;
  const m = n + 2 * r;
  for (let j = 0; j < m; j++) pad[j] = src[start + Math.min(n - 1, Math.max(0, j - r)) * stride];
  for (let j = 0; j < m; j++) g[j] = j % size === 0 ? pad[j] : pick(g[j - 1], pad[j]);
  for (let j = m - 1; j >= 0; j--)
    hb[j] = j === m - 1 || (j + 1) % size === 0 ? pad[j] : pick(hb[j + 1], pad[j]);
  for (let i = 0; i < n; i++) out[start + i * stride] = pick(hb[i], g[i + 2 * r]);
}
function shiftPlane(data, w, h, r, grow) {
  if (r <= 0) return data;
  const t = Math.floor((r - Math.round(r * (Math.SQRT2 - 1))) / 2);
  const a = r - 2 * t;
  const m = Math.max(w, h) + 2 * Math.max(a, t);
  const bufs = { pad: new Uint8Array(m), g: new Uint8Array(m), hb: new Uint8Array(m) };
  let cur = data;
  const pass = (lines, rad) => {
    if (rad <= 0) return;
    const out = new Uint8Array(cur.length);
    const src = cur;
    lines(
      (start, stride, n) => filterLine(src, out, start, stride, n, rad, grow, bufs.pad, bufs.g, bufs.hb)
    );
    cur = out;
  };
  pass((f) => {
    for (let y = 0; y < h; y++) f(y * w, 1, w);
  }, a);
  pass((f) => {
    for (let x = 0; x < w; x++) f(x, w, h);
  }, a);
  pass((f) => {
    for (let x = 0; x < w; x++) f(x, w + 1, Math.min(w - x, h));
    for (let y = 1; y < h; y++) f(y * w, w + 1, Math.min(w, h - y));
  }, t);
  pass((f) => {
    for (let x = 0; x < w; x++) f(x, w - 1, Math.min(x + 1, h));
    for (let y = 1; y < h; y++) f(y * w + w - 1, w - 1, Math.min(w, h - y));
  }, t);
  return cur;
}
function hardenLut(harden) {
  const k = 1 + Math.min(100, Math.max(0, harden)) / 100 * (HARDEST - 1);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++)
    lut[v] = Math.round(Math.min(255, Math.max(0, (v - 127.5) * k + 127.5)));
  return lut;
}
function applyEdge(data, w, h, e) {
  if (!e) return data;
  let out = shiftPlane(data, w, h, shiftPixels(e.shift, w, h), e.shift > 0);
  if (Math.round(e.harden) > 0) {
    const lut = hardenLut(e.harden);
    if (out === data) out = new Uint8Array(data);
    for (let i = 0; i < out.length; i++) out[i] = lut[out[i]];
  }
  return out;
}
function offsetPolygon(points, by, width, height) {
  const n = points.length;
  if (n < 3 || by === 0) return points;
  const short = Math.min(width, height);
  const p = points.map((q) => ({ x: q.x * width, y: q.y * height }));
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const side = area < 0 ? -1 : 1;
  const d = by * short;
  const normal = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return [side * dy / len, -side * dx / len];
  };
  return p.map((q, i) => {
    const prev = p[(i - 1 + n) % n];
    const next = p[(i + 1) % n];
    const [ax, ay] = normal(prev, q);
    const [bx, by2] = normal(q, next);
    let mx = ax + bx;
    let my = ay + by2;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      mx = ax;
      my = ay;
    } else {
      mx /= ml;
      my /= ml;
    }
    const cos = mx * ax + my * ay;
    const reach = Math.min(2, 1 / Math.max(cos, 0.5)) * d;
    return { x: (q.x + mx * reach) / width, y: (q.y + my * reach) / height };
  });
}
const PROMPT_VIAS = ["click", "box", "brush", "lasso", "sky", "look"];
const MAX_PROMPT_POINTS = 64;
const MIN_BOX = 2e-3;
const unit = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1e5) / 1e5;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
function normalisePrompt(v) {
  if (!v || typeof v !== "object") return null;
  const o = v;
  let rect = null;
  const r = o.rect;
  if (r && isNum(r.x) && isNum(r.y) && isNum(r.width) && isNum(r.height)) {
    const x = unit(r.x);
    const y = unit(r.y);
    const width = unit(Math.min(r.width, 1 - x));
    const height = unit(Math.min(r.height, 1 - y));
    if (width > 0 && height > 0) rect = { x, y, width, height };
  }
  const points = Array.isArray(o.points) ? o.points.filter((p) => !!p && typeof p === "object").filter((p) => isNum(p.x) && isNum(p.y)).slice(0, MAX_PROMPT_POINTS).map((p) => ({ x: unit(p.x), y: unit(p.y), fg: p.fg !== false })) : [];
  if (!rect && points.length === 0) return null;
  const out = { rect, points };
  if (Array.isArray(o.parts)) {
    const parts = o.parts;
    const ok = parts.length > 0 && parts.every(
      (n, i) => Number.isInteger(n) && n <= points.length && (i === 0 ? n >= 0 : n > parts[i - 1])
    );
    if (ok) out.parts = parts;
  }
  return out;
}
function enginePrompt(g, count = g.points.length) {
  return {
    rect: g.rect ? { ...g.rect } : null,
    points: g.points.slice(0, count).map((p) => ({
      at: { x: p.x, y: p.y },
      label: p.fg ? "Foreground" : "Background"
    }))
  };
}
function promptSteps(g) {
  const parts = g.parts && g.parts.length > 0 ? g.parts : [g.points.length];
  return parts[parts.length - 1] === g.points.length ? parts : [...parts, g.points.length];
}
function addPart(prev, part) {
  const points = [...prev.points, ...part.points];
  return {
    rect: part.rect ?? prev.rect,
    points,
    parts: [...promptSteps(prev), points.length].filter((n, i, all) => i === 0 || n > all[i - 1])
  };
}
function boxAround(points) {
  if (points.length === 0) return null;
  const xs = points.map((p) => Math.min(1, Math.max(0, p.x)));
  const ys = points.map((p) => Math.min(1, Math.max(0, p.y)));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width < MIN_BOX || height < MIN_BOX) return null;
  return { x: unit(x), y: unit(y), width: unit(width), height: unit(height) };
}
const STROKE_CLICKS = 12;
function strokePrompt(plane, width, height, clicks = STROKE_CLICKS) {
  let max = 0;
  for (const v of plane) if (v > max) max = v;
  if (max < 64) return null;
  const at = max * 0.9;
  const step = Math.max(1, Math.round(Math.max(width, height) / 128));
  const core = [];
  for (let y = step >> 1; y < height; y += step)
    for (let x = step >> 1; x < width; x += step)
      if (plane[y * width + x] >= at) core.push({ x, y });
  if (core.length === 0) return null;
  const cx = core.reduce((s, p) => s + p.x, 0) / core.length;
  const cy = core.reduce((s, p) => s + p.y, 0) / core.length;
  const d2 = (p, x, y) => (p.x - x) ** 2 + (p.y - y) ** 2;
  let first = 0;
  for (let i = 1; i < core.length; i++) if (d2(core[i], cx, cy) < d2(core[first], cx, cy)) first = i;
  const taken = [core[first]];
  const far = core.map((p) => d2(p, core[first].x, core[first].y));
  const apart = (2 * step) ** 2;
  while (taken.length < clicks) {
    let i = 0;
    for (let k = 1; k < far.length; k++) if (far[k] > far[i]) i = k;
    if (far[i] < apart) break;
    taken.push(core[i]);
    for (let k = 0; k < far.length; k++)
      far[k] = Math.min(far[k], d2(core[k], core[i].x, core[i].y));
  }
  return {
    rect: null,
    points: taken.map((p) => ({
      x: unit((p.x + 0.5) / width),
      y: unit((p.y + 0.5) / height),
      fg: true
    }))
  };
}
function strokeObject(held, area, enough = 0.85) {
  let best = -1;
  for (let i = 0; i < held.length; i++)
    if (held[i] >= enough && (best < 0 || area[i] < area[best])) best = i;
  if (best >= 0) return best;
  for (let i = 0; i < held.length; i++) if (best < 0 || held[i] > held[best]) best = i;
  return best;
}
const FACE_PARTS = ["eyes", "brows", "lips", "teeth"];
const FACE_DETECTOR = "yunet-2023mar";
const FACE_LANDMARKER = "face-mesh-v2";
const isFacePart = (v) => FACE_PARTS.includes(v);
const FACE_PART_LABEL = {
  eyes: concepts.tk("Eyes"),
  brows: concepts.tk("Brows"),
  lips: concepts.tk("Lips"),
  teeth: concepts.tk("Teeth")
};
const RINGS = {
  eyes: ["left_eye", "right_eye"],
  brows: ["left_brow", "right_brow"],
  lips: ["lips"],
  teeth: ["inner_mouth"]
};
function partRings(outlines, part) {
  const out = [];
  for (const name of RINGS[part])
    for (const c of outlines[name]?.contours ?? [])
      if (c.points.length >= 3) out.push(c.points.map((p) => ({ x: p.x, y: p.y })));
  return out;
}
function shownRings(found) {
  if (found.face !== null && found.faces[found.face]) return found.faces[found.face].rings;
  return found.faces.flatMap((f) => f.rings);
}
function leftToRight(faces) {
  return [...faces].sort((a, b) => a.bounds[0] + a.bounds[2] / 2 - (b.bounds[0] + b.bounds[2] / 2));
}
function faceTiles(w, h) {
  const tw = Math.round(w * 0.625);
  const th = Math.round(h * 0.625);
  return [
    { x: 0, y: 0, width: tw, height: th },
    { x: w - tw, y: 0, width: tw, height: th },
    { x: 0, y: h - th, width: tw, height: th },
    { x: w - tw, y: h - th, width: tw, height: th }
  ];
}
const iou = (a, b) => {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a[2] * a[3] + b[2] * b[3] - i;
  return u > 0 ? i / u : 0;
};
function mergeFaces(whole, tiles, w, h) {
  const out = [...whole];
  const margin = 2;
  for (const { tile, faces } of tiles)
    for (const f of faces) {
      const [x, y, fw, fh] = f.bounds;
      const cut = x <= tile.x + margin && tile.x > 0 || y <= tile.y + margin && tile.y > 0 || x + fw >= tile.x + tile.width - margin && tile.x + tile.width < w || y + fh >= tile.y + tile.height - margin && tile.y + tile.height < h;
      if (cut) continue;
      if (out.some((o) => iou(o.bounds, f.bounds) > 0.3)) continue;
      out.push(f);
    }
  return out;
}
const RECIPE_VERSION = 4;
const HSL_BANDS = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta"
];
const MAX_POINT_COLORS = 8;
const RETIRED_DENOISE = "scunet-color-real";
const NAFNET_DENOISE = false;
function aiDenoiseModel(v) {
  return v === "drunet-color" || !NAFNET_DENOISE ? "drunet-color" : "nafnet-sidd-w32";
}
function hasPlane(c) {
  return c.kind === "brush" || c.kind === "depth";
}
const SETTINGS_KEYS = [
  "wb",
  "basic",
  "presence",
  "toneCurve",
  "hsl",
  "pointColors",
  "colorGrade",
  "detail",
  "effects",
  "calibration"
];
const IDENTITY_CURVE = () => [
  { x: 0, y: 0 },
  { x: 1, y: 1 }
];
const zeroBands = () => Object.fromEntries(HSL_BANDS.map((b) => [b, { hue: 0, saturation: 0, luminance: 0 }]));
const zeroMix = () => Object.fromEntries(HSL_BANDS.map((b) => [b, 0]));
const zeroWheel = () => ({ hue: 0, saturation: 0, luminance: 0 });
const ZERO_LOCAL = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  hue: 0,
  saturation: 0,
  sharpness: 0,
  noise: 0,
  tintHue: 0,
  tintAmount: 0,
  addHue: 0,
  addSaturation: 0,
  addAmount: 0
};
function defaultRecipe(isRaw) {
  return {
    version: RECIPE_VERSION,
    profile: isRaw ? { kind: "standard" } : { kind: "neutral" },
    profileAmount: 100,
    treatment: "color",
    gainMap: "base",
    wb: { mode: "as-shot", temperature: 0, tint: 0, preset: null },
    basic: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    presence: {
      texture: 0,
      clarity: 0,
      dehaze: 0,
      vibrance: 0,
      saturation: 0,
      hue: 0,
      smoothing: 100
    },
    toneCurve: {
      highlights: 0,
      lights: 0,
      darks: 0,
      shadows: 0,
      splits: [25, 50, 75],
      master: IDENTITY_CURVE(),
      red: IDENTITY_CURVE(),
      green: IDENTITY_CURVE(),
      blue: IDENTITY_CURVE(),
      refineSaturation: 100
    },
    hsl: zeroBands(),
    bwMix: zeroMix(),
    pointColors: [],
    colorGrade: {
      shadows: zeroWheel(),
      midtones: zeroWheel(),
      highlights: zeroWheel(),
      global: zeroWheel(),
      blending: 50,
      balance: 0,
      add: { ...NO_ADD }
    },
    detail: {
      sharpenAmount: isRaw ? 40 : 0,
      sharpenRadius: 1,
      sharpenDetail: 25,
      // A RAW sharpens edges, not the denoised grain of flat areas (HR-0.18-2).
      sharpenMasking: isRaw ? 50 : 0,
      noiseLuminance: 0,
      noiseLuminanceDetail: 50,
      noiseColor: isRaw ? 25 : 0,
      noiseColorDetail: 50,
      rawDenoise: false,
      ai: { enabled: false, model: aiDenoiseModel(RETIRED_DENOISE), strength: 100 }
    },
    lens: defaultLens(),
    effects: {
      vignetteAmount: 0,
      vignetteMidpoint: 50,
      vignetteRoundness: 0,
      vignetteFeather: 50,
      vignetteHighlights: 0,
      vignetteStyle: "highlight",
      wash: { ...NO_ADD },
      grainAmount: 0,
      grainSize: 25,
      grainRoughness: 50
    },
    calibration: {
      shadowsTint: 0,
      redHue: 0,
      redSaturation: 0,
      greenHue: 0,
      greenSaturation: 0,
      blueHue: 0,
      blueSaturation: 0
    },
    geometry: {
      quarterTurns: 0,
      flipHorizontal: false,
      straighten: 0,
      crop: null,
      aspect: null,
      upright: defaultUpright()
    },
    retouch: [],
    pixels: [],
    layers: [],
    custom: []
  };
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function fill(base, value) {
  if (Array.isArray(base)) return Array.isArray(value) ? value : base;
  if (isObject(base)) {
    const out = {};
    const v = isObject(value) ? value : {};
    for (const k of Object.keys(base)) out[k] = fill(base[k], v[k]);
    for (const k of Object.keys(v)) if (!(k in out)) out[k] = v[k];
    return out;
  }
  if (base === null) return value === void 0 ? null : value;
  return typeof value === typeof base ? value : base;
}
function normaliseRecipe(value, isRaw) {
  const base = defaultRecipe(isRaw);
  const r = fill(base, value);
  const saved = isObject(value) && typeof value.version === "number" ? value.version : 1;
  const d = r.detail;
  if (saved < 3 && isRaw && d.sharpenAmount === 40 && d.sharpenRadius === 1 && d.sharpenDetail === 25 && d.sharpenMasking === 0)
    d.sharpenMasking = 50;
  r.version = RECIPE_VERSION;
  if (r.gainMap !== "hdr") r.gainMap = "base";
  if (!isObject(value) || !isObject(value.profile)) {
    r.profile = base.profile;
  }
  r.toneCurve = normaliseToneCurve(r.toneCurve);
  r.calibration = normaliseCalibration(r.calibration);
  d.ai.model = aiDenoiseModel(d.ai.model);
  r.geometry.crop = normaliseCrop(r.geometry.crop);
  r.layers = (r.layers ?? []).filter(isObject).map(({ overlayHue, ...withOld }) => {
    const l = { ...withOld };
    delete l.adjust;
    const settings = layerSettingsOf(withOld);
    settings.toneCurve = normaliseToneCurve(settings.toneCurve);
    settings.calibration = normaliseCalibration(settings.calibration);
    return {
      ...l,
      id: typeof l.id === "string" && l.id ? l.id : newId(),
      name: typeof l.name === "string" ? l.name : "Mask",
      enabled: l.enabled !== false,
      opacity: num(l.opacity, 100, 0, 100),
      blend: BLEND_MODES.includes(l.blend) ? l.blend : "Normal",
      invert: l.invert === true,
      ...typeof overlayHue === "number" && Number.isFinite(overlayHue) ? { overlayHue: (overlayHue % 360 + 360) % 360 } : {},
      amount: num(l.amount, 100, 0, 200),
      settings,
      components: (Array.isArray(l.components) ? l.components : []).map(normaliseComponent).filter((c) => c !== null)
    };
  });
  r.pixels = (Array.isArray(r.pixels) ? r.pixels : []).map(normalisePixelStep).filter((p) => p !== null);
  r.retouch = (Array.isArray(r.retouch) ? r.retouch : []).filter(
    (s) => isObject(s) && typeof s.id === "string" && typeof s.kind === "string" && Array.isArray(s.points) && typeof s.radius === "number"
  );
  r.pointColors = (Array.isArray(r.pointColors) ? r.pointColors : []).map(normalisePointColor).filter((p) => p !== null).slice(0, MAX_POINT_COLORS);
  r.presence.smoothing = num(r.presence.smoothing, 100, 0, 100);
  for (const l of r.layers)
    l.settings.presence.smoothing = num(l.settings.presence.smoothing, 100, 0, 100);
  if (saved < 4 && isEdited(r, isRaw)) {
    r.presence.smoothing = 0;
    for (const l of r.layers) l.settings.presence.smoothing = 0;
  }
  return r;
}
function normaliseCalibration(c) {
  return Object.fromEntries(
    Object.entries(c).map(([k, v]) => [k, num(v, 0, -100, 100)])
  );
}
const BLEND_MODES = [
  "Normal",
  "Multiply",
  "Screen",
  "Overlay",
  "SoftLight",
  "HardLight",
  "Darken",
  "Lighten",
  "Difference",
  "Add"
];
function normaliseCurve(v) {
  const points = (Array.isArray(v) ? v : []).filter(isObject).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: num(p.x, 0, 0, 1), y: num(p.y, 0, 0, 1) })).sort((a, b) => a.x - b.x);
  return points.length >= 2 ? points : IDENTITY_CURVE();
}
function normaliseToneCurve(tc) {
  const raw = Array.isArray(tc.splits) ? tc.splits : [];
  const splits = raw.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  const ok = raw.length === 3 && splits.length === 3 && splits[0] > 0 && splits[0] < splits[1] && splits[1] < splits[2] && splits[2] < 100;
  return {
    ...tc,
    splits: ok ? splits : [25, 50, 75],
    master: normaliseCurve(tc.master),
    red: normaliseCurve(tc.red),
    green: normaliseCurve(tc.green),
    blue: normaliseCurve(tc.blue)
  };
}
function normaliseCrop(v) {
  if (!isObject(v)) return null;
  const x = num(v.x, NaN, 0, 1);
  const y = num(v.y, NaN, 0, 1);
  const width = num(v.width, NaN, 0, 1 - x);
  const height = num(v.height, NaN, 0, 1 - y);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
function normalisePointColor(value) {
  if (!isObject(value)) return null;
  const v = value;
  return {
    id: typeof v.id === "string" && v.id ? v.id : newId(),
    hue: (num(v.hue, 0) % 360 + 360) % 360,
    saturation: num(v.saturation, 0, 0, 1),
    luminance: num(v.luminance, 0.5, 0, 1),
    shiftHue: num(v.shiftHue, 0, -100, 100),
    shiftSat: num(v.shiftSat, 0, -100, 100),
    shiftLum: num(v.shiftLum, 0, -100, 100),
    range: num(v.range, 50, 0, 100)
  };
}
function num(v, def, lo = -Infinity, hi = Infinity) {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}
function point(v, def) {
  return isObject(v) ? { x: num(v.x, def.x), y: num(v.y, def.y) } : def;
}
function ringsOf(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((r) => Array.isArray(r) && r.length >= 3).map((r) => r.map((p) => point(p, { x: 0, y: 0 })));
}
function foundOf(v) {
  if (!isObject(v) || !isFacePart(v.part) || !Array.isArray(v.faces)) return null;
  const faces = v.faces.filter(isObject).map((f) => {
    const b = Array.isArray(f.bounds) ? f.bounds : [];
    return {
      bounds: [0, 1, 2, 3].map((i) => num(b[i], 0)),
      rings: ringsOf(f.rings)
    };
  }).filter((f) => f.rings.length > 0);
  if (faces.length === 0) return null;
  const face = typeof v.face === "number" && Number.isInteger(v.face) && v.face >= 0 && v.face < faces.length ? v.face : null;
  return { part: v.part, faces, face };
}
const MASK_MODES = ["Add", "Subtract", "Intersect"];
function brushSource(v) {
  if (!isObject(v)) return null;
  if (v.kind === "segment" && (v.target === "subject" || v.target === "background" || v.target === "sky" || v.target === "vegetation" || v.target === "water"))
    return { kind: "segment", target: v.target, ...v.fine === true ? { fine: true } : {} };
  if (v.kind === "person" && typeof v.part === "string") return { kind: "person", part: v.part };
  if (v.kind === "phrase" && typeof v.text === "string" && v.text.trim())
    return { kind: "phrase", text: v.text.trim().slice(0, 80) };
  if (v.kind === "prompt") {
    const prompt = normalisePrompt(v.prompt);
    return {
      kind: "prompt",
      ...typeof v.label === "string" && v.label ? { label: v.label } : {},
      ...prompt ? { prompt } : {},
      ...PROMPT_VIAS.includes(v.via) ? { via: v.via } : {},
      ...concepts.conceptOf(v.concept) ? { concept: v.concept } : {}
    };
  }
  return null;
}
function normaliseComponent(value) {
  if (!isObject(value)) return null;
  const c = value;
  const base = {
    id: typeof c.id === "string" && c.id ? c.id : newId(),
    mode: MASK_MODES.includes(c.mode) ? c.mode : "Add",
    opacity: num(c.opacity, 100, 0, 100),
    invert: c.invert === true,
    feather: num(c.feather, 0, 0, 100),
    ...typeof c.name === "string" && c.name.trim() ? { name: c.name.trim() } : {},
    .../* @__PURE__ */ ((e) => e ? { edge: e } : {})(normaliseEdge(c.edge)),
    .../* @__PURE__ */ ((r) => r ? { refine: r } : {})(normaliseRefine(c.refine))
  };
  switch (c.kind) {
    case "brush":
      if (typeof c.png !== "string") return null;
      return {
        ...base,
        kind: "brush",
        png: c.png,
        // A plane held by reference (IPC, history, a project) keeps its reference.
        ...typeof c.ref === "string" && c.ref ? { ref: c.ref } : {},
        .../* @__PURE__ */ ((src) => src ? { source: src } : {})(brushSource(c.source)),
        width: num(c.width, 1),
        height: num(c.height, 1)
      };
    case "polygon": {
      if (!Array.isArray(c.points)) return null;
      const rings = ringsOf(c.rings);
      const found = foundOf(c.found);
      return {
        ...base,
        kind: "polygon",
        points: c.points.map((p) => point(p, { x: 0, y: 0 })),
        ...rings.length ? { rings } : {},
        ...found ? { found } : {}
      };
    }
    case "range":
      return {
        ...base,
        kind: "range",
        hue: c.hue ?? null,
        saturation: c.saturation ?? null,
        luma: c.luma ?? null,
        smoothness: num(c.smoothness, 0, 0, 100)
      };
    case "linear":
      return {
        ...base,
        kind: "linear",
        start: point(c.start, { x: 0.5, y: 0.25 }),
        end: point(c.end, { x: 0.5, y: 0.75 }),
        width: num(c.width, 512, 1),
        height: num(c.height, 512, 1)
      };
    case "radial":
      return {
        ...base,
        kind: "radial",
        centre: point(c.centre, { x: 0.5, y: 0.5 }),
        radiusX: num(c.radiusX, 0.3, 1e-3),
        radiusY: num(c.radiusY, 0.3, 1e-3),
        angle: num(c.angle, 0),
        softness: num(c.softness, 50, 0, 100),
        width: num(c.width, 512, 1),
        height: num(c.height, 512, 1)
      };
    case "bidirectional":
      return {
        ...base,
        kind: "bidirectional",
        start: point(c.start, { x: 0.5, y: 0.25 }),
        end: point(c.end, { x: 0.5, y: 0.75 }),
        centre: num(c.centre, 0.5, 0.02, 0.98),
        width: num(c.width, 512, 1),
        height: num(c.height, 512, 1)
      };
    case "depth": {
      if (typeof c.png !== "string") return null;
      const near = num(c.near, 0, 0, 100);
      return {
        ...base,
        kind: "depth",
        png: c.png,
        ...typeof c.ref === "string" && c.ref ? { ref: c.ref } : {},
        width: num(c.width, 1),
        height: num(c.height, 1),
        near,
        far: num(c.far, 33, near, 100),
        softness: num(c.softness, 10, 0, 100)
      };
    }
    default:
      return null;
  }
}
function normaliseRefine(v) {
  if (!isObject(v)) return null;
  return { on: v.on === true, radius: num(v.radius, 0.5, 0.05, 5) };
}
const RECIPE_GROUPS = [
  "profile",
  "whiteBalance",
  "basicTone",
  "presence",
  "toneCurve",
  "hsl",
  "colorGrade",
  "detailSharpen",
  "detailNoise",
  "lens",
  "effects",
  "calibration",
  "treatment",
  "crop",
  "upright",
  "orientation",
  "retouch",
  "localAdjustments",
  "custom",
  "hdr"
];
function applyGroups(to, from, groups) {
  const r = structuredClone(to);
  const f = structuredClone(from);
  for (const g of groups) {
    switch (g) {
      case "profile":
        r.profile = f.profile;
        r.profileAmount = f.profileAmount;
        break;
      case "whiteBalance":
        r.wb = f.wb;
        break;
      case "basicTone":
        r.basic = f.basic;
        break;
      case "presence":
        r.presence = f.presence;
        break;
      case "toneCurve":
        r.toneCurve = f.toneCurve;
        break;
      case "hsl":
        r.hsl = f.hsl;
        r.bwMix = f.bwMix;
        r.pointColors = f.pointColors;
        break;
      case "colorGrade":
        r.colorGrade = f.colorGrade;
        break;
      case "detailSharpen":
        r.detail.sharpenAmount = f.detail.sharpenAmount;
        r.detail.sharpenRadius = f.detail.sharpenRadius;
        r.detail.sharpenDetail = f.detail.sharpenDetail;
        r.detail.sharpenMasking = f.detail.sharpenMasking;
        break;
      case "detailNoise":
        r.detail.noiseLuminance = f.detail.noiseLuminance;
        r.detail.noiseLuminanceDetail = f.detail.noiseLuminanceDetail;
        r.detail.noiseColor = f.detail.noiseColor;
        r.detail.noiseColorDetail = f.detail.noiseColorDetail;
        r.detail.rawDenoise = f.detail.rawDenoise;
        r.detail.ai = f.detail.ai;
        break;
      case "lens":
        r.lens = f.lens;
        break;
      case "retouch":
        r.retouch = f.retouch;
        break;
      case "effects":
        r.effects = f.effects;
        break;
      case "calibration":
        r.calibration = f.calibration;
        break;
      case "treatment":
        r.treatment = f.treatment;
        break;
      case "crop":
        r.geometry.crop = f.geometry.crop;
        r.geometry.straighten = f.geometry.straighten;
        r.geometry.aspect = f.geometry.aspect;
        break;
      case "upright":
        r.geometry.upright = f.geometry.upright;
        break;
      case "orientation":
        r.geometry.quarterTurns = f.geometry.quarterTurns;
        r.geometry.flipHorizontal = f.geometry.flipHorizontal;
        break;
      case "localAdjustments":
        r.layers = f.layers;
        break;
      case "custom":
        r.custom = f.custom;
        break;
      case "hdr":
        r.gainMap = f.gainMap;
        break;
    }
  }
  return r;
}
function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== void 0);
  const kb = Object.keys(b).filter((k) => b[k] !== void 0);
  return ka.length === kb.length && ka.every((k) => sameValue(a[k], b[k]));
}
function changedFields(a, b, at = []) {
  if (isObject(a) && isObject(b)) {
    return Object.keys(a).flatMap((k) => changedFields(a[k], b[k], [...at, k]));
  }
  return sameValue(a, b) ? [] : [at];
}
function applyFields(to, from, fields) {
  const r = structuredClone(to);
  for (const path of fields) {
    if (path.length === 0) continue;
    let src = from;
    let dst = r;
    for (let i = 0; i < path.length - 1; i++) {
      src = isObject(src) ? src[path[i]] : void 0;
      const next = dst[path[i]];
      if (!isObject(next)) break;
      dst = next;
    }
    const last = path[path.length - 1];
    src = isObject(src) ? src[last] : void 0;
    if (src !== void 0 && last in dst) dst[last] = structuredClone(src);
  }
  return r;
}
function groupValues(r, g) {
  const d = r.detail;
  switch (g) {
    case "profile":
      return [r.profile, r.profileAmount];
    case "whiteBalance":
      return [r.wb];
    case "basicTone":
      return [r.basic];
    case "presence":
      return [r.presence];
    case "toneCurve":
      return [r.toneCurve];
    case "hsl":
      return [r.hsl, r.bwMix, r.pointColors];
    case "colorGrade":
      return [r.colorGrade];
    case "detailSharpen":
      return [d.sharpenAmount, d.sharpenRadius, d.sharpenDetail, d.sharpenMasking];
    case "detailNoise":
      return [d.noiseLuminance, d.noiseLuminanceDetail, d.noiseColor, d.noiseColorDetail, d.ai];
    case "lens":
      return [r.lens];
    case "retouch":
      return [r.retouch];
    case "effects":
      return [r.effects];
    case "calibration":
      return [r.calibration];
    case "treatment":
      return [r.treatment];
    case "crop":
      return [r.geometry.crop, r.geometry.straighten, r.geometry.aspect];
    case "upright":
      return [r.geometry.upright];
    case "orientation":
      return [r.geometry.quarterTurns, r.geometry.flipHorizontal];
    case "localAdjustments":
      return [r.layers];
    case "custom":
      return [r.custom];
    case "hdr":
      return [r.gainMap];
  }
}
const groupChanged = (a, b, g) => !sameValue(groupValues(a, g), groupValues(b, g));
function isEdited(r, isRaw) {
  if (r.pixels.length > 0) return true;
  const def = defaultRecipe(isRaw);
  return RECIPE_GROUPS.some((g) => groupChanged(r, def, g));
}
function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function newLocalLayer(name) {
  return {
    id: newId(),
    name,
    enabled: true,
    opacity: 100,
    blend: "Normal",
    invert: false,
    components: [],
    settings: neutralSettings(),
    amount: 100
  };
}
function slimRecipe(r, refOf, known) {
  if (!r.layers.some((l) => l.components.some((c) => hasPlane(c) && c.png))) return r;
  return {
    ...r,
    layers: r.layers.map((l) => ({
      ...l,
      components: l.components.map((c) => {
        if (!hasPlane(c) || !c.png) return c;
        const ref = c.ref ?? refOf(c.png);
        known?.(ref, c.png);
        return { ...c, png: "", ref };
      })
    }))
  };
}
function hydrateRecipe(r, get) {
  if (!r.layers.some((l) => l.components.some((c) => hasPlane(c) && !c.png && c.ref))) return r;
  return {
    ...r,
    layers: r.layers.map((l) => ({
      ...l,
      components: l.components.map((c) => {
        if (!hasPlane(c) || c.png || !c.ref) return c;
        const png = get(c.ref);
        if (png === void 0) return c;
        const out = { ...c, png };
        delete out.ref;
        return out;
      })
    }))
  };
}
function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function neutralSettings() {
  const r = defaultRecipe(false);
  const out = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, r[k]]));
  out.detail.ai = { ...out.detail.ai, enabled: false };
  return out;
}
function settingsFromAdjust(a) {
  const s = neutralSettings();
  if (a.temperature || a.tint)
    s.wb = { mode: "custom", temperature: a.temperature, tint: a.tint, preset: null };
  s.basic = {
    exposure: a.exposure,
    contrast: a.contrast,
    highlights: a.highlights,
    shadows: a.shadows,
    whites: a.whites,
    blacks: a.blacks
  };
  s.presence = {
    ...s.presence,
    texture: a.texture,
    clarity: a.clarity,
    dehaze: a.dehaze,
    saturation: a.saturation,
    hue: a.hue
  };
  s.detail.sharpenAmount = a.sharpness;
  s.detail.noiseLuminance = a.noise;
  if (a.tintAmount > 0)
    s.colorGrade.global = { hue: a.tintHue, saturation: a.tintAmount, luminance: 0 };
  s.colorGrade.add = { hue: a.addHue, saturation: a.addSaturation, amount: a.addAmount };
  return s;
}
function layerSettingsOf(l) {
  if (isObject(l.settings)) {
    const s = fill(neutralSettings(), l.settings);
    s.pointColors = (Array.isArray(s.pointColors) ? s.pointColors : []).map(normalisePointColor).filter((p) => p !== null).slice(0, MAX_POINT_COLORS);
    return s;
  }
  return settingsFromAdjust(fill(ZERO_LOCAL, l.adjust));
}
exports.EDGE_SHIFT_SPAN = EDGE_SHIFT_SPAN;
exports.ENGINE_RENDER_REV = ENGINE_RENDER_REV;
exports.FACE_DETECTOR = FACE_DETECTOR;
exports.FACE_LANDMARKER = FACE_LANDMARKER;
exports.FACE_PART_LABEL = FACE_PART_LABEL;
exports.HSL_BANDS = HSL_BANDS;
exports.MANUAL_GEOMETRY = MANUAL_GEOMETRY;
exports.NAFNET_DENOISE = NAFNET_DENOISE;
exports.RAW_DEVELOP_REV = RAW_DEVELOP_REV;
exports.RECIPE_GROUPS = RECIPE_GROUPS;
exports.RETIRED_DENOISE = RETIRED_DENOISE;
exports.addColorOp = addColorOp;
exports.addPart = addPart;
exports.aiDenoiseModel = aiDenoiseModel;
exports.applyEdge = applyEdge;
exports.applyFields = applyFields;
exports.applyGroups = applyGroups;
exports.boxAround = boxAround;
exports.canvasToFrame = canvasToFrame;
exports.changedFields = changedFields;
exports.compose = compose;
exports.cropFitsWarp = cropFitsWarp;
exports.defaultRecipe = defaultRecipe;
exports.defaultUpright = defaultUpright;
exports.defringeOp = defringeOp;
exports.edgeKey = edgeKey;
exports.enginePrompt = enginePrompt;
exports.equivalentFocal = equivalentFocal;
exports.faceTiles = faceTiles;
exports.findCamera = findCamera;
exports.fromExif = fromExif;
exports.hasPlane = hasPlane;
exports.hash32 = hash32;
exports.hydrateRecipe = hydrateRecipe;
exports.isEdited = isEdited;
exports.isFacePart = isFacePart;
exports.isPlainEdge = isPlainEdge;
exports.leftToRight = leftToRight;
exports.lensCorrection = lensCorrection;
exports.matchProfile = matchProfile;
exports.mergeFaces = mergeFaces;
exports.mountsFor = mountsFor;
exports.newId = newId;
exports.newLocalLayer = newLocalLayer;
exports.normaliseRecipe = normaliseRecipe;
exports.offsetPolygon = offsetPolygon;
exports.orientPlane = orientPlane;
exports.partRings = partRings;
exports.pixelStepRefusal = pixelStepRefusal;
exports.placeStep = placeStep;
exports.profileName = profileName;
exports.promptSteps = promptSteps;
exports.replaceStep = replaceStep;
exports.resolveProfile = resolveProfile;
exports.sameValue = sameValue;
exports.shotCrop = shotCrop;
exports.shownRings = shownRings;
exports.slimRecipe = slimRecipe;
exports.stackSignature = stackSignature;
exports.strokeObject = strokeObject;
exports.strokePrompt = strokePrompt;
exports.swapsAxes = swapsAxes;
exports.transformPoint = transformPoint;
exports.uprightTransform = uprightTransform;
exports.userOrientation = userOrientation;
exports.validateProfile = validateProfile;
