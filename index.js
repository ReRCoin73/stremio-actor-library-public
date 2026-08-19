require('dotenv').config();
const path = require('path');
const express = require('express');
const { login } = require('./lib/stremioAuth');
const users = require('./lib/users');
const { fetchLibrary } = require('./lib/stremioLibrary');
const { getTopCast } = require('./lib/tmdb');

const app = express();
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use((req, res, next) => {
  if (req.path.endsWith('/manifest.json') || req.path.includes('/catalog/')) {
    res.set('Cache-Control', 'no-cache, max-age=0');
  }
  next();
});

// Cache so na memoria do processo. Sem banco de dados: mais simples, menos pecas
// que podem quebrar. Custo: se o servidor reiniciar, perde o progresso e remonta -
// mas enquanto estiver rodando, titulo novo aparece rapido, sem reconstruir tudo.
const userCaches = new Map(); // authKey -> { items: [...] }
const building = new Set();

function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function decodeConfig(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf-8'));
}

function snapshot(authKey) {
  return userCaches.get(authKey) || { items: [] };
}

function actorsOfType(items, type) {
  const set = new Set();
  items.filter(i => i.type === type).forEach(i => i.cast.forEach(name => set.add(name)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// -------- Builda a biblioteca+elenco de UM usuario, melhorando aos poucos --------
async function buildCache(authKey) {
  const existing = userCaches.get(authKey);
  const previousById = new Map((existing?.items || []).map(i => [i.id, i]));

  const libraryItems = await fetchLibrary(authKey);

  // baseline: TODO titulo da biblioteca entra aqui na hora, mesmo sem elenco ainda.
  // O catalogo nunca fica menor que a biblioteca real - so o elenco (usado no filtro
  // por ator) e que vai sendo preenchido aos poucos, por cima, sem apagar nada.
  const enriched = libraryItems.map(item => {
    const already = previousById.get(item._id);
    if (already && already.cast && already.cast.length > 0) return already;
    return { id: item._id, type: item.type, name: item.name, poster: item.poster, cast: [] };
  });
  userCaches.set(authKey, { items: enriched });

  // agora melhora, um titulo de cada vez, so quem ainda esta sem elenco
  // processa em blocos paralelos (varios titulos ao mesmo tempo) em vez de um por um -
  // muito mais rapido; a TMDB aguenta dezenas de pedidos simultaneos
  const pendentes = enriched.map((item, idx) => ({ item, idx })).filter(x => x.item.cast.length === 0);
  const TAMANHO_BLOCO = 15;

  for (let i = 0; i < pendentes.length; i += TAMANHO_BLOCO) {
    const bloco = pendentes.slice(i, i + TAMANHO_BLOCO);
    await Promise.all(bloco.map(async ({ item, idx }) => {
      try {
        const cast = await getTopCast(item.id, item.type);
        enriched[idx] = { ...item, cast };
      } catch (err) {
        console.error(`Sem elenco por enquanto: ${item.id} (${item.type}):`, err.message);
      }
    }));
    userCaches.set(authKey, { items: enriched });
  }
}

function ensureBuilding(authKey) {
  if (building.has(authKey)) return;
  building.add(authKey);
  buildCache(authKey)
    .catch(err => console.error('Erro ao montar cache:', err.message))
    .finally(() => building.delete(authKey));
}

function buildManifest(movieActors, seriesActors, logoUrl, needsConfig) {
  return {
    id: 'community.castlist.publico',
    version: '1.0.0',
    name: 'Cast List',
    description: 'Filtra sua biblioteca pessoal do Stremio (filmes e series) pelo ator principal de cada titulo. Configuravel: cada pessoa entra com a propria conta Stremio numa pagina de configuracao e recebe um addon individual - login e senha nao ficam armazenados, sao usados so na hora de gerar a chave de acesso.',
    logo: logoUrl,
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [
      {
        type: 'movie',
        id: 'lib-por-ator-movie',
        name: 'Meus Filmes por Ator',
        extra: [{ name: 'genre', isRequired: false, options: movieActors }]
      },
      {
        type: 'series',
        id: 'lib-por-ator-series',
        name: 'Minhas Series por Ator',
        extra: [{ name: 'genre', isRequired: false, options: seriesActors }]
      }
    ],
    // depois de instalado (needsConfig=false) o addon nao pede mais configuracao -
    // a engrenagem some sozinha, so aparece antes de instalar
    behaviorHints: needsConfig
      ? { configurable: true, configurationRequired: true }
      : {}
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
<title>Cast List - Configurar</title>
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
  #result{margin-top:20px;}
  #result.err{color:#f0524b;font-size:14px;}
  .install-btn{display:block;width:100%;box-sizing:border-box;text-align:center;
        padding:14px;border-radius:10px;background:#3ecf6a;color:#0a0a0d;
        font-weight:700;font-size:16px;text-decoration:none;margin-top:6px;}
  .alt-label{font-size:13px;color:#8b8b93;margin-top:18px;margin-bottom:6px;}
  .url-box{font-size:12px;color:#8b8b93;word-break:break-all;background:#0a0a0d;
        border:1px solid #232328;border-radius:8px;padding:10px;}
</style>
</head>
<body>
  <div class="card">
    <h1>Cast List</h1>
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
        result.className = '';
        result.innerHTML =
          '<a class="install-btn" href="' + data.stremioLink + '">Instalar no Stremio</a>' +
          '<div class="alt-label">Se o botão não abrir o app, cola essa URL manualmente no Stremio (Addons &gt; colar URL):</div>' +
          '<div class="url-box">' + data.manifestUrl + '</div>';
      } catch (err) {
        result.className = 'err';
        result.innerHTML = err.message;
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

    users.remember(authKey); // registra que essa pessoa existe, pro relogio automatico achar ela depois de reiniciar
    ensureBuilding(authKey); // comeca a montar em segundo plano, sem segurar a resposta

    res.json({ manifestUrl, stremioLink });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------- Endpoints do addon (por usuario, via config na URL) --------
app.get('/manifest.json', (req, res) => {
  const logoUrl = `https://${req.get('host')}/logo.png?v=2`;
  res.json(buildManifest([], [], logoUrl, true));
});

app.get('/:config/configure', (req, res) => {
  res.redirect('/configure');
});

app.get('/:config/status', (req, res) => {
  try {
    const { a: authKey } = decodeConfig(req.params.config);
    const cache = snapshot(authKey);
    const total = cache.items.length;
    const prontos = cache.items.filter(i => i.cast.length > 0).length;
    res.json({
      total,
      prontos,
      faltam: total - prontos,
      construindo_agora: building.has(authKey),
      filmes_com_ator: actorsOfType(cache.items, 'movie').length,
      series_com_ator: actorsOfType(cache.items, 'series').length
    });
  } catch (err) {
    res.status(400).json({ error: 'Configuracao invalida' });
  }
});

app.get('/:config/manifest.json', (req, res) => {
  try {
    const { a: authKey } = decodeConfig(req.params.config);
    ensureBuilding(authKey);
    const cache = snapshot(authKey);
    const logoUrl = `https://${req.get('host')}/logo.png?v=2`;
    const movieActors = actorsOfType(cache.items, 'movie');
    const seriesActors = actorsOfType(cache.items, 'series');
    res.json(buildManifest(movieActors, seriesActors, logoUrl, false));
  } catch (err) {
    res.status(400).json({ error: 'Configuracao invalida' });
  }
});

app.get('/:config/catalog/:type/:idWithExt', (req, res) => {
  handleCatalog(req, res, req.params.idWithExt, null);
});

app.get('/:config/catalog/:type/:id/:extraWithExt', (req, res) => {
  handleCatalog(req, res, req.params.id, req.params.extraWithExt);
});

function handleCatalog(req, res, idRaw, extraRaw) {
  try {
    const { a: authKey } = decodeConfig(req.params.config);
    ensureBuilding(authKey);
    const cache = snapshot(authKey);
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

// Endpoint leve so pra manter o servidor acordado (usado por um ping externo)
app.get('/ping', (req, res) => res.send('ok'));

const port = process.env.PORT || 7000;
app.listen(port, async () => {
  console.log(`Cast List rodando na porta ${port}`);

  // Ao ligar (depois de reiniciar), traz de volta todo mundo que ja configurou o
  // addon algum dia - nao precisa esperar a pessoa abrir o Stremio pra "avisar".
  const conhecidos = await users.listAll();
  console.log(`Retomando ${conhecidos.length} usuario(s) conhecido(s)`);
  conhecidos.forEach(authKey => ensureBuilding(authKey));

  // Reconfere a biblioteca de todo mundo que ja usou o addon, a cada 5 minutos,
  // sozinho - sem precisar desinstalar/reinstalar pra ver titulo novo.
  setInterval(() => {
    for (const authKey of userCaches.keys()) {
      ensureBuilding(authKey);
    }
  }, 5 * 60 * 1000);
});
