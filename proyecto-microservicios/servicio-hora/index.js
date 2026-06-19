/**
 * SERVICIO DE HORA
 * ----------------
 * Responsabilidad unica: dado un identificador de zona horaria IANA
 * (ej. "America/Managua", "Europe/Madrid"), calcular:
 *   - la hora y fecha actual en esa zona,
 *   - la hora y fecha actual en Nicaragua,
 *   - la diferencia horaria entre ambas (en horas y minutos).
 *
 * No depende de ninguna API externa de hora: el calculo se hace
 * localmente con la libreria Luxon, que usa la base de datos IANA de
 * zonas horarias (tzdata) ya incluida en Node.js. Esto evita que el
 * sistema dependa de un tercero inestable solo para saber la hora,
 * y es ademas mas preciso (incluye manejo correcto de horario de verano).
 */

import express from "express";
import cors from "cors";
import { DateTime } from "luxon";

const app = express();
const PUERTO = process.env.PORT || 4002;
const ZONA_NICARAGUA = "America/Managua";

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[servicio-hora] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ servicio: "hora", estado: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /hora/calcular?zona=Europe/Madrid
 *
 * Validaciones explicitas:
 * - El parametro "zona" es obligatorio.
 * - Debe ser un identificador IANA valido (Luxon lo valida internamente).
 * - Si la zona no es reconocida, se responde 400, no se asume UTC en
 *   silencio (ese tipo de fallback silencioso fue justo la critica que
 *   recibimos en entregas anteriores: "no se implemento la validacion").
 */
app.get("/hora/calcular", (req, res) => {
  const { zona } = req.query;

  if (!zona || typeof zona !== "string" || zona.trim().length === 0) {
    return res.status(400).json({
      error: "Parametro invalido",
      detalle: "Debes enviar un parametro 'zona' con un identificador IANA. Ejemplo: /hora/calcular?zona=Europe/Madrid",
    });
  }

  const zonaLimpia = zona.trim();
  const horaDestino = DateTime.now().setZone(zonaLimpia);

  if (!horaDestino.isValid) {
    return res.status(400).json({
      error: "Zona horaria invalida",
      detalle: `"${zonaLimpia}" no es un identificador de zona horaria IANA reconocido. Ejemplos validos: America/Managua, Europe/Madrid, Asia/Tokyo.`,
      razonInterna: horaDestino.invalidReason,
    });
  }

  const horaNicaragua = DateTime.now().setZone(ZONA_NICARAGUA);

  if (!horaNicaragua.isValid) {
    // Caso extremo, casi imposible, pero se valida de todas formas:
    // no asumimos que el calculo de Nicaragua siempre funciona.
    return res.status(500).json({
      error: "Error interno",
      detalle: "No se pudo calcular la hora de referencia de Nicaragua.",
    });
  }

  // Diferencia horaria: comparamos los offsets en minutos respecto a UTC
  // de cada zona, en el instante actual (esto respeta automaticamente
  // el horario de verano si la zona destino lo tiene activo).
  const offsetDestinoMin = horaDestino.offset; // minutos respecto a UTC
  const offsetNicaraguaMin = horaNicaragua.offset;
  const diferenciaMinutos = offsetDestinoMin - offsetNicaraguaMin;

  const horasDiferencia = Math.trunc(diferenciaMinutos / 60);
  const minutosDiferencia = Math.abs(diferenciaMinutos % 60);

  let descripcionDiferencia;
  if (diferenciaMinutos === 0) {
    descripcionDiferencia = "Misma hora que Nicaragua";
  } else {
    const signo = diferenciaMinutos > 0 ? "adelante de" : "atras de";
    const horasAbs = Math.abs(horasDiferencia);
    const partes = [];
    if (horasAbs > 0) partes.push(`${horasAbs} hora${horasAbs !== 1 ? "s" : ""}`);
    if (minutosDiferencia > 0) partes.push(`${minutosDiferencia} minuto${minutosDiferencia !== 1 ? "s" : ""}`);
    descripcionDiferencia = `${partes.join(" y ")} ${signo} Nicaragua`;
  }

  return res.status(200).json({
    zonaConsultada: zonaLimpia,
    horaZonaConsultada: {
      fechaHoraIso: horaDestino.toISO(),
      fechaLegible: horaDestino.toFormat("dd/MM/yyyy"),
      horaLegible: horaDestino.toFormat("HH:mm:ss"),
      abreviaturaZona: horaDestino.offsetNameShort,
    },
    horaNicaragua: {
      fechaHoraIso: horaNicaragua.toISO(),
      fechaLegible: horaNicaragua.toFormat("dd/MM/yyyy"),
      horaLegible: horaNicaragua.toFormat("HH:mm:ss"),
      abreviaturaZona: horaNicaragua.offsetNameShort,
    },
    diferenciaHoraria: {
      horas: horasDiferencia,
      minutos: minutosDiferencia,
      descripcion: descripcionDiferencia,
    },
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Ruta no encontrada",
    detalle: `La ruta ${req.method} ${req.path} no existe en este microservicio.`,
  });
});

app.listen(PUERTO, () => {
  console.log(`Microservicio de hora corriendo en puerto ${PUERTO}`);
});
