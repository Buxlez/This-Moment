const BROAD_REQUEST = /^\s*(来|放|听|推荐|给我)?\s*(点|一点|些)?\s*(音乐|歌|歌曲)\s*(吧|听听)?[!！.。、,，?？\s]*$/;
const REFRESH = /(换一批|再换|换些|换点|重新来|另一批)/;
const REFINE = /(再|更|一点|一些|保持|别太|不要|稍微|还是)/;

function routeIntent(userInput, hasPreviousCard = false) {
  const text = String(userInput || '').trim();
  if (hasPreviousCard && REFRESH.test(text)) return 'refresh';
  if (hasPreviousCard && REFINE.test(text)) return 'refine';
  if (!hasPreviousCard && BROAD_REQUEST.test(text)) return 'cold_start';
  return 'recommend';
}

module.exports = { routeIntent };
