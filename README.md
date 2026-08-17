# Biblioteca por Ator (versão pública)

Versão multiusuário do addon Stremio que filtra a biblioteca pessoal por ator principal.
Qualquer pessoa pode entrar com o próprio login do Stremio numa página de configuração
e gerar seu addon individual, sem mexer em código nem em variáveis de ambiente.

## Deploy (Render)

1. New Web Service → conecta esse repositório
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Environment Variables:
   - `TMDB_API_KEY` → chave gratuita de themoviedb.org (compartilhada entre todos os usuários)
5. Deploy

## Uso

Depois do deploy, a URL principal é:

```
https://SEU-SERVICO.onrender.com/configure
```

A pessoa abre essa página, entra com email/senha do Stremio, e recebe uma URL de
addon já configurada só pra biblioteca dela. Nenhuma senha fica salva — só a
`authKey` (token de sessão) é usada, embutida de forma opaca na própria URL do addon.
