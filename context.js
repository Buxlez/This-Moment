const fs = require('node:fs');
const path = require('node:path');

function readRequired(filename) {
  const filePath = path.join(__dirname, 'user', filename);
  try { return fs.readFileSync(filePath, 'utf8').trim(); }
  catch { throw new Error(`Missing required recommendation context: user/${filename}`); }
}

function buildRecommendationContext({ environment, previousCard, userInput, intent, candidateCount, excludeTracks = [] }) {
  return [
    '# 系统输出约束',
    `严格输出 JSON。本轮意图为 ${intent}，候选歌曲需要 ${candidateCount} 首。`,
    '# 演示品味', readRequired('taste.md'),
    '# 情绪规则', readRequired('mood-rules.md'),
    '# 模拟环境', JSON.stringify(environment),
    '# 上一张卡片', previousCard ? JSON.stringify({
      direction: previousCard.direction,
      tracks: previousCard.tracks.map(track => ({ id: track.id, title: track.title, artist: track.artist })),
    }) : '无',
    '# 必须排除的平台歌曲 ID', excludeTracks.join(', ') || '无',
    '# 用户本轮原话（最高优先级）', userInput,
    '# JSON 字段',
    '{"intent":"recommend|cold_start|refine|refresh","direction":{"atmosphere":[""],"energy":"","rhythm":[""]},"title":"","description":"两句话，45-70个中文字符","candidates":[{"title":"","artist":""}]}',
  ].join('\n\n');
}

module.exports = { readRequired, buildRecommendationContext };
