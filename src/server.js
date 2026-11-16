import express from 'express';
import 'dotenv/config';
import fs from 'fs';
import { generarGuionLocutor } from './services/gemini.js';
import { generarAudioLocucion } from './services/elevenlabs.js';
import { obtenerCancionActualConHistorial } from './services/spotify.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Variables en memoria para mantener la sesión activa del usuario
let accessTokenGlobal = null;
let refreshTokenGlobal = null;
let tokenExpiresAt = 0;

/**
 * Renueva o devuelve un Access Token válido de Spotify automáticamente.
 */
async function asegurarTokenSpotify() {
  const ahora = Date.now();
  
  // Si el token actual sigue vigente (con 1 minuto de margen), lo reutilizamos
  if (accessTokenGlobal && ahora < tokenExpiresAt - 60000) {
    return accessTokenGlobal;
  }

  // Si no hay refresh token, significa que el usuario nunca ha iniciado sesión
  if (!refreshTokenGlobal) {
    throw new Error("⚠️ No hay ninguna sesión de Spotify iniciada. Entra a http://localhost:3000/login para autenticarte.");
  }

  console.log("🔄 El token de Spotify ha expirado o va a caducar. Renovando automáticamente...");
  
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenGlobal
    })
  });

  const data = await response.json();

  if (data.access_token) {
    accessTokenGlobal = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) {
      refreshTokenGlobal = data.refresh_token; // Spotify a veces rota el refresh token
    }
    console.log("✅ Token de Spotify renovado con éxito en segundo plano.");
    return accessTokenGlobal;
  } else {
    throw new Error("❌ Error al renovar el token con Spotify: " + JSON.stringify(data));
  }
}

app.get('/', (req, res) => {
  res.send('🎙️ ¡El servidor de Bratify está online! <br><a href="/login" target="_blank">1. Haz clic aquí para iniciar sesión con Spotify</a>');
});

// 1. Ruta de inicio de sesión
app.get('/login', (req, res) => {
  const scope = 'user-read-playback-state user-read-currently-playing';
  const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scope,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
  });
  res.redirect(authUrl);
});

// 2. Ruta de retorno (Callback)
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;

  try {
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        code: code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const data = await tokenResponse.json();

    if (data.access_token) {
      accessTokenGlobal = data.access_token;
      refreshTokenGlobal = data.refresh_token;
      tokenExpiresAt = Date.now() + (data.expires_in * 1000);

      // 🔄 Redirige automáticamente a la interfaz principal de Bratify
      res.redirect('/');
    } else {
      res.status(400).json({ error: 'No se pudo obtener el token', details: data });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Ruta principal para crear el bloque (ya no requiere enviar el token desde el cliente)
app.post('/api/crear-bloque', async (req, res) => {
  try {
    // Obtenemos un token válido (renovándolo automáticamente si hace falta)
    const spotifyToken = await asegurarTokenSpotify();

    console.log("🎵 Consultando la canción actual en Spotify...");
    const { cancionAnterior, cancionSiguiente } = await obtenerCancionActualConHistorial(spotifyToken);
    console.log(`🎵 Canción detectada: ${cancionAnterior}`);

    const guion = await generarGuionLocutor(cancionAnterior, cancionSiguiente);
    console.log(`📝 Guion: "${guion}"`);

    const arrayBuffer = await generarAudioLocucion(guion);
    const buffer = Buffer.from(arrayBuffer);

    fs.writeFileSync('output-locucion.mp3', buffer);

    res.json({
      success: true,
      message: '¡Bloque de radio generado con éxito!',
      cancionDetectada: cancionAnterior,
      guion,
      audioGuardado: 'output-locucion.mp3'
    });

  } catch (error) {
    console.error("❌ Error en el servidor:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor Bratify corriendo en http://localhost:${PORT}`);
});