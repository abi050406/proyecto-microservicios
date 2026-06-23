/**
 * API GATEWAY (ARQUITECTURA ULTRA-RESILIENTE V2)
 * ---------------------------------------------
 * Orquestador central fortificado contra errores de configuración en la nube,
 * inmune a cuelgues del lado del cliente (Frontend) y protegido contra lecturas de datos indefinidos.
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PUERTO = process.env.PORT || 4000;

// 🛡️ SANITIZADOR AUTOMÁTICO: Borra las diagonales finales mal puestas en el panel de Render
const limpiarUrl = (url) => url.trim().replace(/\/+$/, "");

const URL_SERVICIO_PAISES = limpiarUrl(process.env.URL_SERVICIO_PAISES || "http://localhost:4001");
const URL_SERVICIO_HORA = limpiarUrl(process.env.URL_SERVICIO_HORA || "http://localhost:4002");
const URL_SERVICIO_CLIMA = limpiarUrl(process.env.URL_SERVICIO_CLIMA || "http://localhost:4003");

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
 * Revisa el estado de los tres microservicios internos limpiando URLs.
 */
app.get("/health/completo", async (_req, res) => {
  const verificar = async (url, nombre) => {
    try {
      const r = await fetch(`${url}/health`, { timeout: 60000 });
      const texto = await r.text();
      
      if (texto.includes("<!DOCTYPE") || texto.trim().startsWith("<")) {
        return { servicio: nombre, url, estado: "inicializando (Render Waking Up)" };
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
 * Lector de flujos seguro: Evita que respuestas HTML rompan el formateo JSON
 */
async function safeParse(respuesta) {
  const texto = await respuesta.text();
  try {
    return JSON.parse(texto);
  } catch (e) {
    return {
      error: "Servidor inicializando",
      detalle: "El microservicio está despertando en la nube. Por favor, reintenta la consulta en unos segundos."
    };
  }
}

/**
 * Resuelve la información combinada de un país de forma segura
 */
async function resolverPaisCompleto(nombrePais) {
  try {
    const respuestaPais = await fetch(
      `${URL_SERVICIO_PAISES}/paises/buscar?nombre=${encodeURIComponent(nombrePais)}`,
      { timeout: 60000 }
    );

    const datosPais = await safeParse(respuestaPais);

    // 🛡️ CONTROL DE INICIALIZACIÓN: Si el servicio está despertando o no trae coordenadas, frena limpiamente
    if (!respuestaPais.ok || datosPais.error || !datosPais.coordenadas) {
      return { 
        ok: false, 
        status: respuestaPais.status || 503, 
        error: datosPais.error ? datosPais : { error: "Servidor inicializando", detalle: "El servicio de países está despertando en la nube." } 
      };
    }

    // Consultas en paralelo a clima y hora (Solo si el paso anterior trajo coordenadas válidas)
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

    const datosClima = await safeParse(respuestaClima);
    const datosHora = await safeParse(respuestaHora);

    return {
      ok: true,
      pais: datosPais,
      clima: respuestaClima.ok ? datosClima : { disponible: false, error: datosClima },
      hora: respuestaHora.ok ? datosHora : { disponible: false, error: datosHora },
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: { error: "Error de comunicacion", detalle: err.message }
    };
  }
}

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
      return res.status(nicaragua.status || 502).json(nicaragua.error);
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
      detalle: "El gateway no pudo completar la orquestación. Los servicios se están levantando.",
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
  console.log(`Gateway corriendo de forma ultra-protegida en puerto ${PUERTO}`);
});
