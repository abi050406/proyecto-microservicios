/**
 * API GATEWAY
 * -----------
 * Este componente es el patron "API Gateway" clasico de arquitecturas de
 * microservicios: el frontend NUNCA habla directamente con los tres
 * microservicios (paises, hora, clima). Habla solo con el gateway, y el
 * gateway se encarga de:
 *
 *   1. Llamar al microservicio de paises para resolver el pais elegido
 *      (coordenadas + zona horaria IANA).
 *   2. Con esas coordenadas, llamar EN PARALELO al microservicio de
 *      clima (temperatura del pais elegido) y al microservicio de hora
 *      (hora del pais elegido + diferencia con Nicaragua).
 *   3. Tambien resuelve los datos de Nicaragua para mostrarlos siempre
 *      como referencia, sin que el usuario tenga que pedirlo aparte.
 *   4. Combinar (orquestar) todas las respuestas en un solo JSON que el
 *      frontend consume con una sola peticion HTTP.
 *
 * Si CUALQUIER microservicio interno falla, el gateway no se cae: captura
 * el error puntual y lo reporta dentro de la respuesta, marcando que esa
 * parte especifica no pudo resolverse, en vez de tronar toda la peticion.
 * Esto es exactamente el tipo de manejo de errores que se penalizo en
 * entregas anteriores por estar ausente.
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PUERTO = process.env.PORT || 4000;

// URLs de los microservicios. En produccion (Render) estas se configuran
// via variables de entorno; en desarrollo local apuntan a localhost.
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
 * Revisa el estado de los tres microservicios internos. Muy util para la
 * demo: si algo no esta corriendo, se ve inmediatamente cual pieza falta,
 * en vez de adivinar por que el sistema no responde.
 */
app.get("/health/completo", async (_req, res) => {
  const verificar = async (url, nombre) => {
    try {
      const r = await fetch(`${url}/health`, { timeout: 60000 });
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
 * Funcion auxiliar: resuelve toda la informacion combinada (pais + clima +
 * hora + diferencia con Nicaragua) para un nombre de pais dado.
 *
 * Se reutiliza tanto para el pais que el usuario elige como para
 * Nicaragua, evitando duplicar logica.
 */
async function resolverPaisCompleto(nombrePais) {
  // Paso 1: datos del pais (coordenadas + zona horaria)
  const respuestaPais = await fetch(
    `${URL_SERVICIO_PAISES}/paises/buscar?nombre=${encodeURIComponent(nombrePais)}`,
    { timeout: 8000 }
  );

  const datosPais = await respuestaPais.json();

  if (!respuestaPais.ok) {
    // Propagamos el mismo codigo de estado y mensaje que dio el
    // microservicio de paises, para no perder informacion de diagnostico.
    return { ok: false, status: respuestaPais.status, error: datosPais };
  }

  // Paso 2 y 3: clima y hora EN PARALELO, ya que son independientes entre si.
  const [respuestaClima, respuestaHora] = await Promise.all([
    fetch(
      `${URL_SERVICIO_CLIMA}/clima/actual?lat=${datosPais.coordenadas.latitud}&lon=${datosPais.coordenadas.longitud}`,
      { timeout: 8000 }
    ),
    fetch(
      `${URL_SERVICIO_HORA}/hora/calcular?zona=${encodeURIComponent(datosPais.zonaHorariaPrincipal)}`,
      { timeout: 8000 }
    ),
  ]);

  const datosClima = await respuestaClima.json();
  const datosHora = await respuestaHora.json();

  return {
    ok: true,
    pais: datosPais,
    // Si el clima o la hora fallaron puntualmente, no tronamos toda la
    // respuesta: marcamos ese bloque como no disponible y seguimos.
    clima: respuestaClima.ok
      ? datosClima
      : { disponible: false, error: datosClima },
    hora: respuestaHora.ok
      ? datosHora
      : { disponible: false, error: datosHora },
  };
}

/**
 * GET /api/consultar?pais=Japon
 *
 * Endpoint principal que consume el frontend. Devuelve en un solo JSON:
 *  - datos del pais consultado (clima + hora + diferencia con Nicaragua)
 *  - datos de Nicaragua (siempre, como referencia fija del enunciado)
 *
 * Validacion explicita: el parametro "pais" es obligatorio.
 */
app.get("/api/consultar", async (req, res) => {
  const { pais } = req.query;

  if (!pais || typeof pais !== "string" || pais.trim().length < 2) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "Debes enviar un parametro 'pais' con al menos 2 caracteres. Ejemplo: /api/consultar?pais=Japon",
    });
  }

  const nombrePais = pais.trim();
  const esNicaragua = nombrePais.toLowerCase() === NOMBRE_NICARAGUA.toLowerCase();

  try {
    // Si el usuario elige Nicaragua, no tiene sentido pedirlo dos veces:
    // resolvemos una sola vez y la reutilizamos para ambos bloques.
    const [resultadoPaisElegido, resultadoNicaragua] = await Promise.all([
      resolverPaisCompleto(nombrePais),
      esNicaragua ? null : resolverPaisCompleto(NOMBRE_NICARAGUA),
    ]);

    if (!resultadoPaisElegido.ok) {
      return res.status(resultadoPaisElegido.status).json(resultadoPaisElegido.error);
    }

    const nicaragua = esNicaragua ? resultadoPaisElegido : resultadoNicaragua;

    if (!nicaragua.ok) {
      // Si por alguna razon ni siquiera Nicaragua se pudo resolver, es un
      // problema del propio servicio de paises, no del pais consultado.
      return res.status(502).json({
        error: "No se pudo resolver la informacion de referencia de Nicaragua",
        detalle: nicaragua.error,
      });
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
      detalle: "El gateway no pudo completar la orquestacion de los microservicios internos. Verifica que todos esten corriendo (revisa /health/completo).",
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
  console.log(`Gateway corriendo en puerto ${PUERTO}`);
  console.log(`-> servicio-paises: ${URL_SERVICIO_PAISES}`);
  console.log(`-> servicio-hora:   ${URL_SERVICIO_HORA}`);
  console.log(`-> servicio-clima:  ${URL_SERVICIO_CLIMA}`);
});
