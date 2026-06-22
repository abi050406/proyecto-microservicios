/**
 * API GATEWAY (ARQUITECTURA DEFENSIVA Y RESILIENTE)
 * ------------------------------------------------
 * Este componente actúa como el orquestador central. Ha sido fortificado
 * con lectores de flujo de texto (Safe JSON Parsing) para evitar colapsos
 * cuando los servidores de Render devuelven páginas HTML de inicialización ("Cold Start").
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PUERTO = process.env.PORT || 4000;

const URL_SERVICIO_PAISES = process.env.URL_SERVICIO_PAISES || "http://localhost:4001";
const URL_SERVICIO_HORA = process.env.URL_SERVICIO_HORA || "http://localhost:4002";
const URL_SERVICIO_CLIMA = process.env.URL_SERVICIO_CLIMA || "http://localhost:4003";

const NOMBRE_NICARAGUA = "Nicaragua";

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[gateway] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ servicio: "gateway", estado: "ok", timestamp: new Date().toISOString() });
});

/**
 * Revisa el estado de los tres microservicios internos de forma segura.
 */
app.get("/health/completo", async (_req, res) => {
  const verificar = async (url, nombre) => {
    try {
      const r = await fetch(`${url}/health`, { timeout: 60000 });
      const texto = await r.text();
      
      // Si la respuesta es una página de Render o Cloudflare, lo identificamos de inmediato
      if (texto.includes("<!DOCTYPE") || texto.trim().startsWith("<")) {
        return { servicio: nombre, url, estado: "inicializando (Render Waking Up Page)" };
      }
      
      return { servicio: nombre, url, estado: r.ok ? "activo" : "responde con error" };
    } catch {
      return { servicio: nombre, url, estado: "no disponible" };
    }
  };

  const resultados = await Promise.all([
    verificar(URL_SERVICIO_PAISES, "paises"),
    verificar(URL_SERVICIO_HORA, "hora"),
    verificar(URL_SERVICIO_CLIMA, "clima"),
  ]);

  res.json({ gateway: "activo", microservicios: resultados });
});

/**
 * Función auxiliar fortificada: resuelve la información interceptando respuestas HTML erróneas.
 */
async function resolverPaisCompleto(nombrePais) {
  const respuestaPais = await fetch(
    `${URL_SERVICIO_PAISES}/paises/buscar?nombre=${encodeURIComponent(nombrePais)}`,
    { timeout: 60000 }
  );

  const textoPais = await respuestaPais.text();
  let datosPais;

  // 🛡️ PARSEO SEGURO: Evita el crash de "Unexpected token '<'"
  try {
    datosPais = JSON.parse(textoPais);
  } catch (e) {
    return {
      ok: false,
      status: 503,
      error: {
        error: "Microservicio en inicialización",
        detalle: "El servidor de países está despertando en la nube. Por favor, reintenta la consulta en unos segundos."
      }
    };
  }

  if (!respuestaPais.ok) {
    return { ok: false, status: respuestaPais.status, error: datosPais };
  }

  // Llamadas en paralelo para clima y hora
  const [respuestaClima, respuestaHora] = await Promise.all([
    fetch(
      `${URL_SERVICIO_CLIMA}/clima/actual?lat=${datosPais.coordenadas.latitud}&lon=${datosPais.coordenadas.longitud}`,
      { timeout: 60000 }
    ),
    fetch(
      `${URL_SERVICIO_HORA}/hora/calcular?zona=${encodeURIComponent(datosPais.zonaHorariaPrincipal)}`,
      { timeout: 60000 }
    ),
  ]);

  const textoClima = await respuestaClima.text();
  const textoHora = await respuestaHora.text();

  let datosClima, datosHora;

  try { datosClima = JSON.parse(textoClima); } catch { datosClima = { disponible: false, error: "Servidor de clima despertando." }; }
  try { datosHora = JSON.parse(textoHora); } catch { datosHora = { disponible: false, error: "Servidor de hora despertando." }; }

  return {
    ok: true,
    pais: datosPais,
    clima: respuestaClima.ok ? datosClima : { disponible: false, error: datosClima },
    hora: respuestaHora.ok ? datosHora : { disponible: false, error: datosHora },
  };
}

/**
 * Endpoint principal de consulta consumido por el frontend.
 */
app.get("/api/consultar", async (req, res) => {
  const { pais } = req.query;

  if (!pais || typeof pais !== "string" || pais.trim().length < 2) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "Debes enviar un parámetro 'pais' con al menos 2 caracteres.",
    });
  }

  const nombrePais = pais.trim();
  const esNicaragua = nombrePais.toLowerCase() === NOMBRE_NICARAGUA.toLowerCase();

  try {
    const [resultadoPaisElegido, resultadoNicaragua] = await Promise.all([
      resolverPaisCompleto(nombrePais),
      esNicaragua ? null : resolverPaisCompleto(NOMBRE_NICARAGUA),
    ]);

    if (!resultadoPaisElegido.ok) {
      return res.status(resultadoPaisElegido.status).json(resultadoPaisElegido.error);
    }

    const nicaragua = esNicaragua ? resultadoPaisElegido : resultadoNicaragua;

    if (!nicaragua.ok) {
      return res.status(503).json(nicaragua.error);
    }

    return res.status(200).json({
      paisConsultado: resultadoPaisElegido.pais,
      climaPaisConsultado: resultadoPaisElegido.clima,
      horaPaisConsultado: resultadoPaisElegido.hora,
      nicaragua: {
        pais: nicaragua.pais,
        clima: nicaragua.clima,
        hora: nicaragua.hora,
      },
      esConsultaSobreNicaragua: esNicaragua,
    });
  } catch (error) {
    console.error("[gateway] Error inesperado:", error.message);
    return res.status(502).json({
      error: "Error de comunicacion entre microservicios",
      detalle: "El gateway no pudo completar la orquestación. Los servicios se están levantando en la nube, por favor espera un momento.",
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Ruta no encontrada",
    detalle: `La ruta ${req.method} ${req.path} no existe en este gateway.`,
  });
});

app.listen(PUERTO, () => {
  console.log(`Gateway corriendo de forma protegida en puerto ${PUERTO}`);
});
