const { routeIntent } = require('./src/domain/intent');

function route(message, hasPreviousCard = false) {
  return { action: 'recommend', intent: routeIntent(message, hasPreviousCard), message: String(message || '').trim() };
}

module.exports = { route, routeIntent };
