const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRepository } = require('../state');

test('persists cards, ordered tracks, and TTS state across reopen', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'this-moment-state-'));
  const dbPath = path.join(directory, 'state.sqlite');
  const card = {
    id: 'card-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    title: '清醒一点，慢慢出发',
    description: '上海的早晨正在醒来。让节奏稳稳地推着你往前。',
    provider: 'demo',
    status: 'ready',
    warning: null,
    ttsStatus: 'pending',
    environment: { city: '上海', weather: '晴朗', localTime: '2026-08-01T08:20:00+08:00' },
    direction: { atmosphere: ['明亮'], energy: '中高', rhythm: ['稳定'] },
    userInput: '提神但别太吵',
    intent: 'recommend',
    createdAt: '2026-08-01T00:20:00.000Z',
    tracks: [
      { id: 'demo-2', title: 'Second', artist: 'B', album: 'B', durationMs: 182000, provider: 'demo' },
      { id: 'demo-1', title: 'First', artist: 'A', album: 'A', durationMs: 180000, provider: 'demo' },
    ],
  };

  let repository;
  try {
    repository = createRepository(dbPath);
    repository.saveCard(card);
    repository.updateTts(card.id, {
      status: 'ready', url: '/api/tts/0123456789abcdef0123456789abcdef.mp3', error: null,
    });
    repository.close();
    repository = null;

    repository = createRepository(dbPath);
    const cards = repository.listCards('session-1');
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0].tracks.map(track => track.id), ['demo-2', 'demo-1']);
    assert.equal(cards[0].ttsStatus, 'ready');
    assert.equal(cards[0].ttsUrl, '/api/tts/0123456789abcdef0123456789abcdef.mp3');
    assert.deepEqual(repository.getCard('card-1').direction.atmosphere, ['明亮']);
  } finally {
    if (repository?.db?.open) repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
