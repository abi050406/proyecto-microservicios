#!/bin/bash
# Levanta los 4 microservicios localmente SIN Docker, instalando
# dependencias si hace falta. Util para desarrollo rapido o si la
# maquina no tiene Docker instalado.
#
# Uso:
#   chmod +x iniciar-todo.sh
#   ./iniciar-todo.sh
#
# Para detener todo: ./detener-todo.sh

set -e

DIRECTORIO_BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$DIRECTORIO_BASE/logs"

iniciar_servicio() {
  local nombre="$1"
  local carpeta="$2"

  echo "Iniciando $nombre..."
  cd "$DIRECTORIO_BASE/$carpeta"

  if [ ! -d "node_modules" ]; then
    echo "  Instalando dependencias de $nombre..."
    npm install --silent
  fi

  nohup node index.js > "$DIRECTORIO_BASE/logs/$nombre.log" 2>&1 &
  echo $! > "$DIRECTORIO_BASE/logs/$nombre.pid"
  echo "  $nombre iniciado (PID $(cat "$DIRECTORIO_BASE/logs/$nombre.pid"))"
}

iniciar_servicio "servicio-paises" "servicio-paises"
iniciar_servicio "servicio-hora" "servicio-hora"
iniciar_servicio "servicio-clima" "servicio-clima"
sleep 1
iniciar_servicio "gateway" "gateway"

echo ""
echo "Todos los microservicios fueron iniciados."
echo "Gateway disponible en: http://localhost:4000"
echo "Verifica el estado de todos con: curl http://localhost:4000/health/completo"
echo ""
echo "Logs disponibles en la carpeta logs/"
echo "Para detener todo: ./detener-todo.sh"
