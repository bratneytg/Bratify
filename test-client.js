async function probarServidor() {
  console.log("Enviando petición al servidor de Bratify...");

  try {
    const response = await fetch('http://127.0.0.1:3000/api/crear-bloque', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        spotifyToken: "BQDZAneDrR_xbd56WlhsVPK7QMuHSQd6kWoKfdJBN9gT60MEp0MAmCZksBWfg967cN3scGG9OvCvwzLHjSbBAWlN_sExd5NgR99QEVz4R7Y71trifwf9F4sqDv5ATLMPdRpqlRF30-2NSCGn149L5OQH5BuSU6smEmuvo22pS-_Nw83L2vxSvefGgsijvVM2pgPRh5RX3-CznySMjPNdfPoQ7BYAslza1FjGD3rPeg4CPJ9Q-bTy957QeLmoXT9Bb7Xk1YE"
      }),
    });

    const resultado = await response.json();
    console.log("\nRespuesta del servidor:", resultado);

  } catch (error) {
    console.error("❌ Error al conectar con el servidor:", error.message);
  }
}
// Servir los archivos estáticos del frontend y los audios generados
app.use(express.static('public'));
app.use('/audios', express.static('.')); // Permite reproducir output-locucion.mp3 desde la web

// Endpoint para controlar la reproducción (play, pause, next, previous, shuffle)
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

// Endpoint ligero para consultar el estado actual (carátula, título, artista, progreso)
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

probarServidor();