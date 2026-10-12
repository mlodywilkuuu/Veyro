'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

let started = false;

function cleanIds(value) {
  return [...new Set(String(value || '')
    .split(/[,\s]+/)
    .map(x => x.trim())
    .filter(x => /^\d{15,25}$/.test(x)))];
}

function cleanWords(value) {
  return [...new Set(String(value || '')
    .split(/[,\n]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 200))];
}

function cleanDomains(value) {
  return [...new Set(String(value || '')
    .split(/[,\n]+/)
    .map(x => x.trim().toLowerCase())
    .map(x => x.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(x => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x))
    .slice(0, 100))];
}

function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function int(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function hasManageGuild(guild) {
  try {
    const p = BigInt(guild.permissions || '0');
    return (p & 8n) === 8n || (p & 32n) === 32n;
  } catch {
    return false;
  }
}

function startPanel({ client, db, save, commands, BOT_VERSION }) {
  if (started) return;
  started = true;

  const CLIENT_ID = process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const GUILD_ID = process.env.GUILD_ID;
  const BASE_URL = String(process.env.PANEL_BASE_URL || '').replace(/\/+$/, '');
  const PORT = Number(process.env.PANEL_PORT || process.env.SERVER_PORT || process.env.PORT || 3000);

  if (!CLIENT_ID || !CLIENT_SECRET || !GUILD_ID || !BASE_URL) {
    console.log('⚠️ Panel WWW wyłączony: ustaw CLIENT_ID, DISCORD_CLIENT_SECRET, GUILD_ID i PANEL_BASE_URL.');
    return;
  }

  const SESSION_SECRET = process.env.PANEL_SESSION_SECRET ||
    crypto.createHash('sha256').update(String(process.env.TOKEN || '') + ':veyro-panel').digest('hex');

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use(express.json({ limit: '128kb' }));
  app.use(session({
    name: 'veyro.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 12
    }
  }));

  app.use(express.static(path.join(__dirname, 'panel', 'public'), { extensions: ['html'] }));

  function authorized(req) {
    return Boolean(req.session?.user?.id && req.session?.authorized);
  }

  function needAuth(req, res, next) {
    if (!authorized(req)) return res.status(401).json({ error: 'Zaloguj się przez Discord.' });
    next();
  }

  function needCsrf(req, res, next) {
    if (!req.session?.csrf || req.get('x-csrf-token') !== req.session.csrf) {
      return res.status(403).json({ error: 'Nieprawidłowy token bezpieczeństwa. Odśwież panel.' });
    }
    next();
  }

  app.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(24).toString('hex');
    req.session.oauthState = state;
    const redirect = new URL('https://discord.com/oauth2/authorize');
    redirect.searchParams.set('client_id', CLIENT_ID);
    redirect.searchParams.set('response_type', 'code');
    redirect.searchParams.set('redirect_uri', BASE_URL + '/auth/callback');
    redirect.searchParams.set('scope', 'identify guilds');
    redirect.searchParams.set('state', state);
    res.redirect(redirect.toString());
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      if (!req.query.code || !req.query.state || req.query.state !== req.session.oauthState) {
        return res.status(400).send('Nieprawidłowa sesja logowania.');
      }

      delete req.session.oauthState;

      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: String(req.query.code),
          redirect_uri: BASE_URL + '/auth/callback'
        })
      });

      if (!tokenResponse.ok) throw new Error('Discord OAuth token: ' + tokenResponse.status);
      const token = await tokenResponse.json();

      const headers = { Authorization: 'Bearer ' + token.access_token };
      const [userResponse, guildsResponse] = await Promise.all([
        fetch('https://discord.com/api/users/@me', { headers }),
        fetch('https://discord.com/api/users/@me/guilds', { headers })
      ]);

      if (!userResponse.ok || !guildsResponse.ok) throw new Error('Nie udało się pobrać profilu Discord.');

      const user = await userResponse.json();
      const guilds = await guildsResponse.json();
      const guild = guilds.find(g => g.id === GUILD_ID);

      if (!guild || !hasManageGuild(guild)) {
        req.session.destroy(() => {});
        return res.status(403).send('Nie masz uprawnienia Administrator lub Zarządzanie serwerem na tym serwerze.');
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        globalName: user.global_name || user.username,
        avatar: user.avatar || null
      };
      req.session.authorized = true;
      req.session.csrf = crypto.randomBytes(24).toString('hex');

      res.redirect('/');
    } catch (e) {
      console.error('Panel OAuth:', e);
      res.status(500).send('Logowanie Discord nie powiodło się.');
    }
  });

  app.post('/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/me', (req, res) => {
    if (!authorized(req)) return res.json({ authenticated: false });
    res.json({
      authenticated: true,
      user: req.session.user,
      csrf: req.session.csrf,
      guildId: GUILD_ID
    });
  });

  app.get('/api/status', needAuth, (req, res) => {
    const p = db('panel-config');
    const radio = db('radio-config');
    res.json({
      bot: client.user ? {
        id: client.user.id,
        tag: client.user.tag,
        avatar: client.user.displayAvatarURL({ size: 128 })
      } : null,
      online: Boolean(client.user),
      version: p.version || BOT_VERSION,
      ping: Math.max(0, Math.round(client.ws.ping || 0)),
      uptimeMs: client.uptime || 0,
      guilds: client.guilds.cache.size,
      commands: commands.map(c => c.name),
      radio: {
        enabled: Boolean(radio.enabled),
        station: radio.station || 'general',
        volume: radio.volume ?? 35
      }
    });
  });

  app.get('/api/automod', needAuth, (req, res) => {
    const c = db('automod-config');
    res.json({
      enabled: Boolean(c.enabled),
      links: Boolean(c.links),
      invites: Boolean(c.invites),
      spam: Boolean(c.spam),
      duplicates: Boolean(c.duplicates),
      caps: Boolean(c.caps),
      mentions: Boolean(c.mentions),
      badWordsEnabled: Boolean(c.badWordsEnabled),
      badWords: c.badWords || [],
      allowedDomains: c.allowedDomains || [],
      ignoredRoles: c.ignoredRoles || [],
      settings: c.settings || {}
    });
  });

  app.put('/api/automod', needAuth, needCsrf, (req, res) => {
    const body = req.body || {};
    const c = db('automod-config');

    for (const key of ['enabled','links','invites','spam','duplicates','caps','mentions','badWordsEnabled']) {
      if (key in body) c[key] = bool(body[key]);
    }

    c.settings ??= {};
    c.settings.spam ??= {};
    c.settings.duplicates ??= {};
    c.settings.caps ??= {};
    c.settings.mentions ??= {};

    if (body.settings?.spam) {
      c.settings.spam.messages = int(body.settings.spam.messages, 2, 30, c.settings.spam.messages || 7);
      c.settings.spam.seconds = int(body.settings.spam.seconds, 2, 120, c.settings.spam.seconds || 10);
    }
    if (body.settings?.duplicates) {
      c.settings.duplicates.messages = int(body.settings.duplicates.messages, 2, 20, c.settings.duplicates.messages || 4);
      c.settings.duplicates.seconds = int(body.settings.duplicates.seconds, 2, 120, c.settings.duplicates.seconds || 15);
    }
    if (body.settings?.caps) {
      c.settings.caps.minLetters = int(body.settings.caps.minLetters, 5, 100, c.settings.caps.minLetters || 12);
      c.settings.caps.percentage = int(body.settings.caps.percentage, 20, 100, c.settings.caps.percentage || 75);
    }
    if (body.settings?.mentions) {
      c.settings.mentions.max = int(body.settings.mentions.max, 1, 50, c.settings.mentions.max || 6);
    }

    if ('badWords' in body) c.badWords = cleanWords(body.badWords);
    if ('allowedDomains' in body) c.allowedDomains = cleanDomains(body.allowedDomains);
    if ('ignoredRoles' in body) c.ignoredRoles = cleanIds(body.ignoredRoles);

    save('automod-config');
    res.json({ ok: true });
  });

  app.get('/api/permissions', needAuth, (req, res) => {
    const c = db('command-permissions');
    res.json({
      commands: commands.map(x => x.name).sort(),
      permissions: c.commands || {}
    });
  });

  app.put('/api/permissions/:command', needAuth, needCsrf, (req, res) => {
    const name = String(req.params.command || '');
    if (!commands.some(c => c.name === name)) return res.status(404).json({ error: 'Nie znaleziono komendy.' });

    const body = req.body || {};
    const mode = ['everyone', 'admins', 'roles'].includes(body.mode) ? body.mode : 'everyone';
    const store = db('command-permissions');
    store.commands ??= {};
    store.commands[name] = {
      mode,
      roleIds: cleanIds(body.roleIds),
      channelIds: cleanIds(body.channelIds)
    };
    save('command-permissions');
    res.json({ ok: true, value: store.commands[name] });
  });

  app.get('/api/radio', needAuth, (req, res) => {
    const c = db('radio-config');
    res.json({
      enabled: Boolean(c.enabled),
      channelId: c.channelId || '',
      volume: c.volume ?? 35,
      station: c.station || 'general'
    });
  });

  app.put('/api/radio', needAuth, needCsrf, (req, res) => {
    const body = req.body || {};
    const c = db('radio-config');
    if ('enabled' in body) c.enabled = bool(body.enabled);
    if ('channelId' in body) c.channelId = cleanIds(body.channelId)[0] || null;
    if ('volume' in body) c.volume = int(body.volume, 1, 100, c.volume ?? 35);
    if (['general','halloween','christmas'].includes(body.station)) c.station = body.station;
    save('radio-config');
    res.json({ ok: true });
  });

  app.use((err, req, res, next) => {
    console.error('Panel HTTP:', err);
    res.status(500).json({ error: 'Błąd panelu.' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log('🌐 Panel Veyro: ' + BASE_URL + ' (port ' + PORT + ')');
  });
}

module.exports = { startPanel };
