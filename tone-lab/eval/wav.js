// Minimal WAV decoder: PCM 8/16/24/32-bit and 32-bit float, any channel count, mixed to mono.
export function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let fmt = null, data = null, p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(body);
      if (format === 0xfffe) format = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE
      fmt = {
        format,
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    p = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');

  const { format, channels, bits, sampleRate } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const read =
    format === 3 && bits === 32 ? (o) => data.readFloatLE(o)
    : bits === 16 ? (o) => data.readInt16LE(o) / 32768
    : bits === 24 ? (o) => data.readIntLE(o, 3) / 8388608
    : bits === 32 ? (o) => data.readInt32LE(o) / 2147483648
    : bits === 8 ? (o) => (data.readUInt8(o) - 128) / 128
    : null;
  if (!read) throw new Error(`unsupported format ${format}/${bits}-bit`);

  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += read((i * channels + c) * bytes);
    out[i] = s / channels;
  }
  return { samples: out, sampleRate };
}
