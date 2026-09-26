import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, type ShaderMaterial } from 'three'
import { useFrameLimit } from './frames'
import { watchContext } from './mode'
import { SIMPLEX_3D } from './shaders/noise'

/** Where in its slow drift the gradient starts. */
const START_TIME = 37.5

const vertex = /* glsl */ `
${SIMPLEX_3D}
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;
varying float vH;
void main() {
  vUv = uv;
  vec3 p = position;
  float h = snoise(vec3(p.x * 0.28, p.y * 0.35, uTime * 0.07)) * uStrength;
  h += snoise(vec3(p.x * 0.7 + 3.0, p.y * 0.6, uTime * 0.11)) * uStrength * 0.35;
  p.z += h;
  vH = h / max(uStrength, 0.0001);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const fragment = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uD;
uniform float uTime;
uniform float uIntensity;
uniform vec2 uRes;
varying vec2 vUv;
varying float vH;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float t = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uC, uA, smoothstep(0.05, 0.55, t));
  col = mix(col, uB, smoothstep(0.5, 0.95, t) * 0.85);
  col = mix(col, uD, smoothstep(0.7, 1.0, vUv.x * 0.6 + t * 0.5) * 0.25);
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  float vig = smoothstep(0.85, 0.2, length(q * vec2(1.1, 1.3)));
  col *= vig * uIntensity * 0.42;
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

function Surface({ intensity }: { intensity: number }): React.JSX.Element {
  const mat = useRef<ShaderMaterial>(null)
  const size = useThree((s) => s.size)
  const uniforms = useMemo(
    () => ({
      uTime: { value: START_TIME },
      uStrength: { value: 1.6 },
      uIntensity: { value: intensity },
      uRes: { value: [1, 1] },
      uA: { value: new Color('#6a4dff') },
      uB: { value: new Color('#a88bff') },
      uC: { value: new Color('#0a0716') },
      uD: { value: new Color('#ff8fb3') }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  // A slow scene: thirty frames a second is plenty, and nothing while hidden.
  useFrameLimit(30)
  useFrame((state, dt) => {
    const m = mat.current
    if (!m) return
    m.uniforms.uTime.value += Math.min(dt, 0.05)
    m.uniforms.uIntensity.value = intensity
    const dpr = state.gl.getPixelRatio()
    m.uniforms.uRes.value = [size.width * dpr, size.height * dpr]
  })
  return (
    <mesh rotation={[-0.9, 0, 0.35]} position={[0, -0.4, 0]}>
      <planeGeometry args={[14, 12, 160, 140]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={vertex}
        fragmentShader={fragment}
      />
    </mesh>
  )
}

/** A slow shader gradient in the accent's purples: the empty and idle canvases, and behind dialogs. */
export default function AmbientGradient({
  intensity = 1
}: {
  intensity?: number
}): React.JSX.Element {
  return (
    <Canvas
      className="fx-canvas"
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 5], fov: 45 }}
      gl={{ alpha: false, antialias: false, powerPreference: 'low-power' }}
      onCreated={({ gl }) => {
        watchContext(gl.domElement)
      }}
    >
      <Surface intensity={intensity} />
    </Canvas>
  )
}
