"use strict";
const concepts = require("./concepts-DZXwTWWX.js");
const recipe = require("./recipe-DEuWaDNo.js");
const child_process = require("child_process");
const os = require("os");
const STRIP_ALL = { exif: false, icc: false, xmp: false, iptc: false };
const PRESERVE_ALL = { exif: true, icc: true, xmp: true, iptc: true };
function opKind(op) {
  return Object.keys(op)[0];
}
function unsupportedRaw(detail) {
  const d = detail?.["Unsupported"];
  const op = d && typeof d["operation"] === "string" ? d["operation"] : null;
  if (op === "raw frames")
    return concepts.t(
      "This RAW holds several frames (dual pixel, pixel shift or a burst), which Playroom cannot develop yet."
    );
  if (op === "raw decode")
    return typeof d?.["detail"] === "string" && d["detail"] ? concepts.t("This RAW format isn't supported ({{detail}}).", { detail: d["detail"] }) : concepts.t("This RAW format isn't supported.");
  return null;
}
function describeEngineError(code, detail) {
  if (code === "TooLarge") {
    const d = detail?.["TooLarge"];
    const px = d && typeof d["pixels"] === "number" ? d["pixels"] : null;
    const side = d && typeof d["side"] === "number" ? d["side"] : null;
    const size = px !== null ? concepts.tp("{{count}} megapixel", "{{count}} megapixels", Math.round(px / 1e6)) : concepts.t("too large");
    return side !== null ? concepts.t("This picture is {{size}} ({{side}} px on its longest side), more than Playroom opens.", {
      size,
      side
    }) : concepts.t("This picture is {{size}}, more than Playroom opens.", { size });
  }
  if (code === "StaleCache")
    return concepts.t("A saved render was made by another engine and is made again.");
  return null;
}
const READ_LIMITS = { max_pixels: 6e8, max_side: 65535 };
const PIXL_COLOUR_VERSION = 1;
const parseRawColour = (v) => v === "container" || v === "pixl:1" ? v : null;
function pixlSupported(info) {
  return !!info?.camera_colour?.pixl_versions.includes(PIXL_COLOUR_VERSION);
}
function defaultRawColour(info) {
  return pixlSupported(info) ? "pixl:1" : "container";
}
function resolveRawColour(recorded, info) {
  const c = parseRawColour(recorded);
  if (c === null) return defaultRawColour(info);
  return c === "pixl:1" && !pixlSupported(info) ? "container" : c;
}
function cameraColourOf(c) {
  return c === "pixl:1" ? { Pixl: { version: PIXL_COLOUR_VERSION } } : "Container";
}
function developMark(c) {
  return c === "pixl:1" ? `${recipe.RAW_DEVELOP_REV}p${PIXL_COLOUR_VERSION}` : recipe.RAW_DEVELOP_REV;
}
function asShotFor(info, c) {
  return (c === "pixl:1" ? info.camera_colour?.as_shot_white : null) ?? info.as_shot_white;
}
function effectiveInfo(info, c) {
  const white = asShotFor(info, c);
  return white === info.as_shot_white ? info : { ...info, as_shot_white: white };
}
function rawColourLabel(info, c) {
  const cc = info?.camera_colour;
  if (c === "pixl:1") return `PIXL${cc?.pixl_camera ? ` · ${cc.pixl_camera}` : ""}`;
  return concepts.t("Container (the file’s own)");
}
const RAW_EXTENSIONS = [
  "cr2",
  "cr3",
  "crw",
  "arw",
  "srf",
  "sr2",
  "nef",
  "nrw",
  "dng",
  "raf",
  "rw2",
  "orf",
  "pef",
  "srw",
  "mrw",
  "3fr",
  "iiq",
  "erf",
  "kdc",
  "x3f"
];
const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "heic",
  "heif",
  "avif",
  "jxl",
  "tif",
  "tiff",
  "webp",
  ...RAW_EXTENSIONS
];
function isRawExt(ext) {
  return RAW_EXTENSIONS.includes(ext.toLowerCase());
}
const DNG_OPCODES = { list1: "Apply", list2: "Apply" };
function rawDevelop(colour) {
  return {
    Develop: {
      scaling: true,
      demosaic: true,
      white_balance: true,
      calibrate: true,
      srgb_gamma: false,
      crop: "Best",
      resolution: "Full",
      colour: cameraColourOf(colour),
      dng_opcodes: DNG_OPCODES
    }
  };
}
function rawProxyDevelop(colour) {
  const full = rawDevelop(colour);
  return { Develop: { ...full.Develop, resolution: "Cell" } };
}
function rawMaster(colour, scene = {
  demosaic: "Classic",
  mosaic_denoise: null
}) {
  return {
    Scene: {
      white_balance: "AsShot",
      highlights: "InpaintOpposed",
      crop: "Best",
      denoise: null,
      mosaic_denoise: scene.mosaic_denoise,
      demosaic: scene.demosaic,
      resolution: "Full",
      colour: cameraColourOf(colour),
      dng_opcodes: DNG_OPCODES
    }
  };
}
function rawProxyMaster(colour) {
  const full = rawMaster(colour);
  return { Scene: { ...full.Scene, resolution: "Cell" } };
}
function rawBinnedMaster(colour, factor) {
  const full = rawMaster(colour);
  return { Scene: { ...full.Scene, resolution: { Binned: { factor } } } };
}
function binFactor(probeLong, cell, edge) {
  const f = Math.floor(probeLong / (edge * 1.02) / cell) * cell;
  return Math.min(Math.floor(64 / cell) * cell, Math.max(cell, f));
}
rawProxyDevelop("container");
const colourOf = (photo) => parseRawColour(photo.raw_colour) ?? "container";
function cellFactor(photo) {
  return photo.ext.toLowerCase() === "raf" && !/gfx/i.test(photo.camera ?? "") ? 3 : 2;
}
function proxyByCell(probeLong, cell, proxyEdge) {
  return proxyEdge * cell * 1.02 <= probeLong;
}
function sourceOrientation(info, raw) {
  if (info.input === "Raw" && raw !== null) return "Normal";
  if (info.input === "Heif") return "Normal";
  return recipe.fromExif(info.orientation);
}
function uprightFraming(orientation, info) {
  if (orientation === "Normal" && info.input !== "Heif") return null;
  return { orientation, rotate_degrees: 0, rotate_resampler: "Lanczos3", crop: null };
}
const HEIF_EXT = /^(heic|heif|hif|avif)$/i;
function versionStamp(photo, developed = true) {
  const mark = HEIF_EXT.test(photo.ext) ? "-u" : developed && isRawExt(photo.ext) ? `-${developMark(colourOf(photo))}` : "";
  return `${Math.round(photo.mtime)}-${photo.size}${mark}`;
}
const ASSUMED_HDR_PEAK = 1e3;
const SDR_WHITE_NITS = 203;
function displayPolicy(info, to) {
  if (info.is_hdr) {
    return {
      ToneMap: {
        to,
        operator: "Bt2390",
        mode: "PerChannel",
        source_peak: { Nits: info.peak_nits ?? ASSUMED_HDR_PEAK },
        target_peak_nits: SDR_WHITE_NITS,
        gamut: "Compress",
        intent: "RelativeColorimetric",
        black_point_compensation: false
      }
    };
  }
  return { ConvertTo: { to, intent: "RelativeColorimetric", black_point_compensation: false } };
}
let interactive;
function interactiveThreads() {
  if (interactive !== void 0) return interactive;
  interactive = Math.max(1, os.cpus().length - 2);
  if (process.platform === "darwin") {
    try {
      const n = parseInt(child_process.execFileSync("sysctl", ["-n", "hw.perflevel0.physicalcpu"]).toString(), 10);
      if (n > 0) interactive = n;
    } catch {
    }
  }
  return interactive;
}
const BACKGROUND_THREADS = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
function heavyThreads() {
  const n = BACKGROUND_THREADS * 2;
  return process.platform === "darwin" ? Math.min(n, interactiveThreads()) : n;
}
function gainMapOf(info) {
  return info?.gain_map ? "Base" : null;
}
function blankRequest(source, sink, input, info) {
  return {
    source: { Path: source },
    sink: { Path: sink },
    input,
    resize: "None",
    resampler: "Lanczos3",
    pixel: { depth: null, channels: null },
    encode: { Png: { compression: "Fast", filter: "Sub" } },
    metadata: STRIP_ALL,
    color: "Preserve",
    linear_resample: false,
    raw: null,
    upscaler: null,
    grade: null,
    dither: "None",
    hdr: null,
    sdr: null,
    gain_map: gainMapOf(info),
    threads: interactiveThreads(),
    framing: null,
    region: null,
    inspect: null,
    overlays: null,
    enhance: null,
    lens: null,
    retouch: null,
    output_sharpen: null,
    limits: READ_LIMITS,
    measure: null
  };
}
function seedOf(row) {
  return recipe.hash32(row.seed_path ?? row.path);
}
exports.BACKGROUND_THREADS = BACKGROUND_THREADS;
exports.IMAGE_EXTENSIONS = IMAGE_EXTENSIONS;
exports.PRESERVE_ALL = PRESERVE_ALL;
exports.READ_LIMITS = READ_LIMITS;
exports.STRIP_ALL = STRIP_ALL;
exports.asShotFor = asShotFor;
exports.binFactor = binFactor;
exports.blankRequest = blankRequest;
exports.cellFactor = cellFactor;
exports.colourOf = colourOf;
exports.defaultRawColour = defaultRawColour;
exports.describeEngineError = describeEngineError;
exports.developMark = developMark;
exports.displayPolicy = displayPolicy;
exports.effectiveInfo = effectiveInfo;
exports.gainMapOf = gainMapOf;
exports.heavyThreads = heavyThreads;
exports.interactiveThreads = interactiveThreads;
exports.isRawExt = isRawExt;
exports.opKind = opKind;
exports.parseRawColour = parseRawColour;
exports.pixlSupported = pixlSupported;
exports.proxyByCell = proxyByCell;
exports.rawBinnedMaster = rawBinnedMaster;
exports.rawColourLabel = rawColourLabel;
exports.rawDevelop = rawDevelop;
exports.rawMaster = rawMaster;
exports.rawProxyMaster = rawProxyMaster;
exports.resolveRawColour = resolveRawColour;
exports.seedOf = seedOf;
exports.sourceOrientation = sourceOrientation;
exports.unsupportedRaw = unsupportedRaw;
exports.uprightFraming = uprightFraming;
exports.versionStamp = versionStamp;
