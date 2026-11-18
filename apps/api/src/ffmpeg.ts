import { BGM_FADE_SEC, BGM_VOLUME, FPS, HEIGHT, SAMPLES_PER_FRAME, WIDTH } from '@cvs/shared';
import { runProcess } from './proc';

/** Exact WAV length from sample count (not the container/header estimate). */
export async function probeWavSec(file: string): Promise<number> {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=duration_ts,sample_rate,duration', '-of', 'json', file,
  ]);
  const s = JSON.parse(stdout).streams?.[0];
  if (!s) throw new Error(`No audio stream in ${file}`);
  if (s.duration_ts && s.sample_rate) return Number(s.duration_ts) / Number(s.sample_rate);
  return Number(s.duration);
}

/** Each scene → 48 kHz mono, padded/trimmed to exactly sceneFrames × 1600 samples, then concatenated. */
export function buildNarrationArgs(inputs: string[], sceneFrames: number[], out: string): string[] {
  const args = ['-y', '-v', 'error'];
  for (const f of inputs) args.push('-i', f);
  const parts = sceneFrames.map((frames, i) => {
    const n = frames * SAMPLES_PER_FRAME;
    return `[${i}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,apad=whole_len=${n},atrim=end_sample=${n}[s${i}]`;
  });
  const concat = `${sceneFrames.map((_, i) => `[s${i}]`).join('')}concat=n=${sceneFrames.length}:v=0:a=1[out]`;
  args.push('-filter_complex', [...parts, concat].join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', out);
  return args;
}

/** Narration at full volume, looped BGM at BGM_VOLUME with fade-out; output length = narration length. */
export function buildMixArgs(narration: string, bgm: string, durationSec: number, out: string): string[] {
  const d = durationSec.toFixed(6);
  const fadeStart = Math.max(0, durationSec - BGM_FADE_SEC).toFixed(6);
  const graph =
    `[1:a]aresample=48000,aformat=channel_layouts=mono,volume=${BGM_VOLUME},atrim=duration=${d},` +
    `afade=t=out:st=${fadeStart}:d=${BGM_FADE_SEC}[bg];` +
    `[0:a][bg]amix=inputs=2:normalize=0:duration=first[out]`;
  return [
    '-y', '-v', 'error', '-i', narration, '-stream_loop', '-1', '-i', bgm,
    '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s16le', out,
  ];
}

export function buildEncodeArgs(audio: string, out: string): string[] {
  return [
    '-y', '-v', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-i', audio,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-movflags', '+faststart', out,
  ];
}

export interface VideoInfo {
  video: { codec: string; width: number; height: number; fps: number; frames: number; durationSec: number } | null;
  audio: { codec: string; durationSec: number } | null;
}

export async function probeVideo(file: string): Promise<VideoInfo> {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file,
  ]);
  const streams: Record<string, string>[] = JSON.parse(stdout).streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const [num, den] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    video: v
      ? {
          codec: v.codec_name,
          width: Number(v.width),
          height: Number(v.height),
          fps: num / den,
          frames: Number(v.nb_read_frames ?? v.nb_frames),
          durationSec: Number(v.duration),
        }
      : null,
    audio: a ? { codec: a.codec_name, durationSec: Number(a.duration) } : null,
  };
}

/** Returns a list of problems; empty means the MP4 meets the spec. */
export function checkVideo(info: VideoInfo, expectedFrames: number): string[] {
  const p: string[] = [];
  const { video: v, audio: a } = info;
  if (!v) return ['no video stream'];
  if (v.codec !== 'h264') p.push(`video codec ${v.codec} != h264`);
  if (v.width !== WIDTH || v.height !== HEIGHT) p.push(`size ${v.width}x${v.height} != ${WIDTH}x${HEIGHT}`);
  if (Math.abs(v.fps - FPS) > 0.01) p.push(`fps ${v.fps} != ${FPS}`);
  if (v.frames !== expectedFrames) p.push(`frames ${v.frames} != ${expectedFrames}`);
  if (!a) {
    p.push('no audio stream');
    return p;
  }
  if (a.codec !== 'aac') p.push(`audio codec ${a.codec} != aac`);
  const drift = Math.abs(a.durationSec - v.durationSec);
  if (drift >= 1 / FPS) p.push(`audio/video duration differ by ${(drift * 1000).toFixed(0)} ms`);
  return p;
}
