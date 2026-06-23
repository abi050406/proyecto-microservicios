/**
 * SERVICIO DE PAISES
 * ------------------
 * Responsabilidad unica: dado un nombre de pais (en español o ingles),
 * resolver sus datos geograficos basicos: nombre oficial, capital,
 * coordenadas y zona horaria IANA principal.
 *
 * Fuente de datos externa: REST Countries API (https://restcountries.com)
 * - Publica, gratuita, sin necesidad de API key.
 *
 * PROBLEMA RESUELTO EN ESTA VERSION:
 * RestCountries solo reconoce nombres de paises en ingles (o el nombre
 * nativo/oficial de cada pais), NO en español. Por eso buscar "España"
 * directamente fallaba (su nombre en ingles es "Spain"), mientras que
 * "Brasil" o "Japon" coincidian por casualidad al ser muy similares a
 * "Brazil" / "Japan".
 *
 * La solucion es traducir el nombre que escribe el usuario (en español)
 * a su nombre en ingles ANTES de consultar la API externa, usando la
 * libreria "i18n-iso-countries", que contiene el catalogo oficial de los
 * ~250 paises reconocidos por ISO 3166 en múltiples idiomas. Esto es
 * mucho mas robusto que mantener una lista corta de paises a mano: cubre
 * practicamente cualquier pais que el usuario escriba en español.
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import countries from "i18n-iso-countries";
import esLocale from "i18n-iso-countries/langs/es.json" with { type: "json" };
import enLocale from "i18n-iso-countries/langs/en.json" with { type: "json" };

countries.registerLocale(esLocale);
countries.registerLocale(enLocale);

const app = express();
const PUERTO = process.env.PORT || 4001;
const REST_COUNTRIES_BASE = "https://restcountries.com/v3.1";

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[servicio-paises] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ servicio: "paises", estado: "ok", timestamp: new Date().toISOString() });
});

function quitarTildes(texto) {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Apodos y nombres coloquiales en español que NO comparten texto con el
 * nombre oficial registrado en la libreria (por eso una busqueda de
 * "contiene" no los encuentra). Esta lista es pequeña y solo complementa
 * a la libreria para estos casos puntuales; no es la fuente principal
 * de datos.
 */
const APODOS_COMUNES = {
  "corea del sur": "KR",
  "corea del norte": "KP",
  eeuu: "US",
  "ee.uu.": "US",
  "estados unidos de america": "US",
  "reino unido": "GB",
  "gran bretana": "GB",
  "emiratos arabes": "AE",
  "republica checa": "CZ",
  chequia: "CZ",
  birmania: "MM",
  "republica democratica del congo": "CD",
  congo: "CG",
  "macedonia del norte": "MK",
  vaticano: "VA",
};

/**
 * Traduce un nombre de pais escrito en español a su nombre en ingles,
 * que es lo que entiende RestCountries. Si el nombre ya esta en ingles
 * (o es ambiguo), tambien intenta resolverlo para no romper busquedas
 * que ya funcionaban antes.
 *
 * Devuelve null si no se pudo identificar ningun pais, lo cual permite
 * a quien llama decidir si usa el nombre original como ultimo recurso.
 */
function traducirNombrePaisAIngles(nombreOriginal) {
  const entrada = quitarTildes(nombreOriginal.trim());

  if (APODOS_COMUNES[entrada]) {
    return countries.getName(APODOS_COMUNES[entrada], "en");
  }

  // Coincidencia exacta contra el catalogo en español.
  let codigoIso = countries.getAlpha2Code(nombreOriginal, "es");

  // Si no hubo coincidencia exacta, tambien probamos contra el catalogo
  // en ingles (cubre el caso de que el usuario ya escriba "Spain").
  if (!codigoIso) {
    codigoIso = countries.getAlpha2Code(nombreOriginal, "en");
  }

  // Busqueda difusa como ultimo recurso: el texto del usuario esta
  // contenido en el nombre oficial en español, o viceversa. Se prefiere
  // siempre la coincidencia mas larga/especifica, para evitar que
  // nombres parecidos (ej. "Republica Dominicana" vs "Dominica") se
  // confundan entre si.
  if (!codigoIso) {
    const nombresEs = countries.getNames("es");
    let mejorCodigo = null;
    let mejorLongitud = 0;

    for (const [cca2, nombreOficial] of Object.entries(nombresEs)) {
      const oficialNormalizado = quitarTildes(nombreOficial);
      const hayCoincidencia =
        oficialNormalizado.includes(entrada) || entrada.includes(oficialNormalizado);
      if (hayCoincidencia) {
        const longitudCompartida = Math.min(oficialNormalizado.length, entrada.length);
        if (longitudCompartida > mejorLongitud) {
          mejorLongitud = longitudCompartida;
          mejorCodigo = cca2;
        }
      }
    }
    codigoIso = mejorCodigo;
  }

  if (!codigoIso) return null;
  return countries.getName(codigoIso, "en");
}

/**
 * GET /paises/buscar?nombre=España
 *
 * Validaciones explicitas:
 * - El parametro "nombre" es obligatorio y debe tener al menos 2 caracteres.
 * - Solo letras, espacios, tildes, guiones y apostrofes (evita caracteres
 *   raros hacia la API externa).
 * - 404 si no se reconoce ningun pais con ese nombre (ni en español ni en
 *   ingles), 503 si la API externa no responde, 422 si los datos vienen
 *   incompletos.
 */
app.get("/paises/buscar", async (req, res) => {
  const { nombre } = req.query;

  if (!nombre || typeof nombre !== "string") {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "Debes enviar un parametro 'nombre' con el nombre del pais. Ejemplo: /paises/buscar?nombre=España",
    });
  }

  const nombreLimpio = nombre.trim();
  if (nombreLimpio.length < 2) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "El nombre del pais debe tener al menos 2 caracteres.",
    });
  }

  const patronValido = /^[a-zA-ZÀ-ÿ\s'.-]+$/;
  if (!patronValido.test(nombreLimpio)) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "El nombre del pais solo puede contener letras, espacios, guiones y apostrofes.",
    });
  }

  // Traducimos a ingles antes de consultar la API externa. Si no se pudo
  // traducir (pais no reconocido en ningun catalogo), usamos el nombre
  // original como ultimo intento: asi no perdemos compatibilidad con
  // nombres nativos que RestCountries si reconozca de forma directa.
  const nombreEnIngles = traducirNombrePaisAIngles(nombreLimpio);
  const nombreParaConsultarApi = nombreEnIngles ?? nombreLimpio;

  try {
    const url = `${REST_COUNTRIES_BASE}/name/${encodeURIComponent(nombreParaConsultarApi)}?fields=name,capital,latlng,flags,timezones,cca2,region`;
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

    if (!Array.isArray(datos) || datos.length === 0) {
      return res.status(404).json({
        error: "Pais no encontrado",
        detalle: `No se encontro ningun pais que coincida con "${nombreLimpio}".`,
      });
    }

    const pais = datos[0];

    if (!pais.timezones || pais.timezones.length === 0 || !pais.latlng) {
      return res.status(422).json({
        error: "Datos incompletos",
        detalle: `El pais "${nombreLimpio}" fue encontrado pero no tiene datos de zona horaria o coordenadas disponibles.`,
      });
    }

    return res.status(200).json({
      // Usamos el nombre comun que devuelve RestCountries en ingles, pero
      // si el usuario escribio en español preferimos mostrar lo que el
      // escribio para que la interfaz se sienta natural en español.
      nombreComun: nombreLimpio,
      nombreOficial: pais.name?.official ?? nombreLimpio,
      codigoIso2: pais.cca2 ?? null,
      capital: pais.capital?.[0] ?? "No disponible",
      region: pais.region ?? "No disponible",
      coordenadas: {
        latitud: pais.latlng[0],
        longitud: pais.latlng[1],
      },
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

app.use((req, res) => {
  res.status(404).json({
    error: "Ruta no encontrada",
    detalle: `La ruta ${req.method} ${req.path} no existe en este microservicio.`,
  });
});

app.listen(PUERTO, () => {
  console.log(`Microservicio de paises corriendo en puerto ${PUERTO}`);
});
