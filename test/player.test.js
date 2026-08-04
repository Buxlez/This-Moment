const test = require('node:test');
const assert = require('node:assert/strict');

const { PlayerState } = require('../pwa/player');

function tracks() {
  return [
    { id: '1', title: 'One', artist: 'A' },
    { id: '2', title: 'Two', artist: 'B' },
    { id: '3', title: 'Three', artist: 'C' },
  ];
}

test('replaces queue and moves through tracks without wrapping', () => {
  const state = new PlayerState();
  state.replaceQueue('card-1', tracks(), 1);
  assert.equal(state.current().id, '2');
  assert.equal(state.next().id, '3');
  assert.equal(state.next(), null);
  assert.equal(state.previous().id, '2');
  state.replaceQueue('card-2', [tracks()[0]], 0);
  assert.equal(state.cardId, 'card-2');
  assert.equal(state.current().id, '1');
});

test('refreshes a failed playback URL once, then stops without advancing', () => {
  const state = new PlayerState();
  state.replaceQueue('card-1', tracks(), 0);
  assert.equal(state.onPlaybackError(), 'refresh');
  assert.equal(state.onPlaybackError(), 'stop');
  assert.equal(state.current().id, '1');
});

test('queue stays on the selected track until navigation is explicit', () => {
  const state = new PlayerState();
  state.replaceQueue('card-1', tracks(), 0);

  assert.equal(state.current().id, '1');
  assert.equal(state.current().id, '1');
  assert.equal(state.next().id, '2');
  assert.equal(state.previous().id, '1');
});

test('player state has no speech-first preference or automatic sequence API', () => {
  const state = new PlayerState();

  assert.equal('ttsFirst' in state, false);
  assert.equal(state.setTtsFirst, undefined);
  assert.equal(state.playAllSequence, undefined);
});
