require('dotenv').config();
const path = require('path');
const express = require('express');
const { login } = require('./lib/stremioAuth');
const { fetchLibrary } = require('./lib/stremioLibrary');
const { getTopCast } = require('./lib/tmdb');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const REFRESH_HOURS = 6;
const userCaches = new Map(); // authKey -> { updatedAt, items, actors }

// -------- Config vai codificada na URL, sem banco de dados --------
function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function decodeConfig(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf-8'));
}

// -------- Monta/atualiza o cache de UM usuario (biblioteca + elenco) --------
async function getOrBuildCache(authKey) {
  const existing = userCaches.get(authKey);
  const stale = !existing || (Date.now() - existing.updatedAt > REFRESH_HOURS * 60 * 60 * 1000);
  if (!stale) return existing;

  const libraryItems = await fetchLibrary(authKey);
  const enriched = [];
  const actorSet = new Set();

  for (const item of libraryItems) {
    try {
      const cast = await getTopCast(item._id, item.type);
      cast.forEach(name => actorSet.add(name));
      enriched.push({ id: item._id, type: item.type, name: item.name, poster: item.poster, cast });
    } catch (err) {
      enriched.push({ id: item._id, type: item.type, name: item.name, poster: item.poster, cast: [] });
    }
    await new Promise(r => setTimeout(r, 300)); // limite de requisicoes do TMDB gratis
  }

  const cache = {
    updatedAt: Date.now(),
    items: enriched,
    actors: Array.from(actorSet).sort((a, b) => a.localeCompare(b))
  };
  userCaches.set(authKey, cache);
  return cache;
}

function buildManifest(actors, logoUrl) {
  return {
    id: 'community.bibliotecaporactor.publico',
    version: '1.0.0',
    name: 'Biblioteca por Ator',
    description: 'Filtra sua biblioteca pessoal do Stremio (filmes e series) pelo ator principal de cada titulo. Configuravel: cada pessoa entra com a propria conta Stremio numa pagina de configuracao e recebe um addon individual - login e senha nao ficam armazenados, sao usados so na hora de gerar a chave de acesso.',
    logo: logoUrl,
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [
      {
        type: 'movie',
        id: 'lib-por-ator-movie',
        name: 'Meus Filmes por Ator',
        extra: [{ name: 'genre', isRequired: false, options: actors }]
      },
      {
        type: 'series',
        id: 'lib-por-ator-series',
        name: 'Minhas Series por Ator',
        extra: [{ name: 'genre', isRequired: false, options: actors }]
      }
    ],
    behaviorHints: { configurable: true, configurationRequired: true }
  };
}

// -------- Pagina de configuracao --------
app.get('/', (req, res) => res.redirect('/configure'));

app.get('/configure', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Biblioteca por Ator - Configurar</title>
<style>
  body{background:#0a0a0d;color:#f2f2f0;font-family:-apple-system,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
  .card{background:#151519;border:1px solid #232328;border-radius:16px;padding:28px;max-width:380px;width:100%;}
  h1{font-size:20px;margin:0 0 6px;}
  p{color:#8b8b93;font-size:14px;margin:0 0 20px;}
  label{font-size:13px;color:#8b8b93;display:block;margin:14px 0 6px;}
  input{width:100%;padding:12px;border-radius:10px;border:1px solid #232328;
        background:#0a0a0d;color:#f2f2f0;font-size:15px;box-sizing:border-box;}
  button{width:100%;margin-top:22px;padding:14px;border-radius:10px;border:none;
         background:#3ecf6a;color:#0a0a0d;font-weight:700;font-size:15px;}
  #result{margin-top:18px;font-size:14px;word-break:break-all;}
  #result a{color:#3ecf6a;}
  .err{color:#f0524b;}
</style>
</head>
<body>
  <div class="card">
    <h1>Biblioteca por Ator</h1>
    <p>Entra com sua conta do Stremio pra gerar seu addon pessoal.</p>
    <form id="f">
      <label>Email do Stremio</label>
      <input type="email" id="email" required>
      <label>Senha</label>
      <input type="password" id="password" required>
      <button type="submit">Gerar meu addon</button>
    </form>
    <div id="result"></div>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const result = document.getElementById('result');
      result.textContent = 'Entrando...';
      try {
        const res = await fetch('/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
        result.innerHTML = 'Pronto! <a href="' + data.stremioLink + '">Toca aqui pra instalar no Stremio</a>' +
          '<br><br>Ou cola essa URL no Stremio (Addons > colar URL):<br>' + data.manifestUrl;
      } catch (err) {
        result.innerHTML = '<span class="err">' + err.message + '</span>';
      }
    });
  </script>
</body>
</html>`);
});

app.post('/configure', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha sao obrigatorios' });

  try {
    const authKey = await login(email, password);
    const config = encodeConfig({ a: authKey });
    const host = req.get('host');
    const manifestUrl = `https://${host}/${config}/manifest.json`;
    const stremioLink = `stremio://${host}/${config}/manifest.json`;

    // comeca a montar o cache em segundo plano, sem fazer a pessoa esperar
    getOrBuildCache(authKey).catch(() => {});

    res.json({ manifestUrl, stremioLink });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------- Endpoints do addon (por usuario, via config na URL) --------
app.get('/:config/manifest.json', async (req, res) => {
  try {
    const { a: authKey } = decodeConfig(req.params.config);
    const cache = await getOrBuildCache(authKey);
    const logoUrl = `https://${req.get('host')}/logo.png`;
    res.json(buildManifest(cache.actors, logoUrl));
  } catch (err) {
    res.status(400).json({ error: 'Configuracao invalida' });
  }
});

app.get('/:config/catalog/:type/:idWithExt', async (req, res) => {
  await handleCatalog(req, res, req.params.idWithExt, null);
});

app.get('/:config/catalog/:type/:id/:extraWithExt', async (req, res) => {
  await handleCatalog(req, res, req.params.id, req.params.extraWithExt);
});

async function handleCatalog(req, res, idRaw, extraRaw) {
  try {
    const { a: authKey } = decodeConfig(req.params.config);
    const cache = await getOrBuildCache(authKey);
    const type = req.params.type;

    let actorFiltro = null;
    if (extraRaw) {
      const extraStr = extraRaw.replace(/\.json$/, '');
      const params = new URLSearchParams(extraStr);
      actorFiltro = params.get('genre');
    }

    let items = cache.items.filter(i => i.type === type);
    if (actorFiltro) items = items.filter(i => i.cast.includes(actorFiltro));

    const metas = items.map(i => ({ id: i.id, type: i.type, name: i.name, poster: i.poster }));
    res.json({ metas });
  } catch (err) {
    res.status(400).json({ metas: [] });
  }
}

const port = process.env.PORT || 7000;
app.listen(port, () => console.log(`Addon publico rodando na porta ${port}`));
