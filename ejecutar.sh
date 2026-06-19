#!/bin/bash
# Navegar al directorio de este script
cd "$(dirname "$0")"

echo "========================================================="
echo "   Iniciando Plataforma Web Cuenta Conmigo..."
echo "   Por favor, no cierres esta ventana."
echo "========================================================="
echo ""

# Abrir el navegador en segundo plano tras 2 segundos para permitir que el servidor inicie
(sleep 2 && xdg-open http://127.0.0.1:8000) &

# Ejecutar el servidor FastAPI usando el entorno virtual local
./venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8000
