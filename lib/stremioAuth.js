const fetch = require('node-fetch');

async function login(email, password) {
  const res = await fetch('https://api.strem.io/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();

  if (!data.result || !data.result.authKey) {
    const msg = (data.error && data.error.message) || 'Login falhou. Confira email e senha.';
    throw new Error(msg);
  }

  return data.result.authKey;
}

module.exports = { login };
