import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

// Inicializa el SDK usando la variable de entorno GEMINI_API_KEY
const ai = new GoogleGenAI();

// ---------------------------------------------------------------------------
// TIPOS DE LOCUCIÓN. Todos terminan presentando la siguiente canción (esa es la
// "esencia" de la emisora); lo que cambia es de qué se habla antes.
// `peso` = probabilidad relativa; `usaClima` = necesita datos de clima/hora.
// ---------------------------------------------------------------------------
const TIPOS = [
  { tipo: 'cancion', peso: 35, usaClima: false },
  { tipo: 'clima',   peso: 20, usaClima: true  },
  { tipo: 'dato',    peso: 20, usaClima: false },
  { tipo: 'momento', peso: 15, usaClima: true  },
  { tipo: 'mixto',   peso: 10, usaClima: true  },
];

const INSTRUCCIONES = {
  cancion: 'Talk about both songs: name them, with a brief natural comment on the lyrics, the artist or the mood.',
  clima:   'Open with the current weather in the city (temperature and conditions, said naturally, never like a robotic report) and use it to lead into the next song. Name the next song; mentioning the one that is ending is optional.',
  dato:    'Share ONE short curiosity about the artist or the song (the one ending or the next one) ONLY if you are highly confident it is true; if not, make a brief remark about the vibe or style instead. Then name the next song.',
  momento: 'Greet the listeners according to the day and time of day and set the mood for it. Do not quote weather numbers. Name the next song.',
  mixto:   'Mix a quick remark about the weather with a quick comment about the songs. Name both songs.',
};

let ultimoTipo = null;        // para no repetir el mismo tipo dos veces seguidas
const ultimosGuiones = [];    // últimas locuciones, para que Gemini no repita muletillas ni aperturas

/**
 * Elige el tipo de la próxima locución (aleatorio ponderado, sin repetir el anterior).
 * @param {boolean} hayClima - si es false, se descartan los tipos que necesitan clima/hora
 */
export function elegirTipoSegmento(hayClima = true) {
  const candidatos = TIPOS.filter(t => t.tipo !== ultimoTipo && (hayClima || !t.usaClima));
  let r = Math.random() * candidatos.reduce((suma, t) => suma + t.peso, 0);
  const elegido = candidatos.find(t => (r -= t.peso) < 0) ?? candidatos[0];
  ultimoTipo = elegido.tipo;
  return elegido.tipo;
}

/**
 * Genera un guion de locución para la radio.
 * @param {string} cancionAnterior - Canción que está terminando
 * @param {string} cancionSiguiente - Canción que está por sonar
 * @param {object} [opciones]
 * @param {string} [opciones.tipo='cancion'] - 'cancion' | 'clima' | 'dato' | 'momento' | 'mixto'
 * @param {object|null} [opciones.clima] - datos de services/clima.js
 * @param {string} [opciones.ambiente] - petición libre del oyente (p. ej. "estoy en una cita romántica"); se suma a lo habitual
 * @param {string} [opciones.idioma='en'] - 'en' | 'es': idioma en el que habla el locutor
 * @param {string} [opciones.genero='female'] - 'male' | 'female': género del locutor (importa en español)
 * @returns {Promise<string>} El guion redactado para locutar
 */
export async function generarGuionLocutor(cancionAnterior, cancionSiguiente, { tipo = 'cancion', clima = null, ambiente = '', idioma = 'en', genero = 'female' } = {}) {
  const lengua = idioma === 'es' ? 'Spanish' : 'English';
  const locutor = genero === 'male' ? 'male' : 'female';
  const necesitaClima = TIPOS.find(t => t.tipo === tipo)?.usaClima;
  const usaClima = necesitaClima && clima;
  const tipoEfectivo = necesitaClima && !clima ? 'cancion' : tipo; // sin datos de clima, se cae al tipo 'cancion'
  const contexto = usaClima
    ? `- Weather in ${clima.ciudad} right now: ${clima.temperaturaC}°C (feels like ${clima.sensacionC}°C), ${clima.descripcion}, wind ${clima.vientoKmh} km/h
    - Local time: ${clima.diaSemana} ${clima.parteDelDia}`
    : '';
  // Petición libre del usuario: se SUMA al tipo de locución elegido (no lo sustituye)
  const peticion = ambiente
    ? `Listener's request (very important, apply it on top of the focus above): "${ambiente}". Adapt the tone and content of the link to it, while still leading into the next song.`
    : '';
  const evitar = ultimosGuiones.length
    ? `- Do NOT reuse the openings, phrases or structure of your previous links:\n${ultimosGuiones.map(g => `      "${g}"`).join('\n')}`
    : '';

  const prompt = `
    Act as a charismatic, sensual, deep and modern ${locutor} radio host.
    You are a ${locutor} host speaking ${lengua}${idioma === 'es' ? ', so use the grammatical forms that match a ' + locutor + ' speaker' : ''}.
    Your job is a quick, entertaining link between the song that is ending and the one coming up next.

    - Song that is ending: "${cancionAnterior}"
    - Song coming up next: "${cancionSiguiente}"
    ${contexto}

    Focus of this link: ${INSTRUCCIONES[tipoEfectivo]}
    ${peticion}

    Rules:
    - Short text in ${lengua} (unless the listener's request asks for another language), ${ambiente ? 65 : 55} words maximum.
    - Keep song titles and artist names exactly as they are (do not translate them). Any weather or time data above is given in English: say it naturally in ${lengua}.
    - It must flow naturally and always lead into the next song, so the listener hears its title and artist.
    - Sound like a real radio host: fresh, varied, never formulaic. Do not start every link the same way (avoid always opening with "Hey").
    - Plain spoken text only: no stage directions, sound effects, emojis, hashtags or markdown. Write numbers the way you would say them.
    ${evitar}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    const guion = response.text.trim();
    ultimosGuiones.push(guion);
    if (ultimosGuiones.length > 3) ultimosGuiones.shift();
    return guion;
  } catch (error) {
    console.error("❌ Error al generar el guion con Gemini:", error.message);
    throw error;
  }
}