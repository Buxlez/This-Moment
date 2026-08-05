const fs = require('node:fs');
const path = require('node:path');

const TTS_ARTIFACT_FILENAME = /^[a-f0-9]{32}\.mp3$/;
const ID3_HEADER_BYTES = 10;
const MPEG_HEADER_BYTES = 4;

function artifactError(code, message, identity) {
  const error = new Error(message);
  error.code = code;
  if (identity) error.artifactIdentity = identity;
  return error;
}

function mpegFrameLength(header) {
  if (header.length < 4 || header[0] !== 0xff || (header[1] & 0xe0) !== 0xe0) return null;
  const version = (header[1] >> 3) & 0x03;
  const layer = (header[1] >> 1) & 0x03;
  const bitrateIndex = (header[2] >> 4) & 0x0f;
  const sampleRateIndex = (header[2] >> 2) & 0x03;
  const padding = (header[2] >> 1) & 0x01;
  if (version === 0x01 || layer === 0x00
    || bitrateIndex === 0x00 || bitrateIndex === 0x0f || sampleRateIndex === 0x03) {
    return null;
  }

  const mpeg1Bitrates = {
    3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  };
  const mpeg2Bitrates = {
    3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  const baseSampleRates = [44100, 48000, 32000];
  const sampleRateDivisor = version === 0x03 ? 1 : (version === 0x02 ? 2 : 4);
  const sampleRate = baseSampleRates[sampleRateIndex] / sampleRateDivisor;
  const bitrateKbps = (version === 0x03 ? mpeg1Bitrates : mpeg2Bitrates)[layer][bitrateIndex];
  const bitrate = bitrateKbps * 1000;

  if (layer === 0x03) return (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
  const coefficient = layer === 0x01 && version !== 0x03 ? 72 : 144;
  return Math.floor((coefficient * bitrate) / sampleRate) + padding;
}

function plausibleMpegHeader(header) {
  return mpegFrameLength(header) !== null;
}

function id3AudioOffset(header, fileSize) {
  if (header.length < ID3_HEADER_BYTES) return null;
  const version = header[3];
  const revision = header[4];
  const flags = header[5];
  const allowedFlags = { 2: 0xc0, 3: 0xe0, 4: 0xf0 }[version];
  if (allowedFlags === undefined || revision === 0xff || (flags & ~allowedFlags) !== 0) {
    return null;
  }
  const sizeBytes = header.subarray(6, 10);
  if (sizeBytes.some(byte => (byte & 0x80) !== 0)) return null;
  const tagSize = sizeBytes.reduce((size, byte) => (size * 128) + byte, 0);
  const footerSize = version === 4 && (flags & 0x10) !== 0 ? ID3_HEADER_BYTES : 0;
  const audioOffset = ID3_HEADER_BYTES + tagSize + footerSize;
  if (!Number.isSafeInteger(audioOffset) || audioOffset > fileSize) return null;
  return audioOffset;
}

function validId3Footer(header, footer) {
  return footer.length === ID3_HEADER_BYTES
    && footer.subarray(0, 3).equals(Buffer.from('3DI'))
    && footer.subarray(3).equals(header.subarray(3, ID3_HEADER_BYTES));
}

function plausibleMp3Header(header) {
  if (header.length >= 3 && header.subarray(0, 3).equals(Buffer.from('ID3'))) {
    const id3Header = header.subarray(0, ID3_HEADER_BYTES);
    const audioOffset = id3AudioOffset(id3Header, header.length);
    const hasFooter = id3Header.length === ID3_HEADER_BYTES
      && id3Header[3] === 4 && (id3Header[5] & 0x10) !== 0;
    if (hasFooter && (audioOffset === null
      || !validId3Footer(id3Header, header.subarray(audioOffset - ID3_HEADER_BYTES, audioOffset)))) {
      return false;
    }
    const frameLength = audioOffset === null
      ? null
      : mpegFrameLength(header.subarray(audioOffset, audioOffset + MPEG_HEADER_BYTES));
    return audioOffset !== null
      && frameLength !== null
      && audioOffset + frameLength <= header.length;
  }
  const frameLength = mpegFrameLength(header.subarray(0, MPEG_HEADER_BYTES));
  return frameLength !== null && frameLength <= header.length;
}

function createTtsArtifactStore(cacheDir) {
  const root = path.resolve(cacheDir);
  let pinnedRoot;

  try {
    fs.mkdirSync(root, { recursive: true });
    const before = fs.lstatSync(root);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw artifactError('INVALID_TTS_CACHE_ROOT', 'TTS cache root must be a real directory.');
    }
    const canonical = fs.realpathSync(root);
    const after = fs.lstatSync(root);
    if (after.isSymbolicLink() || !after.isDirectory()
      || before.dev !== after.dev || before.ino !== after.ino
      || fs.realpathSync(root) !== canonical) {
      throw artifactError('INVALID_TTS_CACHE_ROOT', 'TTS cache root changed during initialization.');
    }
    pinnedRoot = { canonical, dev: after.dev, ino: after.ino };
  } catch (error) {
    if (error.code === 'INVALID_TTS_CACHE_ROOT') throw error;
    throw artifactError('INVALID_TTS_CACHE_ROOT', 'Unable to establish the TTS cache root.');
  }

  async function requirePinnedRoot() {
    // The local desktop threat model excludes an active same-UID attacker performing
    // an ABA rename between syscalls; these checks reject static and ordinary swaps.
    try {
      const before = await fs.promises.lstat(root);
      if (before.isSymbolicLink() || !before.isDirectory()) {
        throw artifactError('INVALID_TTS_CACHE_ROOT', 'TTS cache root is no longer trusted.');
      }
      const canonical = await fs.promises.realpath(root);
      const after = await fs.promises.lstat(root);
      if (after.isSymbolicLink() || !after.isDirectory()
        || before.dev !== after.dev || before.ino !== after.ino
        || after.dev !== pinnedRoot.dev || after.ino !== pinnedRoot.ino
        || canonical !== pinnedRoot.canonical) {
        throw artifactError('INVALID_TTS_CACHE_ROOT', 'TTS cache root is no longer trusted.');
      }
    } catch (error) {
      if (error.code === 'INVALID_TTS_CACHE_ROOT') throw error;
      throw artifactError('INVALID_TTS_CACHE_ROOT', 'Unable to verify the TTS cache root.');
    }
  }

  function resolveFilename(filename) {
    if (typeof filename !== 'string' || !TTS_ARTIFACT_FILENAME.test(filename)) {
      throw artifactError('INVALID_TTS_ARTIFACT_NAME', 'Invalid TTS artifact filename.');
    }
    return { filename, path: path.join(root, filename) };
  }

  function resolveArtifactPath(filePath) {
    if (typeof filePath !== 'string' || !filePath) {
      throw artifactError('INVALID_TTS_ARTIFACT_PATH', 'Invalid TTS artifact path.');
    }
    const resolved = path.resolve(filePath);
    if (path.dirname(resolved) !== root) {
      throw artifactError('TTS_ARTIFACT_OUTSIDE_CACHE', 'TTS artifact is outside the cache root.');
    }
    const filename = path.basename(resolved);
    resolveFilename(filename);
    return { filename, path: resolved };
  }

  async function openResolved(resolved) {
    await requirePinnedRoot();
    let before;
    try {
      before = await fs.promises.lstat(resolved.path);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw artifactError('TTS_ARTIFACT_NOT_FOUND', 'TTS artifact was not found.');
      }
      throw artifactError('INVALID_TTS_ARTIFACT', 'Unable to inspect TTS artifact.');
    }
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
      throw artifactError(
        'INVALID_TTS_ARTIFACT',
        'TTS artifact must be a singly-linked regular non-symlink file.'
      );
    }

    const noFollow = fs.constants.O_NOFOLLOW || 0;
    let handle;
    try {
      handle = await fs.promises.open(resolved.path, fs.constants.O_RDONLY | noFollow);
    } catch (_error) {
      throw artifactError('INVALID_TTS_ARTIFACT', 'Unable to open TTS artifact safely.');
    }

    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.nlink !== 1
        || stats.dev !== before.dev || stats.ino !== before.ino) {
        throw artifactError('INVALID_TTS_ARTIFACT', 'TTS artifact changed during validation.');
      }
      const identity = { dev: stats.dev, ino: stats.ino, nlink: stats.nlink };
      await requirePinnedRoot();

      const initialLength = Math.min(ID3_HEADER_BYTES, stats.size);
      const initial = Buffer.alloc(initialLength);
      const { bytesRead } = await handle.read(initial, 0, initial.length, 0);
      let validAudio = false;
      if (bytesRead >= 3 && initial.subarray(0, 3).equals(Buffer.from('ID3'))) {
        const audioOffset = id3AudioOffset(initial.subarray(0, bytesRead), stats.size);
        if (audioOffset !== null && audioOffset + MPEG_HEADER_BYTES <= stats.size) {
          const id3Header = initial.subarray(0, bytesRead);
          const hasFooter = id3Header[3] === 4 && (id3Header[5] & 0x10) !== 0;
          let footerValid = true;
          if (hasFooter) {
            const footer = Buffer.alloc(ID3_HEADER_BYTES);
            const footerRead = await handle.read(
              footer, 0, ID3_HEADER_BYTES, audioOffset - ID3_HEADER_BYTES
            );
            footerValid = footerRead.bytesRead === ID3_HEADER_BYTES
              && validId3Footer(id3Header, footer);
          }
          const mpegHeader = Buffer.alloc(MPEG_HEADER_BYTES);
          const audioRead = await handle.read(
            mpegHeader, 0, MPEG_HEADER_BYTES, audioOffset
          );
          const frameLength = mpegFrameLength(mpegHeader);
          validAudio = footerValid
            && audioRead.bytesRead === MPEG_HEADER_BYTES
            && frameLength !== null
            && audioOffset + frameLength <= stats.size;
        }
      } else if (bytesRead >= MPEG_HEADER_BYTES) {
        const frameLength = mpegFrameLength(initial.subarray(0, MPEG_HEADER_BYTES));
        validAudio = frameLength !== null && frameLength <= stats.size;
      }
      if (!validAudio) {
        throw artifactError('INVALID_TTS_ARTIFACT_AUDIO', 'TTS artifact is not valid MP3 audio.', identity);
      }
      return { ...resolved, handle, stats };
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  }

  async function openArtifact(filename) {
    return openResolved(resolveFilename(filename));
  }

  async function validateArtifactPath(filePath) {
    const opened = await openResolved(resolveArtifactPath(filePath));
    try {
      return { filename: opened.filename, path: opened.path, size: opened.stats.size };
    } finally {
      await opened.handle.close();
    }
  }

  async function validateGeneratedArtifact(filePath) {
    return validateArtifactPath(filePath);
  }

  return {
    root,
    isValidFilename: filename => typeof filename === 'string' && TTS_ARTIFACT_FILENAME.test(filename),
    openArtifact,
    validateArtifactPath,
    validateGeneratedArtifact,
  };
}

module.exports = { createTtsArtifactStore, plausibleMp3Header, TTS_ARTIFACT_FILENAME };
