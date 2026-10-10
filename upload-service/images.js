import { uploadLimits } from '../site/album-model.js';
import { unbase64 } from './crypto.js';

// The browser decodes, resizes and re-encodes to JPEG. The service independently
// bounds dimensions and removes ALL APP/COM segments (including EXIF/GPS/XMP).
// This is structural validation, not a full JPEG entropy decoder.
export function cleanJPEG(encoded) {
  const invalid = () => { throw new Error('invalid_image'); };
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(uploadLimits.bytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalid();
  let bytes;
  try { bytes = unbase64(encoded); } catch { invalid(); }
  if (bytes.length > uploadLimits.bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let offset = 2, frame = false, scan = false;
  const parts = [bytes.subarray(0, 2)];
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!frame || !scan) invalid();
      parts.push(new Uint8Array([0xff, 0xd9]));
      const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0; for (const part of parts) { result.set(part, at); at += part.length; }
      return result;
    }
    if (!Number.isInteger(marker) || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    const length = bytes[offset] * 256 + bytes[offset + 1];
    const end = offset + length;
    if (!Number.isFinite(length) || length < 2 || end > bytes.length) invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || length < 11) invalid();
      const height = bytes[offset + 3] * 256 + bytes[offset + 4], width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (!width || !height || width > uploadLimits.side || height > uploadLimits.side || bytes[offset + 2] !== 8) invalid();
      frame = true;
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) invalid();
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(bytes.subarray(start, end));
    offset = end;
    if (marker === 0xda) {
      if (!frame) invalid();
      scan = true;
      const scanStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        break;
      }
      if (offset === scanStart) invalid();
      parts.push(bytes.subarray(scanStart, offset));
    }
  }
  invalid();
}
