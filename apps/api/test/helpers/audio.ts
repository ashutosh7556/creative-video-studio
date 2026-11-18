import { runProcess } from '../../src/proc';

export async function makeSine(file: string, seconds: number, freq = 440, sampleRate = 24000): Promise<void> {
  await runProcess('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi',
    '-i', `sine=frequency=${freq}:sample_rate=${sampleRate}:duration=${seconds}`,
    '-ac', '1', '-c:a', 'pcm_s16le', file,
  ]);
}

export async function makeSilence(file: string, seconds: number): Promise<void> {
  await runProcess('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
    '-t', String(seconds), '-c:a', 'pcm_s16le', file,
  ]);
}

export async function probeStream(
  file: string,
): Promise<{ sampleRate: number; channels: number; codec: string; samples: number }> {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels,codec_name,duration_ts', '-of', 'json', file,
  ]);
  const s = JSON.parse(stdout).streams[0];
  return {
    sampleRate: Number(s.sample_rate),
    channels: Number(s.channels),
    codec: s.codec_name,
    samples: Number(s.duration_ts),
  };
}

export async function meanVolumeDb(file: string): Promise<number> {
  const { stderr } = await runProcess('ffmpeg', ['-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  if (!m) throw new Error(`volumedetect output missing for ${file}`);
  return Number(m[1]);
}
