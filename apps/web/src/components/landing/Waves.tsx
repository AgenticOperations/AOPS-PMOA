'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

/**
 * Perlin-noise line field, ported from the Casper marketing hero.
 *
 * Zero dependencies: the noise implementation and the render loop are both
 * local so the landing page never pulls a WebGL/animation library.
 */

/**
 * The 12 gradient vectors, split into parallel component arrays. Typed arrays
 * keep the hot loop free of the undefined-index checks a `Grad[]` would need.
 */
const GRAD_X = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]);
const GRAD_Y = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]);

const PERMUTATION = new Uint8Array([
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142,
  8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203,
  117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74,
  165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220,
  105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132,
  187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3,
  64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227,
  47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221,
  153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185,
  112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51,
  145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121,
  50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78,
  66, 215, 61, 156, 180,
]);

/**
 * Indexed read from a fixed-size lookup table.
 *
 * Every call site is bounds-guaranteed by construction: indices are masked to
 * 0-255 and every table holds 512 entries. The assertion states that invariant
 * instead of adding a branch to the per-point hot loop.
 */
function tableRead(table: Float64Array | Uint16Array | Uint8Array, index: number): number {
  return table[index]!;
}

class Noise {
  private readonly perm = new Uint16Array(512);
  private readonly gradX = new Float64Array(512);
  private readonly gradY = new Float64Array(512);

  constructor(seed: number) {
    let normalized = seed;
    if (normalized > 0 && normalized < 1) normalized *= 65536;
    normalized = Math.floor(normalized);
    if (normalized < 256) normalized |= normalized << 8;

    for (let i = 0; i < 256; i += 1) {
      const source = tableRead(PERMUTATION, i);
      const value = i & 1 ? source ^ (normalized & 255) : source ^ ((normalized >> 8) & 255);
      const gradient = value % 12;
      const gx = tableRead(GRAD_X, gradient);
      const gy = tableRead(GRAD_Y, gradient);
      this.perm[i] = value;
      this.perm[i + 256] = value;
      this.gradX[i] = gx;
      this.gradX[i + 256] = gx;
      this.gradY[i] = gy;
      this.gradY[i + 256] = gy;
    }
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static lerp(a: number, b: number, t: number): number {
    return (1 - t) * a + t * b;
  }

  perlin2(inputX: number, inputY: number): number {
    const cellX = Math.floor(inputX);
    const cellY = Math.floor(inputY);
    const x = inputX - cellX;
    const y = inputY - cellY;
    const gridX = cellX & 255;
    const gridY = cellY & 255;

    const rowA = tableRead(this.perm, gridY);
    const rowB = tableRead(this.perm, gridY + 1);
    const i00 = gridX + rowA;
    const i01 = gridX + rowB;
    const i10 = gridX + 1 + rowA;
    const i11 = gridX + 1 + rowB;

    const n00 = tableRead(this.gradX, i00) * x + tableRead(this.gradY, i00) * y;
    const n01 = tableRead(this.gradX, i01) * x + tableRead(this.gradY, i01) * (y - 1);
    const n10 = tableRead(this.gradX, i10) * (x - 1) + tableRead(this.gradY, i10) * y;
    const n11 = tableRead(this.gradX, i11) * (x - 1) + tableRead(this.gradY, i11) * (y - 1);
    const u = Noise.fade(x);

    return Noise.lerp(Noise.lerp(n00, n10, u), Noise.lerp(n01, n11, u), Noise.fade(y));
  }
}

interface Point {
  readonly x: number;
  readonly y: number;
  wave: { x: number; y: number };
  cursor: { x: number; y: number; vx: number; vy: number };
}

export interface WavesProps {
  readonly lineColor?: string;
  readonly backgroundColor?: string;
  readonly waveSpeedX?: number;
  readonly waveSpeedY?: number;
  readonly waveAmpX?: number;
  readonly waveAmpY?: number;
  readonly xGap?: number;
  readonly yGap?: number;
  readonly friction?: number;
  readonly tension?: number;
  readonly maxCursorMove?: number;
  readonly style?: CSSProperties;
  readonly className?: string;
}

export function Waves({
  lineColor = 'rgba(255,255,255,0.18)',
  backgroundColor = 'transparent',
  waveSpeedX = 0.0125,
  waveSpeedY = 0.005,
  waveAmpX = 32,
  waveAmpY = 16,
  xGap = 10,
  yGap = 32,
  friction = 0.925,
  tension = 0.005,
  maxCursorMove = 100,
  style,
  className = '',
}: WavesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const configRef = useRef({
    lineColor,
    waveSpeedX,
    waveSpeedY,
    waveAmpX,
    waveAmpY,
    friction,
    tension,
    maxCursorMove,
    xGap,
    yGap,
  });

  configRef.current = {
    lineColor,
    waveSpeedX,
    waveSpeedY,
    waveAmpX,
    waveAmpY,
    friction,
    tension,
    maxCursorMove,
    xGap,
    yGap,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;

    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const bounds = { width: 0, height: 0, left: 0, top: 0 };
    const noise = new Noise(Math.random());
    const mouse = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, v: 0, vs: 0, a: 0, set: false };
    let lines: Point[][] = [];
    let frameId = 0;

    function setSize() {
      const rect = container!.getBoundingClientRect();
      bounds.width = rect.width;
      bounds.height = rect.height;
      bounds.left = rect.left;
      bounds.top = rect.top;
      canvas!.width = rect.width;
      canvas!.height = rect.height;
    }

    function setLines() {
      const { width, height } = bounds;
      const { xGap: gapX, yGap: gapY } = configRef.current;
      lines = [];

      const totalLines = Math.ceil((width + 200) / gapX);
      const totalPoints = Math.ceil((height + 30) / gapY);
      const xStart = (width - gapX * totalLines) / 2;
      const yStart = (height - gapY * totalPoints) / 2;

      for (let i = 0; i <= totalLines; i += 1) {
        const points: Point[] = [];
        for (let j = 0; j <= totalPoints; j += 1) {
          points.push({
            x: xStart + gapX * i,
            y: yStart + gapY * j,
            wave: { x: 0, y: 0 },
            cursor: { x: 0, y: 0, vx: 0, vy: 0 },
          });
        }
        lines.push(points);
      }
    }

    function movePoints(time: number) {
      const config = configRef.current;
      for (const points of lines) {
        for (const point of points) {
          const move =
            noise.perlin2(
              (point.x + time * config.waveSpeedX) * 0.002,
              (point.y + time * config.waveSpeedY) * 0.0015,
            ) * 12;
          point.wave.x = Math.cos(move) * config.waveAmpX;
          point.wave.y = Math.sin(move) * config.waveAmpY;

          const dx = point.x - mouse.sx;
          const dy = point.y - mouse.sy;
          const distance = Math.hypot(dx, dy);
          const radius = Math.max(175, mouse.vs);

          if (distance < radius) {
            const strength = 1 - distance / radius;
            const falloff = Math.cos(distance * 0.001) * strength;
            point.cursor.vx += Math.cos(mouse.a) * falloff * radius * mouse.vs * 0.00065;
            point.cursor.vy += Math.sin(mouse.a) * falloff * radius * mouse.vs * 0.00065;
          }

          point.cursor.vx += (0 - point.cursor.x) * config.tension;
          point.cursor.vy += (0 - point.cursor.y) * config.tension;
          point.cursor.vx *= config.friction;
          point.cursor.vy *= config.friction;
          point.cursor.x += point.cursor.vx * 2;
          point.cursor.y += point.cursor.vy * 2;
          point.cursor.x = Math.min(
            config.maxCursorMove,
            Math.max(-config.maxCursorMove, point.cursor.x),
          );
          point.cursor.y = Math.min(
            config.maxCursorMove,
            Math.max(-config.maxCursorMove, point.cursor.y),
          );
        }
      }
    }

    function moved(point: Point, withCursor: boolean) {
      const x = point.x + point.wave.x + (withCursor ? point.cursor.x : 0);
      const y = point.y + point.wave.y + (withCursor ? point.cursor.y : 0);
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }

    function drawLines() {
      ctx!.clearRect(0, 0, bounds.width, bounds.height);
      ctx!.beginPath();
      ctx!.strokeStyle = configRef.current.lineColor;

      for (const points of lines) {
        const head = points[0];
        if (head === undefined) continue;

        const first = moved(head, false);
        ctx!.moveTo(first.x, first.y);

        points.forEach((point, index) => {
          const isLast = index === points.length - 1;
          const following = points[index + 1] ?? point;
          const current = moved(point, !isLast);
          const next = moved(following, !isLast);
          ctx!.lineTo(current.x, current.y);
          if (isLast) ctx!.moveTo(next.x, next.y);
        });
      }

      ctx!.stroke();
    }

    function tick(time: number) {
      mouse.sx += (mouse.x - mouse.sx) * 0.1;
      mouse.sy += (mouse.y - mouse.sy) * 0.1;

      const dx = mouse.x - mouse.lx;
      const dy = mouse.y - mouse.ly;
      const distance = Math.hypot(dx, dy);

      mouse.v = distance;
      mouse.vs += (distance - mouse.vs) * 0.1;
      mouse.vs = Math.min(100, mouse.vs);
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
      mouse.a = Math.atan2(dy, dx);

      movePoints(time);
      drawLines();
      frameId = requestAnimationFrame(tick);
    }

    function updateMouse(x: number, y: number) {
      mouse.x = x - bounds.left;
      mouse.y = y - bounds.top;
      if (!mouse.set) {
        mouse.sx = mouse.x;
        mouse.sy = mouse.y;
        mouse.lx = mouse.x;
        mouse.ly = mouse.y;
        mouse.set = true;
      }
    }

    function onResize() {
      setSize();
      setLines();
    }

    function onMouseMove(event: MouseEvent) {
      updateMouse(event.clientX, event.clientY);
    }

    function onTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch !== undefined) updateMouse(touch.clientX, touch.clientY);
    }

    setSize();
    setLines();

    // Reduced motion still gets the geometry, just frozen: one frame, no listeners.
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) {
      movePoints(0);
      drawLines();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    frameId = requestAnimationFrame(tick);
    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`aops-waves ${className}`.trim()}
      ref={containerRef}
      style={{ backgroundColor, ...style }}
    >
      <canvas className="aops-waves-canvas" ref={canvasRef} />
    </div>
  );
}
