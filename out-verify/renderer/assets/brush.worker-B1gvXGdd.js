(function(){"use strict";const U=(n,t,o)=>{if(t<=n)return o<n?0:1;const e=Math.min(1,Math.max(0,(o-n)/(t-n)));return e*e*(3-2*e)};function I(n,t,o,e,i,r,a,u,c){if(r<=0||u<=0)return;const s=r*(1-Math.min(100,Math.max(0,a))/100),f=Math.max(0,Math.floor(e-r)),m=Math.min(t-1,Math.ceil(e+r)),h=Math.max(0,Math.floor(i-r)),w=Math.min(o-1,Math.ceil(i+r));for(let l=h;l<=w;l++)for(let g=f;g<=m;g++){const S=Math.hypot(g+.5-e,l+.5-i);if(S>r)continue;let F=u*(1-U(s,r,S));if(c&&(F*=c(g,l)),F<=0)continue;const M=l*t+g;n[M]=n[M]+F*(1-n[M])}}function X(n,t,o,e){const i=Math.min(1,Math.max(0,o)),r=new Float32Array(n.length);for(let a=0;a<n.length;a++){const u=Math.min(t[a],i);r[a]=e?n[a]*(1-u):n[a]+u*(1-n[a])}return r}function k(n,t,o){const e=l=>{const g=l/255;return g<=.04045?g/12.92:Math.pow((g+.055)/1.055,2.4)},i=e(n),r=e(t),a=e(o),u=(.4124*i+.3576*r+.1805*a)/.95047,c=.2126*i+.7152*r+.0722*a,s=(.0193*i+.1192*r+.9505*a)/1.08883,f=l=>l>.008856?Math.cbrt(l):7.787*l+16/116,m=f(u),h=f(c),w=f(s);return[116*h-16,500*(m-h),200*(h-w)]}function L(n,t){return Math.hypot(n[0]-t[0],n[1]-t[1],n[2]-t[2])}function N(n){return 1-U(6,18,n)}const O=(()=>{const n=new Uint32Array(256);for(let t=0;t<256;t++){let o=t;for(let e=0;e<8;e++)o=o&1?3988292384^o>>>1:o>>>1;n[t]=o>>>0}return n})();function G(n){let t=4294967295;for(let o=0;o<n.length;o++)t=O[(t^n[o])&255]^t>>>8;return(t^4294967295)>>>0}function y(n,t){const o=new Uint8Array(12+t.length),e=new DataView(o.buffer);e.setUint32(0,t.length);for(let i=0;i<4;i++)o[4+i]=n.charCodeAt(i);return o.set(t,8),e.setUint32(8+t.length,G(o.subarray(4,8+t.length))),o}async function z(n){const t=new Blob([n]).stream().pipeThrough(new CompressionStream("deflate"));return new Uint8Array(await new Response(t).arrayBuffer())}function Y(n){let t="";for(let o=0;o<n.length;o+=32768)t+=String.fromCharCode(...n.subarray(o,o+32768));return btoa(t)}async function V(n,t,o){const e=new Uint8Array(13),i=new DataView(e.buffer);i.setUint32(0,t),i.setUint32(4,o),e[8]=8,e[9]=0;const r=new Uint8Array((t+1)*o);for(let s=0;s<o;s++)r.set(n.subarray(s*t,s*t+t),s*(t+1)+1);const a=[new Uint8Array([137,80,78,71,13,10,26,10]),y("IHDR",e),y("IDAT",await z(r)),y("IEND",new Uint8Array(0))],u=new Uint8Array(a.reduce((s,f)=>s+f.length,0));let c=0;for(const s of a)u.set(s,c),c+=s.length;return Y(u)}const b=n=>self.postMessage(n),A=`#version 300 es
in vec2 aPos;
uniform vec4 uRect; // x0, y0, x1, y1 in target pixels
uniform vec2 uSize; // target size
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aPos);
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}`,H=`#version 300 es
precision highp float;
uniform vec2 uCentre;   // plane pixels
uniform float uR;       // plane pixels
uniform float uInner;
uniform float uFlow;
uniform vec2 uPlane;    // plane size
uniform bool uAuto;
uniform sampler2D uPicture;
uniform vec2 uRef;      // display coords of the dab's centre
uniform mat3 uToDisplay;
out vec4 o;

vec3 lin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
float f(float t) { return t > 0.008856 ? pow(t, 1.0 / 3.0) : 7.787 * t + 16.0 / 116.0; }
vec3 lab(vec3 srgb) {
  vec3 c = lin(srgb);
  float X = (0.4124 * c.r + 0.3576 * c.g + 0.1805 * c.b) / 0.95047;
  float Y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float Z = (0.0193 * c.r + 0.1192 * c.g + 0.9505 * c.b) / 1.08883;
  float fx = f(X), fy = f(Y), fz = f(Z);
  return vec3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}
void main() {
  float d = distance(gl_FragCoord.xy, uCentre);
  if (d > uR) discard;
  float t = uR > uInner ? smoothstep(uInner, uR, d) : (d < uInner ? 0.0 : 1.0);
  float a = uFlow * (1.0 - t);
  if (uAuto) {
    vec2 disp = (uToDisplay * vec3(gl_FragCoord.xy / uPlane, 1.0)).xy;
    float dE = distance(lab(texture(uPicture, uRef).rgb), lab(texture(uPicture, disp).rgb));
    a *= 1.0 - smoothstep(6.0, 18.0, dE);
  }
  o = vec4(a);
}`,W=`#version 300 es
precision highp float;
uniform sampler2D uPlaneTex;
uniform sampler2D uStroke;
uniform float uCap;
uniform bool uErase;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float plane = texelFetch(uPlaneTex, p, 0).r;
  float s = min(texelFetch(uStroke, p, 0).r, uCap);
  float v = uErase ? plane * (1.0 - s) : plane + s * (1.0 - plane);
  o = vec4(v, v, v, 1.0);
}`,q=`#version 300 es
precision highp float;
uniform sampler2D uStroke;
uniform vec2 uCanvas;   // canvas size, device pixels
uniform float uDpr;
uniform vec4 uMap;      // ox, oy, rw, rh
uniform mat3 uToBase;
uniform vec4 uTint;
out vec4 o;
void main() {
  vec2 css = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) / uDpr;
  vec2 disp = (uMap.xy + css) / uMap.zw;
  vec2 base = (uToBase * vec3(disp, 1.0)).xy;
  if (base.x < 0.0 || base.y < 0.0 || base.x > 1.0 || base.y > 1.0) discard;
  float s = texture(uStroke, base).r;
  o = uTint * min(1.0, s * 1.6);
}`;let p=null,d=null,T=null,E=null,_=Promise.resolve(),x=null;const D=n=>new Float32Array([n[0],n[3],0,n[1],n[4],0,n[2],n[5],1]);async function R(n,t,o){const e=typeof n=="string"?await(await fetch(n)).blob():n;return createImageBitmap(e,{premultiplyAlpha:"none",...t&&o?{resizeWidth:t,resizeHeight:o,resizeQuality:"high"}:{}})}const C=n=>new Blob([Uint8Array.from(atob(n),t=>t.charCodeAt(0))],{type:"image/png"});class v{constructor(t){this.gl=t,this.dab=this.program(A,H),this.compose=this.program(A,W),this.preview=this.program(A,q);const o=t.createVertexArray();t.bindVertexArray(o);const e=t.createBuffer();t.bindBuffer(t.ARRAY_BUFFER,e),t.bufferData(t.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),t.STATIC_DRAW);for(const i of[this.dab,this.compose,this.preview]){const r=t.getAttribLocation(i,"aPos");r<0||(t.enableVertexAttribArray(r),t.vertexAttribPointer(r,2,t.FLOAT,!1,0,0))}this.quad=o}gl;dab;compose;preview;quad;strokeTex=null;strokeFb=null;planeTex=null;pictureTex=null;pictureUrl=null;w=0;h=0;static create(t){const o=t.getContext("webgl2",{premultipliedAlpha:!0,antialias:!1});if(!o||!o.getExtension("EXT_color_buffer_float"))return null;try{return new v(o)}catch{return null}}program(t,o){const e=this.gl,i=e.createProgram();for(const[r,a]of[[e.VERTEX_SHADER,t],[e.FRAGMENT_SHADER,o]]){const u=e.createShader(r);if(e.shaderSource(u,a),e.compileShader(u),!e.getShaderParameter(u,e.COMPILE_STATUS))throw new Error(e.getShaderInfoLog(u)??"");e.attachShader(i,u)}if(e.bindAttribLocation(i,0,"aPos"),e.linkProgram(i),!e.getProgramParameter(i,e.LINK_STATUS))throw new Error(e.getProgramInfoLog(i)??"");return i}texture(){const t=this.gl,o=t.createTexture();return t.bindTexture(t.TEXTURE_2D,o),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),o}u(t,o){return this.gl.getUniformLocation(t,o)}draw(t,o,e,i,r,a,u){const c=this.gl;c.uniform4f(this.u(t,"uRect"),o,e,i,r),c.uniform2f(this.u(t,"uSize"),a,u),c.bindVertexArray(this.quad),c.drawArrays(c.TRIANGLE_STRIP,0,4)}async begin(t,o,e,i){const r=this.gl;if(this.w=t.w,this.h=t.h,this.strokeTex&&r.deleteTexture(this.strokeTex),this.strokeFb&&r.deleteFramebuffer(this.strokeFb),this.strokeTex=this.texture(),r.texImage2D(r.TEXTURE_2D,0,r.RGBA16F,t.w,t.h,0,r.RGBA,r.HALF_FLOAT,null),this.strokeFb=r.createFramebuffer(),r.bindFramebuffer(r.FRAMEBUFFER,this.strokeFb),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,this.strokeTex,0),r.viewport(0,0,t.w,t.h),r.clearColor(0,0,0,0),r.clear(r.COLOR_BUFFER_BIT),this.planeTex&&r.deleteTexture(this.planeTex),this.planeTex=this.texture(),r.pixelStorei(r.UNPACK_ALIGNMENT,1),o){const a=await R(C(o),t.w,t.h);r.texImage2D(r.TEXTURE_2D,0,r.R8,r.RED,r.UNSIGNED_BYTE,a),a.close()}else r.texImage2D(r.TEXTURE_2D,0,r.R8,t.w,t.h,0,r.RED,r.UNSIGNED_BYTE,null);if(i&&(!e||e===this.pictureUrl)&&i.close(),e&&e!==this.pictureUrl){const a=i??await R(e);this.pictureTex&&r.deleteTexture(this.pictureTex),this.pictureTex=this.texture(),r.texImage2D(r.TEXTURE_2D,0,r.RGBA8,r.RGBA,r.UNSIGNED_BYTE,a),a.close(),this.pictureUrl=e}}dabs(t,o){const e=this.gl,i=this.dab;e.useProgram(i),e.bindFramebuffer(e.FRAMEBUFFER,this.strokeFb),e.viewport(0,0,this.w,this.h),e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE_MINUS_SRC_COLOR),e.uniform2f(this.u(i,"uPlane"),this.w,this.h),e.uniform1i(this.u(i,"uAuto"),t.auto&&this.pictureTex?1:0),e.uniformMatrix3fv(this.u(i,"uToDisplay"),!1,D(t.toDisplay)),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.pictureTex),e.uniform1i(this.u(i,"uPicture"),0);for(const r of o)r.r<=0||r.flow<=0||(e.uniform2f(this.u(i,"uCentre"),r.x,r.y),e.uniform1f(this.u(i,"uR"),r.r),e.uniform1f(this.u(i,"uInner"),r.r*(1-Math.min(100,Math.max(0,t.softness))/100)),e.uniform1f(this.u(i,"uFlow"),r.flow),e.uniform2f(this.u(i,"uRef"),r.dx,r.dy),this.draw(i,r.x-r.r-1,r.y-r.r-1,r.x+r.r+1,r.y+r.r+1,this.w,this.h));e.disable(e.BLEND),this.show(t)}show(t){const o=this.gl,e=p;if(o.bindFramebuffer(o.FRAMEBUFFER,null),!e||(o.viewport(0,0,e.width,e.height),o.clearColor(0,0,0,0),o.clear(o.COLOR_BUFFER_BIT),!t||!d||!this.strokeTex))return;const i=this.preview;o.useProgram(i),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.strokeTex),o.uniform1i(this.u(i,"uStroke"),0),o.uniform2f(this.u(i,"uCanvas"),e.width,e.height),o.uniform1f(this.u(i,"uDpr"),d.dpr),o.uniform4f(this.u(i,"uMap"),d.ox,d.oy,d.rw,d.rh),o.uniformMatrix3fv(this.u(i,"uToBase"),!1,D(d.toBase));const r=t.erase?[.04,.04,.055,.4]:[.62,.55,.92,t.alpha];o.uniform4f(this.u(i,"uTint"),r[0]*r[3],r[1]*r[3],r[2]*r[3],r[3]),this.draw(i,0,0,e.width,e.height,e.width,e.height)}finish(t,o){const e=this.gl,i=this.texture();e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.w,t.h,0,e.RGBA,e.UNSIGNED_BYTE,null);const r=e.createFramebuffer();e.bindFramebuffer(e.FRAMEBUFFER,r),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,i,0),e.viewport(0,0,t.w,t.h);const a=this.compose;e.useProgram(a),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.planeTex),e.uniform1i(this.u(a,"uPlaneTex"),0),e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,this.strokeTex),e.uniform1i(this.u(a,"uStroke"),1),e.uniform1f(this.u(a,"uCap"),Math.min(1,Math.max(0,o))),e.uniform1i(this.u(a,"uErase"),t.erase?1:0),this.draw(a,0,0,t.w,t.h,t.w,t.h);const u=new Uint8Array(t.w*t.h*4);e.readPixels(0,0,t.w,t.h,e.RGBA,e.UNSIGNED_BYTE,u),e.deleteFramebuffer(r),e.deleteTexture(i),e.activeTexture(e.TEXTURE0);const c=new Uint8Array(t.w*t.h);for(let s=0;s<c.length;s++)c[s]=u[s*4];return c}}async function Z(n,t,o,e){const i=new Float32Array(n.w*n.h);if(t){const a=await R(C(t),n.w,n.h),c=new OffscreenCanvas(n.w,n.h).getContext("2d");c.drawImage(a,0,0),a.close();const s=c.getImageData(0,0,n.w,n.h).data;for(let f=0;f<i.length;f++)i[f]=s[f*4]/255}let r=null;if(o){const a=e??await R(o),u=Math.min(1,1024/Math.max(a.width,a.height)),c=Math.max(1,Math.round(a.width*u)),s=Math.max(1,Math.round(a.height*u)),m=new OffscreenCanvas(c,s).getContext("2d");m.drawImage(a,0,0,c,s),a.close();const h=m.getImageData(0,0,c,s).data,w=new Float32Array(c*s*3);for(let l=0;l<c*s;l++)w.set(k(h[l*4],h[l*4+1],h[l*4+2]),l*3);r={w:c,h:s,data:w}}return{plane:i,stroke:new Float32Array(n.w*n.h),lab:r}}function B(n,t,o){const e=Math.min(n.w-1,Math.max(0,Math.floor(t*n.w))),r=(Math.min(n.h-1,Math.max(0,Math.floor(o*n.h)))*n.w+e)*3;return[n.data[r],n.data[r+1],n.data[r+2]]}function K(n,t,o){const e=t.toDisplay,i=p?.getContext("2d");for(const r of o){let a;const u=n.lab;if(t.auto&&u){const c=B(u,r.dx,r.dy);a=(s,f)=>{const m=(s+.5)/t.w,h=(f+.5)/t.h;return N(L(c,B(u,e[0]*m+e[1]*h+e[2],e[3]*m+e[4]*h+e[5])))}}I(n.stroke,t.w,t.h,r.x,r.y,r.r,t.softness,r.flow,a),i&&d&&(i.setTransform(d.dpr,0,0,d.dpr,0,0),i.fillStyle=t.erase?"rgba(10,10,14,0.22)":"rgba(157,139,234,0.16)",i.beginPath(),i.arc(r.sx,r.sy,r.sr,0,Math.PI*2),i.fill())}}function P(){if(T)return T.show(null);const n=p?.getContext("2d");n&&p&&(n.setTransform(1,0,0,1,0,0),n.clearRect(0,0,p.width,p.height))}async function Q(n){switch(n.t){case"init":p=n.canvas,T=v.create(p);return;case"screen":d=n.screen,p&&(p.width=Math.max(1,Math.round(n.screen.w*n.screen.dpr)),p.height=Math.max(1,Math.round(n.screen.h*n.screen.dpr))),T&&T.show(x);return;case"begin":{x={w:n.w,h:n.h,softness:n.softness,erase:n.erase,toDisplay:n.toDisplay,auto:n.picture!==null,alpha:n.alpha??.3},T?await T.begin(x,n.png,n.picture,n.pictureBitmap):E=await Z(x,n.png,n.picture,n.pictureBitmap);return}case"dabs":if(!x)return;T?T.dabs(x,n.dabs):E&&K(E,x,n.dabs);return;case"end":{const t=x;x=null;try{if(!t)return b({t:"done",id:n.id,png:null});let o;if(T)o=T.finish(t,n.density);else if(E){const e=X(E.plane,E.stroke,n.density,t.erase);o=new Uint8Array(e.length);for(let i=0;i<e.length;i++)o[i]=Math.round(e[i]*255)}else return b({t:"done",id:n.id,png:null});E=null,b({t:"done",id:n.id,png:await V(o,t.w,t.h)})}finally{P()}return}case"cancel":x=null,E=null,P();return}}self.onmessage=n=>{const t=n.data;_=_.then(()=>Q(t)).catch(o=>{t.t==="end"?b({t:"done",id:t.id,png:null,error:String(o)}):console.warn("brush worker",o)})}})();
