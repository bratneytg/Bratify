import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearLista, ErrorListas, normalizar } from '../src/services/listas.js';

// Listas con IA contra un Spotify simulado: sin red ni claves. `cfg` activa los fallos que se quieren provocar.

const CATALOGO = {
  blinding: { uri: 'spotify:track:1', name: 'Blinding Lights', artists: [{ name: 'The Weeknd' }], album: { name: 'After Hours' }, popularity: 90 },
  happy: { uri: 'spotify:track:2', name: 'Happy - From "Despicable Me 2"', artists: [{ name: 'Pharrell Williams' }], album: { name: 'G I R L' }, popularity: 85 },
  eye: { uri: 'spotify:track:3', name: 'Eye of the Tiger', artists: [{ name: 'Survivor' }], album: { name: 'Eye of the Tiger' }, popularity: 80 },
};
const P = (titulo, artista) => ({ titulo, artista });
const generar = (canciones) => async () => ({ nombre: 'Mañana Eléctrica', descripcion: 'Para arrancar el día', canciones });
const base = { token: 'tok', peticion: 'mañana energizante', cantidad: 20, modo: 'lista', idioma: 'es' };

let original, llamadas, cfg;
const resp = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (body == null ? '' : JSON.stringify(body)),
});

beforeEach(() => {
  original = globalThis.fetch; llamadas = []; cfg = {};
  globalThis.fetch = async (url, o = {}) => {
    const u = new URL(url), metodo = o.method || 'GET', ruta = u.pathname.replace('/v1', '');
    llamadas.push(`${metodo} ${ruta}`);
    if (ruta === '/search') {
      if (cfg.buscar403) return resp(403, { error: { message: 'Insufficient client scope' } });
      const q = u.searchParams.get('q').toLowerCase();
      if (q.includes('shape')) return resp(200, { tracks: { items: [{ uri: 'spotify:track:99', name: 'Shape of You', artists: [{ name: 'Otro Artista' }], album: { name: 'x' } }] } });
      if (cfg.versionLive && q.includes('eye')) return resp(200, { tracks: { items: [{ ...CATALOGO.eye, uri: 'spotify:track:LIVE', name: 'Eye of the Tiger - Live', album: { name: 'Live' }, popularity: 99 }, CATALOGO.eye] } });
      const items = Object.entries(CATALOGO).filter(([k]) => q.includes(k)).map(([, v]) => v);
      return resp(200, { tracks: { items } });
    }
    if (ruta === '/me/playlists' && metodo === 'POST') {
      if (cfg.crear403) return resp(403, { error: { message: 'Insufficient client scope' } });
      return cfg.playlistNueva404 ? resp(404, { error: { message: 'nf' } }) : resp(201, { id: 'PL1', uri: 'spotify:playlist:PL1', external_urls: { spotify: 'https://open.spotify.com/playlist/PL1' } });
    }
    if (ruta === '/me') return resp(200, { id: 'user42' });
    if (ruta === '/users/user42/playlists') return resp(201, { id: 'PL2', uri: 'spotify:playlist:PL2', external_urls: { spotify: 'https://open.spotify.com/playlist/PL2' } });
    if (ruta.endsWith('/items') && metodo === 'POST') { cfg.uris = JSON.parse(o.body).uris; return cfg.items404 ? resp(404, { error: { message: 'nf' } }) : resp(201, {}); }
    if (ruta.endsWith('/tracks') && metodo === 'POST') { cfg.uris = JSON.parse(o.body).uris; return resp(201, {}); }
    if (ruta === '/me/player/play') return cfg.sinDispositivo ? resp(404, { error: { message: 'NO_ACTIVE_DEVICE' } }) : resp(204, null);
    if (ruta === '/me/player/queue') { cfg.n = (cfg.n || 0) + 1; return cfg.colaFalla && cfg.n > cfg.colaFalla ? resp(404, { error: { message: 'NO_ACTIVE_DEVICE' } }) : resp(204, null); }
    return resp(500, { error: { message: 'ruta no simulada ' + ruta } });
  };
});
afterEach(() => { globalThis.fetch = original; });

test('crea la lista con las canciones encontradas, en orden, sin duplicadas', async () => {
  const r = await crearLista(base, { generar: generar([P('Blinding Lights', 'The Weeknd'), P('Happy', 'Pharrell Williams'), P('Cancion Inventada', 'Nadie'), P('Eye of the Tiger', 'Survivor'), P('Blinding Lights', 'The Weeknd')]) });
  assert.equal(r.canciones.length, 3);
  assert.deepEqual(cfg.uris, ['spotify:track:1', 'spotify:track:2', 'spotify:track:3']);
  assert.equal(r.noEncontradas.length, 1);
  assert.match(r.noEncontradas[0], /Cancion Inventada/);
  assert.equal(r.url, 'https://open.spotify.com/playlist/PL1');
  assert.equal(r.uri, 'spotify:playlist:PL1');
  assert.equal(r.reproduciendo, true);
  assert.ok(llamadas.includes('POST /me/playlists') && llamadas.includes('POST /playlists/PL1/items'));
  assert.ok(!llamadas.some(l => l.includes('/users/')), 'no usa el endpoint retirado');
});

test('rechaza el mismo título de otro artista y prefiere la versión de estudio a la "Live"', async () => {
  let r = await crearLista(base, { generar: generar([P('Shape of You', 'Ed Sheeran'), P('Blinding Lights', 'The Weeknd')]) });
  assert.equal(r.canciones.length, 1);
  assert.equal(r.noEncontradas.length, 1);
  cfg.versionLive = true;
  await crearLista(base, { generar: generar([P('Eye of the Tiger', 'Survivor')]) });
  assert.equal(cfg.uris[0], 'spotify:track:3');
});

test('normalizar quita feat., remaster, tildes y signos', () => {
  assert.equal(normalizar('Levitating (feat. DaBaby) - Remastered 2020'), 'levitating');
  assert.equal(normalizar('  ¡Canción   Ñandú! '), 'cancion nandu');
});

test('un 403 de permisos se traduce a FALTA_PERMISO con la llamada que falló', async () => {
  cfg.crear403 = true;
  await assert.rejects(crearLista(base, { generar: generar([P('Blinding Lights', 'The Weeknd')]) }),
    (e) => e instanceof ErrorListas && e.codigo === 'FALTA_PERMISO' && e.status === 403 && /POST \/me\/playlists/.test(e.detalle));
  cfg.crear403 = false; cfg.buscar403 = true;
  await assert.rejects(crearLista(base, { generar: generar([P('Blinding Lights', 'The Weeknd')]) }),
    (e) => e.codigo === 'FALTA_PERMISO' && /GET \/search/.test(e.detalle));
});

test('si los endpoints nuevos dan 404 usa los antiguos', async () => {
  cfg.playlistNueva404 = true; cfg.items404 = true;
  const r = await crearLista(base, { generar: generar([P('Blinding Lights', 'The Weeknd')]) });
  assert.ok(llamadas.includes('POST /users/user42/playlists') && llamadas.includes('POST /playlists/PL2/tracks'));
  assert.ok(r.url.endsWith('PL2'));
});

test('sin dispositivo activo la lista se crea igualmente y lo avisa', async () => {
  cfg.sinDispositivo = true;
  const r = await crearLista(base, { generar: generar([P('Blinding Lights', 'The Weeknd')]) });
  assert.equal(r.reproduciendo, false);
  assert.equal(r.motivo, 'sin_dispositivo');
  assert.ok(r.url);
});

test('modo cola: encola sin crear lista y se detiene si falla', async () => {
  const tres = [P('Blinding Lights', 'The Weeknd'), P('Happy', 'Pharrell Williams'), P('Eye of the Tiger', 'Survivor')];
  let r = await crearLista({ ...base, modo: 'cola' }, { generar: generar(tres) });
  assert.equal(r.encoladas, 3);
  assert.ok(!llamadas.includes('POST /me/playlists'));
  cfg.n = 0; cfg.colaFalla = 2;
  r = await crearLista({ ...base, modo: 'cola' }, { generar: generar(tres) });
  assert.equal(r.encoladas, 2);
  assert.equal(r.motivo, 'sin_dispositivo');
});

test('recorta a la cantidad pedida y falla con SIN_RESULTADOS si no hay nada', async () => {
  await crearLista({ ...base, cantidad: 2 }, { generar: generar([P('Blinding Lights', 'The Weeknd'), P('Happy', 'Pharrell Williams'), P('Eye of the Tiger', 'Survivor')]) });
  assert.equal(cfg.uris.length, 2);
  await assert.rejects(crearLista(base, { generar: generar([P('Nada', 'Nadie')]) }), (e) => e.codigo === 'SIN_RESULTADOS' && e.status === 422);
  await assert.rejects(crearLista(base, { generar: async () => ({ canciones: [] }) }), (e) => e.codigo === 'SIN_RESULTADOS');
});
