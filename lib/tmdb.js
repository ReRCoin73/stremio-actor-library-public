const fetch = require('node-fetch');

const TMDB_KEY = process.env.TMDB_API_KEY;
const TOP_N_ACTORS = 1; // so o ator principal (o primeiro creditado) de cada titulo

async function getTopCast(imdbId, type) {
  if (!TMDB_KEY) throw new Error('TMDB_API_KEY nao configurada no servidor');

  const findRes = await fetch(
    `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
  );
  const findData = await findRes.json();

  const bucket = type === 'series' ? findData.tv_results : findData.movie_results;
  if (!bucket || !bucket.length) return [];

  const tmdbId = bucket[0].id;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  const creditsRes = await fetch(
    `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/credits?api_key=${TMDB_KEY}`
  );
  const creditsData = await creditsRes.json();

  if (!creditsData.cast) return [];

  return creditsData.cast
    .slice(0, TOP_N_ACTORS)
    .map(actor => actor.name);
}

module.exports = { getTopCast };
