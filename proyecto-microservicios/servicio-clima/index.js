/**
 * SERVICIO DE CLIMA
 * -----------------
 * Responsabilidad unica: dado un par de coordenadas (latitud, longitud),
 * devolver la temperatura actual y condiciones basicas del clima.
 *
 * Fuente de datos externa: Open-Meteo (https://open-meteo.com)
 * - Publica, gratuita, sin necesidad de API key, pensada para uso
 *   academico y proyectos pequenos/medianos.
 *
 * Este servicio NO sabe nada de paises ni de nombres de ciudades:
 * solo trabaja con coordenadas. Esa separacion es deliberada: el
 * servicio de paises es quien sabe "donde queda" un pais, y este
 * servicio simplemente responde "que clima hay en este punto del mapa".
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PUERTO = process.env.PORT || 4003;
const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[servicio-clima] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ servicio: "clima", estado: "ok", timestamp: new Date().toISOString() });
});

/**
 * Codigos de clima segun estandar WMO usado por Open-Meteo.
 * Se traduce a espanol para que la interfaz sea legible.
 */
function traducirCodigoClima(codigo) {
  const mapa = {
    0: "Cielo despejado",
    1: "Mayormente despejado",
    2: "Parcialmente nublado",
    3: "Nublado",
    45: "Niebla",
    48: "Niebla con escarcha",
    51: "Llovizna ligera",
    53: "Llovizna moderada",
    55: "Llovizna intensa",
    61: "Lluvia ligera",
    63: "Lluvia moderada",
    65: "Lluvia intensa",
    71: "Nevada ligera",
    73: "Nevada moderada",
    75: "Nevada intensa",
    80: "Lluvias debiles aisladas",
    81: "Lluvias moderadas aisladas",
    82: "Lluvias fuertes aisladas",
    95: "Tormenta electrica",
    96: "Tormenta con granizo ligero",
    99: "Tormenta con granizo fuerte",
  };
  return mapa[codigo] ?? "Condicion no clasificada";
}

/**
 * GET /clima/actual?lat=12.13&lon=-86.25
 *
 * Validaciones explicitas:
 * - lat y lon son obligatorios.
 * - Ambos deben ser numeros validos.
 * - Latitud debe estar en rango [-90, 90].
 * - Longitud debe estar en rango [-180, 180].
 * (Estos rangos son los limites fisicos reales de coordenadas geograficas;
 * validarlos evita enviar basura a la API externa.)
 */
app.get("/clima/actual", async (req, res) => {
  const { lat, lon } = req.query;

  if (lat === undefined || lon === undefined) {
    return res.status(400).json({
      error: "Parametros invalidos",
      detalle: "Debes enviar 'lat' y 'lon'. Ejemplo: /clima/actual?lat=12.13&lon=-86.25",
    });
  }

  const latitud = Number(lat);
  const longitud = Number(lon);

  if (Number.isNaN(latitud) || Number.isNaN(longitud)) {
    return res.status(400).json({
      error: "Parametros invalidos",
      detalle: "'lat' y 'lon' deben ser numeros validos.",
    });
  }

  if (latitud < -90 || latitud > 90) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "La latitud debe estar entre -90 y 90 grados.",
    });
  }

  if (longitud < -180 || longitud > 180) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "La longitud debe estar entre -180 y 180 grados.",
    });
  }

  try {
    const url = `${OPEN_METEO_BASE}?latitude=${latitud}&longitude=${longitud}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
    const respuesta = await fetch(url, { timeout: 8000 });

    if (!respuesta.ok) {
      console.error(`[servicio-clima] Open-Meteo respondio con status ${respuesta.status} ${respuesta.statusText}`);
      let cuerpoError = "";
      try {
        cuerpoError = await respuesta.text();
        console.error(`[servicio-clima] Cuerpo de la respuesta de error: ${cuerpoError.substring(0, 300)}`);
      } catch (errorLectura) {
        console.error("[servicio-clima] No se pudo leer el cuerpo del error");
      }
      return res.status(503).json({
        error: "Servicio externo no disponible",
        detalle: "La API de clima (Open-Meteo) no respondio correctamente. Intenta de nuevo en unos segundos.",
        diagnostico: {
          statusExterno: respuesta.status,
          statusTextExterno: respuesta.statusText,
        },
      });
    }

    const datos = await respuesta.json();

    if (!datos.current) {
      return res.status(422).json({
        error: "Datos incompletos",
        detalle: "La API de clima no devolvio datos actuales para esa coordenada.",
      });
    }

    return res.status(200).json({
      coordenadasConsultadas: { latitud, longitud },
      temperaturaActualC: datos.current.temperature_2m,
      humedadRelativa: datos.current.relative_humidity_2m,
      velocidadVientoKmh: datos.current.wind_speed_10m,
      condicion: traducirCodigoClima(datos.current.weather_code),
      horaMedicion: datos.current.time,
    });
  } catch (error) {
    console.error("[servicio-clima] Error inesperado:", error.message);
    return res.status(503).json({
      error: "Servicio externo no disponible",
      detalle: "No se pudo contactar la API de clima. Verifica tu conexion a internet o intenta mas tarde.",
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Ruta no encontrada",
    detalle: `La ruta ${req.method} ${req.path} no existe en este microservicio.`,
  });
});

app.listen(PUERTO, () => {
  console.log(`Microservicio de clima corriendo en puerto ${PUERTO}`);
});
