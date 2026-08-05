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
const MPEG_FRAME = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x01]);
const ID3_AUDIO = Buffer.concat([
  Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  MPEG_FRAME,
]);
const MPEG_AUDIO = MPEG_FRAME;

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

test('pins the original cache root and rejects a symlink replacement without touching outside data', async t => {
  const { cacheDir, parent, store } = temporaryStore(t);
  const movedRoot = path.join(parent, 'original-cache');
  const outsideRoot = path.join(parent, 'outside');
  const outsideArtifact = path.join(outsideRoot, HASHED_MP3);
  fs.mkdirSync(outsideRoot);
  fs.writeFileSync(outsideArtifact, ID3_AUDIO);
  fs.renameSync(cacheDir, movedRoot);
  fs.symlinkSync(outsideRoot, cacheDir);

  await assert.rejects(store.openArtifact(HASHED_MP3), /cache root|artifact/i);
  await assert.rejects(store.validateArtifactPath(path.join(cacheDir, HASHED_MP3)), /cache root|artifact/i);
  await assert.rejects(
    store.validateGeneratedArtifact(path.join(cacheDir, HASHED_MP3)),
    /cache root|artifact/i
  );
  assert.deepEqual(fs.readFileSync(outsideArtifact), ID3_AUDIO);
});

test('rejects a new directory created at the pinned cache path', async t => {
  const { cacheDir, parent, store } = temporaryStore(t);
  const movedRoot = path.join(parent, 'original-cache');
  fs.renameSync(cacheDir, movedRoot);
  fs.mkdirSync(cacheDir);
  const replacementArtifact = path.join(cacheDir, HASHED_MP3);
  fs.writeFileSync(replacementArtifact, ID3_AUDIO);

  await assert.rejects(store.openArtifact(HASHED_MP3), /cache root|artifact/i);
  await assert.rejects(store.validateArtifactPath(replacementArtifact), /cache root|artifact/i);
  assert.deepEqual(fs.readFileSync(replacementArtifact), ID3_AUDIO);
});

test('rejects multiply-linked artifacts and preserves the outside link', async t => {
  const { cacheDir, parent, store } = temporaryStore(t);
  const outsideArtifact = path.join(parent, 'outside.mp3');
  const linkedArtifact = path.join(cacheDir, HASHED_MP3);
  fs.writeFileSync(outsideArtifact, ID3_AUDIO);
  fs.linkSync(outsideArtifact, linkedArtifact);

  await assert.rejects(store.openArtifact(HASHED_MP3), /link|artifact/i);
  await assert.rejects(store.validateArtifactPath(linkedArtifact), /link|artifact/i);
  await assert.rejects(store.validateGeneratedArtifact(linkedArtifact), /link|artifact/i);
  assert.deepEqual(fs.readFileSync(outsideArtifact), ID3_AUDIO);
  assert.equal(fs.existsSync(linkedArtifact), true);
});

test('accepts complete ID3v2 plus MPEG audio and MPEG-only audio', async t => {
  const { cacheDir, store } = temporaryStore(t);
  const tagged = path.join(cacheDir, HASHED_MP3);
  const untagged = path.join(cacheDir, OTHER_HASHED_MP3);
  fs.writeFileSync(tagged, ID3_AUDIO);
  fs.writeFileSync(untagged, MPEG_AUDIO);

  assert.equal((await store.validateArtifactPath(tagged)).size, ID3_AUDIO.length);
  assert.equal((await store.validateArtifactPath(untagged)).size, MPEG_AUDIO.length);
});

test('rejects malformed ID3 headers and ID3-only files', async t => {
  const malformed = [
    { name: 'three-byte ID3', bytes: Buffer.from('ID3') },
    { name: 'truncated ID3 header', bytes: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]) },
    { name: 'unsupported ID3 version', bytes: Buffer.from([0x49, 0x44, 0x33, 0x01, 0x00, 0x00, 0, 0, 0, 0, ...MPEG_FRAME]) },
    { name: 'invalid ID3 revision', bytes: Buffer.from([0x49, 0x44, 0x33, 0x04, 0xff, 0x00, 0, 0, 0, 0, ...MPEG_FRAME]) },
    { name: 'reserved ID3v2.2 flag', bytes: Buffer.from([0x49, 0x44, 0x33, 0x02, 0x00, 0x01, 0, 0, 0, 0, ...MPEG_FRAME]) },
    { name: 'reserved ID3v2.3 flag', bytes: Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x10, 0, 0, 0, 0, ...MPEG_FRAME]) },
    { name: 'reserved ID3v2.4 flag', bytes: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x08, 0, 0, 0, 0, ...MPEG_FRAME]) },
    { name: 'non-syncsafe ID3 size', bytes: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x80, 0, 0, 0, ...MPEG_FRAME]) },
    { name: 'ID3 size beyond file', bytes: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0, 0, 0, 0x20, ...MPEG_FRAME]) },
    { name: 'ID3 only', bytes: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0, 0, 0, 0]) },
  ];

  for (const [index, example] of malformed.entries()) {
    const { cacheDir, store } = temporaryStore(t);
    const filename = `${String(index).padStart(32, '0')}.mp3`;
    const artifactPath = path.join(cacheDir, filename);
    fs.writeFileSync(artifactPath, example.bytes);
    await assert.rejects(
      store.validateArtifactPath(artifactPath),
      /MP3|artifact|audio/i,
      example.name
    );
  }
});

test('rejects malformed MPEG frame headers with and without ID3', async t => {
  const malformedHeaders = [
    Buffer.from([0xff, 0xeb, 0x90, 0x64]), // reserved MPEG version
    Buffer.from([0xff, 0xf8, 0x90, 0x64]), // reserved layer
    Buffer.from([0xff, 0xfb, 0x00, 0x64]), // free bitrate
    Buffer.from([0xff, 0xfb, 0xf0, 0x64]), // bad bitrate
    Buffer.from([0xff, 0xfb, 0x9c, 0x64]), // reserved sample rate
  ];

  for (const [index, mpegHeader] of malformedHeaders.entries()) {
    const { cacheDir, store } = temporaryStore(t);
    const bareName = `${String(index + 20).padStart(32, '0')}.mp3`;
    const taggedName = `${String(index + 30).padStart(32, '0')}.mp3`;
    const taggedHeader = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]);
    fs.writeFileSync(path.join(cacheDir, bareName), mpegHeader);
    fs.writeFileSync(path.join(cacheDir, taggedName), Buffer.concat([taggedHeader, mpegHeader]));

    await assert.rejects(store.openArtifact(bareName), /MP3|artifact|audio/i);
    await assert.rejects(store.openArtifact(taggedName), /MP3|artifact|audio/i);
  }
});
