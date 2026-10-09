"use strict";
const fs = require("fs");
const worker_threads = require("worker_threads");
const ops = require("./ops-3iyMw7Ab.js");
require("path");
require("./gradients-BJM4U-Ix.js");
require("./recipe-CiIOoIr9.js");
require("./concepts-BqKJKtxp.js");
require("zlib");
worker_threads.parentPort?.on("message", (job) => {
  try {
    if (job.op === "gradient") {
      ops.writeGradientPlane(job.file, job.c, job.user);
      ops.pruneGradientsSometimes(job.dir);
    } else if (job.op === "brush")
      ops.writeBrushPlane(job.file, job.png, job.user, job.edge, job.object);
    else if (job.op === "compose") ops.composeMasked(job.image, job.mask, job.out);
    else if (job.op === "guard") ops.guardOverlay(job.src, job.guard, job.out, job.at);
    else if (job.op === "png8")
      fs.writeFileSync(job.out, ops.encodePng8(job.data, job.w, job.h, 1, [ops.CICP_DISPLAY_P3]));
    else if (job.op === "headroom") ops.writeHeadroomGuard(job.rgb, job.w, job.h, job.out);
    else if (job.op === "ramp") ops.writeRamp(job.file, job.w, job.h);
    else if (job.op === "unwarp") ops.unwarpMask(job.mask, job.map, job.w, job.h, job.out);
    else {
      const value = ops.buildPatch(job.withStroke, job.without, job.out, job.mask);
      worker_threads.parentPort?.postMessage({ id: job.id, value });
      return;
    }
    worker_threads.parentPort?.postMessage({ id: job.id, value: null });
  } catch (err) {
    worker_threads.parentPort?.postMessage({ id: job.id, error: err.message ?? String(err) });
  }
});
