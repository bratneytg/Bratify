import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import 'dotenv/config';

console.log("🚀 El script ha comenzado a ejecutarse...");

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ ERROR: Falta la GEMINI_API_KEY en tu archivo .env");
  process.exit(1);
}

if (!process.env.ELEVENLABS_API_KEY) {
  console.error("❌ ERROR: Falta la ELEVENLABS_API_KEY en tu archivo .env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Función para añadir un límite de tiempo (timeout) a la llamada de Gemini
async function generarConTimeout(prompt, tiempoLimiteMs = 10000) {
  const promesaGemini = ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
  });

  const promesaTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("⏰ Tiempo de espera agotado (Gemini tardó demasiado)")), tiempoLimiteMs)
  );

  return Promise.race([promesaGemini, promesaTimeout]);
}

async function crearBloqueDeRadio() {
  try {
    console.log("1. Conectando con Gemini para generar el guion...");
    const prompt = `Actúa como un locutor de radio juvenil, carismático y con mucha energía. 
    Haz una intervención muy corta (máximo 2 oraciones) para presentar la siguiente canción. 
    Acaba de sonar "Blinding Lights" de The Weeknd y ahora va a empezar "Get Lucky" de Daft Punk. 
    Escribe solo lo que vas a decir, sin acotaciones ni efectos de sonido.`;

    const response = await generarConTimeout(prompt);
    const guion = response.text;
    console.log(`\n🎙️ Guion generado con éxito:\n"${guion}"\n`);

    console.log("2. Enviando texto a ElevenLabs para convertirlo a voz...");

    const voiceId = 'JBFqnCBsd6RMkjVDRZzb'; 
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

    const audioResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: guion,
        model_id: 'eleven_flash_v2_5',
      }),
    });

    if (!audioResponse.ok) {
      const errorText = await audioResponse.text();
      throw new Error(`Error en ElevenLabs (${audioResponse.status}): ${errorText}`);
    }

    console.log("3. Descargando el audio y guardándolo en disco...");
    const arrayBuffer = await audioResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync('locucion.mp3', buffer);

    console.log("✅ ¡Proceso terminado! Se ha creado el archivo 'locucion.mp3'.");

  } catch (error) {
    console.error("❌ Ocurrió un error en el proceso:", error.message);
  }
}

crearBloqueDeRadio();