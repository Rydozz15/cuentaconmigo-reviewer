# Plataforma Revisor Cuenta Conmigo 🛠️📊

Este proyecto es una plataforma web integrada para el monitoreo y seguimiento operativo del programa **Cuenta Conmigo**. Permite consolidar datos de participantes en planillas Excel, sincronizar logs de avance desde un servidor remoto de la UC en tiempo real y visualizar métricas interactivas de embudos (funnel) y cohortes semanales.

---

## 🚀 Cómo Iniciar en Local

Para iniciar la aplicación en tu computadora local:

1. Ejecuta el script de inicio directo en tu terminal:
   ```bash
   ./ejecutar.sh
   ```
2. Esto levantará el servidor web local (`http://127.0.0.1:8000`) y **abrirá automáticamente tu navegador web** en esa dirección.
3. **Importante:** No cierres la ventana de la terminal mientras estés usando la aplicación, ya que allí se está ejecutando el backend en FastAPI.

---

## 🔒 Control de Acceso y Seguridad

Para proteger los datos personales de las familias (nombres, teléfonos, progresos):
- **Contraseña de Acceso:** La plataforma exige una contraseña para ingresar a la interfaz. Por defecto es **`cc2026`** (puedes cambiarla en la sección de Ajustes en la aplicación).
- **Gestión Local Segura:** La contraseña se almacena de forma local en `config.json`. Este archivo está incluido en `.gitignore` para que **nunca se suban por error a GitHub**.
- **Autocompletado NATIVO:** El login utiliza un formulario HTML estándar estructurado para que los gestores de contraseñas de los navegadores (Chrome, Edge, Firefox, Safari) te pregunten si deseas guardar la contraseña y la autocompleten automáticamente en tus próximos accesos.
- **Protección de API:** Todos los endpoints de datos de la plataforma (`/api/data`, `/api/upload`, `/api/sync`, `/api/config`) están protegidos. Requieren un token en los encabezados HTTP (`X-Access-Token`) que coincide con tu clave.

---

## 📂 Carpeta de Datos y Persistencia (`data/`)

La aplicación guarda todo su estado de manera persistente en la carpeta `data/` dentro del proyecto:
- **`data/revisor.db`:** Base de datos SQLite local. Guarda comentarios, progresos e información consolidada al instante.
- **`data/template_participantes.xlsx`:** La plantilla del último Excel que subiste, utilizada para regenerar las descargas respetando tus colores y formatos originales.
- **`data/backups/`:** Copias de seguridad automáticas de los archivos Excel anteriores para prevención de pérdidas.

---

## ❓ Preguntas Frecuentes (FAQ) & Guía de Resolución Operativa

Esta guía está diseñada para resolver cualquier duda, error técnico o caso borde que pueda surgir durante la operación diaria de la plataforma de forma autónoma.

### 🔐 1. ¿Cómo funciona la seguridad y cómo cambio la contraseña de acceso?
La plataforma requiere autenticación para que nadie en internet pueda descargar tu Excel ni ver el avance de los participantes. 
- La contraseña por defecto es `cc2026`.
- **Para cambiarla:** Ve a la pestaña **Ajustes Conexión** en la esquina superior derecha del panel web, introduce la nueva clave en el campo correspondiente y presiona "Guardar". El archivo local `config.json` se actualizará de inmediato.
- Al estar configurado en el archivo `.gitignore`, tus credenciales UC y la contraseña de la plataforma nunca se compartirán públicamente si el código se sube a un repositorio.

### 💾 2. ¿Puedo guardar la contraseña en mi navegador para no tener que escribirla siempre?
**Sí.** El formulario de acceso incluye campos estándar y descriptivos de usuario y contraseña. Al ingresar la clave por primera vez y presionar "Ingresar", tu navegador (Chrome, Edge, Safari, Firefox, etc.) detectará el formulario y te mostrará la notificación emergente para **guardar la contraseña**. Si aceptas, se autocompletará sola en el futuro.

### 📥 3. ¿Cómo funciona la descarga segura del Excel corregido?
Los navegadores web no permiten inyectar cabeceras HTTP personalizadas (como `X-Access-Token`) al hacer clic en un enlace de descarga común (`window.location.href`). 
Para solucionar esto de manera segura, la plataforma genera una URL de descarga que incluye la clave de acceso de manera temporal como un parámetro de consulta seguro (query parameter): `/api/download?token=TU_TOKEN`. La API de FastAPI verifica la validez del token antes de entregar el archivo.

### ❌ 4. ¿Qué hago cuando ocurre un error en la plataforma? ¿Cómo uso la Inteligencia Artificial (IA) para solucionarlo?
Si ocurre cualquier error técnico (ej. falla de conexión a la UC, planilla Excel con formato inválido, base de datos bloqueada, etc.), se abrirá un popup interactivo con la información exacta del error:
1. **Selecciona tu Nivel Técnico:** Elige entre **Principiante** (explicaciones sencillas), **Intermedio** (análisis técnico con contexto adicional) o **Avanzado** (detalles técnicos de código).
2. **Copia el Prompt:** Presiona el botón **"Copiar Prompt para IA"**. Esto copiará un texto estructurado que contiene el error exacto junto con una instrucción diseñada profesionalmente para guiar a una IA.
3. **Pégalo en tu IA favorita:** Abre Gemini, ChatGPT o Claude y pega el texto (Ctrl+V).
4. La IA te explicará exactamente qué falló y te dará el paso a paso en español de cómo solucionarlo (por ejemplo: *"revisa si tienes conexión a internet"*, *"comprueba que la columna X en el Excel no tenga espacios en blanco"*, etc.).
5. Si el problema es realmente complejo y requiere un programador, la IA te indicará explícitamente en su respuesta que debes contactar al ingeniero de soporte.

### 🔄 5. Si vuelvo a subir mi Excel base, ¿se pierden los participantes que marqué como "Falso Completado"?
**No.** El clasificador y sincronizador prioriza tus instrucciones explícitas en el Excel base.
- Si un participante figura completado en el servidor UC pero tú sabes que es un falso positivo, solo debes ir a tu Excel de origen y en la columna **`Estado`** escribir **`falso completado`**, **`falso positivo`** o **`no completado`**.
- Al cargar el archivo a la plataforma, el clasificador detectará esta palabra clave y **forzará** su retroceso: no se marcará como completado, su progreso se restablecerá a **`93.8%`** y volverá a la sección de **"Avanzado (Próximo a Terminar)"**.
- Puedes volver a subir el Excel todas las veces que quieras; mientras mantengas ese texto en la columna `Estado`, el sistema siempre respetará tu decisión.

### 📉 6. ¿Cómo corrijo las fechas de inscripción erróneas en los gráficos?
Los gráficos de cohortes semanales agrupan a las familias según la fecha en que se registraron. Si ves barras con fechas extrañas o mal agrupadas:
1. Abre tu Excel base original.
2. Corrige la fecha en la columna **`Fecha de inscripción en el servidor`** o **`Fecha log en app`** para las filas correspondientes.
3. Guarda el Excel y súbelo a la plataforma.
4. El backend recalculará al instante las cohortes y actualizará el gráfico automáticamente sin necesidad de reiniciar la aplicación.

### 📑 7. ¿Se pueden cambiar los nombres de las pestañas en el Excel?
**Sí.** El equipo de diseño o coordinación puede cambiar el nombre de las pestañas en cualquier momento (por ejemplo, pasar de `PARTICIPANTES 2` a `PARTICIPANTES`).
- No necesitas modificar el código del programa.
- Ve a la pestaña **Ajustes Conexión** en la plataforma, actualiza los nombres en los campos "Nombre Pestaña Participantes" y "Nombre Pestaña Contactados", y guarda la configuración. El sistema se adaptará de inmediato al nuevo formato.

### 🧹 8. ¿El Excel descargado contiene hojas basura o de desarrollo interno?
**No.** La descarga está totalmente limpia. El backend toma tu planilla original, actualiza los progresos, los comentarios y los estados directamente en la pestaña correspondiente, y luego **elimina de forma automática cualquier otra pestaña que no corresponda a los participantes** (como hojas de logs temporales). De esta manera, el archivo queda listo para su entrega oficial.

### 🛡️ 9. ¿Se pierden mis comentarios guardados si el servidor se apaga?
**No.** Todos los comentarios que agregas desde la interfaz haciendo clic en la tarjeta de un participante se almacenan en tiempo real en la base de datos SQLite local (`data/revisor.db`). Si el servidor se apaga o la computadora se reinicia, todos los comentarios seguirán allí intactos al volver a abrir la plataforma.

### 🩹 10. ¿Qué pasa si la base de datos local se daña o se borra por error?
El sistema tiene un mecanismo de **auto-recuperación automática**. Si el archivo `data/revisor.db` se corrompe o se elimina:
1. Al iniciar la plataforma, esta buscará el último Excel guardado en `data/template_participantes.xlsx`.
2. Reconstruirá de manera transparente la base de datos local importando todos los registros de ese Excel.
3. Se restaurará el dashboard y los datos sin pérdida de información de avance, utilizando la información del Excel como fuente de verdad.

### ☁️ 11. ¿Cómo despliego (hago deploy) de esta plataforma en internet gratis?

Dado que este proyecto almacena datos de forma persistente, los servicios de hosting estáticos sin disco persistente (como Vercel) borrarían los comentarios cada vez que el servidor entre en suspensión. 

Para resolver esto a costo **$0 USD**, el proyecto utiliza una **Arquitectura Híbrida**: la aplicación web se aloja en **Render.com** (plan gratuito) y la persistencia se delega a **Neon.tech** (PostgreSQL gratuito de por vida), encriptando los archivos con AES-256-GCM antes de respaldarlos.

#### Pasos para el Despliegue:

1. **Crear base de datos en Neon.tech:**
   - Regístrate gratis en [Neon](https://neon.tech/).
   - Crea un nuevo proyecto y copia la URL de conexión de PostgreSQL (ej. `postgresql://usuario:password@ep-host.region.aws.neon.tech/neondb?sslmode=require`).

2. **Crear la aplicación en Render.com:**
   - Regístrate gratis en [Render](https://render.com/).
   - Crea un nuevo **Web Service** y conéctalo a tu repositorio de GitHub.
   - Selecciona el entorno de ejecución **Docker** (Render detectará automáticamente el `Dockerfile` del proyecto).
   - Asegúrate de configurar la región más cercana a tus usuarios.

3. **Configurar Variables de Entorno en Render:**
   En la pestaña *Environment* de Render, añade las siguientes variables:
   - `DATABASE_URL`: La URL de conexión de Neon obtenida en el paso 1.
   - `SECRET_KEY`: Una clave aleatoria segura de 32 bytes codificada en Base64 para encriptar los datos de participantes (puedes generarla con `openssl rand -base64 32`).
   - `WEB_ACCESS_PASSWORD`: La contraseña para acceder al panel web (ej. `cc2026`).

4. **Especificar un solo Worker en el arranque:**
   - Asegúrate de que el comando de ejecución sea exactamente:
     ```bash
     uvicorn app:app --workers 1 --host 0.0.0.0 --port $PORT
     ```
   - Esto evita problemas de concurrencia y mantiene la coherencia de datos.

---

> [!IMPORTANT]
> **⚠️ Control de Compute Hours (Neon Free Tier):**
> La aplicación realiza una consulta rápida de warm-up (`SELECT 1`) cada 15 segundos mientras la pestaña del panel web esté abierta para mantener la conexión activa y evitar latencias en las escrituras del operador. 
> **Cerrar la pestaña al finalizar la jornada preserva las compute hours del free tier** (evitando que la base de datos se mantenga encendida innecesariamente cuando nadie está trabajando).

