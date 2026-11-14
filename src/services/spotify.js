import 'dotenv/config';

/**
 * Obtiene la canción actual, la anterior registrada y la siguiente en la cola.
 * @param {string} accessToken - Token de acceso de Spotify
 * @param {string} [ultimaCancionConocida] - El nombre de la canción anterior que tenía el cliente
 */
export async function obtenerCancionActualConHistorial(accessToken, ultimaCancionConocida = "una gran canción") {
  try {
    const responseCurrent = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (responseCurrent.status === 204 || responseCurrent.status > 300) {
      return {
        cancionAnterior: ultimaCancionConocida,
        cancionSiguiente: "el próximo éxito en la lista"
      };
    }

    const currentData = await responseCurrent.json();
    if (!currentData.item) {
      return { cancionAnterior: ultimaCancionConocida, cancionSiguiente: "la siguiente pista" };
    }

    const cancionActualReproduciendose = `${currentData.item.name} de ${currentData.item.artists.map(a => a.name).join(', ')}`;
    
    // Obtener la siguiente en la cola
    let cancionSiguiente = "la siguiente canción en tu lista";
    try {
      const responseQueue = await fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (responseQueue.ok) {
        const queueData = await responseQueue.json();
        if (queueData.queue && queueData.queue.length > 0) {
          const nextItem = queueData.queue[0];
          cancionSiguiente = `${nextItem.name} de ${nextItem.artists.map(a => a.name).join(', ')}`;
        }
      }
    } catch (e) {
      console.warn("⚠️ No se pudo obtener la cola de reproducción.");
    }

    return {
      cancionAnterior: ultimaCancionConocida, // La que acaba de terminar
      cancionActual: cancionActualReproduciendose,
      cancionSiguiente: cancionSiguiente // La que va a empezar
    };

  } catch (error) {
    console.error("❌ Error al consultar la API de Spotify:", error.message);
    throw error;
  }
}