// 🚀 Cuenta Conmigo Web Platform Client-Side Application

let globalData = null; // Almacenará la respuesta de /api/data
let activeTab = 'upload-tab';
let activeCallSubTab = 'late-calls';
let currentParticipantId = null;
let hasSavedUcPassword = false;

// Instancias de gráficos para poder destruirlos antes de volver a dibujar
let funnelChartInstance = null;
let sectionsChartInstance = null;
let cohortsChartInstance = null;
let cohortBreakdownChartInstance = null;

// 🔐 SISTEMA DE AUTENTICACIÓN Y UTILS
async function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem("web_access_password") || "";
    
    // Configurar headers por defecto
    options.headers = options.headers || {};
    if (!(options.body instanceof FormData)) {
        options.headers["Content-Type"] = "application/json";
    }
    options.headers["X-Access-Token"] = token;
    
    const response = await fetch(url, options);
    
    if (response.status === 401) {
        // Token inválido o vencido
        localStorage.removeItem("web_access_password");
        showLoginOverlay();
        throw new Error("Acceso no autorizado o sesión expirada.");
    }
    
    return response;
}

function showLoginOverlay() {
    const overlay = document.getElementById("login-overlay");
    if (overlay) {
        overlay.classList.remove("hidden");
        document.body.classList.add("overflow-hidden");
    }
}

function hideLoginOverlay() {
    const overlay = document.getElementById("login-overlay");
    if (overlay) {
        overlay.classList.add("hidden");
        document.body.classList.remove("overflow-hidden");
    }
}

async function handleWebLogin(event) {
    event.preventDefault();
    const passwordInput = document.getElementById("web-access-password");
    const errorMsg = document.getElementById("login-error-msg");
    const errorText = document.getElementById("login-error-text");
    
    if (!passwordInput) return;
    const password = passwordInput.value;
    
    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ password: password })
        });
        
        const resData = await response.json();
        if (response.ok && resData.status === "success") {
            // Guardar token y ocultar overlay
            localStorage.setItem("web_access_password", resData.token);
            if (errorMsg) errorMsg.classList.add("hidden");
            hideLoginOverlay();
            passwordInput.value = "";
            
            // Cargar datos iniciales
            loadConfig();
            fetchData();
            checkCloudSyncStatus();
        } else {
            if (errorText) errorText.innerText = resData.detail || "Contraseña incorrecta. Inténtalo de nuevo.";
            if (errorMsg) errorMsg.classList.remove("hidden");
        }
    } catch (err) {
        console.error(err);
        if (errorText) errorText.innerText = "Error de conexión con el servidor.";
        if (errorMsg) errorMsg.classList.remove("hidden");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    switchTab('dashboard-tab');
    initDragAndDrop();
    
    const token = localStorage.getItem("web_access_password");
    if (!token) {
        showLoginOverlay();
    } else {
        loadConfig();
        fetchData();
        checkCloudSyncStatus();
    }
    
    // Auto-polling para consultar nuevos datos del servidor cada 2 minutos
    setInterval(() => {
        const hasToken = !!localStorage.getItem("web_access_password");
        if (globalData && hasToken) {
            fetchData();
        }
    }, 120000);

    // Auto-polling para consultar el estado de la nube cada 15 segundos
    setInterval(() => {
        const hasToken = !!localStorage.getItem("web_access_password");
        if (hasToken) {
            checkCloudSyncStatus();
        }
    }, 15000);
});

// ==============================================================================
// 🧭 NAVEGACIÓN ENTRE PESTAÑAS
// ==============================================================================
function switchTab(tabId) {
    activeTab = tabId;
    
    // Ocultar todas las secciones
    document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
    // Mostrar sección activa
    document.getElementById(tabId).classList.remove("hidden");
    
    // Actualizar estilos de botones
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.className = "tab-btn w-full flex items-center px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9]";
    });
    
    const activeBtn = document.getElementById(`btn-${tabId}`);
    if (activeBtn) {
        activeBtn.className = "tab-btn w-full flex items-center px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-[#2563EB] bg-[#EFF6FF] shadow-sm shadow-blue-50/20";
    }

    // Si entramos a dashboard o seguimiento y hay datos, refrescar visualizaciones
    if ((tabId === 'dashboard-tab' || tabId === 'calls-tab' || tabId === 'search-tab') && globalData) {
        renderDashboard();
        renderFollowUpTabs();
        renderFamiliesTable();
    }
}

function switchCallSubTab(subTabId) {
    activeCallSubTab = subTabId;
    
    // Ocultar contenidos de subpestañas
    document.querySelectorAll(".call-subtab-content").forEach(el => el.classList.add("hidden"));
    document.getElementById(`subtab-${subTabId}`).classList.remove("hidden");
    
    // Cambiar estilos de botones
    document.querySelectorAll(".call-subtab-btn").forEach(btn => {
        btn.className = "call-subtab-btn font-semibold text-sm pb-4 text-[#64748B] hover:text-[#0F172A] border-b-2 border-transparent";
    });
    
    const activeBtn = document.getElementById(`btn-${subTabId}`);
    if (activeBtn) {
        activeBtn.className = "call-subtab-btn font-semibold text-sm pb-4 text-blue-600 border-b-2 border-blue-600";
    }
}

// ==============================================================================
// 📤 GESTIÓN DE SUBIDA DE ARCHIVOS (DRAG & DROP)
// ==============================================================================
function initDragAndDrop() {
    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("fileInput");
    
    if (!dropzone || !fileInput) return;
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add("dragover");
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove("dragover");
        }, false);
    });
    
    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) {
            handleFileUpload(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (fileInput.files.length) {
            handleFileUpload(fileInput.files[0]);
        }
    });
}

async function handleFileUpload(file) {
    const filenameSpan = document.getElementById("filename-span");
    const selectedFileDiv = document.getElementById("selected-file");
    const recordsSpan = document.getElementById("records-loaded");
    const actionsCard = document.getElementById("sync-actions-card");
    const syncStatus = document.getElementById("sync-status");
    
    filenameSpan.innerText = file.name;
    selectedFileDiv.classList.remove("hidden");
    
    // Enviar archivo al backend
    const formData = new FormData();
    formData.append("file", file);
    
    addTerminalLog(`Cargando archivo ${file.name} al servidor...`);
    
    try {
        const response = await authenticatedFetch("/api/upload", {
            method: "POST",
            body: formData
        });
        
        const resData = await response.json();
        if (response.ok) {
            recordsSpan.innerText = `${resData.total_records} registros encontrados`;
            actionsCard.classList.remove("hidden");
            syncStatus.innerText = "Excel cargado. Pendiente sincronizar.";
            syncStatus.className = "text-xs font-semibold text-amber-500 mt-1 block";
            addTerminalLog("✓ Archivo subido y validado exitosamente.");
            
            // Cargar datos vacíos iniciales en el cliente
            fetchData();
        } else {
            showErrorIaModal("Error al subir archivo: " + formatErrorMessage(resData.detail));
            addTerminalLog("[ERROR] " + formatErrorMessage(resData.detail));
        }
    } catch (err) {
        console.error(err);
        showErrorIaModal("Ocurrió un error al cargar el archivo al servidor. Verifica que sea un archivo de Excel válido y con las pestañas configuradas según tus Ajustes.");
        addTerminalLog("[ERROR] Falla de conexión al cargar archivo.");
    }
}

// ==============================================================================
// 🔄 SINCRONIZACIÓN CON EL SERVIDOR UC
// ==============================================================================
async function triggerSync() {
    const syncSpinner = document.getElementById("sync-spinner");
    const btnSync = document.getElementById("btn-sync");
    const logBox = document.getElementById("sync-log-box");
    const syncStatus = document.getElementById("sync-status");
    
    // Leer contraseña UC si no está guardada
    let ucPasswordVal = null;
    if (!hasSavedUcPassword) {
        const inputEl = document.getElementById("sync-uc-password");
        if (inputEl) {
            ucPasswordVal = inputEl.value;
        }
        if (!ucPasswordVal) {
            alert("Por favor ingresa la contraseña de la Cuenta UC para sincronizar.");
            return;
        }
    }
    
    logBox.classList.remove("hidden");
    syncSpinner.classList.add("animate-spin");
    btnSync.disabled = true;
    
    addTerminalLog("Conectando con el servidor UC http://146.155.45.25:4001...");
    addTerminalLog("Enviando token de autorización...");
    
    try {
        const response = await authenticatedFetch("/api/sync", {
            method: "POST",
            body: JSON.stringify({
                uc_password: ucPasswordVal
            })
        });
        
        const resData = await response.json();
        if (response.ok) {
            addTerminalLog("✓ Logs de uso descargados exitosamente del servidor.");
            addTerminalLog("✓ Cruce de datos y matching de teléfonos finalizado.");
            addTerminalLog(`[RESULT] Sincronizados ${resData.total_updated} registros.`);
            
            syncStatus.innerText = "✓ Sincronizado";
            syncStatus.className = "text-xs font-semibold text-emerald-500 mt-1 block";
            
            // Obtener el nuevo set de datos completo
            await fetchData();
            addTerminalLog("✓ Interfaz de usuario actualizada con métricas nuevas.");
        } else {
            addTerminalLog("[ERROR] Sincronización fallida: " + formatErrorMessage(resData.detail));
            showErrorIaModal("Error en sincronización con servidor UC: " + formatErrorMessage(resData.detail));
        }
    } catch (err) {
        console.error(err);
        addTerminalLog("[ERROR] Falla de conexión durante el scraping.");
        showErrorIaModal("Ocurrió un error al sincronizar con el servidor UC. Por favor verifica las credenciales en Ajustes o la conexión a internet del servidor.");
    } finally {
        syncSpinner.classList.remove("animate-spin");
        btnSync.disabled = false;
        
        // Limpiar el campo de texto por seguridad
        const inputEl = document.getElementById("sync-uc-password");
        if (inputEl) inputEl.value = "";
    }
}

// ==============================================================================
// 📥 OBTENCIÓN Y RENDERIZACIÓN DE DATOS
// ==============================================================================
async function fetchData() {
    try {
        const response = await authenticatedFetch("/api/data");
        const resData = await response.json();
        
        if (response.ok && resData.status === "success") {
            globalData = resData;
            
            // Actualizar timestamp
            document.getElementById("dash-update-time").innerText = `Última sincronización: ${resData.fecha_sincronizacion || 'Solo Excel cargado'}`;
            
            // Renderizar vistas
            renderDashboard();
            renderFollowUpTabs();
            renderFamiliesTable();
            populateFilters();
            
            // Si ya hay datos cargados, mostrar los botones de sincronización y descarga en la pestaña de Cargar Excel
            const actionsCard = document.getElementById("sync-actions-card");
            const recordsSpan = document.getElementById("records-loaded");
            const syncStatus = document.getElementById("sync-status");
            const filenameSpan = document.getElementById("filename-span");
            const selectedFileDiv = document.getElementById("selected-file");
            
            if (actionsCard && resData.records && resData.records.length > 0) {
                if (recordsSpan) recordsSpan.innerText = `${resData.records.length} registros encontrados`;
                if (actionsCard) actionsCard.classList.remove("hidden");
                if (filenameSpan) filenameSpan.innerText = "Participantes.xlsx (Restaurado desde base de datos)";
                if (selectedFileDiv) selectedFileDiv.classList.remove("hidden");
                if (syncStatus) {
                    if (resData.fecha_sincronizacion) {
                        syncStatus.innerText = `Última sincronización: ${resData.fecha_sincronizacion}`;
                        syncStatus.className = "text-xs font-semibold text-emerald-500 mt-1 block";
                    } else {
                        syncStatus.innerText = "Excel cargado. Pendiente sincronizar.";
                        syncStatus.className = "text-xs font-semibold text-amber-500 mt-1 block";
                    }
                }
            }
        }
    } catch (err) {
        console.error("Error al obtener datos:", err);
    }
}

function renderDashboard() {
    if (!globalData) return;
    
    // 1. Métricas rápidas
    const total = globalData.records.length;
    const completed = globalData.records.filter(r => r.Completado).length;
    const active = globalData.records.filter(r => r.FechaLog && !r.Completado).length;
    const late = globalData.records.filter(r => r.StatusClasificado === 'En Progreso - Atrasado').length;
    
    document.getElementById("metric-total").innerText = total;
    document.getElementById("metric-completed").innerText = completed;
    document.getElementById("metric-active").innerText = active;
    document.getElementById("metric-late").innerText = late;
    
    // 2. Gráfico del Embudo (Funnel)
    const funnelLabels = Object.keys(globalData.funnel);
    const funnelValues = Object.values(globalData.funnel);
    
    if (funnelChartInstance) funnelChartInstance.destroy();
    const ctxFunnel = document.getElementById("funnelChart").getContext("2d");
    funnelChartInstance = new Chart(ctxFunnel, {
        type: 'bar',
        data: {
            labels: funnelLabels.map(l => l.substring(3)), // Quitar prefijo "1. "
            datasets: [{
                label: 'Cantidad de Familias',
                data: funnelValues,
                backgroundColor: 'rgba(59, 130, 246, 0.85)',
                borderColor: 'rgb(37, 99, 235)',
                borderWidth: 1,
                borderRadius: 8,
                barThickness: 24
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { display: false }, ticks: { stepSize: 1 } },
                y: { grid: { display: false } }
            }
        }
    });
    
    // 3. Gráfico de Secciones del libro
    const sectionLabels = Object.keys(globalData.secciones);
    const sectionValues = Object.values(globalData.secciones);
    
    if (sectionsChartInstance) sectionsChartInstance.destroy();
    const ctxSections = document.getElementById("sectionsChart").getContext("2d");
    sectionsChartInstance = new Chart(ctxSections, {
        type: 'bar',
        data: {
            labels: sectionLabels,
            datasets: [{
                label: 'Participantes Activos',
                data: sectionValues,
                backgroundColor: sectionLabels.map(l => l.includes('L1') ? 'rgba(30, 41, 59, 0.8)' : 'rgba(249, 115, 22, 0.8)'),
                borderColor: sectionLabels.map(l => l.includes('L1') ? '#0F172A' : '#EA580C'),
                borderWidth: 1,
                borderRadius: 6,
                barThickness: 16
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { display: false }, ticks: { stepSize: 1 } },
                y: { grid: { display: false } }
            }
        }
    });
    
    // 3b. Gráfico de Cohortes (Semanas desde inscripción)
    const cohortCounts = [0, 0, 0, 0, 0, 0, 0, 0];
    globalData.records.forEach(r => {
        if (r.SemanasInscripcion !== null && r.SemanasInscripcion !== undefined) {
            const w = parseInt(r.SemanasInscripcion);
            if (w >= 7) {
                cohortCounts[7]++;
            } else if (w >= 0) {
                cohortCounts[w]++;
            }
        }
    });

    if (cohortsChartInstance) cohortsChartInstance.destroy();
    const ctxCohorts = document.getElementById("cohortsChart").getContext("2d");
    cohortsChartInstance = new Chart(ctxCohorts, {
        type: 'bar',
        data: {
            labels: [
                'Semana 0 (0-6d)', 
                'Semana 1 (7-13d)', 
                'Semana 2 (14-20d)', 
                'Semana 3 (21-27d)', 
                'Semana 4 (28-34d)', 
                'Semana 5 (35-41d)', 
                'Semana 6 (42-48d)', 
                'Semana 7+ (49d+)'
            ],
            datasets: [{
                label: 'Familias Inscritas',
                data: cohortCounts,
                backgroundColor: 'rgba(99, 102, 241, 0.85)',
                borderColor: 'rgb(79, 70, 229)',
                borderWidth: 1,
                borderRadius: 6,
                barThickness: 24
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { display: false }, ticks: { stepSize: 1 } }
            },
            onClick: (e, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    openCohortModal(index);
                }
            }
        }
    });
    
    // 4. Tabla de colegios
    const colegiosTbody = document.getElementById("colegios-tbody");
    colegiosTbody.innerHTML = "";
    if (globalData.colegios.length === 0) {
        colegiosTbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-[#64748B]">No hay datos por colegio.</td></tr>`;
    } else {
        // Ordenar colegios por % de completados desc
        globalData.colegios.sort((a,b) => b.pct - a.pct).forEach(c => {
            colegiosTbody.innerHTML += `
                <tr class="border-b border-[#F1F5F9]">
                    <td class="p-4 font-semibold text-[#0F172A]">${c.colegio}</td>
                    <td class="p-4 text-center font-medium">${c.total}</td>
                    <td class="p-4 text-center text-emerald-600 font-bold">${c.completados}</td>
                    <td class="p-4 text-center text-[#64748B]">${c.pendientes}</td>
                    <td class="p-4 text-right font-bold text-blue-600">${c.pct}%</td>
                </tr>
            `;
        });
    }
}

// ==============================================================================
// 📞 SEGUIMIENTO TELEFÓNICO (TABS DE LLAMADAS)
// ==============================================================================
function renderFollowUpTabs() {
    if (!globalData) return;
    
    // 1. Alertas de nuevos pendientes de agregar
    const alertsContainer = document.getElementById("alerts-container");
    alertsContainer.innerHTML = "";
    
    if (globalData.nuevos_pendientes.length > 0) {
        globalData.nuevos_pendientes.forEach(p => {
            alertsContainer.innerHTML += `
                <div class="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm animate-fade-in">
                    <div class="flex items-start space-x-4">
                        <div class="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0">
                            <i class='bx bx-user-plus m-auto'></i>
                        </div>
                        <div>
                            <span class="text-[10px] font-bold text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-full uppercase tracking-wider">Apto en Contactados</span>
                            <h4 class="font-bold text-[#0F172A] text-lg mt-1">${p.nombre_adulto} <span class="text-xs text-[#64748B] font-normal">(Niño: ${p.nombre_nino})</span></h4>
                            <p class="text-xs text-[#64748B] mt-0.5">Colegio: <strong>${p.colegio}</strong> | Teléfono: <strong>${p.telefono}</strong> | ID asignado: <strong>${p.id}</strong></p>
                        </div>
                    </div>
                    <div class="bg-white border border-emerald-100 rounded-2xl p-3 flex items-center space-x-2 text-xs text-emerald-800 shadow-sm flex-shrink-0">
                        <i class='bx bx-info-circle text-lg text-emerald-500'></i>
                        <span>Copiar y agregar manualmente a <strong>PARTICIPANTES 2</strong> en Excel Online.</span>
                    </div>
                </div>
            `;
        });
    }
    
    // 2. Contadores de pestañas
    const calls = globalData.llamadas;
    document.getElementById("cnt-late-calls").innerText = calls.atrasados.length;
    document.getElementById("cnt-nodown-calls").innerText = calls.no_descargan.length;
    document.getElementById("cnt-verify-calls").innerText = calls.completados_confirmar.length;
    
    // 3. Renderizar listados de llamadas
    renderCallList('late-calls', calls.atrasados);
    renderCallList('nodown-calls', calls.no_descargan);
    renderCallList('verify-calls', calls.completados_confirmar);
}

function renderCallList(type, list) {
    const container = document.getElementById(`subtab-${type}`);
    container.innerHTML = "";
    
    if (list.length === 0) {
        container.className = "call-subtab-content w-full bg-white border border-[#E2E8F0] rounded-3xl p-12 text-center text-[#64748B]";
        container.innerHTML = `<i class='bx bx-check-circle text-4xl text-emerald-500 block mb-2'></i> Al día. No hay familias en esta lista.`;
        return;
    }
    
    container.className = "call-subtab-content grid grid-cols-1 md:grid-cols-2 gap-6";
    if (activeCallSubTab !== type) {
        container.classList.add("hidden");
    }
    
    list.forEach(p => {
        let badgeColor = "bg-rose-50 text-rose-600";
        if (p.StatusClasificado.includes("Próximo")) badgeColor = "bg-amber-50 text-amber-600";
        if (p.StatusClasificado.includes("Completado")) badgeColor = "bg-emerald-50 text-emerald-600";
        
        container.innerHTML += `
            <div class="bg-white border border-[#E2E8F0] hover:border-[#CBD5E1] rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition-all duration-300">
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">ID: ${p.ID}</span>
                        <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full ${badgeColor}">${p.StatusClasificado}</span>
                    </div>
                    <h4 class="font-outfit font-bold text-lg text-[#0F172A] truncate">${p.Nombre}</h4>
                    <p class="text-xs text-[#64748B] flex items-center">
                        <i class='bx bx-school mr-1'></i> ${p.Colegio}
                    </p>
                    <div class="grid grid-cols-2 gap-2 text-[11px] bg-[#F8FAFC] p-3 rounded-xl border border-[#F1F5F9]">
                        <div>
                            <span class="text-[#64748B] block">Progreso:</span>
                            <span class="font-bold text-[#0F172A]">${p.Progreso}%</span>
                        </div>
                        <div>
                            <span class="text-[#64748B] block">Última pantalla:</span>
                            <span class="font-bold text-[#0F172A] truncate block max-w-[120px]">${p.PantallaActual || 'Ninguna'}</span>
                        </div>
                    </div>
                </div>
                
                <div class="border-t border-[#F1F5F9] pt-4 flex items-center justify-between">
                    <a href="tel:${p.Telefono}" class="flex items-center text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100/80 px-3.5 py-2 rounded-xl transition-all duration-200">
                        <i class='bx bx-phone text-sm mr-1.5'></i> Llamar: ${p.Telefono}
                    </a>
                    <button onclick="openDetailsModal('${p.ID}')" class="flex items-center text-xs font-bold text-[#475569] hover:text-[#0F172A] bg-[#F1F5F9] hover:bg-[#E2E8F0] px-3.5 py-2 rounded-xl transition-all duration-200">
                        <i class='bx bx-edit-alt text-sm mr-1'></i> Bitácora
                    </button>
                </div>
            </div>
        `;
    });
}

// ==============================================================================
// 📋 LISTADO CONSOLIDADO Y FILTROS
// ==============================================================================
function renderFamiliesTable() {
    if (!globalData) return;
    
    const tbody = document.getElementById("families-tbody");
    tbody.innerHTML = "";
    
    if (globalData.records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-[#64748B]">No hay datos de familias cargados.</td></tr>`;
        return;
    }
    
    globalData.records.forEach(p => {
        tbody.innerHTML += `
            <tr class="border-b border-[#F1F5F9]" data-id="${p.ID}" data-name="${p.Nombre.toLowerCase()}" data-phone="${p.Telefono}" data-school="${p.Colegio}" data-status="${p.StatusClasificado}">
                <td class="p-4 font-semibold text-[#64748B]">${p.ID}</td>
                <td class="p-4">
                    <h5 class="font-bold text-[#0F172A]">${p.Nombre}</h5>
                    <span class="text-xs text-[#64748B] block">${p.Colegio}</span>
                </td>
                <td class="p-4 font-medium">${p.Telefono}</td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center space-x-2">
                        <div class="w-12 bg-[#E2E8F0] rounded-full h-1.5 overflow-hidden">
                            <div class="bg-blue-600 h-full" style="width: ${p.Progreso}%"></div>
                        </div>
                        <span class="text-xs font-bold text-[#475569]">${p.Progreso}%</span>
                    </div>
                </td>
                <td class="p-4">
                    <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full ${getBadgeClass(p.StatusClasificado)}">${p.StatusClasificado}</span>
                </td>
                <td class="p-4 font-mono text-xs text-[#475569]">${p.PantallaActual || 'Ninguna'}</td>
                <td class="p-4 text-right">
                    <button onclick="openDetailsModal('${p.ID}')" class="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all duration-200">
                        Ver Ficha
                    </button>
                </td>
            </tr>
        `;
    });
}

function getBadgeClass(status) {
    if (status.includes("Completado")) return "bg-emerald-50 text-emerald-600";
    if (status.includes("Atrasado")) return "bg-rose-50 text-rose-600";
    if (status.includes("Próximo")) return "bg-amber-50 text-amber-600";
    if (status.includes("Error")) return "bg-purple-50 text-purple-600";
    if (status.includes("Rechazo")) return "bg-slate-100 text-slate-600";
    return "bg-blue-50 text-blue-600";
}

function populateFilters() {
    if (!globalData) return;
    
    const filterSchool = document.getElementById("filterSchool");
    const filterStatus = document.getElementById("filterStatus");
    
    const schools = [...new Set(globalData.records.map(r => r.Colegio))].filter(Boolean).sort();
    const statuses = [...new Set(globalData.records.map(r => r.StatusClasificado))].filter(Boolean).sort();
    
    // Guardar selección actual
    const currentSchool = filterSchool.value;
    const currentStatus = filterStatus.value;
    
    filterSchool.innerHTML = '<option value="">Todos los Colegios</option>';
    schools.forEach(s => {
        filterSchool.innerHTML += `<option value="${s}">${s}</option>`;
    });
    
    filterStatus.innerHTML = '<option value="">Todas las Etapas</option>';
    statuses.forEach(s => {
        filterStatus.innerHTML += `<option value="${s}">${s}</option>`;
    });
    
    filterSchool.value = currentSchool;
    filterStatus.value = currentStatus;
}

function filterTable() {
    const searchVal = document.getElementById("searchInput").value.toLowerCase();
    const schoolVal = document.getElementById("filterSchool").value;
    const statusVal = document.getElementById("filterStatus").value;
    
    document.querySelectorAll("#families-tbody tr").forEach(row => {
        const id = row.getAttribute("data-id");
        const name = row.getAttribute("data-name");
        const phone = row.getAttribute("data-phone");
        const school = row.getAttribute("data-school");
        const status = row.getAttribute("data-status");
        
        if (!id) return; // Saltarse cargadores
        
        const matchesSearch = id.includes(searchVal) || name.includes(searchVal) || phone.includes(searchVal);
        const matchesSchool = !schoolVal || school === schoolVal;
        const matchesStatus = !statusVal || status === statusVal;
        
        if (matchesSearch && matchesSchool && matchesStatus) {
            row.classList.remove("hidden");
        } else {
            row.classList.add("hidden");
        }
    });
}

// ==============================================================================
// 🔍 DETALLES Y COMENTARIOS DE PARTICIPANTE (MODAL)
// ==============================================================================
function openDetailsModal(id) {
    if (!globalData) return;
    
    const p = globalData.records.find(r => r.ID === id);
    if (!p) return;
    
    currentParticipantId = id;
    
    document.getElementById("modal-id").innerText = `ID: ${p.ID}`;
    document.getElementById("modal-name").innerText = p.Nombre;
    document.getElementById("modal-school").innerText = p.Colegio;
    document.getElementById("modal-phone").innerText = p.Telefono;
    document.getElementById("modal-stage").innerText = p.StatusClasificado;
    document.getElementById("modal-screen").innerText = p.PantallaActual || 'Ninguna';
    document.getElementById("modal-progress").innerText = `${p.Progreso}%`;
    document.getElementById("modal-first-log").innerText = p.FechaLog || 'Sin descargar';
    document.getElementById("modal-expected-end").innerText = p.FechaEsperada || '-';
    
    // Inactividad
    document.getElementById("modal-last-active").innerText = p.FechaLog ? (p.FechaFinal || p.FechaLog) : 'Sin actividad';
    document.getElementById("modal-days-inactive").innerText = p.DiasUltimoUso !== null ? `${p.DiasUltimoUso} días` : '-';
    
    // Comentario input
    document.getElementById("modal-comment-input").value = p.Comentarios || "";
    
    // Abrir Modal
    const modal = document.getElementById("details-modal");
    modal.classList.remove("hidden");
}

function closeModal() {
    const modal = document.getElementById("details-modal");
    modal.classList.add("hidden");
    currentParticipantId = null;
}

async function saveComment() {
    if (!currentParticipantId) return;
    
    const commentVal = document.getElementById("modal-comment-input").value;
    
    try {
        const response = await authenticatedFetch("/api/update-comment", {
            method: "POST",
            body: JSON.stringify({ id: currentParticipantId, comment: commentVal })
        });
        
        const resData = await response.json();
        if (response.ok) {
            // Actualizar localmente para no recargar de la API
            const p = globalData.records.find(r => r.ID === currentParticipantId);
            if (p) {
                p.Comentarios = commentVal;
            }
            
            // Refrescar vistas
            renderFamiliesTable();
            renderFollowUpTabs();
            
            closeModal();
        } else {
            showErrorIaModal("Error al guardar comentario: " + formatErrorMessage(resData.detail));
        }
    } catch (err) {
        console.error(err);
        showErrorIaModal("Ocurrió un error al guardar el comentario. Verifica la conexión con el servidor local o el estado del archivo.");
    }
}

// ==============================================================================
// 📅 MODAL DE COHORTES INTERACTIVO
// ==============================================================================
function openCohortModal(weekIndex) {
    if (!globalData) return;
    
    // Filtrar participantes de la cohorte seleccionada
    const filtered = globalData.records.filter(r => {
        if (r.SemanasInscripcion === null || r.SemanasInscripcion === undefined) return false;
        if (weekIndex === 7) {
            return r.SemanasInscripcion >= 7;
        } else {
            return r.SemanasInscripcion === weekIndex;
        }
    });
    
    const weekLabels = [
        'Semana 0 (0-6 días de inscripción)',
        'Semana 1 (7-13 días)',
        'Semana 2 (14-20 días)',
        'Semana 3 (21-27 días)',
        'Semana 4 (28-34 días)',
        'Semana 5 (35-41 días)',
        'Semana 6 (42-48 días)',
        'Semana 7 o más (49+ días)'
    ];
    
    document.getElementById("cohort-modal-title").innerText = `Avance en ${weekLabels[weekIndex]}`;
    document.getElementById("cohort-total-cnt").innerText = filtered.length;
    
    // Contar estados en esta cohorte
    const statusCounts = {};
    filtered.forEach(r => {
        const status = r.StatusClasificado || 'Desconocido';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    const labels = Object.keys(statusCounts);
    const data = Object.values(statusCounts);
    
    // Paleta de colores para cada estado
    const colorMap = {
        'Rechazo / Sin disponibilidad': 'rgba(148, 163, 184, 0.85)',
        'Recién Notificado (< 5 días)': 'rgba(59, 130, 246, 0.85)',
        'Notificado - No Descarga App': 'rgba(99, 102, 241, 0.85)',
        'Notificado con Error Técnico': 'rgba(168, 85, 247, 0.85)',
        'En Progreso - Atrasado': 'rgba(239, 68, 68, 0.85)',
        'En Libro 1': 'rgba(20, 184, 166, 0.85)',
        'En Progreso - Empezando Libro 2': 'rgba(249, 115, 22, 0.85)',
        'En Progreso - Próximo a Terminar (Avanzado)': 'rgba(234, 179, 8, 0.85)',
        'Completado': 'rgba(16, 185, 129, 0.85)'
    };
    
    const bgColors = labels.map(l => colorMap[l] || 'rgba(100, 116, 139, 0.85)');
    
    if (cohortBreakdownChartInstance) cohortBreakdownChartInstance.destroy();
    const ctxBreakdown = document.getElementById("cohortBreakdownChart").getContext("2d");
    cohortBreakdownChartInstance = new Chart(ctxBreakdown, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: bgColors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 10 } }
                }
            }
        }
    });
    
    document.getElementById("cohort-modal").classList.remove("hidden");
}

function closeCohortModal() {
    document.getElementById("cohort-modal").classList.add("hidden");
    if (cohortBreakdownChartInstance) {
        cohortBreakdownChartInstance.destroy();
        cohortBreakdownChartInstance = null;
    }
}

// ==============================================================================
// 💾 CONFIGURACIÓN Y DESCARGAS
// ==============================================================================
async function loadConfig() {
    try {
        const response = await authenticatedFetch("/api/config");
        const resData = await response.json();
        if (response.ok) {
            document.getElementById("email").value = resData.email || "";
            document.getElementById("dateFrom").value = resData.dateFrom || "";
            document.getElementById("sheetName").value = resData.sheetName || "PARTICIPANTES 2";
            document.getElementById("contactadosSheetName").value = resData.contactadosSheetName || "CONTACTADOS";
            
            hasSavedUcPassword = resData.hasPassword;
            const pWrapper = document.getElementById("sync-password-wrapper");
            if (pWrapper) {
                if (hasSavedUcPassword) {
                    pWrapper.classList.add("hidden");
                } else {
                    pWrapper.classList.remove("hidden");
                }
            }
        }
    } catch (err) {
        console.error("Error al cargar config:", err);
    }
}

async function saveServerConfig(e) {
    e.preventDefault();
    const emailVal = document.getElementById("email").value;
    const passwordVal = document.getElementById("password").value;
    const dateFromVal = document.getElementById("dateFrom").value;
    const sheetNameVal = document.getElementById("sheetName").value;
    const contactadosSheetNameVal = document.getElementById("contactadosSheetName").value;
    
    try {
        const response = await authenticatedFetch("/api/config", {
            method: "POST",
            body: JSON.stringify({
                email: emailVal,
                password: passwordVal,
                dateFrom: dateFromVal,
                sheetName: sheetNameVal,
                contactadosSheetName: contactadosSheetNameVal
            })
        });
        
        const resData = await response.json();
        if (response.ok) {
            alert("Ajustes del servidor guardados exitosamente.");
            document.getElementById("password").value = ""; // Limpiar
            switchTab('upload-tab');
        } else {
            showErrorIaModal("Error de Configuración: " + formatErrorMessage(resData.detail));
        }
    } catch (err) {
        console.error(err);
        showErrorIaModal("Error al guardar ajustes en config.json. Verifica los permisos de escritura del servidor.");
    }
}

function downloadFinalExcel() {
    const token = localStorage.getItem("web_access_password") || "";
    window.location.href = `/api/download?token=${encodeURIComponent(token)}`;
}

function addTerminalLog(msg) {
    const logBox = document.getElementById("sync-log-box");
    if (!logBox) return;
    
    const time = new Date().toLocaleTimeString();
    logBox.innerHTML += `<p><span class="text-[#64748B]">[${time}]</span> ${msg}</p>`;
    logBox.scrollTop = logBox.scrollHeight;
}

// 🛠️ MODAL DE ERROR INTERACTIVO CON IA
function showErrorIaModal(errorMessage) {
    document.getElementById("error-ia-msg").innerText = errorMessage;
    
    // Forzar a Principiante por defecto
    const easyRadio = document.querySelector('input[name="tech-level"][value="Principiante 🐣"]');
    if (easyRadio) easyRadio.checked = true;
    
    updateLevelSelectionStyles();
    
    document.getElementById("error-ia-modal").classList.remove("hidden");
}

function closeErrorIaModal() {
    document.getElementById("error-ia-modal").classList.add("hidden");
}

function copyErrorCode() {
    const errorText = document.getElementById("error-ia-msg").innerText;
    navigator.clipboard.writeText(errorText);
    
    alert("Mensaje de error técnico copiado al portapapeles.");
}

function updateLevelSelectionStyles() {
    const radioSelected = document.querySelector('input[name="tech-level"]:checked');
    const selectedLevel = radioSelected ? radioSelected.value : "Principiante 🐣";
    
    const labels = {
        "Principiante 🐣": "level-label-easy",
        "Intermedio 🚀": "level-label-medium",
        "Avanzado 💻": "level-label-hard"
    };
    
    Object.keys(labels).forEach(level => {
        const el = document.getElementById(labels[level]);
        if (!el) return;
        if (level === selectedLevel) {
            el.classList.add("border-blue-500", "bg-blue-50/50");
            el.classList.remove("border-[#E2E8F0]", "bg-white");
        } else {
            el.classList.remove("border-blue-500", "bg-blue-50/50");
            el.classList.add("border-[#E2E8F0]", "bg-white");
        }
    });
}

function copyAIPrompt() {
    const errorText = document.getElementById("error-ia-msg").innerText;
    const radioSelected = document.querySelector('input[name="tech-level"]:checked');
    const selectedLevel = radioSelected ? radioSelected.value : "Principiante 🐣";
    
    const promptText = `Hola. Estoy usando la herramienta local "Revisor Cuenta Conmigo" (FastAPI backend + HTML/JS frontend) que procesa planillas Excel (.xlsx) usando Pandas/openpyxl y se conecta a una API del servidor de la UC.

Se ha producido el siguiente error técnico en el sistema:
=========================================
${errorText}
=========================================

Mi nivel de conocimiento técnico es: "${selectedLevel}".

Por favor, ayúdame con lo siguiente de forma muy didáctica, analítica y amigable:
1. Explícame con palabras sencillas qué significa este error y en qué parte del flujo (ej. carga de archivo Excel, conexión de red, validación de columnas o sincronización de base de datos) pudo haber ocurrido.
2. Dame una lista detallada paso a paso de posibles causas y soluciones que yo mismo puedo probar para corregirlo (ej. revisar si el Excel tiene las pestañas y columnas correctas, si mis credenciales en Ajustes son correctas, si el puerto está bloqueado, etc.).
3. Si consideras que el error es muy complejo, requiere modificar el código Python o JS, o es un fallo del servidor que no puedo resolver editando la configuración o los archivos Excel, indícame explícitamente al final de tu respuesta que debo comunicarme con el ingeniero de desarrollo para solucionarlo.`;

    navigator.clipboard.writeText(promptText);
    
    const btn = document.getElementById("btn-copy-prompt");
    const originalContent = btn.innerHTML;
    btn.innerHTML = "<i class='bx bx-check'></i> <span>¡Prompt Copiado!</span>";
    btn.classList.remove("from-blue-600", "to-indigo-600");
    btn.classList.add("from-emerald-600", "to-teal-600");
    
    setTimeout(() => {
        btn.innerHTML = originalContent;
        btn.classList.remove("from-emerald-600", "to-teal-600");
        btn.classList.add("from-blue-600", "to-indigo-600");
    }, 2000);
}

// ☁️ FUNCIONES DE SINCRONIZACIÓN DE PERSISTENCIA EN LA NUBE
async function checkCloudSyncStatus() {
    try {
        const response = await authenticatedFetch("/api/sync-status");
        const resData = await response.json();
        if (response.ok) {
            updateCloudSyncUI(resData.last_cloud_sync_status, resData.last_cloud_sync_time);
        }
    } catch (err) {
        console.error("Error al obtener estado de nube:", err);
        updateCloudSyncUI("connection_failed", null);
    }
}

function updateCloudSyncUI(status, time) {
    const dot = document.getElementById("cloud-status-dot");
    const text = document.getElementById("cloud-status-text");
    const timeSpan = document.getElementById("cloud-status-time");
    const cardTimeSpan = document.getElementById("cloud-sync-card-time");
    
    if (!dot || !text) return;
    
    // Reset classes
    dot.className = "w-2.5 h-2.5 rounded-full";
    
    if (status === "success") {
        dot.classList.add("bg-emerald-500", "animate-none");
        text.innerText = "Guardado en nube";
        text.className = "text-xs font-semibold text-emerald-600";
        const timeStr = time ? `Última: ${time.split(" ")[1] || time}` : "";
        if (timeSpan) timeSpan.innerText = timeStr;
        if (cardTimeSpan) cardTimeSpan.innerText = time || "Desconocido";
    } else if (status === "failed") {
        dot.classList.add("bg-rose-500", "animate-ping");
        text.innerText = "Fallo de respaldo";
        text.className = "text-xs font-semibold text-rose-600";
        if (timeSpan) timeSpan.innerText = "Reintentando...";
        if (cardTimeSpan) cardTimeSpan.innerText = "Fallo (Reintentando...)";
    } else if (status === "connection_failed") {
        dot.classList.add("bg-rose-500", "animate-none");
        text.innerText = "Nube desconectada";
        text.className = "text-xs font-semibold text-rose-600";
        if (timeSpan) timeSpan.innerText = "";
        if (cardTimeSpan) cardTimeSpan.innerText = "Desconectado del servidor";
    } else if (status === "syncing") {
        dot.classList.add("bg-amber-500", "animate-pulse");
        text.innerText = "Respaldo pendiente";
        text.className = "text-xs font-semibold text-amber-600";
        if (timeSpan) timeSpan.innerText = "Subiendo...";
        if (cardTimeSpan) cardTimeSpan.innerText = "Subiendo archivos...";
    } else {
        // idle (no DATABASE_URL set)
        dot.classList.add("bg-slate-400", "animate-none");
        text.innerText = "Local (Sin persistencia)";
        text.className = "text-xs font-semibold text-[#475569]";
        if (timeSpan) timeSpan.innerText = "";
        if (cardTimeSpan) cardTimeSpan.innerText = "No configurado (DATABASE_URL vacía)";
    }
}

async function forceCloudSyncPull() {
    const btn = document.getElementById("btn-force-pull");
    if (!btn) return;
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "<i class='bx bx-refresh animate-spin text-lg'></i> <span>Sincronizando...</span>";
    
    try {
        const response = await authenticatedFetch("/api/force-cloud-pull", {
            method: "POST"
        });
        const resData = await response.json();
        if (response.ok) {
            alert("Sincronización manual desde la nube completada exitosamente.");
            // Recargar datos y config locales en la UI
            loadConfig();
            fetchData();
        } else {
            showErrorIaModal("Error al sincronizar desde la nube: " + formatErrorMessage(resData.detail));
        }
    } catch (err) {
        console.error(err);
        showErrorIaModal("Error de red al intentar sincronizar desde la nube.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
        checkCloudSyncStatus(); // Forzar actualización de estado
    }
}

function formatErrorMessage(detail) {
    if (!detail) return "Ocurrió un error inesperado.";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
        return detail.map(err => {
            const field = err.loc ? err.loc.join(".") : "";
            return `${field ? field + ": " : ""}${err.msg || JSON.stringify(err)}`;
        }).join(" | ");
    }
    if (typeof detail === "object") {
        return JSON.stringify(detail);
    }
    return String(detail);
}
