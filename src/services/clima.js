import 'dotenv/config';

// Ciudad configurable en el .env (CIUDAD=Munich). Open-Meteo es gratuito y no necesita API key.
const CIUDAD = process.env.CIUDAD || 'Munich';
const TTL_MS = 10 * 60 * 1000; // el clima apenas cambia: se reutiliza 10 min para no hacer peticiones de más

let ubicacion = null; // la geocodificación de la ciudad se hace una sola vez
let cache = null;     // { ts, datos }

// Código meteorológico WMO -> descripción corta en inglés (el DJ habla en inglés)
function describirCodigo(c) {
  if (c === 0) return 'clear sky';
  if (c <= 2) return 'partly cloudy';
  if (c === 3) return 'overcast';
  if (c <= 48) return 'foggy';
  if (c <= 57) return 'drizzle';
  if (c <= 67) return 'rain';
  if (c <= 77) return 'snow';
  if (c <= 82) return 'rain showers';
  if (c <= 86) return 'snow showers';
  return 'thunderstorm';
}

function parteDelDia(hora) {
  if (hora < 6) return 'late night';
  if (hora < 12) return 'morning';
  if (hora < 18) return 'afternoon';
  if (hora < 22) return 'evening';
  return 'night';
}

/**
 * Clima actual y momento del día (hora LOCAL de la ciudad) para que el DJ lo use en la charla.
 * @returns {Promise<object|null>} null si no se pudo obtener (el servidor entonces evita hablar del clima)
 */
export async function obtenerClima() {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.datos;

  try {
    if (!ubicacion) {
      const geo = await (await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(CIUDAD)}&count=1&language=en`
      )).json();
      const r = geo.results?.[0];
      if (!r) throw new Error(`No se encontró la ciudad "${CIUDAD}"`);
      ubicacion = { nombre: r.name, lat: r.latitude, lon: r.longitude };
    }

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${ubicacion.lat}&longitude=${ubicacion.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&timezone=auto`
    );
    if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
    const { current } = await res.json();

    // current.time llega como "2026-11-14T21:30" ya en hora local de la ciudad
    const [dia, hora] = current.time.split('T');
    const datos = {
      ciudad: ubicacion.nombre,
      temperaturaC: Math.round(current.temperature_2m),
      sensacionC: Math.round(current.apparent_temperature),
      descripcion: describirCodigo(current.weather_code),
      vientoKmh: Math.round(current.wind_speed_10m),
      esDeDia: !!current.is_day,
      diaSemana: new Date(`${dia}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      parteDelDia: parteDelDia(parseInt(hora.slice(0, 2), 10)),
    };

    cache = { ts: Date.now(), datos };
    return datos;
  } catch (error) {
    console.warn('⚠️ No se pudo obtener el clima:', error.message);
    return cache?.datos ?? null; // si hay un dato antiguo, mejor eso que nada
  }
}