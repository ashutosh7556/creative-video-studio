import { describe, expect, it } from 'vitest';
import { buildEncodeArgs, buildMixArgs, buildNarrationArgs, checkVideo, type VideoInfo } from '../src/ffmpeg';

describe('buildNarrationArgs', () => {
  it('pads/trims each scene to an exact sample count and concatenates', () => {
    const args = buildNarrationArgs(['a.wav', 'b.wav'], [78, 30], 'out.wav');
    expect(args.slice(0, 7)).toEqual(['-y', '-v', 'error', '-i', 'a.wav', '-i', 'b.wav']);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain(
      '[0:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,apad=whole_len=124800,atrim=end_sample=124800[s0]',
    );
    expect(graph).toContain('apad=whole_len=48000,atrim=end_sample=48000[s1]');
    expect(graph).toContain('[s0][s1]concat=n=2:v=0:a=1[out]');
    expect(args.at(-1)).toBe('out.wav');
  });
});

describe('buildMixArgs', () => {
  it('loops BGM, lowers it, fades out and keeps narration length', () => {
    const args = buildMixArgs('n.wav', 'm.mp3', 40, 'mix.wav');
    expect(args).toContain('-stream_loop');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('volume=0.12');
    expect(graph).toContain('atrim=duration=40.000000');
    expect(graph).toContain('afade=t=out:st=38.500000:d=1.5');
    expect(graph).toContain('[0:a][bg]amix=inputs=2:normalize=0:duration=first[out]');
  });
});

describe('buildEncodeArgs', () => {
  it('reads JPEG frames from stdin and encodes H.264/AAC with faststart', () => {
    const args = buildEncodeArgs('mix.wav', 'out.tmp.mp4');
    expect(args.join(' ')).toBe(
      '-y -v error -f image2pipe -framerate 30 -c:v mjpeg -i - -i mix.wav -map 0:v -map 1:a ' +
        '-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -ac 2 ' +
        '-movflags +faststart out.tmp.mp4',
    );
  });
});

describe('checkVideo', () => {
  const good: VideoInfo = {
    video: { codec: 'h264', width: 1280, height: 720, fps: 30, frames: 900, durationSec: 30 },
    audio: { codec: 'aac', durationSec: 30.01 },
  };
  it('passes a correct file', () => {
    expect(checkVideo(good, 900)).toEqual([]);
  });
  it('reports every problem', () => {
    const bad: VideoInfo = {
      video: { codec: 'vp9', width: 640, height: 360, fps: 25, frames: 899, durationSec: 30 },
      audio: { codec: 'mp3', durationSec: 30.1 },
    };
    expect(checkVideo(bad, 900)).toHaveLength(6);
  });
  it('reports missing audio', () => {
    expect(checkVideo({ ...good, audio: null }, 900)).toContain('no audio stream');
  });
});
