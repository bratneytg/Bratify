import express from 'express';
import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import * as gemini from './services/gemini.js'; // namespace: si falta elegirTipoSegmento no se cae el arranque
import { generarAudioLocucion } from './services/elevenlabs.js';
import { obtenerCancionActualConHistorial } from './services/spotify.js';
import { obtenerClima } from './services/clima.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// CONFIGURACIÓN. En Render define: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, GEMINI_API_KEY, ELEVENLABS_API_KEY
// y SPOTIFY_REDIRECT_URI = https://TU-APP.onrender.com/callback (idéntica a la registrada en el dashboard de Spotify).
// ---------------------------------------------------------------------------
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/callback`;
const SCOPE = 'user-read-playback-state user-read-currently-playing user-modify-playback-state';
const EN_RENDER = !!process.env.RENDER || process.env.NODE_ENV === 'production';
const COOKIE_SESION = 'bratify_rt';   // refresh token (httpOnly: el JavaScript del navegador no puede leerlo)
const COOKIE_STATE = 'bratify_state'; // anti-CSRF durante el login
const ACCIONES_PERMITIDAS = ['play', 'pause', 'next', 'previous', 'shuffle', 'volume', 'seek'];
const UN_ANO = 365 * 24 * 3600 * 1000;

app.set('trust proxy', 1); // Render va detrás de un proxy HTTPS
app.use(express.json());
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, '../public')));
app.get('/healthz', (req, res) => res.send('ok')); // health check de Render

// ---------------------------------------------------------------------------
// SESIÓN: el refresh token vive en una cookie y el servidor renueva el access token solo.
// Sin disco ni base de datos (en Render el disco se borra en cada reinicio).
// ---------------------------------------------------------------------------
const opcionesCookie = (maxAge) => ({ httpOnly: true, sameSite: 'lax', secure: EN_RENDER, path: '/', maxAge });

function leerCookie(req, nombre) {
  const par = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(nombre + '='));
  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
}

const cacheTokens = new Map();   // refreshToken -> { accessToken, expira }
const renovaciones = new Map();  // refreshToken -> Promise (evita renovar varias veces a la vez)

async function pedirTokensSpotify(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams(params)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error_description || data.error || `Spotify ${r.status}`), { codigo: data.error });
  return data;
}

// Devuelve un access token válido (renovándolo si hace falta) o null si no hay sesión o fue revocada
async function obtenerAccessToken(req, res) {
  const refresh = leerCookie(req, COOKIE_SESION);
  if (!refresh) return null;

  const guardado = cacheTokens.get(refresh);
  if (guardado && guardado.expira - Date.now() > 60_000) return guardado.accessToken;

  if (!renovaciones.has(refresh)) {
    renovaciones.set(refresh, pedirTokensSpotify({ grant_type: 'refresh_token', refresh_token: refresh })
      .finally(() => renovaciones.delete(refresh)));
  }
  try {
    const data = await renovaciones.get(refresh);
    cacheTokens.set(refresh, { accessToken: data.access_token, expira: Date.now() + data.expires_in * 1000 });
    // Spotify a veces entrega un refresh token nuevo: hay que guardarlo
    if (data.refresh_token && data.refresh_token !== refresh) res.cookie(COOKIE_SESION, data.refresh_token, opcionesCookie(UN_ANO));
    return data.access_token;
  } catch (e) {
    console.warn('⚠️ No se pudo renovar el token:', e.message);
    if (e.codigo === 'invalid_grant') { // sesión revocada: toca iniciar sesión de nuevo
      cacheTokens.delete(refresh);
      res.clearCookie(COOKIE_SESION, opcionesCookie(0));
    }
    return null;
  }
}

// Las rutas protegidas reciben `req.spotifyToken` ya listo
async function requiereSesion(req, res, next) {
  const token = await obtenerAccessToken(req, res);
  if (!token) return res.status(401).json({ error: 'sin_sesion' });
  req.spotifyToken = token;
  next();
}

// ---------------------------------------------------------------------------
// LOGIN / LOGOUT
// ---------------------------------------------------------------------------
app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(COOKIE_STATE, state, opcionesCookie(10 * 60 * 1000));
  res.redirect('https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: process.env.SPOTIFY_CLIENT_ID, scope: SCOPE, redirect_uri: REDIRECT_URI, state,
  }));
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const paginaError = (msg) => res.status(400).send(
    `<body style="font-family:sans-serif;text-align:center;padding-top:50px"><h2>${msg}</h2><a href="/login">Intentar de nuevo</a></body>`);

  if (error) return paginaError('Spotify canceló el inicio de sesión.');
  if (!code || !state || state !== leerCookie(req, COOKIE_STATE)) return paginaError('Login no válido o caducado.');

  try {
    const data = await pedirTokensSpotify({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
    cacheTokens.set(data.refresh_token, { accessToken: data.access_token, expira: Date.now() + data.expires_in * 1000 });
    res.cookie(COOKIE_SESION, data.refresh_token, opcionesCookie(UN_ANO));
    res.clearCookie(COOKIE_STATE, opcionesCookie(0));
    res.redirect('/'); // ya no hay que copiar ningún token
  } catch (e) {
    console.error('❌ Error en /callback:', e.message);
    paginaError('No se pudo completar el inicio de sesión: ' + e.message);
  }
});

app.get('/logout', (req, res) => {
  cacheTokens.delete(leerCookie(req, COOKIE_SESION));
  res.clearCookie(COOKIE_SESION, opcionesCookie(0));
  res.redirect('/');
});

// El front pregunta esto al abrir: ¿hay sesión válida?
app.get('/api/estado-sesion', async (req, res) => {
  res.json({ conectado: !!(await obtenerAccessToken(req, res)) });
});

// ---------------------------------------------------------------------------
// API DEL REPRODUCTOR
// ---------------------------------------------------------------------------
app.get('/api/estado', requiereSesion, async (req, res) => {
  try {
    const r = await fetch('https://api.spotify.com/v1/me/player', { headers: { Authorization: `Bearer ${req.spotifyToken}` } });
    if (r.status === 204) return res.json({ is_playing: false }); // sin dispositivo activo
    if (r.status === 401) cacheTokens.delete(leerCookie(req, COOKIE_SESION)); // fuerza renovar en la próxima
    res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/player/:action', requiereSesion, async (req, res) => {
  const { action } = req.params;
  if (!ACCIONES_PERMITIDAS.includes(action)) return res.status(400).json({ success: false, error: `Acción no permitida: ${action}` });

  let url = `https://api.spotify.com/v1/me/player/${action}`;
  let method = 'POST'; // next y previous
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  if (action === 'play' || action === 'pause') method = 'PUT';
  if (action === 'shuffle') { method = 'PUT'; url += `?state=${req.body?.state === true || req.body?.state === 'true'}`; }
  if (action === 'volume') { method = 'PUT'; url += `?volume_percent=${Math.min(100, Math.max(0, Math.round(num(req.body?.volume_percent, 100))))}`; }
  if (action === 'seek') { method = 'PUT'; url += `?position_ms=${Math.max(0, Math.round(num(req.body?.position_ms, 0)))}`; }

  try {
    const r = await fetch(url, { method, headers: { Authorization: `Bearer ${req.spotifyToken}` } });
    if (r.ok) return res.json({ success: true, status: r.status });
    // Ej.: 403 sin Premium o dispositivo sin control de volumen; 404 sin dispositivo activo
    res.status(r.status).json({ success: false, details: await r.json().catch(() => ({})) });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// LOCUCIÓN DEL DJ. El audio viaja en base64 dentro de la respuesta: sin archivos en disco
// (efímero en Render) y una petición menos, así la precarga es más rápida.
// ---------------------------------------------------------------------------
const peticionesPorSesion = new Map(); // límite por sesión: Gemini y ElevenLabs cuestan dinero
function superaLimite(clave) {
  const ahora = Date.now();
  const recientes = (peticionesPorSesion.get(clave) || []).filter(t => ahora - t < 60_000);
  recientes.push(ahora);
  peticionesPorSesion.set(clave, recientes);
  return recientes.length > 6; // máx. 6/min (la app hace 1 por canción + reintentos)
}

app.post('/api/crear-bloque', requiereSesion, async (req, res) => {
  if (superaLimite(leerCookie(req, COOKIE_SESION))) return res.status(429).json({ success: false, error: 'Demasiadas peticiones, espera un momento' });

  try {
    const ambiente = String(req.body.ambiente ?? '').trim().slice(0, 300);
    const { cancionAnterior, cancionSiguiente } = await obtenerCancionActualConHistorial(
      req.spotifyToken, req.body.ultimaCancionConocida || 'una gran canción'
    );

    // Variedad: canción, clima, dato curioso, momento del día o mezcla
    const clima = await obtenerClima();
    const tipo = gemini.elegirTipoSegmento?.(!!clima) ?? 'cancion';
    const guion = await gemini.generarGuionLocutor(cancionAnterior, cancionSiguiente, { tipo, clima, ambiente });
    console.log(`🎙️ Locución [${tipo}]${ambiente ? ` + ambiente "${ambiente}"` : ''}: ${guion}`);

    const audio = await generarAudioLocucion(guion);
    res.json({ success: true, cancionDetectada: cancionAnterior, guion, tipo, audioBase64: Buffer.from(audio).toString('base64') });
  } catch (error) {
    console.error('❌ Error en /api/crear-bloque:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Bratify en el puerto ${PORT} (redirect: ${REDIRECT_URI})`);
});