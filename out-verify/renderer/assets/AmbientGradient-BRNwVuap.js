import{j as a,w as h,r as u}from"./index-BjPR7Ynt.js";import{C as p,c as v,a as i,u as g,b as x,S as d}from"./noise-x-iPUb0d.js";const y=37.5,w=`
${d}
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
`,C=`
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
`;function S({intensity:o,still:e}){const n=u.useRef(null),s=v(t=>t.size),l=v(t=>t.invalidate),c=u.useMemo(()=>({uTime:{value:y},uStrength:{value:1.6},uIntensity:{value:o},uRes:{value:[1,1]},uA:{value:new i("#6a4dff")},uB:{value:new i("#a88bff")},uC:{value:new i("#0a0716")},uD:{value:new i("#ff8fb3")}}),[]);return g(30,!e),u.useEffect(()=>{e&&l()},[e,l,s]),x((t,f)=>{const r=n.current;if(!r)return;r.uniforms.uTime.value+=Math.min(f,.05),r.uniforms.uIntensity.value=o;const m=t.gl.getPixelRatio();r.uniforms.uRes.value=[s.width*m,s.height*m]}),a.jsxs("mesh",{rotation:[-.9,0,.35],position:[0,-.4,0],children:[a.jsx("planeGeometry",{args:[14,12,160,140]}),a.jsx("shaderMaterial",{ref:n,uniforms:c,vertexShader:w,fragmentShader:C})]})}function R({intensity:o=1,still:e=!1}){return a.jsx(p,{className:"fx-canvas",frameloop:"demand",dpr:[1,1.5],camera:{position:[0,0,5],fov:45},gl:{alpha:!1,antialias:!1,powerPreference:"low-power"},onCreated:({gl:n})=>{h(n.domElement)},children:a.jsx(S,{intensity:o,still:e})})}export{R as default};
