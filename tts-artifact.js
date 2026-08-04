const fs = require('node:fs');
const path = require('node:path');

const TTS_ARTIFACT_FILENAME = /^[a-f0-9]{32}\.mp3$/;
const MAX_HEADER_BYTES = 10;

function artifactError(code, message, identity) {
  const error = new Error(message);
  error.code = code;
  if (identity) error.artifactIdentity = identity;
  return error;
}

function plausibleMp3Header(header) {
  if (header.length >= 3 && header.subarray(0, 3).equals(Buffer.from('ID3'))) return true;
  if (header.length < 4 || header[0] !== 0xff || (header[1] & 0xe0) !== 0xe0) return false;
  const version = (header[1] >> 3) & 0x03;
  const layer = (header[1] >> 1) & 0x03;
  const bitrate = (header[2] >> 4) & 0x0f;
  const sampleRate = (header[2] >> 2) & 0x03;
  return version !== 0x01 && layer !== 0x00
    && bitrate !== 0x00 && bitrate !== 0x0f && sampleRate !== 0x03;
}

function createTtsArtifactStore(cacheDir) {
  const root = path.resolve(cacheDir);

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
    let before;
    try {
      before = await fs.promises.lstat(resolved.path);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw artifactError('TTS_ARTIFACT_NOT_FOUND', 'TTS artifact was not found.');
      }
      throw artifactError('INVALID_TTS_ARTIFACT', 'Unable to inspect TTS artifact.');
    }
    if (before.isSymbolicLink() || !before.isFile()) {
      throw artifactError('INVALID_TTS_ARTIFACT', 'TTS artifact must be a regular non-symlink file.');
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
      const identity = { dev: stats.dev, ino: stats.ino };
      if (!stats.isFile() || stats.dev !== before.dev || stats.ino !== before.ino) {
        throw artifactError('INVALID_TTS_ARTIFACT', 'TTS artifact changed during validation.');
      }
      const header = Buffer.alloc(Math.min(MAX_HEADER_BYTES, stats.size));
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (!plausibleMp3Header(header.subarray(0, bytesRead))) {
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
          const current = await fs.promises.lstat(resolved.path);
          if (current.isFile() && !current.isSymbolicLink()
            && current.dev === error.artifactIdentity.dev
            && current.ino === error.artifactIdentity.ino) {
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
