"use strict";
const recipe = require("./recipe-DEuWaDNo.js");
const GRADIENT_EDGE = 512;
function gradientPlaneSize(frameWidth, frameHeight, edge = GRADIENT_EDGE) {
  if (!(frameWidth > 0 && frameHeight > 0)) return { width: edge, height: edge };
  return frameWidth >= frameHeight ? { width: edge, height: Math.max(1, Math.round(edge * frameHeight / frameWidth)) } : { width: Math.max(1, Math.round(edge * frameWidth / frameHeight)), height: edge };
}
const smooth = (e0, e1, x) => {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
function dither(x, y) {
  let h = Math.imul(x, 668265261) ^ Math.imul(y, 374761393);
  h = Math.imul(h ^ h >>> 15, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) % 1024 / 1024 - 0.5;
}
function radialGeometry(c) {
  const short = Math.min(c.width, c.height);
  return {
    cx: c.centre.x * c.width,
    cy: c.centre.y * c.height,
    rx: Math.max(0.5, c.radiusX * short),
    ry: Math.max(0.5, c.radiusY * short),
    angle: c.angle * Math.PI / 180
  };
}
const CENTRE_MIN = 0.02;
const CENTRE_MAX = 0.98;
function bidirectionalCentre(c) {
  const k = Math.min(CENTRE_MAX, Math.max(CENTRE_MIN, c.centre));
  return { x: c.start.x + (c.end.x - c.start.x) * k, y: c.start.y + (c.end.y - c.start.y) * k };
}
function gradientCoverage(c) {
  if (c.kind === "bidirectional") {
    const sx = c.start.x * c.width;
    const sy = c.start.y * c.height;
    const dx = c.end.x * c.width - sx;
    const dy = c.end.y * c.height - sy;
    const len2 = dx * dx + dy * dy;
    const k = Math.min(CENTRE_MAX, Math.max(CENTRE_MIN, c.centre));
    if (len2 < 1e-9) return () => 0;
    return (px, py) => {
      const t = ((px - sx) * dx + (py - sy) * dy) / len2;
      const u = t <= k ? t / k : (1 - t) / (1 - k);
      return smooth(0, 1, u);
    };
  }
  if (c.kind === "linear") {
    const sx = c.start.x * c.width;
    const sy = c.start.y * c.height;
    const dx = c.end.x * c.width - sx;
    const dy = c.end.y * c.height - sy;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return (px, py) => (px - sx) * dx + (py - sy) * dy <= 0 ? 1 : 0;
    return (px, py) => 1 - smooth(0, 1, ((px - sx) * dx + (py - sy) * dy) / len2);
  }
  const g = radialGeometry(c);
  const cos = Math.cos(-g.angle);
  const sin = Math.sin(-g.angle);
  const inner = 1 - Math.min(100, Math.max(0, c.softness)) / 100;
  return (px, py) => {
    const x = px - g.cx;
    const y = py - g.cy;
    const u = (x * cos - y * sin) / g.rx;
    const v = (x * sin + y * cos) / g.ry;
    return 1 - smooth(inner, 1, Math.sqrt(u * u + v * v));
  };
}
function rasteriseGradient(c) {
  const w = Math.max(1, Math.round(c.width));
  const h = Math.max(1, Math.round(c.height));
  const out = new Uint8Array(w * h);
  const at = gradientCoverage(c);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = at(x + 0.5, y + 0.5);
      out[y * w + x] = Math.max(0, Math.min(255, Math.round(v * 255 + dither(x, y))));
    }
  }
  return out;
}
function gradientKey(c) {
  const g = c.kind === "linear" ? [c.kind, c.start.x, c.start.y, c.end.x, c.end.y, c.width, c.height] : c.kind === "bidirectional" ? [c.kind, c.start.x, c.start.y, c.end.x, c.end.y, c.centre, c.width, c.height] : [
    c.kind,
    c.centre.x,
    c.centre.y,
    c.radiusX,
    c.radiusY,
    c.angle,
    c.softness,
    c.width,
    c.height
  ];
  return recipe.hash32(
    JSON.stringify(g.map((v) => typeof v === "number" ? Math.round(v * 1e5) / 1e5 : v))
  ).toString(16).padStart(8, "0");
}
const inReach = (v) => Math.round(Math.min(2, Math.max(-1, v)) * 1e6) / 1e6;
const reachPoint = (p) => ({ x: inReach(p.x), y: inReach(p.y) });
function rasterGradient(c) {
  return !recipe.isPlainEdge(c.edge);
}
function gradientShape(c, user) {
  const turn = (p) => reachPoint(recipe.transformPoint(user, p));
  if (c.kind === "linear") {
    const from = turn(c.start);
    const to = turn(c.end);
    if (from.x === to.x && from.y === to.y) return null;
    return { LinearGradient: { from, to, ramp: "Smoothstep" } };
  }
  if (c.kind === "bidirectional") {
    const from = turn(c.start);
    const to = turn(c.end);
    if (from.x === to.x && from.y === to.y) return null;
    return {
      BidirectionalGradient: { from, centre: turn(bidirectionalCentre(c)), to, ramp: "Smoothstep" }
    };
  }
  const a = c.angle * Math.PI / 180;
  const o = recipe.transformPoint(user, { x: 0.5 + Math.cos(a), y: 0.5 + Math.sin(a) });
  const rotation = Math.round(Math.atan2(o.y - 0.5, o.x - 0.5) * 180 / Math.PI * 1e4) / 1e4;
  return {
    RadialGradient: {
      centre: turn(c.centre),
      radii: {
        x: Math.round(Math.min(4, Math.max(1e-4, c.radiusX)) * 1e6) / 1e6,
        y: Math.round(Math.min(4, Math.max(1e-4, c.radiusY)) * 1e6) / 1e6
      },
      rotation,
      feather: Math.round(Math.min(1, Math.max(0, c.softness / 100)) * 1e4) / 1e4,
      ramp: "Smoothstep"
    }
  };
}
exports.gradientKey = gradientKey;
exports.gradientPlaneSize = gradientPlaneSize;
exports.gradientShape = gradientShape;
exports.rasterGradient = rasterGradient;
exports.rasteriseGradient = rasteriseGradient;
