async function probarServidor() {
  console.log("enviando petición al servidor de Bratify...");

  try {
    const response = await fetch('http://localhost:3000/api/crear-bloque', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cancionAnterior: "Blinding Lights",
        cancionSiguiente: "Get Lucky"
      }),
    });

    const resultado = await response.json();
    console.log("\n Respuesta del servidor:", resultado);

  } catch (error) {
    console.error("❌ Error al conectar con el servidor:", error.message);
  }
}

probarServidor();