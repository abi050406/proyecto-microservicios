/**
 * SERVICIO DE PAISES
 * ------------------
 * Responsabilidad unica: dado un nombre de pais en espanol o ingles,
 * resolver datos geograficos basicos: nombre oficial, capital,
 * coordenadas y zona horaria IANA principal.
 *
 * Fuente de datos local:
 * - i18n-iso-countries: identifica paises por nombre en espanol o ingles.
 * - world-countries: provee capital, region, coordenadas y nombres oficiales.
 * - countries-and-timezones: provee zonas horarias IANA por codigo ISO2.
 *
 * Esta version no consulta RestCountries ni ninguna API externa. Asi evita
 * que el servicio falle si un proveedor cambia o descontinua su API.
 */

import express from "express";
import cors from "cors";
import countries from "i18n-iso-countries";
import worldCountries from "world-countries";
import timezones from "countries-and-timezones";
import esLocale from "i18n-iso-countries/langs/es.json" with { type: "json" };
import enLocale from "i18n-iso-countries/langs/en.json" with { type: "json" };

countries.registerLocale(esLocale);
countries.registerLocale(enLocale);

const app = express();
const PUERTO = process.env.PORT || 4001;

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
 * Apodos y nombres coloquiales que no siempre coinciden con el catalogo
 * ISO por nombre exacto. Solo complementan a la libreria, no reemplazan
 * el catalogo completo de paises.
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
 * Algunos paises con territorios lejanos o muchas zonas devuelven zonas
 * en orden alfabetico. Para la interfaz, priorizamos la zona de la
 * capital o la zona principal esperada por el usuario.
 */
const ZONAS_HORARIAS_PRIORITARIAS = {
  AR: "America/Argentina/Buenos_Aires",
  AU: "Australia/Sydney",
  BR: "America/Sao_Paulo",
  CA: "America/Toronto",
  CL: "America/Santiago",
  EC: "America/Guayaquil",
  ES: "Europe/Madrid",
  FR: "Europe/Paris",
  GB: "Europe/London",
  MX: "America/Mexico_City",
  PT: "Europe/Lisbon",
  RU: "Europe/Moscow",
  US: "America/New_York",
};

const PAISES_POR_ISO2 = new Map(worldCountries.map((pais) => [pais.cca2, pais]));

/**
 * Identifica un pais escrito en espanol o ingles y devuelve su codigo ISO2.
 * Devuelve null si no se pudo identificar ningun pais.
 */
function resolverCodigoIso2(nombreOriginal) {
  const entrada = quitarTildes(nombreOriginal.trim());

  if (APODOS_COMUNES[entrada]) {
    return APODOS_COMUNES[entrada];
  }

  let codigoIso = countries.getAlpha2Code(nombreOriginal, "es");

  if (!codigoIso) {
    codigoIso = countries.getAlpha2Code(nombreOriginal, "en");
  }

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

  return codigoIso ?? null;
}

function obtenerZonaHorariaPrincipal(codigoIso2) {
  const paisConZonas = timezones.getCountry(codigoIso2);
  const zonas = paisConZonas?.timezones ?? [];
  const zonaPrincipal = ZONAS_HORARIAS_PRIORITARIAS[codigoIso2] ?? zonas[0] ?? null;

  return {
    zonaPrincipal,
    zonas,
  };
}

/**
 * GET /paises/buscar?nombre=Espana
 *
 * Validaciones explicitas:
 * - El parametro "nombre" es obligatorio y debe tener al menos 2 caracteres.
 * - Solo letras, espacios, tildes, guiones y apostrofes.
 * - 404 si no se reconoce ningun pais con ese nombre.
 * - 422 si los datos locales vienen incompletos.
 */
app.get("/paises/buscar", (req, res) => {
  const { nombre } = req.query;

  if (!nombre || typeof nombre !== "string") {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "Debes enviar un parametro 'nombre' con el nombre del pais. Ejemplo: /paises/buscar?nombre=Espana",
    });
  }

  const nombreLimpio = nombre.trim();
  if (nombreLimpio.length < 2) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "El nombre del pais debe tener al menos 2 caracteres.",
    });
  }

  const patronValido = /^[a-zA-Z\u00C0-\u00FF\s'.-]+$/;
  if (!patronValido.test(nombreLimpio)) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "El nombre del pais solo puede contener letras, espacios, guiones y apostrofes.",
    });
  }

  const codigoIso2 = resolverCodigoIso2(nombreLimpio);

  if (!codigoIso2) {
    return res.status(404).json({
      error: "Pais no encontrado",
      detalle: `No se encontro ningun pais que coincida con "${nombreLimpio}". Verifica la ortografia.`,
    });
  }

  const pais = PAISES_POR_ISO2.get(codigoIso2);
  const { zonaPrincipal, zonas } = obtenerZonaHorariaPrincipal(codigoIso2);

  if (!pais || !pais.latlng || pais.latlng.length < 2 || !zonaPrincipal) {
    return res.status(422).json({
      error: "Datos incompletos",
      detalle: `El pais "${nombreLimpio}" fue encontrado pero no tiene datos locales completos de zona horaria o coordenadas.`,
    });
  }

  return res.status(200).json({
    nombreComun: nombreLimpio,
    nombreOficial: pais.translations?.spa?.official ?? pais.name?.official ?? nombreLimpio,
    codigoIso2: pais.cca2,
    capital: pais.capital?.[0] ?? "No disponible",
    region: pais.region ?? "No disponible",
    coordenadas: {
      latitud: pais.latlng[0],
      longitud: pais.latlng[1],
    },
    zonaHorariaPrincipal: zonaPrincipal,
    zonasHorariasDisponibles: zonas,
    bandera: pais.flag ?? null,
  });
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
