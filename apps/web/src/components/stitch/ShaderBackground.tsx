'use client';

import { useEffect, useRef } from 'react';

const VERTEX_SHADER = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `precision highp float;
varying vec2 v_texCoord;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float grid(vec2 uv, float res) {
    vec2 grid = fract(uv * res);
    return step(0.98, max(grid.x, grid.y));
}

void main() {
    vec2 uv = v_texCoord;
    vec2 m = u_mouse / u_resolution;

    // Pixelate for 8-bit aesthetic
    float pixelScale = 4.0;
    vec2 pUv = floor(uv * u_resolution / pixelScale) / (u_resolution / pixelScale);

    // Base geometric grid
    float g1 = grid(pUv, 20.0);
    float g2 = grid(pUv, 100.0) * 0.5;
    float pattern = max(g1, g2);

    // Mouse interaction: Scatter/Glow effect
    float dist = distance(pUv, m);

    // Thresholded scatter noise
    float n = noise(pUv + u_time * 0.01);
    float scatter = step(0.97, n) * smoothstep(0.4, 0.0, dist);

    // Expanding rings/ripples
    float ripple = step(0.98, sin(dist * 40.0 - u_time * 5.0)) * smoothstep(0.2, 0.0, dist) * 0.5;

    // Ambient fog
    float fog = step(0.5, noise(pUv + u_time * 0.05)) * 0.05;

    // Combine everything into binary black and white
    float checker = mod(floor(v_texCoord.x * u_resolution.x) + floor(v_texCoord.y * u_resolution.y), 2.0);
    float brightness = pattern * 0.1 + scatter + ripple + fog;

    // Strict threshold for B&W pixels
    float final = step(0.5, brightness + checker * 0.05);

    gl_FragColor = vec4(vec3(final * 0.2), 1.0); // Subtle opacity for background use
}`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type) as WebGLShader;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * Interactive shader background from the Stitch design ("ANIMATION_19").
 * Mounted once in the root layout (not per-route) so it persists across
 * client-side navigation instead of restarting on every screen.
 */
export function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function syncSize() {
      const w = canvas!.clientWidth || 1280;
      const h = canvas!.clientHeight || 720;
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
      }
    }

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncSize);
      resizeObserver.observe(canvas);
    }
    syncSize();

    const gl = (canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return;

    const program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'u_time');
    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uMouse = gl.getUniformLocation(program, 'u_mouse');

    // u_mouse is in pixel coordinates matching u_resolution (ShaderToy convention).
    const mouse = { x: canvas.width / 2, y: canvas.height / 2 };

    function handleMouseMove(event: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = (event.clientX - rect.left) / rect.width;
      const ny = 1.0 - (event.clientY - rect.top) / rect.height;
      mouse.x = nx * canvas!.width;
      mouse.y = ny * canvas!.height;
    }
    window.addEventListener('mousemove', handleMouseMove);

    let frameId: number;
    function render(t: number) {
      if (typeof ResizeObserver === 'undefined') syncSize();
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      if (uTime) gl!.uniform1f(uTime, t * 0.001);
      if (uResolution) gl!.uniform2f(uResolution, canvas!.width, canvas!.height);
      if (uMouse) gl!.uniform2f(uMouse, mouse.x, mouse.y);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      frameId = requestAnimationFrame(render);
    }
    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('mousemove', handleMouseMove);
      resizeObserver?.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
