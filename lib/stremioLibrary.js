const fetch = require('node-fetch');

async function fetchLibrary(authKey) {
  const res = await fetch('https://api.strem.io/api/datastoreGet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      authKey,
      collection: 'libraryItem',
      all: true
    })
  });

  const data = await res.json();

  if (!data.result) {
    throw new Error('Nao foi possivel ler a library. Resposta: ' + JSON.stringify(data));
  }

  return data.result.filter(item => !item.removed && (item.type === 'movie' || item.type === 'series'));
}

module.exports = { fetchLibrary };
