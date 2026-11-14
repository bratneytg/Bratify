import express from 'express';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generarGuionLocutor, elegirTipoSegmento } from './services/gemini.js';
import { obtenerClima } from './services/clima.js';
import { generarAudioLocucion } from './services/elevenlabs.js';
import { obtenerCancionActualConHistorial } from './services/spotify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Carpeta DEDICADA para las locuciones. Antes se servía toda la raíz del proyecto
// (/audios exponía server.js, package.json...). Ahora solo se expone esta carpeta.
const AUDIOS_DIR = path.join(__dirname, '../audios');
fs.mkdirSync(AUDIOS_DIR, { recursive: true });

app.use(express.json());

// 1. Frontend y audios generados
app.use(express.static(path.join(__dirname, '../public')));
app.use('/audios', express.static(AUDIOS_DIR));

// Acciones del reproductor permitidas. Sin esta lista, `:action` se concatenaba
// directamente a la URL de Spotify (se podía llamar a cualquier endpoint).
const ACCIONES_PERMITIDAS = ['play', 'pause', 'next', 'previous', 'shuffle', 'volume', 'seek'];

// Borra locuciones antiguas para que la carpeta no crezca sin límite (deja las 5 últimas)
function limpiarAudiosAntiguos() {
  const archivos = fs.readdirSync(AUDIOS_DIR)
    .filter(f => f.endsWith('.mp3'))
    .sort(); // el nombre lleva Date.now(), así que el orden alfabético = cronológico
  archivos.slice(0, -5).forEach(f => fs.unlink(path.join(AUDIOS_DIR, f), () => {}));
}

// 2. Login con Spotify (permisos de lectura y control de reproducción)
app.get('/login', (req, res) => {
  const scope = 'user-read-playback-state user-read-currently-playing user-modify-playback-state';
  const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
  });
  res.redirect(authUrl);
});

// 3. Callback de Spotify: canjea el code por el token y lo guarda en el navegador
//    (misma clave 'bratify_token' que lee el index.html), así no hay que copiarlo a mano.
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  if (!code) return res.status(400).send('Spotify no devolvió ningún código de autorización.');

  try {
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const data = await tokenResponse.json();

    if (data.access_token) {
      res.send(`
        <h1>¡Autenticación exitosa! 🎉</h1>
        <p>Guardando el token y volviendo a Bratify...</p>
        <p>Si no te redirige, copia este token en el reproductor:</p>
        <textarea rows="4" cols="50" style="width:100%;">${data.access_token}</textarea>
        <script>
          localStorage.setItem('bratify_token', ${JSON.stringify(data.access_token)});
          location.replace('/');
        </script>
      `);
    } else {
      res.status(400).json({ error: 'No se pudo obtener el token', details: data });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Estado actual del reproductor (canción, progreso, dispositivo, volumen, shuffle...)
app.get('/api/estado', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Falta token' });

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    // 204 = no hay dispositivo/reproducción activa
    if (response.status === 204) return res.json({ is_playing: false });
    const data = await response.json().catch(() => ({}));
    // Reenviamos el código real (antes un 401 por token caducado llegaba como 200 y el front no se enteraba)
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Control del reproductor: play, pause, next, previous, shuffle y volume.
//    El método HTTP hacia Spotify se decide aquí, el front siempre puede usar POST.
app.all('/api/player/:action', async (req, res) => {
  const { action } = req.params;
  if (!ACCIONES_PERMITIDAS.includes(action)) {
    return res.status(400).json({ success: false, error: `Acción no permitida: ${action}` });
  }

  const spotifyToken = req.body?.spotifyToken || req.headers.authorization?.split(' ')[1];
  if (!spotifyToken) {
    return res.status(401).json({ success: false, error: 'Falta token de Spotify' });
  }

  let url = `https://api.spotify.com/v1/me/player/${action}`;
  let method = 'POST'; // next y previous

  if (action === 'play' || action === 'pause') {
    method = 'PUT';
  } else if (action === 'shuffle') {
    method = 'PUT';
    const state = req.query.state ?? req.body?.state; // antes solo se leía del body
    url += `?state=${state === true || state === 'true'}`;
  } else if (action === 'seek') {
    // Salta a una posición de la canción (ms). Requiere Premium, igual que el control de volumen.
    method = 'PUT';
    const pos = Math.max(0, Math.round(Number(req.query.position_ms ?? req.body?.position_ms ?? 0)));
    url += `?position_ms=${pos}`;
  } else if (action === 'volume') {
    method = 'PUT';
    // Con `||` el volumen 0 se convertía en 100; con `??` se respeta. Se limita a 0-100.
    const raw = Number(req.query.volume_percent ?? req.body?.volume_percent ?? 100);
    const vol = Math.min(100, Math.max(0, Math.round(raw)));
    url += `?volume_percent=${vol}`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${spotifyToken}` }
    });

    if (response.ok) return res.json({ success: true, status: response.status });

    // Ej.: 403 VOLUME_CONTROL_DISALLOWED (móviles/altavoces sin control de volumen) o 403 sin Premium
    const errorData = await response.json().catch(() => ({}));
    res.status(response.status).json({ success: false, details: errorData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Genera la locución del DJ IA (guion con Gemini + voz con ElevenLabs)
app.post('/api/crear-bloque', async (req, res) => {
  try {
    const { spotifyToken, ultimaCancionConocida } = req.body;
    // Petición libre del oyente (opcional), limitada a 300 caracteres
    const ambiente = String(req.body.ambiente ?? '').trim().slice(0, 300);

    const { cancionAnterior, cancionActual, cancionSiguiente } = await obtenerCancionActualConHistorial(
      spotifyToken,
      ultimaCancionConocida || 'una gran canción'
    );

    // Variedad: se elige de qué hablará el DJ (canción, clima, dato curioso, momento del día o mezcla).
    // Si no hay datos de clima (null), solo se eligen tipos que no lo necesitan.
    const clima = await obtenerClima();
    const tipo = elegirTipoSegmento(!!clima);
    const guion = await generarGuionLocutor(cancionAnterior, cancionSiguiente, { tipo, clima, ambiente });
    console.log(`🎙️ Locución [${tipo}]${ambiente ? ` + ambiente "${ambiente}"` : ''}: ${guion}`);
    const arrayBuffer = await generarAudioLocucion(guion);

    // Nombre único por locución: evita problemas de caché y de pisar un audio que aún suena
    const nombreArchivo = `locucion-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(AUDIOS_DIR, nombreArchivo), Buffer.from(arrayBuffer));
    limpiarAudiosAntiguos();

    res.json({
      success: true,
      cancionDetectada: cancionAnterior,
      guion,
      tipo,
      audioUrl: `/audios/${nombreArchivo}` // el front descarga exactamente este archivo
    });
  } catch (error) {
    console.error('❌ Error en el servidor:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Bratify corriendo en http://127.0.0.1:${PORT}`);
});