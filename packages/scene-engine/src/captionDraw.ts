import { CAPTION_FADE_SEC, type CaptionCue } from '@cvs/shared';
import gsap from 'gsap';

const FONT_PX = 40;
const LINE_HEIGHT = 56;
const MAX_TEXT_WIDTH = 1100;
const PAD_X = 32;
const PAD_Y = 20;
const easeOut = gsap.parseEase('power2.out');

export function captionFont(fontFamily: string): string {
  return `600 ${FONT_PX}px ${fontFamily}`;
}

/** Greedy word wrap using real glyph metrics. Breaks only at spaces. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCaption(
  ctx: CanvasRenderingContext2D,
  cue: CaptionCue,
  frame: number,
  fps: number,
  fontFamily: string,
  width: number,
  height: number,
): void {
  const t = (frame - cue.startFrame) / fps;
  const e = easeOut(Math.min(1, t / CAPTION_FADE_SEC));
  ctx.save();
  ctx.globalAlpha = e;
  ctx.font = captionFont(fontFamily);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, cue.text, MAX_TEXT_WIDTH);
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = Math.min(width - 80, textW + PAD_X * 2);
  const h = lines.length * LINE_HEIGHT + PAD_Y * 2;
  const cy = height - 120 + (1 - e) * 12;
  const x = (width - w) / 2;
  const y = cy - h / 2;
  ctx.fillStyle = 'rgba(8, 10, 20, 0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => ctx.fillText(l, width / 2, y + PAD_Y + LINE_HEIGHT * i + LINE_HEIGHT / 2));
  ctx.restore();
}
