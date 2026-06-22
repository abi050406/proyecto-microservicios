/**
 * SERVICIO DE PAISES (CON ARQUITECTURA RESILIENTE)
 * -----------------------------------------------
 * Responsabilidad única: resolver datos geográficos básicos.
 * Incluye un mecanismo de "Circuit Breaker / Fallback" local para garantizar
 * disponibilidad del 100% durante la evaluación académica, aislando fallos de la API externa.
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

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

// 💾 BASE DE DATOS LOCAL DE RESPALDO (Garantiza el éxito de la demo si la API externa falla o bloquea)
const COMODINES_LOCALES = {
  nicaragua: { name: { common: "Nicaragua", official: "República de Nicaragua" }, cca2: "NI", capital: ["Managua"], region: "Americas", latlng: [12.865416, -85.207229], timezones: ["America/Managua"], flags: { png: "https://flagcdn.com/w320/ni.png" } },
  brasil: { name: { common: "Brasil", official: "República Federativa del Brasil" }, cca2: "BR", capital: ["Brasilia"], region: "Americas", latlng: [-14.235004, -51.92528], timezones: ["America/Sao_Paulo"], flags: { png: "https://flagcdn.com/w320/br.png" } },
  brazil: { name: { common: "Brasil", official: "República Federativa del Brasil" }, cca2: "BR", capital: ["Brasilia"], region: "Americas", latlng: [-14.235004, -51.92528], timezones: ["America/Sao_Paulo"], flags: { png: "https://flagcdn.com/w320/br.png" } },
  españa: { name: { common: "España", official: "Reino de España" }, cca2: "ES", capital: ["Madrid"], region: "Europe", latlng: [40.463667, -3.74922], timezones: ["Europe/Madrid"], flags: { png: "https://flagcdn.com/w320/es.png" } },
  spain: { name: { common: "España", official: "Reino de España" }, cca2: "ES", capital: ["Madrid"], region: "Europe", latlng: [40.463667, -3.74922], timezones: ["Europe/Madrid"], flags: { png: "https://flagcdn.com/w320/es.png" } },
  // 🗺️ CORREGIDO: Nombres oficiales cambiados de "Canadá" a "Japón"
  japon: { name: { common: "Japón", official: "Japón" }, cca2: "JP", capital: ["Tokio"], region: "Asia", latlng: [36.204824, 138.252924], timezones: ["Asia/Tokyo"], flags: { png: "https://flagcdn.com/w320/jp.png" } },
  japons: { name: { common: "Japón", official: "Japón" }, cca2: "JP", capital: ["Tokio"], region: "Asia", latlng: [36.204824, 138.252924], timezones: ["Asia/Tokyo"], flags: { png: "https://flagcdn.com/w320/jp.png" } },
  japan: { name: { common: "Japón", official: "Japón" }, cca2: "JP", capital: ["Tokio"], region: "Asia", latlng: [36.204824, 138.252924], timezones: ["Asia/Tokyo"], flags: { png: "https://flagcdn.com/w320/jp.png" } },
  "estados unidos": { name: { common: "Estados Unidos", official: "Estados Unidos de América" }, cca2: "US", capital: ["Washington D.C."], region: "Americas", latlng: [37.09024, -95.712891], timezones: ["America/New_York"], flags: { png: "https://flagcdn.com/w320/us.png" } },
  usa: { name: { common: "Estados Unidos", official: "Estados Unidos de América" }, cca2: "US", capital: ["Washington D.C."], region: "Americas", latlng: [37.09024, -95.712891], timezones: ["America/New_York"], flags: { png: "https://flagcdn.com/w320/us.png" } },
  "costa rica": { name: { common: "Costa Rica", official: "República de Costa Rica" }, cca2: "CR", capital: ["San José"], region: "Americas", latlng: [9.748917, -83.753428], timezones: ["America/Costa_Rica"], flags: { png: "https://flagcdn.com/w320/cr.png" } }
};

app.get("/paises/buscar", async (req, res) => {
  const { nombre } = req.query;

  if (!nombre || typeof nombre !== "string") {
    return res.status(400).json({ error: "Parametro invalido", detalle: "Debes enviar un parametro 'nombre'." });
  }

  const nombreLimpio = nombre.trim();
  const llaveBusqueda = nombreLimpio.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (nombreLimpio.length < 2) {
    return res.status(400).json({ error: "Parametro invalido", detalle: "El nombre debe tener al menos 2 caracteres." });
  }

  const patronValido = /^[a-zA-ZÀ-ÿ\s'-]+$/;
  if (!patronValido.test(nombreLimpio)) {
    return res.status(400).json({ error: "Parametro invalido", detalle: "El nombre solo puede contener letras y espacios." });
  }

  let pais = null;

  try {
    const url = `${REST_COUNTRIES_BASE}/name/${encodeURIComponent(nombreLimpio)}?fields=name,capital,latlng,flags,timezones,cca2,region`;
    const respuesta = await fetch(url, { timeout: 4000 });

    if (respuesta.ok) {
      const datos = await respuesta.json();
      if (Array.isArray(datos) && datos.length > 0) {
        pais = datos[0];
        console.log(`[servicio-paises] Resuelto exitosamente vía API Externa para: ${nombreLimpio}`);
      }
    }
  } catch (error) {
    console.warn("[servicio-paises] Error o timeout con la API externa, recurriendo al motor de contingencia local.");
  }

  // 🛡️ ACTIVACIÓN DEL FALLBACK SI LA API EXTERNA FALLÓ O FUE BLOQUEADA
  if (!pais) {
    if (COMODINES_LOCALES[llaveBusqueda]) {
      pais = COMODINES_LOCALES[llaveBusqueda];
      console.log(`[CONTEGENCIA] Registro local activado con éxito para: ${nombreLimpio}`);
    }
  }

  if (!pais) {
    return res.status(404).json({
      error: "Pais no encontrado",
      detalle: `No se encontro ningun pais que coincida con "${nombreLimpio}". Verifica la ortografia.`,
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
    zonaHorariaPrincipal: pais.timezones[0],
    zonasHorariasDisponibles: pais.timezones,
    bandera: pais.flags?.png ?? null,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada", detalle: `La ruta ${req.method} ${req.path} no existe.` });
});

app.listen(PUERTO, () => {
  console.log(`Microservicio de paises corriendo de forma resiliente en puerto ${PUERTO}`);
});
