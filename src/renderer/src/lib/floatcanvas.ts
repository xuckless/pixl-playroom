/**
 * Full HDR's presenter (engine 0.18): an F16 frame, linear Display P3 with
 * 1.0 = SDR white, drawn on a WebGPU canvas that keeps values above 1
 * (`rgba16float`, `display-p3`, extended tone mapping). A float16 / WebGPU
 * canvas takes sRGB-encoded values, so the sign-preserving sRGB curve is
 * applied to the colour (never alpha) as it is drawn (integration guide §4.5).
 * Without WebGPU, callers draw the frame's SDR companion instead.
 */

/** An F16 frame as main's engine sent it: RGBA half floats, row by row. */
export interface FloatFrame {
  width: number
  height: number
  data: Uint16Array<ArrayBuffer>
}

const SHADER = /* wgsl */ `
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  var p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: Out;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f((p[i].x + 1.0) * 0.5, 1.0 - (p[i].y + 1.0) * 0.5);
  return o;
}
fn oetf(v: f32) -> f32 {
  let a = abs(v);
  let e = select(1.055 * pow(a, 1.0 / 2.4) - 0.055, 12.92 * a, a <= 0.0031308);
  return sign(v) * e;
}
@fragment fn fs(i: Out) -> @location(0) vec4f {
  let c = textureSample(tex, smp, i.uv);
  return vec4f(oetf(c.r), oetf(c.g), oetf(c.b), c.a);
}
`

interface Gpu {
  device: GPUDevice
  pipeline: GPURenderPipeline
  sampler: GPUSampler
}

let gpu: Promise<Gpu | null> | null = null

/** The device and pipeline, made once; null where WebGPU is not there. */
function gpuOnce(): Promise<Gpu | null> {
  gpu ??= (async (): Promise<Gpu | null> => {
    try {
      const adapter = await navigator.gpu?.requestAdapter()
      if (!adapter) return null
      const device = await adapter.requestDevice()
      const module = device.createShaderModule({ code: SHADER })
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' }
      })
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
      device.lost.then(() => (gpu = null))
      return { device, pipeline, sampler }
    } catch {
      return null
    }
  })()
  return gpu
}

/** What `floatCanvasReady` last found: null before it is asked. */
let known: boolean | null = null

/** Whether Full HDR frames can be drawn here (WebGPU up). */
export async function floatCanvasReady(): Promise<boolean> {
  known = (await gpuOnce()) !== null
  return known
}

/** Whether F16 frames are known to draw here, without waiting (false until asked once). */
export function floatCanvasKnown(): boolean | null {
  return known
}

/** What a canvas keeps between frames: its context, configured once, and the texture it uploads into. */
interface CanvasGpu {
  /** The device it was configured for: a lost device's successor configures it again. */
  device: GPUDevice
  ctx: GPUCanvasContext
  tex: GPUTexture | null
  bind: GPUBindGroup | null
}

const canvases = new WeakMap<HTMLCanvasElement, CanvasGpu>()

/** `canvas`'s WebGPU context, configured on first use; null when it will not take one. */
function canvasGpu(g: Gpu, canvas: HTMLCanvasElement): CanvasGpu | null {
  const kept = canvases.get(canvas)
  if (kept && kept.device === g.device) return kept
  const ctx = kept?.ctx ?? canvas.getContext('webgpu')
  if (!ctx) return null
  try {
    ctx.configure({
      device: g.device,
      format: 'rgba16float',
      colorSpace: 'display-p3',
      toneMapping: { mode: 'extended' },
      alphaMode: 'premultiplied'
    })
  } catch {
    return null
  }
  const made: CanvasGpu = { device: g.device, ctx, tex: null, bind: null }
  canvases.set(canvas, made)
  return made
}

/** A canvas leaving the page: its texture goes now, not when the collector gets to it. */
export function releaseFloat(canvas: HTMLCanvasElement): void {
  const c = canvases.get(canvas)
  canvases.delete(canvas)
  const tex = c?.tex
  if (tex) void c.device.queue.onSubmittedWorkDone().then(() => tex.destroy())
}

/**
 * Draw `frame` on `canvas` (sized to it). False when WebGPU is not there or
 * the canvas would not take it: the caller draws the SDR companion. A canvas
 * keeps its context and its texture from frame to frame (a drag draws
 * dozens a second into one canvas); a texture is made only for a new size.
 */
export async function drawFloat(canvas: HTMLCanvasElement, frame: FloatFrame): Promise<boolean> {
  const g = await gpuOnce()
  if (!g) return false
  const c = canvasGpu(g, canvas)
  if (!c) return false
  if (canvas.width !== frame.width) canvas.width = frame.width
  if (canvas.height !== frame.height) canvas.height = frame.height
  if (!c.tex || c.tex.width !== frame.width || c.tex.height !== frame.height) {
    // The last size's goes once the GPU is done with what it drew.
    const old = c.tex
    if (old) void g.device.queue.onSubmittedWorkDone().then(() => old.destroy())
    c.tex = g.device.createTexture({
      size: [frame.width, frame.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    })
    c.bind = g.device.createBindGroup({
      layout: g.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: c.tex.createView() },
        { binding: 1, resource: g.sampler }
      ]
    })
  }
  // In the queue after the last frame's draw: that one reads what it was given.
  g.device.queue.writeTexture(
    { texture: c.tex },
    frame.data,
    { bytesPerRow: frame.width * 8 },
    { width: frame.width, height: frame.height }
  )
  const enc = g.device.createCommandEncoder()
  const pass = enc.beginRenderPass({
    colorAttachments: [
      {
        view: c.ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store'
      }
    ]
  })
  pass.setPipeline(g.pipeline)
  pass.setBindGroup(0, c.bind)
  pass.draw(3)
  pass.end()
  g.device.queue.submit([enc.finish()])
  return true
}
