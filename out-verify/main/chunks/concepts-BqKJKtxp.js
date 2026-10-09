"use strict";
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "zh-Hans", name: "简体中文" },
  { code: "ja", name: "日本語" },
  { code: "vi", name: "Tiếng Việt" }
];
function isLanguage(v) {
  return LANGUAGES.some((l) => l.code === v);
}
function isLanguageSetting(v) {
  return v === "system" || isLanguage(v);
}
function languageOf(tag) {
  const base = tag.toLowerCase().split(/[-_]/)[0];
  if (base === "zh") return "zh-Hans";
  return isLanguage(base) ? base : null;
}
function pickLanguage(preferred) {
  for (const tag of preferred) {
    const l = languageOf(tag);
    if (l) return l;
  }
  return "en";
}
function withoutContext(key) {
  return key.replace(/\|[a-z][\w-]*$/, "");
}
function fill(text, values) {
  text = withoutContext(text);
  if (!values) return text;
  return text.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (m, name) => values[name] === void 0 || values[name] === null ? m : String(values[name])
  );
}
let impl = fill;
let current = "en";
function setCurrentLanguage(l) {
  current = l;
}
function setTranslator(fn) {
  impl = fn;
}
function t(text, values) {
  return impl(text, values);
}
function tp(one, other, count, values) {
  const out = impl(other, { ...values, count });
  return out === other || out === fill(other, { ...values, count }) ? fill(count === 1 ? one : other, { ...values, count }) : out;
}
function midSentence(label) {
  const text = t(label);
  return current === "de" ? text : text.charAt(0).toLowerCase() + text.slice(1);
}
function tk(text) {
  return text;
}
const person = (id, label, ask, many = false, size = "small") => ({ id, label, ask, many, size, finders: ["parts", "text", "click"], group: "people" });
const CONCEPTS = [
  {
    id: "sky",
    label: tk("Sky"),
    ask: tk("Click the sky"),
    many: false,
    size: "best",
    finders: ["sky-model", "text", "click"],
    group: "scene"
  },
  person("body", tk("Person"), tk("Click the person"), false, "large"),
  person("face", tk("Face"), tk("Click the face")),
  person("hair", tk("Hair"), tk("Click the hair")),
  person("skin", tk("Skin"), tk("Click each patch of skin"), true),
  person("eyes", tk("Eyes"), tk("Click each eye"), true),
  person("brows", tk("Brows"), tk("Click each brow"), true),
  person("lips", tk("Lips"), tk("Click the lips")),
  person("teeth", tk("Teeth"), tk("Click the teeth")),
  person("clothes", tk("Clothes"), tk("Click each piece of clothing"), true)
];
const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));
function conceptOf(id) {
  return typeof id === "string" ? BY_ID.get(id) ?? null : null;
}
function pickBySize(size, area, iou) {
  const sure = area.map((_, i) => i).filter((i) => iou[i] >= 0.5);
  const pool = sure.length ? sure : area.map((_, i) => i);
  if (pool.length === 0) return -1;
  if (size === "best") return pool.reduce((b, i) => iou[i] > iou[b] ? i : b, pool[0]);
  return pool.reduce(
    (b, i) => (size === "small" ? area[i] < area[b] : area[i] > area[b]) ? i : b,
    pool[0]
  );
}
exports.conceptOf = conceptOf;
exports.fill = fill;
exports.isLanguageSetting = isLanguageSetting;
exports.midSentence = midSentence;
exports.pickBySize = pickBySize;
exports.pickLanguage = pickLanguage;
exports.setCurrentLanguage = setCurrentLanguage;
exports.setTranslator = setTranslator;
exports.t = t;
exports.tk = tk;
exports.tp = tp;
