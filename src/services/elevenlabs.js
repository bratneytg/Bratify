import 'dotenv/config';

/**
 * Convierte un texto en un buffer de audio MP3 usando ElevenLabs.
 * @param {string} textoGuion 
 * @returns {Promise<ArrayBuffer>} El buffer con el audio generado
 */
export async function generarAudioLocucion(textoGuion) {
  const voiceId = 'JaagUurP1dmW3WscoJ79'; 
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

  const audioResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: textoGuion,
      model_id: 'eleven_flash_v2_5',
    }),
  });

  if (!audioResponse.ok) {
    const errorText = await audioResponse.text();
    throw new Error(`Error en ElevenLabs (${audioResponse.status}): ${errorText}`);
  }

  return await audioResponse.arrayBuffer();
}
