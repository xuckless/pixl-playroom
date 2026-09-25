import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, type Mesh, type ShaderMaterial } from 'three'
import { watchContext } from './mode'
import { SIMPLEX_3D } from './shaders/noise'

const vertex = /* glsl */ `
${SIMPLEX_3D}
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;

float field(vec3 p) {
  return snoise(p * uFreq + vec3(uTime * 0.22, uTime * 0.17, uTime * 0.29)) * uAmp
    + snoise(p * uFreq * 2.3 - vec3(uTime * 0.21)) * uAmp * 0.35;
}

vec3 displaced(vec3 dir) {
  return dir * (1.0 + field(dir));
}

void main() {
  vec3 n = normalize(position);
  vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  float e = 0.012;
  vec3 p0 = displaced(n);
  vec3 p1 = displaced(normalize(n + t * e));
  vec3 p2 = displaced(normalize(n + b * e));
  vec3 nn = normalize(cross(p1 - p0, p2 - p0));
  vDisp = field(n) / max(uAmp, 0.0001);
  vec4 world = modelViewMatrix * vec4(p0, 1.0);
  vNormal = normalize(normalMatrix * nn);
  vView = normalize(-world.xyz);
  gl_Position = projectionMatrix * world;
}
`

const fragment = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uLight;
uniform vec3 uHot;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(vec3(-0.5, 0.7, 0.6));
  float diff = max(dot(n, l), 0.0);
  float d = clamp(vDisp * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = mix(uDeep, uMid, smoothstep(0.1, 0.6, d));
  base = mix(base, uLight, smoothstep(0.55, 0.95, d) * 0.8);
  float fres = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 2.4);
  vec3 h = normalize(l + normalize(vView));
  float spec = pow(max(dot(n, h), 0.0), 48.0);
  vec3 col = base * (0.35 + 0.75 * diff) + uHot * fres * 0.85 + vec3(spec) * 0.35;
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.035;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

function Blob({ active }: { active: boolean }): React.JSX.Element {
  const mesh = useRef<Mesh>(null)
  const mat = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.12 },
      uFreq: { value: 1.1 },
      uDeep: { value: new Color('#2b1f66') },
      uMid: { value: new Color('#7b68d8') },
      uLight: { value: new Color('#b7a4ff') },
      uHot: { value: new Color('#e9e2ff') }
    }),
    []
  )
  useFrame((_, dt) => {
    const m = mat.current
    if (!m) return
    m.uniforms.uTime.value += dt * (active ? 1.1 : 0.45)
    // The ripples swell while work runs and settle when it stops.
    const target = active ? 0.15 : 0.07
    m.uniforms.uAmp.value += (target - m.uniforms.uAmp.value) * Math.min(1, dt * 2.5)
    if (mesh.current) {
      mesh.current.rotation.y += dt * 0.18
      mesh.current.rotation.x = Math.sin(m.uniforms.uTime.value * 0.3) * 0.25
    }
  })
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1, 64]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={vertex}
        fragmentShader={fragment}
      />
    </mesh>
  )
}

/** A noise-rippled purple sphere, lit with a glass rim: the app's "working" object. */
export default function ProcessingSphere({
  active = true
}: {
  active?: boolean
}): React.JSX.Element {
  return (
    <Canvas
      className="fx-canvas"
      dpr={[1, 2]}
      camera={{ position: [0, 0, 3.1], fov: 40 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0)
        watchContext(gl.domElement)
      }}
    >
      <Blob active={active} />
    </Canvas>
  )
}
