/**
 * SERVICIO DE PAISES
 * ------------------
 * Responsabilidad unica (principio de microservicios): dado un codigo o
 * nombre de pais, resolver sus datos geograficos basicos: nombre oficial,
 * capital, coordenadas (lat/lon), bandera y zona horaria IANA principal.
 *
 * No sabe nada de clima ni de hora. Otros servicios consumen este servicio
 * para obtener la informacion que necesitan, en vez de duplicar la logica
 * de "como busco un pais" en cada uno.
 *
 * Fuente de datos externa: REST Countries API (https://restcountries.com)
 * - Publica, gratuita, sin necesidad de API key.
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PUERTO = process.env.PORT || 4001;
const REST_COUNTRIES_BASE = "https://restcountries.com/v3.1";

app.use(cors());
app.use(express.json());

/**
 * Middleware simple de logging para depuracion / evidencia en la demo.
 */
app.use((req, _res, next) => {
  console.log(`[servicio-paises] ${req.method} ${req.path}`);
  next();
});

/**
 * Ruta de salud. Util para que el gateway y el evaluador verifiquen
 * rapidamente que el microservicio esta vivo.
 */
app.get("/health", (_req, res) => {
  res.json({ servicio: "paises", estado: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /paises/buscar?nombre=Nicaragua
 *
 * Validaciones explicitas:
 * - El parametro "nombre" es obligatorio.
 * - Debe tener al menos 2 caracteres (evita busquedas vacias o inutiles).
 * - Si la API externa no encuentra el pais, se responde 404 con un
 *   mensaje claro, NO un error generico 500.
 * - Si la API externa falla (caida, timeout), se responde 503
 *   (Service Unavailable) explicando que el problema es externo,
 *   no del propio microservicio.
 */
app.get("/paises/buscar", async (req, res) => {
  const { nombre } = req.query;

  // --- Validacion de entrada ---
  if (!nombre || typeof nombre !== "string") {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "Debes enviar un parametro 'nombre' con el nombre del pais. Ejemplo: /paises/buscar?nombre=Nicaragua",
    });
  }

  const nombreLimpio = nombre.trim();
  if (nombreLimpio.length < 2) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "El nombre del pais debe tener al menos 2 caracteres.",
    });
  }

  // Solo letras, espacios y algunos acentos/guiones (evita inyeccion de
  // caracteres raros hacia la API externa).
  const patronValido = /^[a-zA-ZÀ-ÿ\s'-]+$/;
  if (!patronValido.test(nombreLimpio)) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "El nombre del pais solo puede contener letras, espacios, guiones y apostrofes.",
    });
  }

  try {
    const url = `${REST_COUNTRIES_BASE}/name/${encodeURIComponent(nombreLimpio)}?fields=name,capital,latlng,flags,timezones,cca2,region`;
    const respuesta = await fetch(url, { timeout: 8000 });

    if (respuesta.status === 404) {
      return res.status(404).json({
        error: "Pais no encontrado",
        detalle: `No se encontro ningun pais que coincida con "${nombreLimpio}". Verifica la ortografia.`,
      });
    }

    if (!respuesta.ok) {
      return res.status(503).json({
        error: "Servicio externo no disponible",
        detalle: "La API de paises (RestCountries) no respondio correctamente. Intenta de nuevo en unos segundos.",
      });
    }

    const datos = await respuesta.json();
    console.log("[DEBUG RESTCOUNTRIES] La API respondió:", datos);

    if (!Array.isArray(datos) || datos.length === 0) {
      return res.status(404).json({
        error: "Pais no encontrado",
        detalle: `No se encontro ningun pais que coincida con "${nombreLimpio}".`,
      });
    }

    // Tomamos la primera coincidencia (la API ordena por relevancia).
    const pais = datos[0];

    if (!pais.timezones || pais.timezones.length === 0 || !pais.latlng) {
      return res.status(422).json({
        error: "Datos incompletos",
        detalle: `El pais "${nombreLimpio}" fue encontrado pero no tiene datos de zona horaria o coordenadas disponibles.`,
      });
    }

    return res.status(200).json({
      nombreComun: pais.name?.common ?? nombreLimpio,
      nombreOficial: pais.name?.official ?? nombreLimpio,
      codigoIso2: pais.cca2 ?? null,
      capital: pais.capital?.[0] ?? "No disponible",
      region: pais.region ?? "No disponible",
      coordenadas: {
        latitud: pais.latlng[0],
        longitud: pais.latlng[1],
      },
      // La API puede devolver varias zonas horarias (ej. Estados Unidos,
      // Rusia). Tomamos la primera como representativa y dejamos el
      // arreglo completo por transparencia.
      zonaHorariaPrincipal: pais.timezones[0],
      zonasHorariasDisponibles: pais.timezones,
      bandera: pais.flags?.png ?? null,
    });
  } catch (error) {
    console.error("[servicio-paises] Error inesperado:", error.message);
    return res.status(503).json({
      error: "Servicio externo no disponible",
      detalle: "No se pudo contactar la API de paises. Verifica tu conexion a internet o intenta mas tarde.",
    });
  }
});

/**
 * Manejo de rutas no definidas (evita respuestas genericas de Express).
 */
app.use((req, res) => {
  res.status(404).json({
    error: "Ruta no encontrada",
    detalle: `La ruta ${req.method} ${req.path} no existe en este microservicio.`,
  });
});

app.listen(PUERTO, () => {
  console.log(`Microservicio de paises corriendo en puerto ${PUERTO}`);
});
