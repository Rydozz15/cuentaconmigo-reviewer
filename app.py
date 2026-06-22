import os
import json
import shutil
import sqlite3
import asyncio
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import hashlib
import time
import psycopg2
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import io
import logging
from starlette.background import BackgroundTask

logging.basicConfig(level=logging.INFO)

DATETIME_FORMAT = "%d-%m-%Y %H:%M:%S"

def cleanup_temp_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
            print(f"[EXCEL] Archivo temporal eliminado: {path}")
    except Exception as e:
        print(f"[EXCEL] Error al eliminar archivo temporal: {e}")

# Importar módulos locales
from scraper import descargar_reporte_logs
from logic import (
    procesar_datos_completos,
    guardar_archivo_final,
    status_map,
    calcular_progreso,
    extraer_seccion,
    ETIQUETAS_SECCION,
    SECUENCIA_PANTALLAS,
    parsear_timestamp,
    parsear_fecha_inscripcion
)

app = FastAPI(title="Plataforma Cuenta Conmigo", version="1.0")

# Habilitar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configurar directorios
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_DIR = os.path.join(BASE_DIR, "data")
BACKUPS_DIR = os.path.join(DATA_DIR, "backups")
TEMP_DIR = "/tmp"  # Render tiene /tmp disponible para escritura efímera

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(BACKUPS_DIR, exist_ok=True)

# Estado Global en Memoria
class AppState:
    df_processed = None       # DataFrame integrado con logs y comentarios
    df_original = None        # DataFrame original antes de procesar
    df_contactados = None     # DataFrame CONTACTADOS
    nuevos_pendientes = []    # Lista de participantes aptos no agregados
    fecha_sincronizacion = None
    archivo_plantilla_path = None # Ruta persistente de la plantilla Excel
    last_cloud_sync_time = None
    last_cloud_sync_status = "idle"  # idle, success, failed, connection_failed

state = AppState()

# 🔐 CRIPTOGRAFÍA AES-256-GCM Y PERSISTENCIA CLOUD
def encrypt_data(data: bytes, secret_key_b64: str) -> bytes:
    key = base64.b64decode(secret_key_b64)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, data, None)
    return nonce + ciphertext

def decrypt_data(encrypted_data: bytes, secret_key_b64: str) -> bytes:
    key = base64.b64decode(secret_key_b64)
    aesgcm = AESGCM(key)
    nonce = encrypted_data[:12]
    ciphertext = encrypted_data[12:]
    return aesgcm.decrypt(nonce, ciphertext, None)

_secret_key_warned = False

def get_secret_key():
    global _secret_key_warned
    sk = os.environ.get("SECRET_KEY")
    if sk:
        return sk
    if not _secret_key_warned:
        logging.warning("[SECURITY] Variable de entorno SECRET_KEY no configurada. Se usará una clave secreta predeterminada (no segura para producción).")
        _secret_key_warned = True
    derived_bytes = hashlib.sha256(b"cc2026_default_secret_seed_salt_2026").digest()
    return base64.b64encode(derived_bytes).decode("utf-8")

def get_postgres_conn():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return None
    return psycopg2.connect(db_url, connect_timeout=5)

def init_postgres_db():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return
    
    print("[CLOUD-DB] Inicializando base de datos Postgres (esperando cold start si aplica)...")
    conn = None
    for attempt in range(15):  # 15 intentos de 3 segundos = 45 segundos max de espera
        try:
            conn = get_postgres_conn()
            if conn:
                break
        except Exception as e:
            print(f"[CLOUD-DB] Conexión de inicialización fallida (intento {attempt + 1}/15): {e}")
            time.sleep(3)
            
    if not conn:
        print("[CLOUD-DB] No se pudo establecer conexión con Postgres para inicializar la tabla.")
        return
        
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_state (
                    key VARCHAR(255) PRIMARY KEY,
                    content BYTEA,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()
            print("[CLOUD-DB] Tabla app_state inicializada en Postgres.")
    except Exception as e:
        print(f"[CLOUD-DB] Error al inicializar tabla en Postgres: {e}")
    finally:
        conn.close()

def db_push_state():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return
        
    db_path = os.path.join(DATA_DIR, "revisor.db")
    template_path = os.path.join(DATA_DIR, "template_participantes.xlsx")
    config_path = os.path.join(BASE_DIR, "config.json")
    
    db_data = b""
    template_data = b""
    config_data = b""
    
    if os.path.exists(db_path):
        with open(db_path, "rb") as f:
            db_data = f.read()
            
    if os.path.exists(template_path):
        with open(template_path, "rb") as f:
            template_data = f.read()

    if os.path.exists(config_path):
        with open(config_path, "rb") as f:
            config_data = f.read()
            
    if not db_data and not template_data and not config_data:
        print("[CLOUD-DB] No hay archivos locales para respaldar.")
        return
        
    key = get_secret_key()
    
    encrypted_db = encrypt_data(db_data, key) if db_data else None
    encrypted_template = encrypt_data(template_data, key) if template_data else None
    encrypted_config = encrypt_data(config_data, key) if config_data else None
    
    conn = None
    for attempt in range(3):
        try:
            conn = get_postgres_conn()
            if not conn:
                break
            with conn.cursor() as cur:
                if encrypted_db:
                    cur.execute("""
                        INSERT INTO app_state (key, content, updated_at)
                        VALUES ('revisor.db', %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP;
                    """, (psycopg2.Binary(encrypted_db),))
                if encrypted_template:
                    cur.execute("""
                        INSERT INTO app_state (key, content, updated_at)
                        VALUES ('template_participantes.xlsx', %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP;
                    """, (psycopg2.Binary(encrypted_template),))
                if encrypted_config:
                    cur.execute("""
                        INSERT INTO app_state (key, content, updated_at)
                        VALUES ('config.json', %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP;
                    """, (psycopg2.Binary(encrypted_config),))
                conn.commit()
                print("[CLOUD-DB] Respaldo en la nube exitoso.")
                state.last_cloud_sync_time = datetime.now().strftime(DATETIME_FORMAT)
                state.last_cloud_sync_status = "success"
                return
        except Exception as e:
            print(f"[CLOUD-DB] Intento {attempt + 1} de respaldo fallido: {e}")
            state.last_cloud_sync_status = f"failed: {e}"
            time.sleep(2 ** attempt)
        finally:
            if conn:
                conn.close()

def db_pull_state():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return False
        
    print("[CLOUD-DB] Iniciando descarga del estado desde la nube...")
    key = get_secret_key()
    
    conn = None
    for attempt in range(15):  # 15 intentos de 3 segundos = 45 segundos max de espera
        try:
            conn = get_postgres_conn()
            if conn:
                break
        except Exception as e:
            print(f"[CLOUD-DB] Conexión fallida (intento {attempt + 1}/15): {e}")
            time.sleep(3)
            
    if not conn:
        print("[CLOUD-DB] No se pudo establecer conexión con Postgres tras 15 intentos. Arrancando en modo degradado.")
        state.last_cloud_sync_status = "connection_failed"
        return False
        
    try:
        db_content = None
        template_content = None
        config_content = None
        
        with conn.cursor() as cur:
            cur.execute("SELECT key, content FROM app_state WHERE key IN ('revisor.db', 'template_participantes.xlsx', 'config.json');")
            rows = cur.fetchall()
            for row in rows:
                if row[0] == 'revisor.db':
                    db_content = row[1]
                elif row[0] == 'template_participantes.xlsx':
                    template_content = row[1]
                elif row[0] == 'config.json':
                    config_content = row[1]
                    
        os.makedirs(DATA_DIR, exist_ok=True)
        
        decryption_success = True
        
        if db_content:
            try:
                decrypted_db = decrypt_data(bytes(db_content), key)
                db_path = os.path.join(DATA_DIR, "revisor.db")
                with open(db_path, "wb") as f:
                    f.write(decrypted_db)
                print("[CLOUD-DB] revisor.db descargado y desencriptado con éxito.")
            except Exception as decrypt_err:
                print(f"[CLOUD-DB] Error de desencriptación en revisor.db (¿clave secreta incorrecta?): {decrypt_err}")
                decryption_success = False
                
        if template_content:
            try:
                decrypted_template = decrypt_data(bytes(template_content), key)
                template_path = os.path.join(DATA_DIR, "template_participantes.xlsx")
                with open(template_path, "wb") as f:
                    f.write(decrypted_template)
                print("[CLOUD-DB] template_participantes.xlsx descargado y desencriptado con éxito.")
            except Exception as decrypt_err:
                print(f"[CLOUD-DB] Error de desencriptación en template_participantes.xlsx: {decrypt_err}")
                decryption_success = False

        if config_content:
            try:
                decrypted_config = decrypt_data(bytes(config_content), key)
                config_path = os.path.join(BASE_DIR, "config.json")
                with open(config_path, "wb") as f:
                    f.write(decrypted_config)
                print("[CLOUD-DB] config.json descargado y desencriptado con éxito.")
            except Exception as decrypt_err:
                print(f"[CLOUD-DB] Error de desencriptación en config.json: {decrypt_err}")
                decryption_success = False
                
        if not decryption_success:
            state.last_cloud_sync_status = "failed"
            return False
            
        state.last_cloud_sync_time = datetime.now().strftime(DATETIME_FORMAT)
        state.last_cloud_sync_status = "success"
        return True
    except Exception as e:
        print(f"[CLOUD-DB] Error al descargar estado de la nube: {e}")
        state.last_cloud_sync_status = f"failed: {e}"
        return False
    finally:
        if conn:
            conn.close()

# Funciones de persistencia con SQLite y Fallback con Excel
def save_state_to_db():
    if state.df_processed is None:
        return
    db_path = os.path.join(DATA_DIR, "revisor.db")
    conn = sqlite3.connect(db_path, timeout=10.0)
    try:
        state.df_processed.to_sql("df_processed", conn, if_exists="replace", index=False)
        if state.df_original is not None:
            state.df_original.to_sql("df_original", conn, if_exists="replace", index=False)
        if state.df_contactados is not None:
            state.df_contactados.to_sql("df_contactados", conn, if_exists="replace", index=False)
        
        meta = {
            "fecha_sincronizacion": state.fecha_sincronizacion or "",
            "archivo_plantilla_path": state.archivo_plantilla_path or "",
            "nuevos_pendientes_json": json.dumps(state.nuevos_pendientes or [])
        }
        df_meta = pd.DataFrame([meta])
        df_meta.to_sql("metadata", conn, if_exists="replace", index=False)
        print("[DB] Estado guardado en SQLite con éxito.")
    except Exception as e:
        print(f"[DB] Error al guardar en SQLite: {e}")
    finally:
        conn.close()
    db_push_state()

def load_state_from_db():
    db_path = os.path.join(DATA_DIR, "revisor.db")
    if not os.path.exists(db_path):
        print("[DB] Base de datos revisor.db no encontrada.")
        return False
    
    conn = sqlite3.connect(db_path, timeout=10.0)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row[0] for row in cursor.fetchall()]
        
        if "df_processed" in tables:
            state.df_processed = pd.read_sql("SELECT * FROM df_processed", conn)
        if "df_original" in tables:
            state.df_original = pd.read_sql("SELECT * FROM df_original", conn)
        if "df_contactados" in tables:
            state.df_contactados = pd.read_sql("SELECT * FROM df_contactados", conn)
            
        if "metadata" in tables:
            df_meta = pd.read_sql("SELECT * FROM metadata", conn)
            if not df_meta.empty:
                meta = df_meta.iloc[0]
                state.fecha_sincronizacion = meta.get("fecha_sincronizacion") or None
                state.archivo_plantilla_path = meta.get("archivo_plantilla_path") or None
                nuevos_raw = meta.get("nuevos_pendientes_json")
                if nuevos_raw:
                    state.nuevos_pendientes = json.loads(nuevos_raw)
                else:
                    state.nuevos_pendientes = []
        print("[DB] Estado recuperado de SQLite exitosamente.")
        return True
    except Exception as e:
        print(f"[DB] Error al cargar de SQLite: {e}")
        return False
    finally:
        conn.close()

def load_state_from_excel_fallback():
    template_path = os.path.join(DATA_DIR, "template_participantes.xlsx")
    if not os.path.exists(template_path):
        print("[FALLBACK] No hay archivo Excel template_participantes.xlsx para recuperar.")
        return False
    
    cfg = load_config()
    sheet_to_read = cfg.get("sheet_name", "PARTICIPANTES 2")
    contactados_sheet = cfg.get("contactados_sheet_name", "CONTACTADOS")
    
    try:
        print(f"[FALLBACK] Recuperando estado desde Excel: {template_path}")
        xls = pd.ExcelFile(template_path)
        if sheet_to_read not in xls.sheet_names:
            print(f"[FALLBACK] Hoja '{sheet_to_read}' no encontrada.")
            return False
            
        df_p = pd.read_excel(template_path, sheet_name=sheet_to_read, skiprows=2)
        df_p = df_p.dropna(subset=[df_p.columns[0]])
        
        df_c = None
        if contactados_sheet in xls.sheet_names:
            df_c = pd.read_excel(template_path, sheet_name=contactados_sheet, skiprows=13)
            
        state.df_original = df_p.copy()
        state.df_processed = df_p.copy()
        state.df_contactados = df_c.copy() if df_c is not None else None
        state.nuevos_pendientes = []
        state.fecha_sincronizacion = None
        state.archivo_plantilla_path = template_path
        
        save_state_to_db()
        print("[FALLBACK] Estado de emergencia recuperado desde Excel con éxito.")
        return True
    except Exception as e:
        print(f"[FALLBACK] Error al leer desde Excel: {e}")
        return False

# Cargar configuración inicial
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

def load_config():
    defaults = {
        "email": "usuario@uc.cl",
        "password": "",
        "dateFrom": "2026-05-07",
        "sheet_name": "PARTICIPANTES 2",
        "contactados_sheet_name": "CONTACTADOS",
        "web_access_password": "cc2026",
        "login_url": "http://146.155.45.25:4001/api/auth/admin",
        "report_url": "http://146.155.45.25:4001/api/report"
    }
    cfg = defaults.copy()
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                loaded = json.load(f)
                for k, v in loaded.items():
                    cfg[k] = v
        except Exception as e:
            logging.warning(f"Error al cargar el archivo de configuración config.json: {e}")
            
    # Priorizar variable de entorno sobre config.json y defaults
    env_web_pass = os.environ.get("WEB_ACCESS_PASSWORD")
    if env_web_pass:
        cfg["web_access_password"] = env_web_pass
        
    return cfg

def save_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=4)
    db_push_state()

async def auto_sync_loop():
    print("[AUTO-SYNC] Bucle de sincronización automática iniciado.")
    # Espera inicial corta para dar tiempo a que el arranque y la restauración de la base de datos finalicen
    await asyncio.sleep(10)
    while True:
        try:
            if state.archivo_plantilla_path is not None and state.df_processed is not None:
                # Verificar cooldown de 3 horas (10800 segundos) para evitar spam al servidor UC
                if state.fecha_sincronizacion:
                    try:
                        last_sync_dt = datetime.strptime(state.fecha_sincronizacion, DATETIME_FORMAT)
                        if abs((datetime.now() - last_sync_dt).total_seconds()) < 10800:
                            print(f"[AUTO-SYNC] Omitiendo sincronización automática: última actualización exitosa hace menos de 3 horas ({state.fecha_sincronizacion}).")
                            await asyncio.sleep(900)
                            continue
                    except Exception as parse_err:
                        print(f"[AUTO-SYNC] Error al evaluar cooldown de sincronización: {parse_err}")

                cfg = load_config()
                email = cfg.get("email")
                password = cfg.get("password")
                date_from = cfg.get("dateFrom")
                date_to = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
                
                if password:
                    print(f"[AUTO-SYNC] Iniciando sincronización automática para {email}...")
                    # Descargar logs
                    logs_content = descargar_reporte_logs(
                        email=email,
                        password=password,
                        date_from=date_from,
                        date_to=date_to,
                        login_url=cfg.get("login_url"),
                        report_url=cfg.get("report_url")
                    )
                    
                    df_servidor = pd.read_excel(io.BytesIO(logs_content))
                    
                    # Ejecutar procesamiento
                    df_resultado, nuevos_p = procesar_datos_completos(
                        df_participantes=state.df_processed,
                        df_contactados=state.df_contactados,
                        df_servidor=df_servidor
                    )
                    
                    # Actualizar estado global
                    state.df_processed = df_resultado
                    state.nuevos_pendientes = nuevos_p
                    state.fecha_sincronizacion = datetime.now().strftime(DATETIME_FORMAT)
                    
                    # Guardar en SQLite
                    save_state_to_db()
                    print(f"[AUTO-SYNC] Sincronización automática completada con éxito. Actualizados {len(df_resultado)} registros.")
                else:
                    print("[AUTO-SYNC] Sincronización automática omitida: sin contraseña.")
            
            # Esperar 15 minutos (900 segundos) para el próximo ciclo
            await asyncio.sleep(900)
        except Exception as e:
            print(f"[AUTO-SYNC] Error en sincronización automática: {e}")
            # Esperar 60 segundos antes de reintentar si ocurrió un error (ej. caída de red o servidor de la UC caído)
            await asyncio.sleep(60)

@app.on_event("startup")
async def startup_event():
    # 1. Inicializar base de datos Postgres y descargar el estado desde la nube (si aplica)
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        init_postgres_db()
        db_pull_state()
        
    # 2. Intentar cargar desde SQLite, y si no, desde el fallback del Excel
    if not load_state_from_db():
        load_state_from_excel_fallback()
    asyncio.create_task(auto_sync_loop())


# ==============================================================================
# 🎛️ ENDPOINTS DE LA API
# ==============================================================================

def verify_access(x_access_token: str = Header(None)):
    cfg = load_config()
    correct_token = cfg.get("web_access_password", "cc2026")
    if not x_access_token or x_access_token != correct_token:
        raise HTTPException(status_code=401, detail="Acceso denegado. Token de acceso inválido o ausente.")

class LoginSchema(BaseModel):
    username: str = "admin"
    password: str

@app.post("/api/login")
def web_login(data: LoginSchema):
    cfg = load_config()
    correct_password = cfg.get("web_access_password", "cc2026")
    if data.password == correct_password:
        return {"status": "success", "token": correct_password}
    raise HTTPException(status_code=401, detail="Contraseña de acceso incorrecta.")

@app.get("/api/sync-status", dependencies=[Depends(verify_access)])
def get_sync_status():
    # Ping pasivo a Postgres para mantenerlo tibio (warm-up)
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        conn = None
        try:
            conn = get_postgres_conn()
            if conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1;")
        except Exception as e:
            print(f"[CLOUD-DB] Ping de warm-up fallido: {e}")
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
            
    return {
        "last_cloud_sync_time": state.last_cloud_sync_time,
        "last_cloud_sync_status": state.last_cloud_sync_status
    }

@app.post("/api/force-cloud-pull", dependencies=[Depends(verify_access)])
def force_cloud_pull():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise HTTPException(status_code=400, detail="No se ha configurado la variable DATABASE_URL para la persistencia en la nube.")
        
    success = db_pull_state()
    if success:
        if load_state_from_db():
            return {
                "status": "success",
                "message": "Sincronización manual desde la nube exitosa. Datos recargados.",
                "last_cloud_sync_time": state.last_cloud_sync_time
            }
        else:
            raise HTTPException(status_code=500, detail="Base de datos descargada pero falló al cargarse en memoria.")
    else:
        raise HTTPException(status_code=500, detail=f"No se pudo descargar el estado de la nube. Status: {state.last_cloud_sync_status}")


class SyncSchema(BaseModel):
    uc_password: str | None = None

class ConfigSchema(BaseModel):
    email: str
    password: str
    dateFrom: str
    sheetName: str = "PARTICIPANTES 2"
    contactadosSheetName: str = "CONTACTADOS"

@app.get("/api/config", dependencies=[Depends(verify_access)])
def get_config():
    cfg = load_config()
    # Omitir password en la respuesta por seguridad
    return {
        "email": cfg.get("email"),
        "dateFrom": cfg.get("dateFrom"),
        "hasPassword": bool(cfg.get("password")),
        "sheetName": cfg.get("sheet_name", "PARTICIPANTES 2"),
        "contactadosSheetName": cfg.get("contactados_sheet_name", "CONTACTADOS")
    }

@app.post("/api/config", dependencies=[Depends(verify_access)])
def update_config(data: ConfigSchema):
    cfg = load_config()
    cfg["email"] = data.email
    # Solo actualizar password si se envía algo no vacío, por si envían cadena vacía para no sobrescribir
    if data.password:
        cfg["password"] = data.password
    cfg["dateFrom"] = data.dateFrom
    cfg["sheet_name"] = data.sheetName
    cfg["contactados_sheet_name"] = data.contactadosSheetName
    save_config(cfg)
    return {"status": "success", "message": "Configuración guardada correctamente."}

@app.post("/api/upload", dependencies=[Depends(verify_access)])
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Solo se permiten archivos Excel (.xlsx).")
        
    max_size = 50 * 1024 * 1024
    contents = await file.read(max_size + 1)
    if len(contents) > max_size:
        raise HTTPException(status_code=400, detail="El archivo excede el tamaño máximo permitido de 50MB.")
        
    temp_path = os.path.join(TEMP_DIR, f"uploaded_{datetime.now().timestamp()}_{file.filename}")
    with open(temp_path, "wb") as f:
        f.write(contents)
        
    # Obtener configuración de hojas
    cfg = load_config()
    sheet_to_read = cfg.get("sheet_name", "PARTICIPANTES 2")
    contactados_sheet = cfg.get("contactados_sheet_name", "CONTACTADOS")
    
    # Intentar leer pestañas configuradas
    try:
        xls = pd.ExcelFile(temp_path)
        if sheet_to_read not in xls.sheet_names:
            raise Exception(f"No se encontró la pestaña '{sheet_to_read}' en el archivo Excel. Verifica los Ajustes.")
        if contactados_sheet not in xls.sheet_names:
            raise Exception(f"No se encontró la pestaña '{contactados_sheet}' en el archivo Excel. Verifica los Ajustes.")
            
        df_p = pd.read_excel(temp_path, sheet_name=sheet_to_read, skiprows=2)
        df_p = df_p.dropna(subset=[df_p.columns[0]]) # Quitar filas sin ID
        
        df_c = pd.read_excel(temp_path, sheet_name=contactados_sheet, skiprows=13)
        
        # Mapear y respaldar archivo plantilla
        target_template_path = os.path.join(DATA_DIR, "template_participantes.xlsx")
        if os.path.exists(target_template_path):
            backup_1 = os.path.join(BACKUPS_DIR, "template_participantes_backup_1.xlsx")
            backup_2 = os.path.join(BACKUPS_DIR, "template_participantes_backup_2.xlsx")
            if os.path.exists(backup_1):
                shutil.copy(backup_1, backup_2)
            shutil.copy(target_template_path, backup_1)
            
        # Mover archivo a ubicación persistente
        shutil.copy(temp_path, target_template_path)
        state.archivo_plantilla_path = target_template_path
        
        # Guardar en estado en memoria
        state.df_original = df_p.copy()
        state.df_processed = df_p.copy()
        state.df_contactados = df_c.copy()
        state.nuevos_pendientes = []
        state.fecha_sincronizacion = None
        
        # Guardar en base de datos SQLite
        save_state_to_db()
        
        # Limpieza
        if os.path.exists(temp_path):
            os.remove(temp_path)
            
        return {
            "status": "success",
            "message": "Archivo cargado e inicializado exitosamente.",
            "columns": df_p.columns.tolist(),
            "total_records": len(df_p)
        }
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=400, detail=f"Error al leer el archivo Excel: {e}")

@app.post("/api/sync", dependencies=[Depends(verify_access)])
def sync_data(data: SyncSchema = None):
    if state.archivo_plantilla_path is None or state.df_processed is None:
        raise HTTPException(status_code=400, detail="Debe cargar un archivo Excel primero.")
        
    cfg = load_config()
    email = cfg.get("email")
    
    # Priorizar la contraseña enviada en la petición (en memoria) para que no quede guardada en config.json
    password = None
    if data and data.uc_password:
        password = data.uc_password
    else:
        password = cfg.get("password")
        
    date_from = cfg.get("dateFrom")
    date_to = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d") # Fecha de mañana para incluir hoy completo
    
    if not password:
        raise HTTPException(status_code=400, detail="No se ha proporcionado ni configurado la contraseña del servidor UC.")
        
    # Descargar logs
    try:
        logs_content = descargar_reporte_logs(
            email=email,
            password=password,
            date_from=date_from,
            date_to=date_to,
            login_url=cfg.get("login_url"),
            report_url=cfg.get("report_url")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    # Leer el reporte descargado en memoria
    try:
        df_servidor = pd.read_excel(io.BytesIO(logs_content))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al leer archivo de reporte de logs: {e}")
        
    # Ejecutar procesamiento
    try:
        df_resultado, nuevos_p = procesar_datos_completos(
            df_participantes=state.df_processed,
            df_contactados=state.df_contactados,
            df_servidor=df_servidor
        )
        
        # Actualizar estado global
        state.df_processed = df_resultado
        state.nuevos_pendientes = nuevos_p
        state.fecha_sincronizacion = datetime.now().strftime(DATETIME_FORMAT)
        
        # Guardar en base de datos SQLite
        save_state_to_db()
        
        return {
            "status": "success",
            "message": "Sincronización finalizada con éxito.",
            "total_updated": len(df_resultado),
            "nuevos_pendientes_count": len(nuevos_p)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en el cruce de datos: {e}")

@app.get("/api/data", dependencies=[Depends(verify_access)])
def get_processed_data():
    if state.df_processed is None:
        return {"status": "empty", "message": "No hay datos cargados."}
        
    df = state.df_processed.copy()
    
    # Formatear nans a None para salida JSON limpia
    df = df.replace({np.nan: None})
    
    # 1. Armar datos de participantes
    records = []
    for idx, row in df.iterrows():
        # Calcular semanas desde inscripción
        fecha_ins = row.get("Fecha de inscripción en el servidor")
        semanas_ins = None
        fecha_ins_dt = None
        if pd.notna(fecha_ins) and fecha_ins != "":
            try:
                fecha_ins_dt = parsear_fecha_inscripcion(fecha_ins)
                if fecha_ins_dt is not None:
                    dias = (datetime.now() - fecha_ins_dt).days
                    semanas_ins = max(0, dias // 7)
            except Exception as e:
                print(f"Error parsing FechaInscripcion for weeks: {e}")

        # Buscamos columnas seguras
        records.append({
            "ID": str(row.get("ID", "")).replace(".0", ""),
            "Colegio": row.get("Colegio"),
            "Nombre": f"{row.get('Nombre adulto', '')} {row.get('1er apellido adulto', '')}".strip(),
            "Telefono": row.get("Teléfono"),
            "FechaInscripcion": fecha_ins_dt.strftime('%Y-%m-%d') if fecha_ins_dt else None,
            "FechaLog": str(row.get("Fecha log en app"))[:10] if row.get("Fecha log en app") else None,
            "FechaEsperada": str(row.get("Fecha Esperada Finalización"))[:10] if row.get("Fecha Esperada Finalización") else None,
            "FechaFinal": str(row.get("Fecha Finalización Real"))[:10] if row.get("Fecha Finalización Real") else None,
            "PantallaActual": row.get("Pantalla Actual"),
            "Progreso": round(float(row.get("% Progreso", 0)), 1) if row.get("% Progreso") else 0.0,
            "DiasUltimoUso": int(row.get("Días desde último uso")) if row.get("Días desde último uso") is not None else None,
            "Estado": row.get("Estado"),
            "Completado": bool(row.get("Completado", False)),
            "StatusClasificado": row.get("Status Clasificado", "Desconocido"),
            "SemanasInscripcion": semanas_ins,
            "Comentarios": row.get("Comentarios", "")
        })
        
    # 2. Distribución del Embudo (Funnel)
    funnel_counts = {}
    for label in sorted(status_map.values()):
        count = int((df['Status Ordenado'] == label).sum())
        funnel_counts[label] = count
        
    # 3. Distribución por Sección
    seccion_counts = {}
    df_activos = df[df['Status Clasificado'].astype(str).str.contains('En Progreso|Libro|Llamar')].copy()
    if not df_activos.empty:
        df_activos['Sección'] = df_activos['Pantalla Actual'].apply(extraer_seccion)
        counts = df_activos['Sección'].value_counts()
        for sec in SECUENCIA_PANTALLAS:
            label = ETIQUETAS_SECCION.get(sec, sec)
            seccion_counts[label] = int(counts.get(sec, 0))
            
    # 4. Estadísticas de Colegios
    colegio_data = []
    df['Completado_Num'] = df['Completado'].apply(lambda x: 1.0 if x == True else 0.0)
    if 'Colegio' in df.columns:
        colegio_stats = df.groupby('Colegio').agg(
            Total=('ID', 'count'),
            Completados=('Completado_Num', 'sum')
        )
        for col_name, row_col in colegio_stats.iterrows():
            total = int(row_col['Total'])
            comp = int(row_col['Completados'])
            colegio_data.append({
                "colegio": col_name,
                "total": total,
                "completados": comp,
                "pendientes": total - comp,
                "pct": round(comp / total * 100, 1) if total > 0 else 0
            })
            
    # 5. Listas de Seguimiento (Llamadas)
    atrasados = [r for r in records if r["StatusClasificado"] == 'En Progreso - Atrasado']
    no_descargan = [r for r in records if r["StatusClasificado"] == 'Notificado - No Descarga App']
    completados_confirmar = [r for r in records if r["StatusClasificado"] in ['Completado', 'En Progreso - Próximo a Terminar (Avanzado)']]
    
    return {
        "status": "success",
        "fecha_sincronizacion": state.fecha_sincronizacion,
        "nuevos_pendientes": state.nuevos_pendientes,
        "funnel": funnel_counts,
        "secciones": seccion_counts,
        "colegios": colegio_data,
        "records": records,
        "llamadas": {
            "atrasados": atrasados,
            "no_descargan": no_descargan,
            "completados_confirmar": completados_confirmar
        }
    }

class UpdateCommentSchema(BaseModel):
    id: str
    comment: str

@app.post("/api/update-comment", dependencies=[Depends(verify_access)])
def update_comment(data: UpdateCommentSchema):
    if state.df_processed is None:
        raise HTTPException(status_code=400, detail="No hay datos cargados.")
        
    df = state.df_processed
    # Buscar participante por ID
    idx_list = df[df.iloc[:, 0].astype(str).str.strip().replace('.0','') == data.id].index
    if len(idx_list) == 0:
        raise HTTPException(status_code=404, detail="Participante no encontrado.")
        
    df.at[idx_list[0], 'Comentarios'] = data.comment
    
    # Guardar en SQLite
    save_state_to_db()
    return {"status": "success", "message": "Comentario guardado correctamente en base de datos."}

@app.get("/api/download")
def download_excel(token: str = None):
    cfg = load_config()
    correct_token = cfg.get("web_access_password", "cc2026")
    if not token or token != correct_token:
        raise HTTPException(status_code=401, detail="Acceso denegado. Token de acceso inválido o ausente.")
    if state.df_processed is None or state.archivo_plantilla_path is None:
        raise HTTPException(status_code=400, detail="No hay datos procesados para descargar.")
        
    output_filename = f"PARTICIPANTES_FINAL_{datetime.now().strftime('%d-%m-%Y')}.xlsx"
    output_path = os.path.join(TEMP_DIR, output_filename)
    
    try:
        # Dropear columnas temporales antes de guardar
        df_export = state.df_processed.copy()
        
        if 'Status Ordenado' in df_export.columns:
            df_export['Status Clasificado'] = df_export['Status Ordenado']
            if 'Etapa del Embudo' in df_export.columns:
                df_export['Etapa del Embudo'] = df_export['Status Ordenado']
                
        columnas_drop = ['Status Ordenado', 'Completado_Num', 'tel_match']
        df_export = df_export.drop(columns=[col for col in columnas_drop if col in df_export.columns])
        
        # Obtener configuración de hojas
        cfg = load_config()
        sheet_name = cfg.get("sheet_name", "PARTICIPANTES 2")
        
        # Guardar preservando estilos y dejando solo la pestaña de participantes
        guardar_archivo_final(
            ruta_plantilla=state.archivo_plantilla_path,
            ruta_salida=output_path,
            df_datos=df_export,
            df_original=state.df_original,
            sheet_name=sheet_name,
            keep_only_target_sheet=True
        )
        
        # Respaldar el Excel generado en backups históricos
        try:
            backup_filename = f"PARTICIPANTES_FINAL_{datetime.now().strftime('%Y-%m-%d_%H%M%S')}.xlsx"
            backup_path = os.path.join(BACKUPS_DIR, backup_filename)
            shutil.copy(output_path, backup_path)
            print(f"[EXCEL] Respaldo histórico creado: {backup_filename}")
        except Exception as e:
            print(f"[EXCEL] Error al crear respaldo histórico: {e}")
            
        return FileResponse(
            path=output_path,
            filename=output_filename,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            background=BackgroundTask(cleanup_temp_file, output_path)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar archivo Excel: {e}")

# ==============================================================================
# 📄 SERVIR PÁGINAS ESTÁTICAS
# ==============================================================================

@app.get("/")
def get_index():
    index_path = os.path.join(TEMPLATES_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Error: templates/index.html no encontrado.</h1>", status_code=404)

# Montar archivos estáticos
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
