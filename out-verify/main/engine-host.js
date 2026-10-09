"use strict";
const module$1 = require("module");
const concepts = require("./chunks/concepts-DZXwTWWX.js");
const ENGINE_PACKAGE = "@xuckless/pixl-engine";
const METHODS = ["engineVersion", "probe", "convert", "analyze", "suggestEncode"];
function send(msg) {
  process.parentPort.postMessage(msg);
}
function causeChain(err, depth = 0) {
  if (!(err instanceof Error) || depth > 6) return [];
  const { cause } = err;
  const causes = Array.isArray(cause) ? cause : cause === void 0 ? [] : [cause];
  return causes.flatMap((c) => {
    const message = c instanceof Error ? c.message : String(c);
    return [message, ...causeChain(c, depth + 1)];
  });
}
function loadNative() {
  try {
    const require2 = module$1.createRequire(__filename);
    const mod = require2(ENGINE_PACKAGE);
    const missing = METHODS.filter((m) => typeof mod[m] !== "function");
    if (missing.length > 0) {
      return { reason: `${ENGINE_PACKAGE} loaded but lacks: ${missing.join(", ")}` };
    }
    if (typeof mod.hasEnhance !== "function") mod.hasEnhance = () => false;
    if (typeof mod.bindingVersion !== "function") mod.bindingVersion = mod.engineVersion;
    return { engine: mod };
  } catch (err) {
    const e = err;
    const where = `${process.platform}-${process.arch}`;
    if (e.code === "MODULE_NOT_FOUND") {
      return { reason: `${ENGINE_PACKAGE} is not installed for ${where}` };
    }
    if (e.code === "VersionMismatch") {
      return { reason: `version mismatch on ${where}: ${e.message}`, code: e.code };
    }
    const detail = causeChain(e);
    return {
      reason: `${ENGINE_PACKAGE} failed to load on ${where}: ${e.message}` + (detail.length > 0 ? ` (${detail.join("; ")})` : "")
    };
  }
}
function toErrorShape(err) {
  if (err && typeof err === "object") {
    const e = err;
    return {
      message: typeof e.message === "string" ? e.message : String(err),
      code: typeof e.code === "string" ? e.code : "Unknown",
      detail: e.detail && typeof e.detail === "object" ? e.detail : void 0
    };
  }
  return { message: String(err), code: "Unknown" };
}
function bundledRuntime(e) {
  try {
    return typeof e.bundledRuntime === "function" ? e.bundledRuntime() : void 0;
  } catch {
    return void 0;
  }
}
const loaded = loadNative();
const engine = "engine" in loaded ? loaded.engine : void 0;
if (engine) {
  send({
    kind: "hello",
    status: "ready",
    version: engine.engineVersion(),
    enhance: engine.hasEnhance(),
    runtime: bundledRuntime(engine),
    prompt: typeof engine.segmentPrompt === "function"
  });
} else {
  send({
    kind: "hello",
    status: "unavailable",
    reason: "reason" in loaded ? loaded.reason : "",
    code: "code" in loaded ? loaded.code : void 0
  });
}
const aborts = /* @__PURE__ */ new Map();
const samSessions = /* @__PURE__ */ new Map();
const embeddings = /* @__PURE__ */ new Map();
const KEEP_EMBEDDINGS = 3;
const lanes = /* @__PURE__ */ new Map();
let concept = null;
function stale(what) {
  return Object.assign(new Error(`${what} is not loaded in this engine`), { code: "Stale" });
}
function session(name) {
  const s = samSessions.get(name);
  if (!s || s.obj.closed) throw stale(`model ${name}`);
  return s.obj;
}
async function sam(e, call, signal) {
  switch (call.op) {
    case "load": {
      const ref = JSON.stringify(call.ref);
      const had = samSessions.get(call.session);
      if (had && had.ref === ref && !had.obj.closed) return { op: "load", loadMs: 0 };
      had?.obj.close();
      samSessions.delete(call.session);
      const obj = await e.loadModelSession(call.ref);
      samSessions.set(call.session, { ref, obj });
      return { op: "load", loadMs: obj.loadMs };
    }
    case "embed": {
      const s = session(call.session);
      const request = { ...call.request, encoder: { ...call.request.encoder, model: s.model } };
      const made = await e.promptEmbedding(request, { sessions: [s], signal });
      embeddings.get(call.id)?.close();
      embeddings.delete(call.id);
      embeddings.set(call.id, made);
      while (embeddings.size > KEEP_EMBEDDINGS) {
        const [id, old] = embeddings.entries().next().value;
        old.close();
        embeddings.delete(id);
      }
      const report = made.report;
      return { op: "embed", provenance: made.provenance, modelMs: report?.model_ms ?? null };
    }
    case "decode": {
      const emb = embeddings.get(call.embedding);
      if (!emb || emb.closed) throw stale(`embedding ${call.embedding}`);
      embeddings.delete(call.embedding);
      embeddings.set(call.embedding, emb);
      const s = session(call.session);
      const maskInput = call.maskInput ? lanes.get(call.lane) : void 0;
      const request = { ...call.request, decoder: { ...call.request.decoder, model: s.model } };
      const r = await e.segmentPrompt(request, {
        embedding: emb,
        sessions: [s],
        signal,
        ...maskInput ? { maskInput } : {}
      });
      const i = call.pick ? concepts.pickBySize(
        call.pick,
        r.planes.map((p) => p.coverage),
        r.planes.map((p) => p.predicted_iou)
      ) : 0;
      const kept = i >= 0 && r.planes[i] ? [r.planes[i]] : [];
      if (call.keep && kept[0]) lanes.set(call.lane, kept[0].logits);
      return {
        op: "decode",
        planes: (call.pick ? kept : r.planes).map((p) => ({
          png: p.png,
          predicted_iou: p.predicted_iou,
          coverage: p.coverage,
          bounds: p.bounds
        })),
        plane_width: r.plane_width,
        plane_height: r.plane_height,
        model_ms: r.model_ms
      };
    }
    case "concept": {
      if (typeof e.segmentConcept !== "function")
        throw Object.assign(new Error("this engine has no phrase segmentation"), {
          code: "EngineUnavailable"
        });
      let reused = true;
      let embedMs = 0;
      if (!concept || concept.key !== call.key || concept.emb.closed) {
        concept?.emb.close();
        concept = null;
        reused = false;
        const t0 = Date.now();
        const emb = await e.promptEmbedding(call.embed, { signal });
        embedMs = Date.now() - t0;
        concept = { key: call.key, emb };
      }
      const t1 = Date.now();
      const r = await e.segmentConcept(call.request, { embedding: concept.emb, signal });
      return {
        op: "concept",
        instances: r.instances.map((i) => ({
          png: i.png,
          score: i.score,
          coverage: i.coverage,
          rect: i.rect
        })),
        presence: r.presence,
        reused,
        embedMs,
        conceptMs: Date.now() - t1
      };
    }
    case "release": {
      for (const id of call.embeddings ?? []) {
        embeddings.get(id)?.close();
        embeddings.delete(id);
      }
      for (const id of call.lanes ?? []) lanes.delete(id);
      for (const name of call.sessions ?? []) {
        samSessions.get(name)?.obj.close();
        samSessions.delete(name);
      }
      if (call.embeddings?.includes("concept")) {
        concept?.emb.close();
        concept = null;
      }
      return { op: "release" };
    }
  }
}
let previews;
function deliver(frame, result) {
  const r = result;
  if (!previews || !r?.output) return;
  const f16 = r.output.byteLength === r.width * r.height * 8;
  const msg = {
    frame,
    width: r.width,
    height: r.height,
    data: r.output,
    sample: f16 ? "F16" : "U8",
    ...r.companion ? {
      companion: {
        width: r.companion.width,
        height: r.companion.height,
        data: r.companion.data
      }
    } : {}
  };
  previews.postMessage(msg);
  r.output = null;
}
process.parentPort.on("message", (e) => {
  const msg = e.data;
  if (msg?.kind === "port") {
    previews?.close();
    previews = e.ports[0];
    previews?.start();
    return;
  }
  if (msg?.kind === "cancel") {
    aborts.get(msg.id)?.abort();
    return;
  }
  if (msg?.kind === "sam") {
    const { id: id2 } = msg;
    if (!engine || typeof engine.segmentPrompt !== "function") {
      send({
        kind: "response",
        id: id2,
        ok: false,
        error: { message: "this engine has no prompted segmentation", code: "EngineUnavailable" }
      });
      return;
    }
    let signal;
    if (msg.cancellable) {
      const abort = new AbortController();
      aborts.set(id2, abort);
      signal = abort.signal;
    }
    sam(engine, msg.call, signal).then(
      (result) => send({ kind: "response", id: id2, ok: true, result }),
      (err) => send({ kind: "response", id: id2, ok: false, error: toErrorShape(err) })
    ).finally(() => aborts.delete(id2));
    return;
  }
  if (!msg || msg.kind !== "request") return;
  const { id, method, args } = msg;
  if (!engine) {
    send({
      kind: "response",
      id,
      ok: false,
      error: { message: "engine unavailable", code: "EngineUnavailable" }
    });
    return;
  }
  const fn = engine[method];
  if (typeof fn !== "function") {
    send({
      kind: "response",
      id,
      ok: false,
      error: { message: `unknown engine method ${String(method)}`, code: "BadRequest" }
    });
    return;
  }
  let callArgs = args;
  if (msg.cancellable) {
    const abort = new AbortController();
    aborts.set(id, abort);
    callArgs = [...args, { signal: abort.signal }];
  }
  const frame = msg.frame;
  Promise.resolve().then(() => fn.apply(engine, callArgs)).then(
    (result) => {
      if (frame) deliver(frame, result);
      send({ kind: "response", id, ok: true, result });
    },
    (err) => send({ kind: "response", id, ok: false, error: toErrorShape(err) })
  ).finally(() => aborts.delete(id));
});
