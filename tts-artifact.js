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

function plausibleMpegHeader(header) {
  if (header.length < 4 || header[0] !== 0xff || (header[1] & 0xe0) !== 0xe0) return false;
  const version = (header[1] >> 3) & 0x03;
  const layer = (header[1] >> 1) & 0x03;
  const bitrate = (header[2] >> 4) & 0x0f;
  const sampleRate = (header[2] >> 2) & 0x03;
  return version !== 0x01 && layer !== 0x00
    && bitrate !== 0x00 && bitrate !== 0x0f && sampleRate !== 0x03;
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
  const audioOffset = ID3_HEADER_BYTES + tagSize;
  if (!Number.isSafeInteger(audioOffset) || audioOffset > fileSize) return null;
  return audioOffset;
}

function plausibleMp3Header(header) {
  if (header.length >= 3 && header.subarray(0, 3).equals(Buffer.from('ID3'))) {
    const audioOffset = id3AudioOffset(header.subarray(0, ID3_HEADER_BYTES), header.length);
    return audioOffset !== null
      && audioOffset + MPEG_HEADER_BYTES <= header.length
      && plausibleMpegHeader(header.subarray(audioOffset, audioOffset + MPEG_HEADER_BYTES));
  }
  return plausibleMpegHeader(header.subarray(0, MPEG_HEADER_BYTES));
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
          const mpegHeader = Buffer.alloc(MPEG_HEADER_BYTES);
          const audioRead = await handle.read(
            mpegHeader, 0, MPEG_HEADER_BYTES, audioOffset
          );
          validAudio = audioRead.bytesRead === MPEG_HEADER_BYTES
            && plausibleMpegHeader(mpegHeader);
        }
      } else if (bytesRead >= MPEG_HEADER_BYTES) {
        validAudio = plausibleMpegHeader(initial.subarray(0, MPEG_HEADER_BYTES));
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
    try {
      return await validateArtifactPath(filePath);
    } catch (error) {
      const resolved = (() => {
        try { return resolveArtifactPath(filePath); } catch { return null; }
      })();
      if (resolved && error.artifactIdentity) {
        try {
          await requirePinnedRoot();
          const current = await fs.promises.lstat(resolved.path);
          if (current.isFile() && !current.isSymbolicLink()
            && current.nlink === 1
            && current.dev === error.artifactIdentity.dev
            && current.ino === error.artifactIdentity.ino) {
            await requirePinnedRoot();
            const confirmed = await fs.promises.lstat(resolved.path);
            if (!confirmed.isFile() || confirmed.isSymbolicLink()
              || confirmed.nlink !== 1
              || confirmed.dev !== error.artifactIdentity.dev
              || confirmed.ino !== error.artifactIdentity.ino) {
              throw artifactError('INVALID_TTS_ARTIFACT', 'TTS artifact changed before cleanup.');
            }
            await fs.promises.unlink(resolved.path);
          }
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') throw cleanupError;
        }
      }
      throw error;
    }
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
