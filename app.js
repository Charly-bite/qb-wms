document.addEventListener("DOMContentLoaded", function () {
    const socket = io();

    // 1. Initialize DOM Elements
    const inputProducto = document.getElementById("input-producto");
    const inputLote = document.getElementById("input-lote");
    const inputArea = document.getElementById("input-area");
    const inputUsuario = document.getElementById("input-usuario");
    const btnSetArea = document.getElementById("btn-set-area");
    const currentAreaBadge = document.getElementById("current-area");
    const inputSearch = document.getElementById("input-search");
    const btnAdd = document.getElementById("btn-add");
    const btnExport = document.getElementById("btn-export");
    const syncStatus = document.getElementById("sync-status");
    const tabInventory = document.getElementById("tab-inventory");
    const tabReserved = document.getElementById("tab-reserved");
    const tabPeticiones = document.getElementById("tab-peticiones");
    const tabHistorial = document.getElementById("tab-historial");
    const warningPeticiones = document.getElementById("warning-peticiones");
    const loadingOverlay = document.getElementById("loading-overlay");

    // 2. State
    const ACTIVE_AREA_KEY = "active_area";
    const ACTIVE_USER_KEY = "active_user";
    let activeArea = normalizeArea(localStorage.getItem(ACTIVE_AREA_KEY) || "A1");
    let activeUser = normalizeUser(localStorage.getItem(ACTIVE_USER_KEY) || "Almacen1");
    let isApplyingRemoteData = false;
    let isInventoryDeletionInProgress = false;
    let syncTimer = null;
    let pullTimer = null;
    let lastAppliedServerSignature = "";
    let currentTab = "inventory"; // "inventory" | "reserved" | "peticiones" | "historial"

    function setSyncStatus(state, text) {
        if (!syncStatus) {
            return;
        }

        syncStatus.classList.remove("sync-ok", "sync-connecting", "sync-offline");
        syncStatus.classList.add(state);
        syncStatus.textContent = text;
    }

    function normalizeRows(data) {
        return (Array.isArray(data) ? data : []).map((row) => ({
            ...row,
            id: row.id ?? Date.now() + Math.random(),
            KG: row.KG ?? 25,
            Reservado: row.Reservado ?? false,
        }));
    }

    function buildRowsSignature(rows) {
        return JSON.stringify(
            (Array.isArray(rows) ? rows : []).map((row) => [
                row.id ?? "",
                row.Ubicacion ?? "",
                row.Producto ?? "",
                row.Nombre ?? "",
                row.Lote ?? "",
                row.KG ?? "",
                row.Comentarios ?? "",
                row.Reservado ?? false,
            ])
        );
    }

    function normalizeArea(value) {
        return (value || "").trim().toUpperCase();
    }

    function normalizeUser(value) {
        return (value || "").trim();
    }

    function renderActiveUser() {
        inputUsuario.value = activeUser;
    }

    function syncUserFromInput() {
        const nextUser = normalizeUser(inputUsuario.value);
        if (!nextUser) {
            inputUsuario.value = activeUser;
            return;
        }

        activeUser = nextUser;
        localStorage.setItem(ACTIVE_USER_KEY, activeUser);

        const petUsuarioInput = document.getElementById("pet-usuario");
        if (petUsuarioInput && !petUsuarioInput.value.trim()) {
            petUsuarioInput.value = activeUser;
        }
    }

    function renderActiveArea() {
        currentAreaBadge.textContent = activeArea || "SIN AREA";
        inputArea.value = activeArea;
    }

    function setActiveArea() {
        const nextArea = normalizeArea(inputArea.value);
        if (!nextArea) {
            alert("Debes ingresar un area valida. Ejemplo: A1");
            inputArea.focus();
            return false;
        }

        activeArea = nextArea;
        localStorage.setItem(ACTIVE_AREA_KEY, activeArea);
        renderActiveArea();
        pushActiveAreaToServer(activeArea);
        inputProducto.focus();
        return true;
    }

    function syncAreaFromInputSilently() {
        const nextArea = normalizeArea(inputArea.value);
        if (!nextArea || nextArea === activeArea) {
            return;
        }

        activeArea = nextArea;
        localStorage.setItem(ACTIVE_AREA_KEY, activeArea);
        renderActiveArea();
        pushActiveAreaToServer(activeArea);
    }

    function setActiveAreaFromServer(value) {
        const nextArea = normalizeArea(value);
        if (!nextArea || nextArea === activeArea) {
            return;
        }

        activeArea = nextArea;
        localStorage.setItem(ACTIVE_AREA_KEY, activeArea);
        renderActiveArea();
    }

    function extractBatchNumber(value) {
        const raw = String(value || "").trim();
        const digits = raw.replace(/\D/g, "");
        return digits ? Number(digits) : NaN;
    }

    function shouldQuerySapName(productCode) {
        return /^IFF/i.test(String(productCode || "").trim());
    }

    function updatePendingRequestsWarning() {
        if (!warningPeticiones) {
            return;
        }

        const pendingCount = peticionesTable
            .getData()
            .filter((row) => String(row.estado || "Pendiente").trim().toLowerCase() === "pendiente").length;

        if (pendingCount > 0) {
            warningPeticiones.classList.remove("hidden");
            warningPeticiones.innerHTML = `<strong>Aviso:</strong> Hay ${pendingCount} petición${pendingCount === 1 ? "" : "es"} sin atender.`;
            return;
        }

        warningPeticiones.classList.add("hidden");
    }

    function syncInventoryDataToServer() {
        const currentData = table.getData();
        return fetch("/api/inventory", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ data: currentData, usuario: activeUser }),
        });
    }

    // 3. Initialize Tabulator Grid
    const table = new Tabulator("#inventory-table", {
        data: [],
        layout: "fitColumns",
        responsiveLayout: "hide",
        history: true,
        groupBy: "Ubicacion",
        selectableRows: true,
        groupHeader: function(value, count, data, group){
            const printValue = value || "SIN_AREA";
            
            const container = document.createElement("div");
            container.style.cssText = "display:inline-flex; align-items:center; width:calc(100% - 30px); justify-content:space-between;";
            
            const leftDiv = document.createElement("div");
            leftDiv.style.cssText = "display:flex; align-items:center; gap:10px;";
            
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "group-select-all-cb";
            cb.style.cssText = "width: 16px; height: 16px; cursor: pointer;";
            cb.title = "Seleccionar todos los del área";
            
            // Re-evaluate checkbox state if some rows are selected?
            // Optional: determine if all are selected initially
            let allSelected = false;
            let someSelected = false;
            const rows = group.getRows();
            if (rows.length > 0) {
                const selectedCount = rows.filter(r => r.isSelected()).length;
                allSelected = selectedCount === rows.length;
                someSelected = selectedCount > 0 && selectedCount < rows.length;
            }
            cb.checked = allSelected;
            cb.indeterminate = someSelected;
            
            cb.addEventListener("click", function(e) {
                e.stopPropagation();
            });
            
            cb.addEventListener("change", function(e) {
                const isChecked = e.target.checked;
                if (isChecked) {
                    group.getRows().forEach(r => r.select());
                } else {
                    group.getRows().forEach(r => r.deselect());
                }
            });
            
            const titleSpan = document.createElement("span");
            titleSpan.style.cssText = "font-weight:bold; color:#1a365d;";
            titleSpan.textContent = `Área: ${printValue}`;
            
            const countSpan = document.createElement("span");
            countSpan.style.cssText = "font-size:12px; background:#e2e8f0; padding:2px 8px; border-radius:12px; color:#333;";
            countSpan.textContent = `${count} Productos`;
            
            leftDiv.appendChild(cb);
            leftDiv.appendChild(titleSpan);
            leftDiv.appendChild(countSpan);
            
            const rightDiv = document.createElement("div");
            
            const delBtn = document.createElement("button");
            delBtn.className = "group-delete-selected-btn";
            delBtn.style.cssText = "color: white; background-color: #f44336; border: none; border-radius: 4px; padding: 4px 8px; margin-left: 15px; cursor: pointer; font-weight: bold; font-size: 11px;";
            delBtn.textContent = "❌ Eliminar Seleccionados";
            
            delBtn.addEventListener("click", async function(e) {
                e.stopPropagation();
                const groupArea = group.getKey() || "SIN_AREA";
                const selectedRows = group.getRows().filter(row => row.isSelected());

                if (selectedRows.length === 0) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Sin selección',
                        text: `Por favor utiliza las casillas para seleccionar los registros del área ${groupArea} que deseas eliminar.`,
                        confirmButtonColor: '#1a365d'
                    });
                    return;
                }

                const result = await Swal.fire({
                    title: '¿Confirmar eliminación?',
                    text: `¿Estás seguro de que deseas eliminar ${selectedRows.length} registro(s) SELECCIONADO(S) del área ${groupArea}?`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#f44336',
                    cancelButtonColor: '#718096',
                    confirmButtonText: 'Sí, eliminar',
                    cancelButtonText: 'Cancelar'
                });

                if (result.isConfirmed) {
                    loadingOverlay.classList.remove("hidden");
                    isInventoryDeletionInProgress = true;

                    // Pequeña espera para permitir que el navegador pinte el overlay antes del proceso pesado
                    await new Promise(resolve => setTimeout(resolve, 50));

                    try {
                        // Deletions in Tabulator are fast, but we can wrap them to ensure UI responsiveness
                        await Promise.all(selectedRows.map(row => row.delete()));
                        await syncInventoryDataToServer();
                        
                        Swal.fire({
                            icon: 'success',
                            title: 'Eliminados',
                            text: 'Los registros han sido eliminados correctamente.',
                            timer: 2000,
                            showConfirmButton: false
                        });
                    } catch (error) {
                        console.error("Error al eliminar:", error);
                        Swal.fire('Error', 'No se pudieron eliminar todos los registros.', 'error');
                    } finally {
                        isInventoryDeletionInProgress = false;
                        loadingOverlay.classList.add("hidden");
                    }
                }
            });
            
            rightDiv.appendChild(delBtn);
            
            container.appendChild(leftDiv);
            container.appendChild(rightDiv);
            
            return container;
        },
        columns: [
            {
                formatter: "rowSelection",
                titleFormatter: function() { return ""; }, // Elimina el checkbox maestro del header global
                hozAlign: "center",
                headerSort: false,
                resizable: false,
                width: 48,
                cellClick: function (_e, cell) {
                    cell.getRow().toggleSelect();
                },
            },
            { title: "#", formatter: "rownum", headerSort: false, width: 60, hozAlign: "center", resizable: false },
            { title: "Ubicacion", field: "Ubicacion", editor: "input", width: 150 },
            { title: "Producto", field: "Producto", editor: "input", widthGrow: 2 },
            { title: "Nombre", field: "Nombre", editor: "input", widthGrow: 3 },
            {
                title: "Lote",
                field: "Lote",
                editor: "input",
                widthGrow: 1,
                headerSortStartingDir: "asc",
                sorter: function (a, b) {
                    const aNum = extractBatchNumber(a);
                    const bNum = extractBatchNumber(b);

                    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
                        return aNum - bNum;
                    }

                    return String(a || "").localeCompare(String(b || ""), undefined, {
                        numeric: true,
                        sensitivity: "base",
                    });
                },
            },
            { title: "KG", field: "KG", editor: "number", hozAlign: "right", width: 90 },
            { title: "Comentarios", field: "Comentarios", editor: "input", widthGrow: 2 },
            {
                title: "Res.",
                field: "Reservado",
                formatter: "tickCross",
                editor: true,
                hozAlign: "center",
                width: 60,
                headerSort: false,
            },
            {
                title: "❌",
                formatter: function () {
                    return "<button tabindex='-1' style='color: white; background-color: #f44336; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-weight: bold;'>X</button>";
                },
                width: 60,
                hozAlign: "center",
                headerSort: false,
                cellClick: async function (_e, cell) {
                    const result = await Swal.fire({
                        title: '¿Eliminar registro?',
                        text: '¿Estás seguro de que deseas eliminar este registro?',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#f44336',
                        cancelButtonColor: '#718096',
                        confirmButtonText: 'Sí, eliminar',
                        cancelButtonText: 'Cancelar'
                    });

                    if (result.isConfirmed) {
                        loadingOverlay.classList.remove("hidden");
                        isInventoryDeletionInProgress = true;

                        // Pequeña espera para permitir que el navegador pinte el overlay
                        await new Promise(resolve => setTimeout(resolve, 50));

                        try {
                            await cell.getRow().delete();
                            await syncInventoryDataToServer();
                        } catch (error) {
                            console.error("Error al eliminar:", error);
                            Swal.fire('Error', 'No se pudo eliminar el registro.', 'error');
                        } finally {
                            isInventoryDeletionInProgress = false;
                            loadingOverlay.classList.add("hidden");
                        }
                    }
                },
            },
        ],
    });

    // 4. Initialize Peticiones Grid
    const peticionesTable = new Tabulator("#peticiones-table", {
        data: [],
        layout: "fitColumns",
        responsiveLayout: "hide",
        history: true,
        columns: [
            { title: "ID", field: "id", visible: false },
            { title: "Fecha/Hora", field: "fecha", formatter: (cell) => new Date(cell.getValue()).toLocaleString(), width: 180 },
            { title: "Usuario (Pide)", field: "usuario", width: 150 },
            { title: "Producto/Material", field: "producto", widthGrow: 2 },
            { title: "Cant. Tambos", field: "cantidad", width: 120, hozAlign: "center" },
            { title: "Estado", field: "estado", editor: "select", editorParams: { values: ["Pendiente", "Surtido", "Cancelado"] }, width: 120 },
            {
                title: "❌",
                formatter: function () {
                    return "<button tabindex='-1' style='color: white; background-color: #f44336; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-weight: bold;'>X</button>";
                },
                width: 60,
                hozAlign: "center",
                headerSort: false,
                cellClick: function (_e, cell) {
                    if (confirm("Estas seguro de que deseas eliminar esta peticion?")) {
                        const rowData = cell.getRow().getData();
                        cell.getRow().delete();
                        const currentData = peticionesTable.getData();
                        fetch("/api/peticiones", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ peticiones: currentData, usuario: activeUser }),
                        });
                        updatePendingRequestsWarning();
                    }
                },
            },
        ],
    });

    peticionesTable.on("cellEdited", () => {
        if (isApplyingRemoteData) return;
        const currentData = peticionesTable.getData();
        fetch("/api/peticiones", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ peticiones: currentData, usuario: activeUser }),
        });
        updatePendingRequestsWarning();
    });

    const historialTable = new Tabulator("#historial-table", {
        data: [],
        layout: "fitColumns",
        responsiveLayout: "hide",
        initialSort: [{ column: "fecha", dir: "desc" }],
        columns: [
            { title: "Fecha/Hora", field: "fecha", formatter: (cell) => new Date(cell.getValue()).toLocaleString(), width: 180 },
            { title: "Usuario", field: "usuario", width: 180 },
            { title: "Accion", field: "accion", width: 220 },
            { title: "Detalle", field: "detalle", widthGrow: 2 },
        ],
    });

    // Logica para crear nueva peticion
    document.getElementById("btn-add-peticion").addEventListener("click", async () => {
        const usuario = document.getElementById("pet-usuario").value.trim() || activeUser;
        const producto = document.getElementById("pet-producto").value.trim();
        const cantidad = document.getElementById("pet-cantidad").value;

        if (!usuario || !producto || !cantidad) {
            Swal.fire({
                icon: 'warning',
                title: 'Faltan datos',
                text: 'Por favor llena Usuario, Producto y Cantidad.',
            });
            return;
        }

        try {
            await fetch("/api/peticiones", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ usuario, producto, cantidad })
            });

            // Limpiar inputs
            document.getElementById("pet-producto").value = "";
            document.getElementById("pet-cantidad").value = "1";
            Swal.fire({
                icon: 'success',
                title: 'Petición enviada',
                text: 'Tu petición se ha registrado correctamente.',
                timer: 2000,
                showConfirmButton: false
            });
            updatePendingRequestsWarning();
        } catch (error) {
            console.error("Error pidiendo material:", error);
            Swal.fire("Error", "No se pudo registrar la petición", "error");
        }
    });

    function queueSyncIfLocalChange() {
        if (isApplyingRemoteData) {
            return;
        }

        if (isInventoryDeletionInProgress) {
            return;
        }

        scheduleServerSync();
    }

    table.on("cellEdited", queueSyncIfLocalChange);
    table.on("rowAdded", queueSyncIfLocalChange);
    table.on("rowDeleted", queueSyncIfLocalChange);

    function applyGlobalSearch() {
        const term = (inputSearch.value || "").trim().toLowerCase();

        if (!term) {
            table.setGroupBy("Ubicacion");
            table.setFilter(function (rowData) {
                const isReserved = Boolean(rowData.Reservado);
                if (currentTab === "inventory" && isReserved) return false;
                if (currentTab === "reserved" && !isReserved) return false;
                return true;
            });
            table.clearSort();
            return;
        }

        table.setGroupBy(false);
        table.setSort([
            { column: "Producto", dir: "asc" },
            { column: "Lote", dir: "asc" }
        ]);

        table.setFilter(function (rowData) {
            const isReserved = Boolean(rowData.Reservado);
            if (currentTab === "inventory" && isReserved) return false;
            if (currentTab === "reserved" && !isReserved) return false;

            const ubicacion = String(rowData.Ubicacion || "").toLowerCase();
            const producto = String(rowData.Producto || "").toLowerCase();
            const nombre = String(rowData.Nombre || "").toLowerCase();
            const lote = String(rowData.Lote || "").toLowerCase();

            return (
                ubicacion.includes(term) ||
                producto.includes(term) ||
                nombre.includes(term) ||
                lote.includes(term)
            );
        });
    }

    tabInventory?.addEventListener("click", () => setTab("inventory"));
    tabReserved?.addEventListener("click", () => setTab("reserved"));
    tabPeticiones?.addEventListener("click", () => setTab("peticiones"));
    tabHistorial?.addEventListener("click", () => setTab("historial"));

    function setTab(tabName) {
        if (currentTab === tabName) return;
        currentTab = tabName;
        
        const viewInventory = document.getElementById("view-inventory");
        const viewPeticiones = document.getElementById("view-peticiones");
        const viewHistorial = document.getElementById("view-historial");
        
        tabInventory.classList.remove("active");
        tabReserved.classList.remove("active");
        tabPeticiones.classList.remove("active");
        tabHistorial.classList.remove("active");

        if (tabName === "inventory" || tabName === "reserved") {
            if (tabName === "inventory") tabInventory.classList.add("active");
            if (tabName === "reserved") tabReserved.classList.add("active");
            
            viewInventory.classList.remove("hidden");
            viewPeticiones.classList.add("hidden");
            viewHistorial.classList.add("hidden");
            
            loadingOverlay.classList.remove("hidden");
            setTimeout(() => {
                applyGlobalSearch();
                loadingOverlay.classList.add("hidden");
            }, 50);
        } else if (tabName === "peticiones") {
            tabPeticiones.classList.add("active");
            viewInventory.classList.add("hidden");
            viewPeticiones.classList.remove("hidden");
            viewHistorial.classList.add("hidden");
        } else if (tabName === "historial") {
            tabHistorial.classList.add("active");
            viewInventory.classList.add("hidden");
            viewPeticiones.classList.add("hidden");
            viewHistorial.classList.remove("hidden");
        }
    }

    async function pushInventoryToServer() {
        try {
            setSyncStatus("sync-connecting", "Syncing...");
            const data = table.getData();
            const nextSignature = buildRowsSignature(data);
            await fetch("/api/inventory", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ data, usuario: activeUser }),
            });
            lastAppliedServerSignature = nextSignature;
            setSyncStatus("sync-ok", "Sync OK");
        } catch (error) {
            console.error("No se pudo sincronizar inventario con el servidor:", error);
            setSyncStatus("sync-offline", "Offline");
        }
    }

    async function pushActiveAreaToServer(nextArea) {
        try {
            setSyncStatus("sync-connecting", "Syncing...");
            await fetch("/api/active-area", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ activeArea: nextArea, usuario: activeUser }),
            });
            setSyncStatus("sync-ok", "Sync OK");
        } catch (error) {
            console.error("No se pudo sincronizar area activa con el servidor:", error);
            setSyncStatus("sync-offline", "Offline");
        }
    }

    function scheduleServerSync() {
        if (syncTimer) {
            clearTimeout(syncTimer);
        }

        syncTimer = setTimeout(() => {
            pushInventoryToServer();
            syncTimer = null;
        }, 250);
    }

    async function loadInventoryFromServer(showBusy = false) {
        try {
            if (showBusy) {
                setSyncStatus("sync-connecting", "Syncing...");
            }
            const resp = await fetch("/api/inventory");
            if (!resp.ok) {
                throw new Error("Respuesta invalida del servidor");
            }

            const payload = await resp.json();
            const rows = normalizeRows(payload.data);
            const incomingSignature = buildRowsSignature(rows);
            setActiveAreaFromServer(payload.activeArea);

            if (incomingSignature === lastAppliedServerSignature) {
                setSyncStatus("sync-ok", "Sync OK");
                return;
            }

            isApplyingRemoteData = true;
            await table.setData(rows);
            isApplyingRemoteData = false;
            lastAppliedServerSignature = incomingSignature;

            applyGlobalSearch();
            setSyncStatus("sync-ok", "Sync OK");
        } catch (error) {
            console.error("No se pudo cargar inventario inicial del servidor:", error);
            setSyncStatus("sync-offline", "Offline");
        }
    }

    socket.on("inventory_sync", async function (rows) {
        const normalized = normalizeRows(rows);
        const incomingSignature = buildRowsSignature(normalized);

        if (incomingSignature === lastAppliedServerSignature) {
            setSyncStatus("sync-ok", "Sync OK");
            return;
        }

        isApplyingRemoteData = true;
        await table.setData(normalized);
        isApplyingRemoteData = false;
        lastAppliedServerSignature = incomingSignature;
        applyGlobalSearch();
        setSyncStatus("sync-ok", "Sync OK");
    });

    socket.on("area_sync", function (nextArea) {
        setActiveAreaFromServer(nextArea);
        setSyncStatus("sync-ok", "Sync OK");
    });

    socket.on("bootstrap_sync", async function (payload) {
        if (!payload) {
            return;
        }

        if (payload.peticiones) {
            await peticionesTable.setData(payload.peticiones);
            updatePendingRequestsWarning();
        }

        if (payload.historial) {
            historialTable.setData(payload.historial);
        }

        const normalized = normalizeRows(payload.data);
        const incomingSignature = buildRowsSignature(normalized);

        if (incomingSignature === lastAppliedServerSignature) {
            setActiveAreaFromServer(payload.activeArea);
            setSyncStatus("sync-ok", "Sync OK");
            return;
        }

        isApplyingRemoteData = true;
        await table.setData(normalized);
        isApplyingRemoteData = false;
        lastAppliedServerSignature = incomingSignature;
        setActiveAreaFromServer(payload.activeArea);
        applyGlobalSearch();
        setSyncStatus("sync-ok", "Sync OK");
    });

    socket.on("peticiones_sync", function (peticiones) {
        if (isApplyingRemoteData) return;
        isApplyingRemoteData = true;
        peticionesTable.setData(peticiones).then(updatePendingRequestsWarning);
        isApplyingRemoteData = false;
    });

    socket.on("historial_sync", function (historial) {
        historialTable.setData(Array.isArray(historial) ? historial : []);
    });

    socket.on("nueva_peticion", function (peticion) {
        Swal.fire({
            title: '¡Nueva Petición de Material!',
            html: `<b>${peticion.usuario}</b> está solicitando:<br><br><span style='font-size: 1.5em; color: var(--primary-color);'>${peticion.cantidad} Tambo(s)</span><br>de <b>${peticion.producto}</b>`,
            icon: 'info',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#1a365d'
        });
    });

    socket.on("connect", function () {
        setSyncStatus("sync-ok", "Sync OK");
    });

    socket.on("disconnect", function () {
        setSyncStatus("sync-offline", "Offline");
    });

    socket.io.on("reconnect_attempt", function () {
        setSyncStatus("sync-connecting", "Reconnecting...");
    });

    socket.io.on("reconnect", function () {
        setSyncStatus("sync-ok", "Sync OK");
    });

    // 5. Function to add new scanned row
    async function addNewRow() {
        // Si el operador cambio el area y no pulso "Asignar area",
        // se sincroniza automaticamente antes de capturar la fila.
        syncAreaFromInputSilently();

        const prodVal = inputProducto.value.trim().replace(/'/g, "-");
        const loteVal = inputLote.value.trim().replace(/'/g, "-").replace(/S$/i, "");

        if (!prodVal || !loteVal) {
            alert("Ambos campos de Producto y Lote deben estar llenos antes de agregar.");
            return;
        }

        // Solo consultamos SAP para productos IFF.
        let nombreProducto = "";
        if (shouldQuerySapName(prodVal)) {
            // Validar si ya escaneamos este producto antes (para re-usar su nombre cuando SAP este fallando por fines de semana)
            const localData = table.getData();
            const prevOccurence = localData.find(r => 
                String(r.Producto).trim().toUpperCase() === prodVal.toUpperCase() && 
                String(r.Nombre).trim() !== ""
            );

            if (prevOccurence) {
                // Reutilizamos el nombre que ya tenemos en memoria
                nombreProducto = prevOccurence.Nombre;
            } else {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2500);

                try {
                    const resp = await fetch(`/api/product/${encodeURIComponent(prodVal)}`, {
                        signal: controller.signal,
                    });

                    if (resp.ok) {
                        const queryData = await resp.json();
                        nombreProducto = queryData.name || "";
                    }
                } catch (error) {
                    console.error("Consulta de Base de Datos no disponible, se continua sin nombre:", error);
                    nombreProducto = "";
                } finally {
                    clearTimeout(timeoutId);
                }
            }
        }

        const newRow = {
            id: Date.now(),
            Ubicacion: activeArea,
            Producto: prodVal,
            Nombre: nombreProducto,
            Lote: loteVal,
            KG: 25,
            Comentarios: "",
        };

        table.addData([newRow], true);

        inputProducto.value = "";
        inputLote.value = "";
        inputProducto.focus();
    }

    // 6. Handling the Scanners (Enter Key logic)
    inputProducto.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            if (inputProducto.value.trim() !== "") {
                inputLote.focus();
            }
        }
    });

    inputLote.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            addNewRow();
        }
    });

    btnAdd.addEventListener("click", addNewRow);
    btnSetArea.addEventListener("click", setActiveArea);

    inputArea.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            setActiveArea();
        }
    });

    inputArea.addEventListener("blur", syncAreaFromInputSilently);
    inputUsuario.addEventListener("blur", syncUserFromInput);
    inputUsuario.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            syncUserFromInput();
            inputProducto.focus();
        }
    });

    inputSearch.addEventListener("input", applyGlobalSearch);

    // 7. Actions Bar
    btnExport.addEventListener("click", async function () {
        const data = table.getData();
        if (data.length === 0) {
            alert("No hay datos para exportar.");
            return;
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Inventario App";

        // Group data by Area (Ubicacion)
        const groupedData = data.reduce((acc, row) => {
            const area = (row.Ubicacion || "SIN_AREA").trim();
            if (!acc[area]) acc[area] = [];
            acc[area].push(row);
            return acc;
        }, {});

        // Sort areas alphabetically
        const areas = Object.keys(groupedData).sort();

        // Create a Summary Sheet ("Areas Trabajadas")
        const summarySheet = workbook.addWorksheet("Areas Trabajadas");
        summarySheet.columns = [
            { header: "Area / Ubicación", key: "Area", width: 25 },
            { header: "Total de Productos", key: "Count", width: 25 },
        ];

        const summaryHeader = summarySheet.getRow(1);
        summaryHeader.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
        summaryHeader.alignment = { vertical: "middle", horizontal: "center" };
        summaryHeader.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1A365D" },
        };

        let totalGeneral = 0;
        areas.forEach((area) => {
            const count = groupedData[area].length;
            totalGeneral += count;
            
            const newRow = summarySheet.addRow({
                Area: area,
                Count: count,
            });
            newRow.getCell('Count').alignment = { horizontal: "center" };
        });

        // Add a general total at the end
        const totalRow = summarySheet.addRow({
            Area: "TOTAL GENERAL",
            Count: totalGeneral,
        });
        totalRow.font = { bold: true };
        totalRow.getCell('Count').alignment = { horizontal: "center" };

        summarySheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1 && rowNumber < summarySheet.rowCount) {
                row.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: rowNumber % 2 === 0 ? "FFF7FAFC" : "FFFFFFFF" },
                };
            }
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: "thin", color: { argb: "FFCBD5E1" } },
                    left: { style: "thin", color: { argb: "FFCBD5E1" } },
                    bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
                    right: { style: "thin", color: { argb: "FFCBD5E1" } },
                };
            });
        });

        // Create a sheet for each area
        for (const area of areas) {
            const rows = groupedData[area];
            // Ensure valid sheet name
            const sheetName = area.substring(0, 31).replace(/[/*?:\[\]\\]/g, "_");
            const sheet = workbook.addWorksheet(sheetName);

            // Added index '#' column
            sheet.columns = [
                { header: "#", key: "Index", width: 6 },
                { header: "Ubicacion", key: "Ubicacion", width: 15 },
                { header: "Producto", key: "Producto", width: 25 },
                { header: "Nombre", key: "Nombre", width: 40 },
                { header: "Lote", key: "Lote", width: 20 },
                { header: "KG", key: "KG", width: 12 },
                { header: "Comentarios", key: "Comentarios", width: 45 },
            ];

            const headerRow = sheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
            headerRow.alignment = { vertical: "middle", horizontal: "center" };
            headerRow.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF1A365D" },
            };

            rows.forEach((row, index) => {
                const newRow = sheet.addRow({
                    Index: index + 1, // Enumerate products for this area
                    Ubicacion: row.Ubicacion || "",
                    Producto: row.Producto || "",
                    Nombre: row.Nombre || "",
                    Lote: row.Lote || "",
                    KG: row.KG ?? 25,
                    Comentarios: row.Comentarios || "",
                });
                newRow.alignment = { vertical: "middle", horizontal: "left" };
                
                // Highlight the Index column for visibility
                newRow.getCell('Index').font = { bold: true };
                newRow.getCell('Index').alignment = { horizontal: "center" };
            });

            sheet.eachRow((row, rowNumber) => {
                if (rowNumber > 1) {
                    row.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: rowNumber % 2 === 0 ? "FFF7FAFC" : "FFFFFFFF" },
                    };
                }
                row.eachCell((cell) => {
                    cell.border = {
                        top: { style: "thin", color: { argb: "FFCBD5E1" } },
                        left: { style: "thin", color: { argb: "FFCBD5E1" } },
                        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
                        right: { style: "thin", color: { argb: "FFCBD5E1" } },
                    };
                });
            });

            sheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const exportDate = new Date().toISOString().slice(0,10);
        saveAs(new Blob([buffer]), `Inventario_Exportacion_${exportDate}.xlsx`);
    });

    renderActiveArea();
    renderActiveUser();

    const petUsuarioInput = document.getElementById("pet-usuario");
    if (petUsuarioInput && !petUsuarioInput.value.trim()) {
        petUsuarioInput.value = activeUser;
    }

    loadInventoryFromServer(true);
    pullTimer = setInterval(() => loadInventoryFromServer(false), 15000);
    inputProducto.focus();
    updatePendingRequestsWarning();
});
