#!/bin/bash
# Detiene los 4 microservicios iniciados con iniciar-todo.sh

DIRECTORIO_BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for servicio in servicio-paises servicio-hora servicio-clima gateway; do
  ARCHIVO_PID="$DIRECTORIO_BASE/logs/$servicio.pid"
  if [ -f "$ARCHIVO_PID" ]; then
    PID=$(cat "$ARCHIVO_PID")
    if kill "$PID" 2>/dev/null; then
      echo "$servicio detenido (PID $PID)"
    else
      echo "$servicio ya no estaba corriendo"
    fi
    rm "$ARCHIVO_PID"
  else
    echo "$servicio no tiene un PID registrado (¿ya estaba detenido?)"
  fi
done
