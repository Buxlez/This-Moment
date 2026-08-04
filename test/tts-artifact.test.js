const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let artifactModule = {};
try {
  artifactModule = require('../tts-artifact');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('exports a central TTS artifact store factory', () => {
  assert.equal(typeof artifactModule.createTtsArtifactStore, 'function');
});

const HASHED_MP3 = '0123456789abcdef0123456789abcdef.mp3';
const OTHER_HASHED_MP3 = 'abcdef0123456789abcdef0123456789.mp3';
const ID3_AUDIO = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x54, 0x54, 0x53]);
const MPEG_AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x01]);

function temporaryStore(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-artifact-test-'));
  const cacheDir = path.join(parent, 'cache');
  fs.mkdirSync(cacheDir);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return {
    cacheDir,
    parent,
    store: artifactModule.createTtsArtifactStore(cacheDir),
  };
}

test('validates hashed MP3 files and opens the same trusted artifact', async t => {
  const { cacheDir, store } = temporaryStore(t);
  assert.equal(typeof store.validateArtifactPath, 'function');
  assert.equal(typeof store.openArtifact, 'function');
  const id3Path = path.join(cacheDir, HASHED_MP3);
  const mpegPath = path.join(cacheDir, OTHER_HASHED_MP3);
  fs.writeFileSync(id3Path, ID3_AUDIO);
  fs.writeFileSync(mpegPath, MPEG_AUDIO);

  assert.deepEqual(await store.validateArtifactPath(id3Path), {
    filename: HASHED_MP3, path: id3Path, size: ID3_AUDIO.length,
  });
  assert.equal((await store.validateArtifactPath(mpegPath)).filename, OTHER_HASHED_MP3);

  const opened = await store.openArtifact(HASHED_MP3);
  try {
    const bytes = Buffer.alloc(ID3_AUDIO.length);
    const { bytesRead } = await opened.handle.read(bytes, 0, bytes.length, 0);
    assert.equal(bytesRead, ID3_AUDIO.length);
    assert.deepEqual(bytes, ID3_AUDIO);
    assert.equal(opened.stats.isFile(), true);
  } finally {
    await opened.handle.close();
  }
});

test('rejects arbitrary names, traversal, outside paths, symlinks, and non-audio files', async t => {
  const { cacheDir, parent, store } = temporaryStore(t);
  assert.equal(typeof store.validateArtifactPath, 'function');
  assert.equal(typeof store.openArtifact, 'function');
  const arbitrary = path.join(cacheDir, 'retry_voice.mp3');
  const textPath = path.join(cacheDir, HASHED_MP3);
  const outsidePath = path.join(parent, OTHER_HASHED_MP3);
  const symlinkPath = path.join(cacheDir, OTHER_HASHED_MP3);
  fs.writeFileSync(arbitrary, ID3_AUDIO);
  fs.writeFileSync(textPath, Buffer.from('not an mp3 file'));
  fs.writeFileSync(outsidePath, ID3_AUDIO);
  fs.symlinkSync(outsidePath, symlinkPath);

  await assert.rejects(store.validateArtifactPath(arbitrary), /artifact|filename|cache/i);
  await assert.rejects(store.validateArtifactPath(outsidePath), /artifact|filename|cache/i);
  await assert.rejects(store.validateArtifactPath(textPath), /MP3|artifact|audio/i);
  await assert.rejects(store.validateArtifactPath(symlinkPath), /symlink|artifact|file/i);
  await assert.rejects(store.openArtifact('../README.md'), /artifact|filename|cache/i);
  await assert.rejects(store.openArtifact('retry_voice.mp3'), /artifact|filename|cache/i);
  await assert.rejects(store.openArtifact(OTHER_HASHED_MP3), /symlink|artifact|file/i);
});

test('generated-artifact cleanup removes only invalid regular files inside the cache root', async t => {
  const { cacheDir, parent, store } = temporaryStore(t);
  assert.equal(typeof store.validateGeneratedArtifact, 'function');
  const invalidInside = path.join(cacheDir, HASHED_MP3);
  const invalidOutside = path.join(parent, OTHER_HASHED_MP3);
  const symlinkPath = path.join(cacheDir, OTHER_HASHED_MP3);
  fs.writeFileSync(invalidInside, Buffer.from('provider returned text'));
  fs.writeFileSync(invalidOutside, Buffer.from('outside data'));
  fs.symlinkSync(invalidOutside, symlinkPath);

  await assert.rejects(store.validateGeneratedArtifact(invalidInside), /MP3|artifact|audio/i);
  assert.equal(fs.existsSync(invalidInside), false);

  await assert.rejects(store.validateGeneratedArtifact(invalidOutside), /artifact|filename|cache/i);
  assert.equal(fs.existsSync(invalidOutside), true);

  await assert.rejects(store.validateGeneratedArtifact(symlinkPath), /symlink|artifact|file/i);
  assert.equal(fs.lstatSync(symlinkPath).isSymbolicLink(), true);
});
