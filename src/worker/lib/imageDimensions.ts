/**
 * Reads the natural pixel width/height straight from a PNG or JPEG's
 * header bytes — no image-decoding library needed, just enough parsing
 * to anchor an embedded image at the right aspect ratio instead of
 * stretching it to whatever cell range it's dropped into.
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

export function readImageDimensions(buffer: ArrayBuffer): ImageDimensions | null {
  const bytes = new Uint8Array(buffer);
  return readPng(bytes) ?? readJpeg(bytes);
}

function readPng(bytes: Uint8Array): ImageDimensions | null {
  // Signature: 89 50 4E 47 0D 0A 1A 0A, then the IHDR chunk always comes
  // first: 4-byte length, "IHDR", 4-byte width, 4-byte height (big-endian).
  const isPng =
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (!isPng) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}

function readJpeg(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset < bytes.length - 8) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    // SOF0..SOF15 markers (excluding DHT/JPG/DAC) carry the dimensions;
    // 0xC0-0xCF except 0xC4, 0xC8, 0xCC.
    const isSofMarker =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSofMarker) {
      const height = view.getUint16(offset + 5, false);
      const width = view.getUint16(offset + 7, false);
      return { width, height };
    }
    const segmentLength = view.getUint16(offset + 2, false);
    offset += 2 + segmentLength;
  }
  return null;
}
