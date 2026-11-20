# Velvet Dial

Radio con DJ de IA sobre tu Spotify. Entre canción y canción, un locutor (guion de Gemini + voz de ElevenLabs) habla
de la música, el clima o la hora. Además crea listas de reproducción o añade canciones a la cola a partir de una frase
("es por la mañana y quiero empezar el día con música energizante").

- **Servidor:** Node.js + Express (`src/`), desplegado en Render. Sin base de datos: la sesión vive en una cookie.
- **Web:** `public/index.html` (un solo archivo, también instalable como app en iPhone).
- **App Android:** Capacitor (`android/`), carga la web remota (`capacitor.config.json`). Los cambios web no necesitan recompilar el APK.

## Variables de entorno (en Render o en un `.env` local)

| Variable | Para qué |
|---|---|
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | App registrada en el dashboard de Spotify |
| `SPOTIFY_REDIRECT_URI` | `https://TU-APP.onrender.com/callback`, idéntica a la registrada en Spotify |
| `GEMINI_API_KEY` | Guiones y listas |
| `ELEVENLABS_API_KEY` | Voz del DJ |
| `CIUDAD` | Ciudad por defecto para el clima (opcional) |
| `STATE_SECRET` | Clave para firmar el login (opcional; si falta se usa el client secret) |

Nunca subas el `.env` ni claves al repositorio.

## Desarrollo

```bash
npm install
npm start          # http://127.0.0.1:3000
npm test           # pruebas automáticas (no necesitan red ni claves)
```

Para probar en local, añade `http://127.0.0.1:3000/callback` como Redirect URI en el dashboard de Spotify.

## Flujo de trabajo

1. Cada cambio va en una **rama** (`git checkout -b mi-cambio`). `npm test` debe pasar (GitHub lo ejecuta solo al subir).
2. Los cambios importantes se prueban primero en un entorno de pruebas (ver abajo).
3. Cuando está probado, se fusiona en `Main`. **Render despliega `Main` automáticamente**, y es lo que usan los amigos.
4. Si algo sale mal: en el panel de Render, *Events → Rollback* al despliegue anterior, o `git revert` del commit.

### Entorno de pruebas (opcional, una vez)

1. En Render crea un segundo *Web Service* desde este mismo repositorio, rama `pruebas`, con las mismas variables de entorno.
2. Su `SPOTIFY_REDIRECT_URI` será `https://TU-APP-PRUEBAS.onrender.com/callback`; añádela también en el dashboard de Spotify.
3. Sube a `pruebas` lo que quieras probar; `Main` no se toca hasta que esté bien.

## Cosas que conviene saber

- **Spotify en modo desarrollo:** máximo 5 usuarios, que hay que añadir a mano en *User Management* del dashboard (si no, error 403). El dueño necesita Premium.
- **Permisos nuevos:** si se añade un permiso (scope) a `SCOPE` en `src/server.js`, cada usuario debe pulsar "Reconectar Spotify" una vez.
- **Render gratis:** el servicio se duerme tras un rato sin uso y tarda ~50 s en despertar. Todo el estado en memoria (límites, caché de tokens) se pierde al reiniciar; las sesiones no, porque van en la cookie.
- **Límites de uso** (protegen el gasto en Gemini y ElevenLabs): 6 locuciones por minuto y 5 listas cada 10 minutos por sesión. Los tiempos máximos de espera a cada servicio están en `src/utils.js` y en cada llamada.
- **Seguridad:** la política de contenido (CSP) está en modo *Report-Only*: no bloquea, solo avisa en los logs con `🛡️ CSP (solo aviso)`. Si tras unos días de uso no aparece ningún aviso, se puede activar cambiando `Content-Security-Policy-Report-Only` por `Content-Security-Policy` en `src/server.js`.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| "Spotify necesita un permiso nuevo" y sigue igual tras reconectar | Mira el texto entre corchetes: indica la llamada de Spotify que falló |
| 403 al iniciar sesión | El usuario no está en la lista de *User Management* del dashboard de Spotify |
| El DJ no habla | Mira los logs de Render: `Error en /api/crear-bloque` indica si falló Gemini, ElevenLabs o Spotify |
| "Un servicio tardó demasiado" | Un proveedor no respondió a tiempo; la app reintenta sola |
| Cambios web que no se ven | La página se revalida en cada carga; recarga o borra la caché de la app Android |

## Estructura

```
src/server.js           Rutas, sesión, login con Spotify, cabeceras de seguridad
src/utils.js            Tiempos máximos para llamadas externas
src/services/           gemini (guiones y listas), elevenlabs (voz), spotify, clima, listas
public/index.html       Toda la interfaz (locución + listas, es/en)
test/                   Pruebas automáticas (node:test)
android/                Proyecto Android (Capacitor)
```
