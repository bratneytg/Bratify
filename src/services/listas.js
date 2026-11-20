/**
 * Listas de reproducción y cola con IA.
 *
 *  1. Gemini propone canciones (título + artista) a partir de la petición del oyente.
 *  2. Se busca cada una en Spotify y se elige la coincidencia correcta (las que no existen se descartan).
 *  3. Modo "lista": se crea una playlist privada, se añaden las canciones y se reproduce.
 *     Modo "cola":  se añaden las canciones a la cola de reproducción actual.
 *
 * Endpoints (Spotify, tras los cambios de 2026 para apps en modo desarrollo):
 *   POST /me/playlists            (antes POST /users/{id}/playlists, retirado)
 *   POST /playlists/{id}/items    (antes /tracks)
 *   GET  /search                  (máx. 10 resultados por petición)
 * Si un endpoint nuevo no existe todavía para esta app (404/405), se prueba el antiguo.
 */

import { fetchConTiempo } from '../utils.js';

const API = 'https://api.spotify.com/v1';
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/** Error con código para que el servidor decida qué responder al navegador. */
export class ErrorListas extends Error {
  constructor(codigo, mensaje, status = 500, detalle) { super(mensaje); this.codigo = codigo; this.status = status; this.detalle = detalle; }
}

// ---------------------------------------------------------------------------
// Llamadas a Spotify
// ---------------------------------------------------------------------------
async function spotify(token, metodo, ruta, { cuerpo, reintentos = 1 } = {}) {
  const r = await fetchConTiempo(API + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }, 12_000);
  if (r.status === 429 && reintentos > 0) { // límite de Spotify: se espera lo que pida (máx. 5 s) y se reintenta una vez
    await dormir(Math.min(5, Number(r.headers?.get?.('retry-after')) || 1) * 1000);
    return spotify(token, metodo, ruta, { cuerpo, reintentos: reintentos - 1 });
  }
  const texto = await r.text().catch(() => '');
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { /* respuesta sin JSON */ }
  if (!r.ok) {
    const e = new Error(data?.error?.message || texto.slice(0, 200) || `HTTP ${r.status}`);
    e.status = r.status;
    e.paso = `${metodo} ${ruta.split('?')[0]}`; // qué llamada falló (sin datos personales)
    throw e;
  }
  return data;
}

const esFaltaDePermiso = (e) => e?.status === 403 && /scope/i.test(e.message || '');
const traducirError = (e) => esFaltaDePermiso(e)
  ? new ErrorListas('FALTA_PERMISO', 'Spotify necesita un permiso nuevo para crear listas', 403, `${e.paso || 'Spotify'} → ${e.message}`)
  : e;

// ---------------------------------------------------------------------------
// Búsqueda y coincidencia
// ---------------------------------------------------------------------------
/** Minúsculas, sin tildes, sin "(Remastered…)", "feat." ni signos: para comparar títulos y artistas. */
export function normalizar(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft|featuring|with)\b.*$/g, ' ')
    .replace(/\s+-\s+(remaster(ed)?|\d{4}.*|live.*|mono|stereo|single.*|radio edit).*$/g, ' ')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VERSIONES_RARAS = /\b(karaoke|tribute|cover|instrumental|live|remix|acoustic|8d|sped up|slowed|nightcore)\b/;

/** Elige, entre los resultados de Spotify, el que mejor coincide con el título y el artista pedidos (o null). */
export function elegirMejor(items, titulo, artista) {
  const t = normalizar(titulo), a = normalizar(artista);
  if (!t) return null;
  let mejor = null, mejorPuntos = 0;
  for (const it of items ?? []) {
    if (!it?.uri || !it?.name) continue;
    const nt = normalizar(it.name);
    const puntosTitulo = nt === t ? 3 : (nt && (nt.includes(t) || t.includes(nt))) ? 2 : 0;
    if (!puntosTitulo) continue;
    const artistas = (it.artists ?? []).map(x => normalizar(x.name));
    const coincideArtista = !a || artistas.some(n => n && (n === a || n.includes(a) || a.includes(n)));
    if (!coincideArtista) continue; // mismo título de otro artista: no vale
    let puntos = puntosTitulo * 10;
    if (VERSIONES_RARAS.test(normalizar(it.name)) && !VERSIONES_RARAS.test(t)) puntos -= 15; // versión en directo, karaoke, remix…
    if (VERSIONES_RARAS.test(normalizar(it.album?.name)) && !VERSIONES_RARAS.test(t)) puntos -= 5;
    puntos += (it.popularity ?? 0) / 100; // desempate: la más conocida
    if (puntos > mejorPuntos || !mejor) { mejor = it; mejorPuntos = puntos; }
  }
  return mejor;
}

export async function buscarCancion(token, { titulo, artista }) {
  const consultas = [`track:${titulo} artist:${artista}`, `${titulo} ${artista}`];
  for (const q of consultas) {
    const data = await spotify(token, 'GET', `/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
    const mejor = elegirMejor(data?.tracks?.items, titulo, artista);
    if (mejor) return mejor;
  }
  return null;
}

/** Busca todas las canciones con un máximo de `paralelo` peticiones a la vez. Conserva el orden. */
async function buscarTodas(token, canciones, paralelo = 4) {
  const resultados = new Array(canciones.length).fill(null);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < canciones.length) {
      const i = siguiente++;
      try { resultados[i] = await buscarCancion(token, canciones[i]); }
      catch (e) { if (esFaltaDePermiso(e) || e.status === 401) throw e; /* una búsqueda fallida solo descarta esa canción */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(paralelo, canciones.length) }, trabajador));
  return resultados;
}

// ---------------------------------------------------------------------------
// Crear lista, reproducir, encolar
// ---------------------------------------------------------------------------
async function crearPlaylist(token, nombre, descripcion) {
  const cuerpo = { name: nombre, description: descripcion, public: false };
  try {
    return await spotify(token, 'POST', '/me/playlists', { cuerpo });
  } catch (e) {
    if (e.status !== 404 && e.status !== 405) throw e;
    const yo = await spotify(token, 'GET', '/me'); // apps que aún usan el endpoint antiguo
    return spotify(token, 'POST', `/users/${yo.id}/playlists`, { cuerpo });
  }
}

async function anadirItems(token, idPlaylist, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    const cuerpo = { uris: uris.slice(i, i + 100) };
    try {
      await spotify(token, 'POST', `/playlists/${idPlaylist}/items`, { cuerpo });
    } catch (e) {
      if (e.status !== 404 && e.status !== 405) throw e;
      await spotify(token, 'POST', `/playlists/${idPlaylist}/tracks`, { cuerpo });
    }
  }
}

const motivoDeError = (e) => e.status === 404 ? 'sin_dispositivo' : e.status === 403 ? 'sin_premium' : 'error';

async function reproducirLista(token, uriLista) {
  try {
    await spotify(token, 'PUT', '/me/player/play', { cuerpo: { context_uri: uriLista } });
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: motivoDeError(e) };
  }
}

async function encolar(token, uris) {
  let encoladas = 0;
  for (const uri of uris) {
    try {
      await spotify(token, 'POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`);
      encoladas++;
    } catch (e) {
      return { encoladas, motivo: motivoDeError(e) };
    }
  }
  return { encoladas };
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------
const limpiarTexto = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * @param {object} p
 * @param {string} p.token - access token de Spotify del usuario
 * @param {string} p.peticion - lo que quiere escuchar
 * @param {number} p.cantidad - canciones que quiere (10-40)
 * @param {'lista'|'cola'} p.modo
 * @param {'es'|'en'} p.idioma - idioma del nombre/descripción de la lista
 * @param {Function} p.generar - (peticion, cantidad, {idioma}) => {nombre, descripcion, canciones:[{titulo, artista}]}
 */
export async function crearLista({ token, peticion, cantidad, modo, idioma }, { generar }) {
  const propuesta = await generar(peticion, cantidad, { idioma });
  const propuestas = Array.isArray(propuesta?.canciones) ? propuesta.canciones : [];
  if (!propuestas.length) throw new ErrorListas('SIN_RESULTADOS', 'La IA no propuso ninguna canción. Prueba a describirlo de otra forma.', 422);

  const encontradas = [];
  const noEncontradas = [];
  try {
    const resultados = await buscarTodas(token, propuestas);
    const vistas = new Set();
    resultados.forEach((it, i) => {
      if (!it) { noEncontradas.push(`${propuestas[i].titulo} — ${propuestas[i].artista}`); return; }
      if (vistas.has(it.uri)) return; // repetida: se ignora sin avisar
      vistas.add(it.uri);
      encontradas.push({ uri: it.uri, titulo: it.name, artista: (it.artists ?? []).map(x => x.name).join(', ') });
    });
  } catch (e) { throw traducirError(e); }

  const elegidas = encontradas.slice(0, cantidad);
  if (!elegidas.length) throw new ErrorListas('SIN_RESULTADOS', 'No encontré en Spotify ninguna de las canciones propuestas. Prueba otra petición.', 422);
  const uris = elegidas.map(c => c.uri);
  const canciones = elegidas.map(({ titulo, artista }) => ({ titulo, artista }));

  try {
    if (modo === 'cola') {
      const { encoladas, motivo } = await encolar(token, uris);
      return { modo, canciones, noEncontradas, encoladas, motivo: motivo ?? null };
    }
    const nombre = limpiarTexto(propuesta.nombre, 60) || 'Velvet Dial';
    const descripcion = limpiarTexto(propuesta.descripcion, 200) || limpiarTexto(peticion, 200);
    const playlist = await crearPlaylist(token, nombre, descripcion);
    await anadirItems(token, playlist.id, uris);
    const reproduccion = await reproducirLista(token, playlist.uri || `spotify:playlist:${playlist.id}`);
    return {
      modo, nombre, canciones, noEncontradas,
      url: playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlist.id}`,
      uri: playlist.uri || `spotify:playlist:${playlist.id}`, // para abrirla directamente en la app de Spotify
      reproduciendo: reproduccion.ok, motivo: reproduccion.ok ? null : reproduccion.motivo,
    };
  } catch (e) { throw traducirError(e); }
}
