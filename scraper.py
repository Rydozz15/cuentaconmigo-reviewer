import requests
import json
import os
from datetime import datetime

def descargar_reporte_logs(email, password, date_from, date_to, login_url=None, report_url=None):
    """
    Se conecta al servidor de la UC, se autentica y descarga el reporte
    de logs en formato binario (Excel) para el rango de fechas especificado.
    """
    if not login_url:
        login_url = "http://146.155.45.25:4001/api/auth/admin"
    if not report_url:
        report_url = "http://146.155.45.25:4001/api/report"
        
    print(f"🔐 Intentando autenticación en: {login_url}")
    payload = {
        "email": email,
        "password": password
    }
    
    try:
        response = requests.post(login_url, json=payload, headers={"Content-Type": "application/json"}, timeout=15)
        if response.status_code != 200:
            raise Exception(f"Error en autenticación: Código {response.status_code}. Detalle: {response.text}")
        
        data = response.json()
        token = data.get("token") or data.get("authToken")
        if not token:
            raise Exception("No se encontró el token de autenticación en la respuesta del servidor.")
            
        print("✅ Autenticación exitosa. Descargando reporte...")
        
        # Formatear parámetros
        params = {
            "dateFrom": date_from,
            "dateTo": date_to
        }
        
        headers = {
            "Authorization": f"Bearer {token}"
        }
        
        # Realizar GET del reporte
        rep_response = requests.get(report_url, params=params, headers=headers, timeout=60)
        if rep_response.status_code != 200:
            raise Exception(f"Error al descargar reporte: Código {rep_response.status_code}. Detalle: {rep_response.text}")
            
        print(f"✅ Descarga completada exitosamente. Tamaño: {len(rep_response.content)} bytes.")
        return rep_response.content
        
    except requests.exceptions.RequestException as e:
        raise Exception(f"Error de red al conectar con el servidor UC: {e}")

if __name__ == "__main__":
    # Test local cargando config
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            config = json.load(f)
        
        email = config.get("email")
        password = config.get("password")
        date_from = config.get("dateFrom")
        date_to = datetime.now().strftime("%Y-%m-%d")
        
        if password:
            try:
                content = descargar_reporte_logs(email, password, date_from, date_to)
                with open("test_reporte.xlsx", "wb") as f:
                    f.write(content)
                print("Guardado reporte de prueba en test_reporte.xlsx")
            except Exception as e:
                print(f"Error en test: {e}")
        else:
            print("Password vacío en config.json, omitiendo test de conexión.")
    else:
        print("No se encontró config.json")
