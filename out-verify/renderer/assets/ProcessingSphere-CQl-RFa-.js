import{j as n,w as p,r as a}from"./index-BnftGmD8.js";import{C as d,a as i,u as h,b as x,S as g}from"./noise-P0V2kogM.js";const w=`
${g}
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
`,z=`
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
`;function b({active:e}){const r=a.useRef(null),s=a.useRef(null),c=a.useMemo(()=>({uTime:{value:0},uAmp:{value:.12},uFreq:{value:1.1},uDeep:{value:new i("#2b1f66")},uMid:{value:new i("#7b68d8")},uLight:{value:new i("#b7a4ff")},uHot:{value:new i("#e9e2ff")}}),[]),[l,u]=a.useState(!e);return e&&l&&u(!1),a.useEffect(()=>{if(e)return;const m=setTimeout(()=>u(!0),2e3);return()=>clearTimeout(m)},[e]),h(30,e||!l),x((m,f)=>{const o=s.current;if(!o)return;const t=Math.min(f,.05);o.uniforms.uTime.value+=t*(e?1.1:.45);const v=e?.15:.07;o.uniforms.uAmp.value+=(v-o.uniforms.uAmp.value)*Math.min(1,t*2.5),r.current&&(r.current.rotation.y+=t*.18,r.current.rotation.x=Math.sin(o.uniforms.uTime.value*.3)*.25)}),n.jsxs("mesh",{ref:r,children:[n.jsx("icosahedronGeometry",{args:[1,28]}),n.jsx("shaderMaterial",{ref:s,uniforms:c,vertexShader:w,fragmentShader:z})]})}function y({active:e=!0}){return n.jsx(d,{className:"fx-canvas",frameloop:"demand",dpr:[1,1.5],camera:{position:[0,0,3.1],fov:40},gl:{alpha:!0,antialias:!1,powerPreference:"low-power"},onCreated:({gl:r})=>{r.setClearColor(0,0),p(r.domElement)},children:n.jsx(b,{active:e})})}export{y as default};
