# Centro Horario Mundial — Sistema de Microservicios

Sistema web que permite seleccionar un país y consultar su **hora actual**,
**temperatura actual**, y la **diferencia horaria** respecto a Nicaragua,
construido con una arquitectura de **microservicios** que consume **APIs
externas**.

## 1. Arquitectura

El sistema está dividido en 4 componentes independientes, cada uno con una
única responsabilidad (principio de microservicios: *single responsibility*):

```
┌─────────────┐       ┌──────────────────────────────────────────┐
│  Frontend    │──────▶│              API GATEWAY (4000)            │
│ (HTML/JS)    │       │  Orquesta los 3 microservicios y combina   │
└─────────────┘       │  sus respuestas en un solo JSON             │
                       └──────────────────────────────────────────┘
                                │           │            │
                    ┌───────────┘           │            └───────────┐
                    ▼                       ▼                        ▼
         ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
         │ servicio-paises     │  │ servicio-clima      │  │ servicio-hora      │
         │ (4001)              │  │ (4003)              │  │ (4002)             │
         │ Resuelve capital,   │  │ Resuelve temperatura│  │ Calcula hora local  │
         │ coordenadas y zona  │  │ actual por lat/lon  │  │ y diferencia con     │
         │ horaria de un país  │  │                     │  │ Nicaragua            │
         │                     │  │                     │  │                     │
         │ API externa:        │  │ API externa:         │  │ Sin API externa:    │
         │ RestCountries.com   │  │ Open-Meteo.com       │  │ libreria Luxon       │
         └────────────────────┘  └────────────────────┘  └────────────────────┘
```

**¿Por qué el gateway no llama directo y el frontend sí pasa por el gateway?**
Porque ese es justamente el patrón "API Gateway": el cliente (frontend) nunca
debe conocer ni hablar directamente con los microservicios internos. Solo
conoce un punto de entrada único. Esto permite, por ejemplo, cambiar la
implementación interna de cualquier microservicio sin tocar el frontend.

### Flujo de una consulta

1. El usuario escribe un país en el frontend y presiona "Consultar".
2. El frontend llama a `GET /api/consultar?pais=Japon` en el **gateway**.
3. El gateway llama a `servicio-paises` para obtener coordenadas y zona
   horaria de Japón.
4. Con esos datos, el gateway llama **en paralelo** a `servicio-clima`
   (temperatura) y `servicio-hora` (hora + diferencia con Nicaragua).
5. El gateway también resuelve los mismos datos para Nicaragua (referencia
   fija que pide el enunciado).
6. El gateway combina todo en un solo JSON y lo devuelve al frontend.
7. El frontend pinta dos tarjetas (país elegido y Nicaragua) más el bloque
   de diferencia horaria.

## 2. APIs externas utilizadas

| API | Para qué se usa | Requiere API key | Documentación |
|---|---|---|---|
| [RestCountries](https://restcountries.com) | Capital, coordenadas, zona horaria IANA de un país | No | restcountries.com |
| [Open-Meteo](https://open-meteo.com) | Temperatura, humedad, viento y condición climática actual | No | open-meteo.com |

La hora y la diferencia horaria **no** se calculan con una API externa de
hora: se calculan localmente con la librería **Luxon**, que usa la base de
datos oficial de zonas horarias IANA (la misma que usan sistemas operativos
y navegadores). Esta decisión fue deliberada: depender de una tercera API
solo para sumar/restar husos horarios añade un punto de falla innecesario,
y el cálculo correcto (incluyendo horario de verano) es responsabilidad
natural de este microservicio.

## 3. Validaciones y manejo de errores implementados

Esta sección documenta explícitamente lo que se implementó, porque en
entregas anteriores se penalizó la ausencia de esto:

- **Cada microservicio valida sus propios parámetros de entrada** antes de
  hacer cualquier llamada externa (parámetro faltante, tipo incorrecto,
  fuera de rango, caracteres no permitidos).
- **Códigos de estado HTTP correctos y semánticos**: 400 (entrada inválida),
  404 (país no encontrado), 422 (datos incompletos de la fuente externa),
  503 (la API externa no respondió), 502 (falla de comunicación entre
  microservicios internos).
- **Ningún fallback silencioso**: si una zona horaria no es válida, el
  sistema no asume UTC por defecto; responde con error explícito.
- **Fallas parciales no tumban toda la respuesta**: si el clima falla pero
  la hora funciona (o viceversa), el gateway devuelve igual los datos que
  sí pudo obtener, marcando como `"disponible": false` lo que falló, en
  vez de que toda la consulta truene.
- **Endpoint de salud** (`/health` en cada servicio, `/health/completo` en
  el gateway) para verificar rápidamente qué pieza está caída.

## 4. Cómo correrlo localmente

### Opción A — Sin Docker (más simple)

Requiere [Node.js](https://nodejs.org) 18 o superior instalado.

```bash
chmod +x iniciar-todo.sh detener-todo.sh
./iniciar-todo.sh
```

Esto instala dependencias automáticamente (si hace falta) y levanta los 4
servicios. Luego abre `frontend/index.html` directamente en tu navegador
(doble clic, o arrástralo a una pestaña).

Para detener todo:
```bash
./detener-todo.sh
```

### Opción B — Con Docker

Requiere [Docker](https://www.docker.com/) y Docker Compose instalados.

```bash
docker compose up --build
```

Esto construye y levanta los 4 contenedores juntos, cada uno aislado.
Luego abre `frontend/index.html` en tu navegador.

### Verificar que todo esté corriendo

```bash
curl http://localhost:4000/health/completo
```

Debe responder algo como:
```json
{
  "gateway": "activo",
  "microservicios": [
    { "servicio": "paises", "estado": "activo" },
    { "servicio": "hora", "estado": "activo" },
    { "servicio": "clima", "estado": "activo" }
  ]
}
```

## 5. Cómo desplegarlo en línea (Render)

[Render](https://render.com) tiene un plan gratuito que permite desplegar
varios servicios web pequeños sin necesidad de tarjeta de crédito.

Pasos generales (se repiten para cada uno de los 4 componentes):

1. Sube este proyecto a un repositorio de GitHub.
2. En Render, crea un **Web Service** nuevo por cada carpeta:
   `servicio-paises`, `servicio-hora`, `servicio-clima`, `gateway`.
3. Para cada uno, en "Root Directory" especifica la carpeta correspondiente
   (ej. `servicio-paises`).
4. Build command: `npm install` — Start command: `node index.js`.
5. Una vez desplegados `servicio-paises`, `servicio-hora` y
   `servicio-clima`, copia sus URLs públicas (Render les asigna una URL
   tipo `https://servicio-paises-xxxx.onrender.com`).
6. En el servicio `gateway`, agrega las variables de entorno:
   - `URL_SERVICIO_PAISES` = URL pública de servicio-paises
   - `URL_SERVICIO_HORA` = URL pública de servicio-hora
   - `URL_SERVICIO_CLIMA` = URL pública de servicio-clima
7. Una vez desplegado el gateway, copia su URL pública.
8. En `frontend/index.html`, antes de la etiqueta `<script>` final, agrega:
   ```html
   <script>window.URL_GATEWAY_OVERRIDE = "https://tu-gateway.onrender.com";</script>
   ```
9. Sube el frontend a [Netlify](https://netlify.com), [Vercel](https://vercel.com),
   o como GitHub Pages — cualquiera de estos sirve un sitio estático gratis.

**Nota sobre el plan gratuito de Render**: los servicios gratuitos "duermen"
tras 15 minutos de inactividad y tardan unos segundos en despertar en la
primera consulta tras estar inactivos. Esto es normal y se puede mencionar
en la exposición si la demo tarda un poco la primera vez.

## 6. Estructura de carpetas

```
proyecto-microservicios/
├── servicio-paises/      # Microservicio: datos geográficos y de zona horaria
├── servicio-hora/        # Microservicio: cálculo de hora y diferencia horaria
├── servicio-clima/       # Microservicio: temperatura actual
├── gateway/               # Orquestador que expone la API unificada
├── frontend/              # Interfaz web (HTML/CSS/JS, sin frameworks)
├── docker-compose.yml     # Levanta los 4 microservicios en Docker
├── iniciar-todo.sh        # Levanta los 4 microservicios sin Docker
├── detener-todo.sh        # Detiene los servicios iniciados sin Docker
└── README.md
```

## 7. Limitaciones conocidas (para ser transparente en la exposición)

- El plan gratuito de las APIs externas no garantiza disponibilidad 24/7;
  si RestCountries u Open-Meteo están caídos, el sistema responde con un
  error 503 explícito en lugar de fallar de forma confusa.
- No hay base de datos: el sistema es de consulta en tiempo real, no
  guarda historial de búsquedas. Esto fue una decisión de alcance, no una
  omisión accidental — el enunciado pide consultar datos en vivo, no
  llevar un registro persistente.
- La autenticación de usuarios no aplica a este proyecto, ya que es un
  servicio de consulta pública sin datos sensibles ni de usuario.
- El autocompletado de países en el frontend es solo una ayuda de UX con
  una lista corta predefinida; el campo acepta cualquier país del mundo
  porque la validación real ocurre en el backend contra RestCountries.
