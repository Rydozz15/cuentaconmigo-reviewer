# Revisor Cuenta Conmigo

Plataforma web integrada para el monitoreo y seguimiento operativo del programa **Cuenta Conmigo**. Este sistema consolida la información de participantes desde planillas Excel, sincroniza en tiempo real los logs de avance desde un servidor remoto UC y provee métricas visuales interactivas de embudos (funnel) y análisis de cohortes semanales.

---

## Características Principales

- **Dashboard Interactivo:** Vista por defecto que presenta el análisis de cohortes y el embudo de avance del programa.
- **Sincronización Inteligente:** Consulta automática en segundo plano con el servidor de la UC con controles de cooldown para evitar sobrecargar los servicios remotos.
- **Persistencia Híbrida y Cifrada:** Almacenamiento local mediante SQLite y respaldo seguro en la nube utilizando PostgreSQL con cifrado local AES-256-GCM para asegurar la privacidad de los datos personales.
- **Diagnóstico Asistido por IA:** Ventana interactiva que genera prompts específicos y estructurados según el nivel técnico del usuario para resolver anomalías del sistema mediante herramientas de Inteligencia Artificial.

---

## Configuración y Ejecución Local

Para ejecutar la aplicación en un entorno local, siga estos pasos:

1. Abra una terminal en la raíz del proyecto.
2. Ejecute el script de inicio automatizado:
   ```bash
   ./ejecutar.sh
   ```
   Este script inicializa el entorno virtual de Python (`venv`), instala las dependencias necesarias y arranca el servidor web local en `http://127.0.0.1:8000`, abriendo automáticamente la interfaz en su navegador web predeterminado.

> [!NOTE]
> Es necesario mantener la ventana de la terminal abierta mientras se utiliza la plataforma, ya que el servicio FastAPI se ejecuta en primer plano.

---

## Arquitectura de Datos y Sincronización

### 1. Bucle de Sincronización en Segundo Plano
Al iniciar, la plataforma activa una tarea de sincronización periódica en segundo plano:
- **Arranque inicial:** Realiza la primera sincronización 10 segundos después de iniciar la aplicación.
- **Cooldown de prevención:** Limita las sincronizaciones automáticas a un intervalo mínimo de **3 horas** (10,800 segundos) desde la última sincronización exitosa, evitando sobrecargar o spamear el servidor de la UC.
- **Ciclo periódico:** Evalúa la necesidad de sincronización cada 15 minutos. En caso de error de red o de servicio remoto, reintenta automáticamente a los 60 segundos.

### 2. Respaldo Híbrido de Datos
La persistencia de la información está estructurada en dos niveles:
- **Nivel Local (SQLite):** Guarda comentarios, progresos y configuraciones en `data/revisor.db`. Adicionalmente, almacena copias de seguridad de las planillas subidas en `data/backups/` y mantiene la última plantilla Excel de referencia en `data/template_participantes.xlsx`.
- **Nivel de Nube (PostgreSQL):** Si se configura la base de datos en la nube (Neon.tech), los archivos críticos SQLite, la configuración y el template Excel se cifran localmente mediante **AES-256-GCM** y se respaldan en la base de datos remota en cada cambio.

### 3. Mecanismo de Auto-recuperación
Si la base de datos local SQLite se corrompe o elimina, el backend restaura de forma transparente el estado operativo procesando el último Excel guardado en `data/template_participantes.xlsx`, reconstruyendo la estructura interna sin pérdida de información de avance.

---

## Seguridad y Control de Acceso

- **Autenticación por Contraseña:** El portal web requiere autenticación. Por defecto, la contraseña configurada es `cc2026` (se puede modificar desde la interfaz en Ajustes).
- **Autocompletado Nativo:** El login está implementado utilizando un formulario HTML5 estándar compatible con gestores de contraseñas de navegadores modernos (Chrome, Firefox, Edge, Safari) para permitir el guardado seguro y llenado automático.
- **Protección de API:** Todos los endpoints internos (`/api/data`, `/api/upload`, `/api/sync`, `/api/config`) están protegidos y requieren que la petición HTTP incluya la cabecera `X-Access-Token` con la contraseña como token de validación.

---

## Preguntas Frecuentes (FAQ) y Guía Operativa

Esta sección describe la resolución autónoma de dudas técnicas y operativas comunes que puedan presentarse durante el uso diario.

### 1. ¿Cómo cambio la contraseña de acceso y mantengo el sistema seguro?
La contraseña por defecto es `cc2026`. Para modificarla:
1. Vaya a la pestaña **Ajustes Conexión** en el panel web.
2. Ingrese la nueva clave de acceso en el campo de contraseña de la plataforma y guarde los cambios.
3. Esto actualizará localmente el archivo `config.json`. Este archivo se encuentra bajo el control de `.gitignore` para asegurar que las credenciales de la UC y del sitio web nunca se publiquen en repositorios públicos de Git.

### 2. ¿Es posible almacenar la contraseña en el navegador?
Sí. El formulario de ingreso utiliza estándares de accesibilidad y nombres de campo explícitos (`username` y `password`). Tras ingresar la clave y presionar "Ingresar", el navegador mostrará la solicitud nativa para recordar o almacenar la contraseña.

### 3. ¿Cómo funciona la descarga segura del Excel corregido?
Los navegadores web no admiten de forma nativa cabeceras personalizadas de autorización al ejecutar redirecciones directas de descarga de archivos. Para asegurar que solo usuarios autenticados descarguen el reporte, el backend genera una URL temporal con un token de sesión seguro como parámetro de consulta: `/api/download?token=TOKEN_DE_ACCESO`. El endpoint valida este token en el servidor antes de autorizar la entrega de la planilla.

### 4. ¿Cómo utilizo la Inteligencia Artificial para resolver errores operativos?
Cuando el sistema detecta un error de formato, problemas de red con la UC o bases de datos bloqueadas, despliega un modal emergente interactivo:
1. **Seleccione el nivel técnico:** Elija entre **Principiante** (explicaciones simples y descriptivas), **Intermedio** (análisis funcional) o **Avanzado** (diagnóstico detallado a nivel de código).
2. **Copie el Prompt:** Presione el botón **"Copiar Prompt para IA"** para guardar una instrucción de resolución estructurada en su portapapeles.
3. **Péguelo en la IA:** Abra su modelo favorito (Gemini, ChatGPT, Claude) y pegue el prompt. La IA analizará el error y le guiará paso a paso para resolver la anomalía en español.

### 5. Si vuelvo a subir mi planilla Excel base, ¿perderé los participantes marcados como "Falso Completado"?
No. La plataforma prioriza los estados configurados de forma manual por el operador en el Excel de entrada. Si un participante figura como completado en el servidor UC, pero usted define en la columna `Estado` de la planilla original los términos `falso completado`, `falso positivo` o `no completado`, el sistema ignorará el registro de completado de la UC, mantendrá el progreso en `93.8%` y lo ubicará de nuevo en la categoría de participantes pendientes ("Avanzado - Próximo a Terminar").

### 6. ¿Cómo se corrigen las fechas erróneas de inscripción de las cohortes?
Los gráficos del Dashboard agrupan y estructuran las cohortes de acuerdo con los campos de fechas presentes en el Excel (`Fecha de inscripción en el servidor` o `Fecha log en app`). Para corregir cohortes con fechas incorrectas, modifique la fecha en la celda respectiva de su archivo Excel base y vuelva a cargarlo en la plataforma. El backend recalculará y actualizará el dashboard automáticamente.

### 7. ¿Es factible cambiar los nombres de las pestañas en el Excel?
Sí. En caso de que se actualice la estructura o nombres de las pestañas en el libro de Excel (por ejemplo, renombrar `PARTICIPANTES 2` a `PARTICIPANTES`), diríjase a la pestaña **Ajustes Conexión** y actualice los campos correspondientes con los nuevos nombres de pestaña. El sistema se adaptará al instante sin requerir cambios de programación.

### 8. ¿El archivo Excel descargado contiene datos temporales u hojas de prueba?
No. Antes de despachar la descarga, el backend filtra los datos y elimina de forma automática cualquier hoja de cálculo que no corresponda al formato oficial de participantes (como logs transitorios o páginas de depuración), garantizando que el documento esté limpio y listo para entrega ejecutiva.

### 9. ¿Se conservan los comentarios si el servidor de la plataforma se apaga?
Sí. Los comentarios añadidos desde la interfaz a las tarjetas de los participantes se guardan inmediatamente en la base de datos local SQLite (`data/revisor.db`) y se replican en el almacenamiento PostgreSQL remoto si está activo. Al reiniciar la aplicación o encender el servidor, todos los comentarios se mantendrán intactos.

### 10. ¿Cómo restauro la plataforma si la base de datos local se elimina o daña?
El sistema incluye recuperación pasiva. Si el archivo `data/revisor.db` se destruye, la plataforma identificará en el siguiente arranque la última planilla Excel válida respaldada en `data/template_participantes.xlsx` y la utilizará para reconstruir completamente el estado y los comentarios agregados hasta el último respaldo.

### 11. ¿Cómo realizo el despliegue (deploy) del proyecto en la nube de forma gratuita?
Dado que los servicios de hosting gratuitos tradicionales (como Render o Heroku) suspenden los contenedores tras periodos de inactividad destruyendo sus archivos locales, esta plataforma utiliza una **arquitectura híbrida**: la ejecución de la app se aloja en Render y la base de datos persistente se delega a Neon.tech (PostgreSQL gratuito de por vida con cifrado local AES-256-GCM para proteger los datos en reposo).

#### Pasos para Despliegue:
1. **Crear BD en Neon:** Regístrese de forma gratuita en [Neon](https://neon.tech/) y cree una base de datos. Copie su cadena de conexión (URL de conexión).
2. **Crear Web Service en Render:** Cree un servicio web en [Render](https://render.com/), vincule su repositorio de GitHub y elija el entorno **Docker** (detectará de manera automática el `Dockerfile`).
3. **Configurar Variables de Entorno en Render:**
   - `DATABASE_URL`: La URL de conexión copiada de Neon.
   - `SECRET_KEY`: Una clave aleatoria segura de 32 bytes en formato Base64 para el cifrado de datos (puede generarla con `openssl rand -base64 32`).
   - `WEB_ACCESS_PASSWORD`: La contraseña deseada para proteger el acceso web de la aplicación.
   - `TZ`: Configurar en `America/Santiago` (o la zona horaria local correspondiente). Esto es crítico para asegurar que los registros de fechas y las cohortes no sufran desfases horarios respecto a la hora oficial de Chile.
4. **Restricción de Ejecución:** Asegúrese de definir el comando de arranque de la aplicación con un único worker de Uvicorn para prevenir inconsistencias de escritura concurrente:
   ```bash
   uvicorn app:app --workers 1 --host 0.0.0.0 --port $PORT
   ```

> [!TIP]
> **Tolerancia a Cold Start:** Debido a que el tier gratuito de Neon suspende la base de datos tras periodos de inactividad, el backend de la plataforma está configurado para reintentar pacientemente la conexión hasta 15 veces (esperando 3 segundos entre intentos, sumando un total de 45 segundos) durante el inicio del servidor web. Esto permite dar tiempo a que Neon complete su proceso de arranque ("cold start") y se descarguen exitosamente los respaldos cifrados antes de servir la interfaz al usuario.

### 12. ¿Cómo evito consumir en exceso la cuota gratuita de Neon (Free Tier)?
Para mantener el canal activo con PostgreSQL y evitar demoras de conexión, el portal web ejecuta pings de mantenimiento (`SELECT 1`) automáticos cada 15 segundos mientras mantenga abierta la interfaz web. **Se recomienda cerrar la pestaña de la aplicación en el navegador al terminar la jornada de trabajo**. Esto detendrá las peticiones web y permitirá que la base de datos de Neon entre en suspensión, preservando así las horas de cómputo mensuales gratuitas de su plan.
