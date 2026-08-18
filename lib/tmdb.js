const fetch = require('node-fetch');

const TMDB_KEY = process.env.TMDB_API_KEY;
const TOP_N_ACTORS = 1; // so o ator principal (o primeiro creditado) de cada titulo

async function fetchJson(url) {
  const res = await fetch(url);
  if (res.status === 429) {
    const err = new Error('TMDB rate limit (429)');
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`TMDB respondeu ${res.status} para ${url}`);
  }
  return res.json();
}

async function getTopCastOnce(imdbId, type) {
  if (!TMDB_KEY) throw new Error('TMDB_API_KEY nao configurada no servidor');

  const cleanId = imdbId.split(':')[0]; // seguranca: tira qualquer sufixo de temporada/episodio

  const findData = await fetchJson(
    `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_KEY}&external_source=imdb_id`
  );

  const bucket = type === 'series' ? findData.tv_results : findData.movie_results;
  if (!bucket || !bucket.length) return [];

  const tmdbId = bucket[0].id;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  const creditsData = await fetchJson(
    `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/credits?api_key=${TMDB_KEY}`
  );

  if (!creditsData.cast) return [];

  return creditsData.cast
    .slice(0, TOP_N_ACTORS)
    .map(actor => actor.name);
}

// Tenta de novo com espera crescente se a TMDB responder "muitas requisicoes" (429),
// em vez de desistir do titulo silenciosamente.
async function getTopCast(imdbId, type, attempt = 1) {
  try {
    return await getTopCastOnce(imdbId, type);
  } catch (err) {
    if (err.rateLimited && attempt <= 3) {
      const wait = attempt * 1500;
      console.warn(`TMDB rate limit em ${imdbId}, tentativa ${attempt}, esperando ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      return getTopCast(imdbId, type, attempt + 1);
    }
    console.error(`Falha ao buscar elenco de ${imdbId} (${type}):`, err.message);
    throw err;
  }
}

module.exports = { getTopCast };
