import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conTiempo, esTimeout, fetchConTiempo } from '../src/utils.js';

test('conTiempo devuelve el resultado si llega a tiempo', async () => {
  assert.equal(await conTiempo(Promise.resolve(42), 200), 42);
});

test('conTiempo lanza TimeoutError si la promesa tarda demasiado', async () => {
  const lenta = new Promise(r => setTimeout(r, 300));
  await assert.rejects(conTiempo(lenta, 30, 'prueba'), (e) => esTimeout(e) && /prueba/.test(e.message));
});

test('conTiempo propaga el error original si la promesa falla antes', async () => {
  await assert.rejects(conTiempo(Promise.reject(new Error('boom')), 200), /boom/);
});

test('fetchConTiempo corta una petición que no responde', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (url, { signal }) => new Promise((_, rechazar) => signal.addEventListener('abort', () => rechazar(signal.reason)));
  try {
    await assert.rejects(fetchConTiempo('https://ejemplo.invalid', {}, 30), esTimeout);
  } finally {
    globalThis.fetch = original;
  }
});
