import express from 'express';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generarGuionLocutor } from './services/gemini.js';
import { generarAudioLocucion } from './services/elevenlabs.js';
import { obtenerCancionActualConHistorial } from './services/spotify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 1. Servir el frontend y los archivos de audio generados
app.use(express.static(path.join(__dirname, '../public')));
app.use('/audios', express.static(path.join(__dirname, '..')));

// 2. Ruta de inicio de sesión con Spotify (con permisos de reproducción)
app.get('/login', (req, res) => {
  const scope = 'user-read-playback-state user-read-currently-playing user-modify-playback-state';
  const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scope,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3000/callback',
  });
  res.redirect(authUrl);
});

// 3. Callback de Spotify para entregar el token de acceso
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
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3000/callback',
        grant_type: 'authorization_code'
      })
    });

    const data = await tokenResponse.json();

    if (data.access_token) {
      // Muestra el token de forma clara para que la interfaz o tú podáis usarlo sin enredos de redirección infinita
      res.send(`
        <html>
          <head><title>Bratify - Autenticación</title></head>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
            <h1>¡Autenticación exitosa con Spotify! 🎉</h1>
            <p>Copia este Token de acceso:</p>
            <textarea rows="4" cols="50" style="width:100%; max-width:500px; padding: 10px; font-family: monospace;">${data.access_token}</textarea>
            <br><br>
            <a href="/" style="font-size: 18px; color: #1db954; text-decoration: none; font-weight: bold;">Volver al reproductor de Bratify</a>
          </body>
        </html>
      `);
    } else {
      res.status(400).json({ error: 'No se pudo obtener el token', details: data });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Endpoint de estado actual del reproductor
app.get('/api/estado', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Falta token' });

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.status === 204) return res.json({ is_playing: false });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Endpoint para controlar play, pause, next, previous y shuffle
app.post('/api/player/:action', async (req, res) => {
  const { action } = req.params;
  const { spotifyToken, state } = req.body;

  let url = `https://api.spotify.com/v1/me/player/${action}`;
  let method = 'POST';

  if (action === 'play' || action === 'pause') {
    method = 'PUT';
  } else if (action === 'shuffle') {
    method = 'PUT';
    url = `https://api.spotify.com/v1/me/player/shuffle?state=${state}`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${spotifyToken}` }
    });
    res.json({ success: response.ok, status: response.status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Endpoint para generar la locución del DJ IA con historial
app.post('/api/crear-bloque', async (req, res) => {
  try {
    const { spotifyToken, ultimaCancionConocida } = req.body;
    
    const { cancionAnterior, cancionActual, cancionSiguiente } = await obtenerCancionActualConHistorial(
      spotifyToken, 
      ultimaCancionConocida || "una gran canción"
    );

    const guion = await generarGuionLocutor(cancionAnterior, cancionSiguiente);
    const arrayBuffer = await generarAudioLocucion(guion);
    
    fs.writeFileSync(path.join(__dirname, '../output-locucion.mp3'), Buffer.from(arrayBuffer));

    res.json({
      success: true,
      cancionDetectada: cancionAnterior,
      guion
    });
  } catch (error) {
    console.error("❌ Error en el servidor:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Bratify corriendo en http://127.0.0.1:${PORT}`);
});