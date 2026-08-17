document.addEventListener("DOMContentLoaded", function () {
    // Guard: ensure critical dependencies loaded before initializing
    if (typeof Tabulator === 'undefined') {
        console.error('Tabulator no está disponible. Verifica que vendor/tabulator.min.js se cargó correctamente.');
        return;
    }
    if (typeof io === 'undefined') {
        console.error('Socket.IO no está disponible. Verifica que /socket.io/socket.io.js se cargó correctamente.');
        return;
    }
    if (typeof Swal === 'undefined') {
        console.warn('SweetAlert2 no está disponible. Se usarán alertas nativas como fallback.');
        window.Swal = { fire: function(opts) { alert(typeof opts === 'string' ? opts : (opts.title || '') + '\n' + (opts.text || '')); return Promise.resolve({ isConfirmed: false }); } };
    }

    try { _initApp(); } catch (err) {
        console.error('Error fatal al inicializar la aplicación:', err);
        var overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            overlay.innerHTML = '<div style="text-align:center;padding:40px;max-width:500px;">' +
                '<h1 style="color:#1a365d;margin-bottom:16px;">⚠️ Error de Inicialización</h1>' +
                '<p style="color:#2d3748;font-size:1.1em;margin-bottom:12px;">Ocurrió un error al iniciar la aplicación.</p>' +
                '<pre style="text-align:left;background:#f1f5f9;padding:12px;border-radius:8px;font-size:0.85em;overflow:auto;max-height:200px;">' + err.message + '</pre>' +
                '<button onclick="location.reload()" style="margin-top:16px;background:#1a365d;color:white;border:none;padding:12px 24px;border-radius:8px;font-size:1em;cursor:pointer;">🔄 Recargar Página</button>' +
                '</div>';
        }
    }
});

function _initApp() {
    const socket = io();

    // 1. Initialize DOM Elements
    const inputProducto = document.getElementById("input-producto");
    const inputLote = document.getElementById("input-lote");
    const selectArea = document.getElementById("select-area"); // hidden input
    const selectAreaSearch = document.getElementById("select-area-search");
    const dropdownSelectArea = document.getElementById("dropdown-select-area");
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
    const btnDeleteArea = document.getElementById("btn-delete-area");

    // Modal DOM Elements
    const scannerModal = document.getElementById("scanner-modal");
    const btnOpenScannerModal = document.getElementById("btn-open-scanner-modal");
    const modalBtnClose = document.getElementById("modal-btn-close");
    const modalBtnDone = document.getElementById("modal-btn-done");
    const modalInputProducto = document.getElementById("modal-input-producto");
    const modalInputLote = document.getElementById("modal-input-lote");
    const modalInputKg = document.getElementById("modal-input-kg");
    const modalSelectArea = document.getElementById("modal-select-area"); // hidden input
    const modalSelectAreaSearch = document.getElementById("modal-select-area-search");
    const dropdownModalSelectArea = document.getElementById("dropdown-modal-select-area");
    const modalBtnDeleteArea = document.getElementById("modal-btn-delete-area");
    const modalBadgeUser = document.getElementById("modal-badge-user");
    const modalBtnAdd = document.getElementById("modal-btn-add");
    const modalBtnClearSession = document.getElementById("modal-btn-clear-session");
    const modalScannedTbody = document.getElementById("modal-scanned-tbody");
    const modalEmptyState = document.getElementById("modal-empty-state");
    const modalSessionCount = document.getElementById("modal-session-count");
    const modalFooterArea = document.getElementById("modal-footer-area");
    const modalFooterTotal = document.getElementById("modal-footer-total");
    const modalFeedbackBar = document.getElementById("modal-feedback-bar");
    const modalFeedbackText = document.getElementById("modal-feedback-text");
    const stepColProducto = document.getElementById("step-col-producto");
    const stepColLote = document.getElementById("step-col-lote");

    // Safe Storage helper (handles SecurityError when localStorage is partitioned or blocked)
    const memStorage = {};
    function safeStorageGet(key, defaultVal = "") {
        try {
            const val = localStorage.getItem(key);
            return val !== null ? val : defaultVal;
        } catch (e) {
            return memStorage[key] !== undefined ? memStorage[key] : defaultVal;
        }
    }

    function safeStorageSet(key, val) {
        try {
            localStorage.setItem(key, val);
        } catch (e) {}
        memStorage[key] = val;
    }

    // 2. State
    const ACTIVE_AREA_KEY = "active_area";
    const ACTIVE_USER_KEY = "active_user";
    let activeArea = normalizeArea(safeStorageGet(ACTIVE_AREA_KEY, "PRUEBA"));
    let activeUser = normalizeUser(safeStorageGet(ACTIVE_USER_KEY, "Almacen1"));
    let isApplyingRemoteData = false;
    let isInventoryDeletionInProgress = false;
    let syncTimer = null;
    let pullTimer = null;
    let lastAppliedServerSignature = "";
    let currentTab = "inventory"; // "inventory" | "reserved" | "peticiones" | "historial"
    let historialLoaded = false; // Lazy-load: only fetch historial when tab is first opened
    let sessionScannedRows = []; // Products scanned during active session
    let isScannerModalOpen = false;
    let modalFeedbackTimer = null;

    const DEFAULT_LOCATIONS = (() => {
        const locs = ["PRUEBA"];
        const letters = ["A", "B", "C", "D", "E", "F"];
        for (const letter of letters) {
            for (let n = 1; n <= 100; n++) {
                locs.push(n + letter);
            }
        }
        return locs;
    })();

    function getDeletedLocations() {
        try {
            const d = JSON.parse(safeStorageGet("deleted_locations", "[]"));
            return Array.isArray(d) ? d.map(x => String(x).trim().toUpperCase()) : [];
        } catch (e) {
            return [];
        }
    }

    function getAvailableLocations() {
        const deletedLocs = getDeletedLocations();
        const locSet = new Set(DEFAULT_LOCATIONS);
        
        // Add custom locations saved in storage
        try {
            const customLocs = JSON.parse(safeStorageGet("custom_locations", "[]"));
            if (Array.isArray(customLocs)) {
                customLocs.forEach(loc => {
                    if (loc && String(loc).trim()) locSet.add(String(loc).trim().toUpperCase());
                });
            }
        } catch (e) {}

        // Add any unique locations from table data
        if (typeof table !== "undefined" && table && table.getData) {
            try {
                const data = table.getData();
                data.forEach(r => {
                    if (r.Ubicacion && String(r.Ubicacion).trim()) {
                        locSet.add(String(r.Ubicacion).trim().toUpperCase());
                    }
                });
            } catch (e) {}
        }

        if (activeArea) locSet.add(activeArea);

        // Filter out deleted locations blacklist
        deletedLocs.forEach(d => {
            locSet.delete(d);
        });

        return Array.from(locSet).sort((a, b) => {
            if (a === "PRUEBA") return -1;
            if (b === "PRUEBA") return 1;

            // Group by letter, then by numeric prefix (e.g. 1A, 2A.. 100A, then 1B, 2B.. 100B)
            const matchA = String(a).match(/^(\d+)([A-Z]+)$/);
            const matchB = String(b).match(/^(\d+)([A-Z]+)$/);

            if (matchA && matchB) {
                if (matchA[2] === matchB[2]) {
                    return Number(matchA[1]) - Number(matchB[1]);
                }
                return matchA[2].localeCompare(matchB[2]);
            }
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
        });
    }

    function removeLocationFromStorage(loc) {
        const cleanLoc = String(loc).trim().toUpperCase();
        
        // 1. Remove from custom_locations
        try {
            let customLocs = JSON.parse(safeStorageGet("custom_locations", "[]"));
            customLocs = customLocs.filter(l => String(l).trim().toUpperCase() !== cleanLoc);
            safeStorageSet("custom_locations", JSON.stringify(customLocs));
        } catch (e) {}

        // 2. Add to deleted_locations blacklist
        try {
            let deletedLocs = getDeletedLocations();
            if (!deletedLocs.includes(cleanLoc)) {
                deletedLocs.push(cleanLoc);
                safeStorageSet("deleted_locations", JSON.stringify(deletedLocs));
            }
        } catch (e) {}

        // 3. Switch activeArea if it was the deleted location
        if (activeArea === cleanLoc) {
            const remaining = getAvailableLocations();
            activeArea = remaining[0] || "PRUEBA";
            safeStorageSet(ACTIVE_AREA_KEY, activeArea);
            renderActiveArea();
            pushActiveAreaToServer(activeArea);
        } else {
            populateLocationSelects();
        }
    }

    async function promptDeleteLocation(sourceSelect) {
        const targetLoc = (sourceSelect ? sourceSelect.value : activeArea) || activeArea;
        if (!targetLoc || targetLoc === "__NEW_LOCATION__") {
            Swal.fire({
                icon: 'info',
                title: 'Selecciona una ubicación',
                text: 'Por favor selecciona la ubicación que deseas eliminar.',
                confirmButtonColor: '#1a365d'
            });
            return;
        }

        // Check if there are rows in inventory with this location
        const allRows = (typeof table !== "undefined" && table && table.getData) ? table.getData() : [];
        const affectedRows = allRows.filter(r => String(r.Ubicacion).trim().toUpperCase() === targetLoc.toUpperCase());

        if (affectedRows.length > 0) {
            const result = await Swal.fire({
                title: `¿Eliminar "${targetLoc}"?`,
                html: `<div style="text-align: left; padding: 5px;">
                         <p style="color: #b91c1c; font-weight: bold; margin-bottom: 8px;">⚠️ Hay <b>${affectedRows.length} producto(s)</b> registrados en esta ubicación.</p>
                         <p style="font-size: 0.95em; color: #4b5563; margin-bottom: 0;">¿Deseas mover estos productos a otra área o eliminarlos junto con la ubicación?</p>
                       </div>`,
                icon: 'warning',
                showDenyButton: true,
                showCancelButton: true,
                confirmButtonText: '📦 Mover a otra área',
                denyButtonText: '🗑️ Eliminar productos y área',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#1a365d',
                denyButtonColor: '#dc2626',
                cancelButtonColor: '#64748b'
            });

            if (result.isConfirmed) {
                // Reassign products to a different area
                const remainingLocs = getAvailableLocations().filter(l => l !== targetLoc);
                const inputOptions = {};
                remainingLocs.forEach(l => { inputOptions[l] = l; });

                const { value: newDestination } = await Swal.fire({
                    title: 'Selecciona el área destino',
                    text: `¿A qué ubicación deseas mover los ${affectedRows.length} productos de "${targetLoc}"?`,
                    input: 'select',
                    inputOptions: inputOptions,
                    inputPlaceholder: 'Selecciona una ubicación...',
                    showCancelButton: true,
                    confirmButtonColor: '#1a365d',
                    inputValidator: (val) => !val ? 'Debes seleccionar una ubicación destino' : undefined
                });

                if (newDestination) {
                    await fetch("/api/inventory/delete-area", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ area: targetLoc, deleteProducts: false, newArea: newDestination, usuario: activeUser })
                    }).catch(console.error);

                    removeLocationFromStorage(targetLoc);
                    activeArea = newDestination;
                    safeStorageSet(ACTIVE_AREA_KEY, activeArea);
                    renderActiveArea();
                    applyGlobalSearch();
                    Swal.fire({
                        icon: 'success',
                        title: 'Ubicación Reasignada y Eliminada',
                        text: `Se movieron ${affectedRows.length} producto(s) a "${newDestination}" y se eliminó "${targetLoc}".`,
                        timer: 2500,
                        showConfirmButton: false
                    });
                }
            } else if (result.isDenied) {
                // Delete products and location atomically on server
                await fetch("/api/inventory/delete-area", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ area: targetLoc, deleteProducts: true, usuario: activeUser })
                }).catch(console.error);

                removeLocationFromStorage(targetLoc);
                applyGlobalSearch();
                Swal.fire({
                    icon: 'success',
                    title: 'Ubicación y Productos Eliminados',
                    text: `Se eliminó "${targetLoc}" y sus ${affectedRows.length} productos.`,
                    timer: 2500,
                    showConfirmButton: false
                });
            }
        } else {
            // No products in location: direct confirmation
            const confirmDelete = await Swal.fire({
                title: `¿Eliminar ubicación "${targetLoc}"?`,
                text: `Esta ubicación está vacía y se removerá de los selectores.`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#dc2626',
                cancelButtonColor: '#64748b'
            });

            if (confirmDelete.isConfirmed) {
                await fetch("/api/inventory/delete-area", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ area: targetLoc, deleteProducts: true, usuario: activeUser })
                }).catch(console.error);

                removeLocationFromStorage(targetLoc);
                showModalFeedback(`🗑️ Ubicación "${targetLoc}" eliminada`);
                Swal.fire({
                    icon: 'success',
                    title: 'Ubicación Eliminada',
                    text: `Se eliminó "${targetLoc}" correctamente.`,
                    timer: 1800,
                    showConfirmButton: false
                });
            }
        }
    }

    async function promptAddNewLocation(sourceSelect) {
        const { value: newLoc, isConfirmed } = await Swal.fire({
            title: '📍 Nueva Ubicación',
            text: 'Escribe el nombre o código de la nueva área / tarima:',
            input: 'text',
            inputPlaceholder: 'Ejemplo: C1 T18, D3, REVISIÓN...',
            showCancelButton: true,
            confirmButtonText: 'Guardar y Asignar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#1a365d',
            cancelButtonColor: '#718096',
            inputValidator: (value) => {
                if (!value || !value.trim()) {
                    return 'Debes escribir una ubicación válida';
                }
            }
        });

        if (isConfirmed && newLoc && newLoc.trim()) {
            const cleanLoc = newLoc.trim().toUpperCase();
            
            // Remove from deleted_locations if previously deleted
            try {
                let deletedLocs = getDeletedLocations();
                deletedLocs = deletedLocs.filter(l => l !== cleanLoc);
                localStorage.setItem("deleted_locations", JSON.stringify(deletedLocs));
            } catch (e) {}

            let customLocs = [];
            try {
                customLocs = JSON.parse(localStorage.getItem("custom_locations") || "[]");
            } catch (e) {
                customLocs = [];
            }
            if (!customLocs.includes(cleanLoc)) {
                customLocs.push(cleanLoc);
                localStorage.setItem("custom_locations", JSON.stringify(customLocs));
            }

            activeArea = cleanLoc;
            localStorage.setItem(ACTIVE_AREA_KEY, activeArea);
            renderActiveArea();
            pushActiveAreaToServer(activeArea);
            showModalFeedback(`✅ Nueva ubicación asignada: ${cleanLoc}`);
        } else {
            // Revert dropdown selection to current activeArea
            if (sourceSelect) {
                sourceSelect.value = activeArea;
            }
        }
    }

    // ---- Searchable Select Combobox Engine ----
    function initSearchableSelect(hiddenInput, searchInput, dropdown, onChange) {
        if (!hiddenInput || !searchInput || !dropdown) return null;

        let allOptions = []; // [{value, label, isAction}]
        let highlightedIdx = -1;
        let isOpen = false;

        function renderDropdown(filter) {
            dropdown.innerHTML = "";
            const query = (filter || "").trim().toUpperCase();
            let filtered = allOptions.filter(o => !o.isAction && o.label.toUpperCase().includes(query));

            // Limit rendered items for performance (600 locations)
            const MAX_VISIBLE = 80;
            const truncated = filtered.length > MAX_VISIBLE;
            if (truncated) filtered = filtered.slice(0, MAX_VISIBLE);

            if (filtered.length === 0 && !query) {
                filtered = allOptions.filter(o => !o.isAction).slice(0, MAX_VISIBLE);
            }

            filtered.forEach((opt, idx) => {
                const div = document.createElement("div");
                div.className = "searchable-select-option" + (opt.value === hiddenInput.value ? " selected" : "");
                div.textContent = opt.label;
                div.dataset.value = opt.value;
                div.dataset.idx = idx;
                div.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    selectOption(opt.value, opt.label);
                });
                dropdown.appendChild(div);
            });

            if (filtered.length === 0) {
                const noRes = document.createElement("div");
                noRes.className = "searchable-select-no-results";
                noRes.textContent = "Sin resultados para \"" + (filter || "") + "\"";
                dropdown.appendChild(noRes);
            }

            if (truncated) {
                const more = document.createElement("div");
                more.className = "searchable-select-no-results";
                more.textContent = "Escribe para refinar...";
                dropdown.appendChild(more);
            }

            // Add action option
            const actionOpts = allOptions.filter(o => o.isAction);
            actionOpts.forEach(opt => {
                const div = document.createElement("div");
                div.className = "searchable-select-option action-option";
                div.textContent = opt.label;
                div.dataset.value = opt.value;
                div.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    selectOption(opt.value, opt.label);
                });
                dropdown.appendChild(div);
            });

            highlightedIdx = -1;
        }

        function selectOption(value, label) {
            closeDropdown();
            if (value === "__NEW_LOCATION__") {
                searchInput.value = hiddenInput.value || activeArea;
                if (onChange) onChange(value);
                return;
            }
            hiddenInput.value = value;
            searchInput.value = value;
            if (onChange) onChange(value);
        }

        function openDropdown() {
            if (isOpen) return;
            isOpen = true;
            renderDropdown(searchInput.value);
            dropdown.classList.add("open");
        }

        function closeDropdown() {
            isOpen = false;
            dropdown.classList.remove("open");
            highlightedIdx = -1;
        }

        searchInput.addEventListener("focus", () => {
            searchInput.select();
            openDropdown();
        });

        searchInput.addEventListener("input", () => {
            openDropdown();
            renderDropdown(searchInput.value);
        });

        searchInput.addEventListener("blur", () => {
            // Delay to allow mousedown on option
            setTimeout(() => {
                closeDropdown();
                // If user typed something that is not a valid option, revert
                const typed = (searchInput.value || "").trim().toUpperCase();
                const match = allOptions.find(o => o.value === typed && !o.isAction);
                if (match) {
                    hiddenInput.value = match.value;
                    searchInput.value = match.value;
                    if (onChange) onChange(match.value);
                } else {
                    // Revert to current hidden value
                    searchInput.value = hiddenInput.value || "";
                }
            }, 180);
        });

        searchInput.addEventListener("keydown", (e) => {
            const items = dropdown.querySelectorAll(".searchable-select-option");
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!isOpen) { openDropdown(); return; }
                highlightedIdx = Math.min(highlightedIdx + 1, items.length - 1);
                updateHighlight(items);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                highlightedIdx = Math.max(highlightedIdx - 1, 0);
                updateHighlight(items);
            } else if (e.key === "Enter" || e.key === "Tab") {
                if (isOpen && highlightedIdx >= 0 && highlightedIdx < items.length) {
                    e.preventDefault();
                    items[highlightedIdx].dispatchEvent(new MouseEvent("mousedown"));
                } else if (isOpen) {
                    // Auto-select first visible match if user typed something
                    const firstItem = dropdown.querySelector(".searchable-select-option:not(.action-option)");
                    if (firstItem) {
                        e.preventDefault();
                        firstItem.dispatchEvent(new MouseEvent("mousedown"));
                    }
                }
            } else if (e.key === "Escape") {
                closeDropdown();
                searchInput.value = hiddenInput.value || "";
            }
        });

        function updateHighlight(items) {
            items.forEach((it, i) => {
                it.classList.toggle("highlighted", i === highlightedIdx);
            });
            if (items[highlightedIdx]) {
                items[highlightedIdx].scrollIntoView({ block: "nearest" });
            }
        }

        return {
            setOptions(opts) {
                allOptions = opts;
            },
            setValue(val) {
                hiddenInput.value = val;
                searchInput.value = val;
            },
            getValue() {
                return hiddenInput.value;
            }
        };
    }

    // ---- Searchable select instances ----
    const searchableMain = initSearchableSelect(selectArea, selectAreaSearch, dropdownSelectArea, (val) => {
        if (val === "__NEW_LOCATION__") {
            promptAddNewLocation({ value: selectArea.value, _isSearchable: true });
            return;
        }
        const nextArea = normalizeArea(val);
        if (nextArea) {
            activeArea = nextArea;
            safeStorageSet(ACTIVE_AREA_KEY, activeArea);
            renderActiveArea();
            pushActiveAreaToServer(activeArea);
        }
    });

    const searchableModal = initSearchableSelect(modalSelectArea, modalSelectAreaSearch, dropdownModalSelectArea, (val) => {
        if (val === "__NEW_LOCATION__") {
            promptAddNewLocation({ value: modalSelectArea.value, _isSearchable: true });
            return;
        }
        const nextArea = normalizeArea(val);
        if (nextArea) {
            activeArea = nextArea;
            safeStorageSet(ACTIVE_AREA_KEY, activeArea);
            renderActiveArea();
            pushActiveAreaToServer(activeArea);
            if (modalFooterArea) modalFooterArea.textContent = activeArea;
            updateSessionLocations(nextArea);
        }
    });

    function populateLocationSelects() {
        const deletedLocs = getDeletedLocations();
        const locations = getAvailableLocations();
        let currentSelected = activeArea;
        if (deletedLocs.includes(currentSelected)) {
            currentSelected = locations[0] || "PRUEBA";
        }

        const opts = locations.map(loc => ({ value: loc, label: loc, isAction: false }));
        opts.push({ value: "__NEW_LOCATION__", label: "➕ Añadir nueva ubicación...", isAction: true });

        if (searchableMain) {
            searchableMain.setOptions(opts);
            searchableMain.setValue(currentSelected);
        }
        if (searchableModal) {
            searchableModal.setOptions(opts);
            searchableModal.setValue(currentSelected);
        }
    }

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
        safeStorageSet(ACTIVE_USER_KEY, activeUser);

        const petUsuarioInput = document.getElementById("pet-usuario");
        if (petUsuarioInput && !petUsuarioInput.value.trim()) {
            petUsuarioInput.value = activeUser;
        }
    }

    function renderActiveArea() {
        currentAreaBadge.textContent = activeArea || "SIN AREA";
        populateLocationSelects();
        if (modalFooterArea) modalFooterArea.textContent = activeArea;
    }

    function setActiveArea() {
        const nextArea = normalizeArea(selectArea ? selectArea.value : "");
        if (!nextArea) {
            alert("Debes seleccionar un área válida.");
            return false;
        }

        activeArea = nextArea;
        safeStorageSet(ACTIVE_AREA_KEY, activeArea);
        renderActiveArea();
        pushActiveAreaToServer(activeArea);
        inputProducto?.focus();
        return true;
    }

    function syncAreaFromInputSilently() {
        const nextArea = normalizeArea(selectArea ? selectArea.value : "");
        if (!nextArea || nextArea === activeArea) {
            return;
        }

        activeArea = nextArea;
        safeStorageSet(ACTIVE_AREA_KEY, activeArea);
        renderActiveArea();
        pushActiveAreaToServer(activeArea);
    }

    function setActiveAreaFromServer(value) {
        const nextArea = normalizeArea(value);
        if (!nextArea || nextArea === activeArea) {
            return;
        }

        activeArea = nextArea;
        safeStorageSet(ACTIVE_AREA_KEY, activeArea);
        renderActiveArea();
    }

    function extractBatchNumber(value) {
        const raw = String(value || "").trim();
        const digits = raw.replace(/\D/g, "");
        return digits ? Number(digits) : NaN;
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
        height: "65vh", // Fixed height enables virtual DOM rendering (only visible rows in DOM)
        layout: "fitColumns",
        responsiveLayout: "hide",
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
            titleSpan.style.cssText = "font-weight: 800; color: #ffffff; background-color: #1e3a8a; padding: 3px 10px; border-radius: 6px; font-size: 0.85rem; letter-spacing: 0.02em;";
            titleSpan.textContent = `Área: ${printValue}`;
            
            const countSpan = document.createElement("span");
            countSpan.style.cssText = "font-size: 0.78rem; font-weight: 700; background: #e0f2fe; color: #0369a1; padding: 2px 9px; border-radius: 999px; border: 1px solid #bae6fd;";
            countSpan.textContent = `${count} Productos`;
            
            leftDiv.appendChild(cb);
            leftDiv.appendChild(titleSpan);
            leftDiv.appendChild(countSpan);
            
            const rightDiv = document.createElement("div");
            
            const delBtn = document.createElement("button");
            delBtn.className = "group-delete-selected-btn";
            delBtn.style.cssText = "color: #dc2626; background-color: #fee2e2; border: 1px solid #fca5a5; border-radius: 6px; padding: 3px 10px; margin-left: 15px; cursor: pointer; font-weight: 700; font-size: 0.75rem; transition: all 0.15s ease;";
            delBtn.textContent = "🗑️ Eliminar Seleccionados";
            delBtn.onmouseover = () => { delBtn.style.backgroundColor = "#ef4444"; delBtn.style.color = "#ffffff"; };
            delBtn.onmouseout = () => { delBtn.style.backgroundColor = "#fee2e2"; delBtn.style.color = "#dc2626"; };
            
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
                        const idsToDelete = selectedRows.map(row => row.getIndex());
                        await table.deleteRow(idsToDelete);
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
                titleFormatter: function() {
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.className = "global-select-all-checkbox";
                    checkbox.style.cssText = "width: 16px; height: 16px; cursor: pointer; display: block; margin: 0 auto;";
                    checkbox.title = "Seleccionar todos los filtrados";
                    
                    checkbox.addEventListener("click", function(e) {
                        e.stopPropagation();
                    });
                    
                    checkbox.addEventListener("change", function(e) {
                        const isChecked = e.target.checked;
                        const activeRows = table.getRows("active");
                        if (isChecked) {
                            activeRows.forEach(row => row.select());
                        } else {
                            activeRows.forEach(row => row.deselect());
                        }
                    });
                    
                    return checkbox;
                },
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
                    return "<button tabindex='-1' style='color: #dc2626; background-color: #fee2e2; border: 1px solid #fca5a5; border-radius: 4px; padding: 2px 7px; cursor: pointer; font-weight: bold; font-size: 0.8rem; transition: all 0.15s ease;'>✕</button>";
                },
                width: 50,
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
                            const rowData = cell.getRow().getData();
                            await cell.getRow().delete();
                            await fetch(`/api/inventory/delete/${rowData.id}`, {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ usuario: activeUser })
                            });
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
                    return "<button tabindex='-1' style='color: #dc2626; background-color: #fee2e2; border: 1px solid #fca5a5; border-radius: 4px; padding: 2px 7px; cursor: pointer; font-weight: bold; font-size: 0.8rem; transition: all 0.15s ease;'>✕</button>";
                },
                width: 50,
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

    table.on("cellEdited", async function(cell) {
        if (isApplyingRemoteData) return;
        const rowData = cell.getRow().getData();
        try {
            await fetch("/api/inventory/update", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ row: rowData, usuario: activeUser })
            });
        } catch (error) {
            console.error("Error al actualizar la celda:", error);
        }
    });

    function cleanStr(s) {
        if (!s) return "";
        return String(s)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function compactStr(s) {
        return cleanStr(s).replace(/[\s\-_./\\]/g, "");
    }

    function parseSearchTokens(rawTerm) {
        const cleaned = cleanStr(rawTerm);
        // Normalize location codes like "17 b", "17-b", "a 1" into "17b", "a1"
        const normalizedCodes = cleaned
            .replace(/\b(\d+)\s*[\-_]?\s*([a-z])\b/gi, "$1$2")
            .replace(/\b([a-z])\s*[\-_]?\s*(\d+)\b/gi, "$1$2");

        const tokens = normalizedCodes.split(/\s+/).filter(Boolean);
        const compactTokens = tokens.map(t => compactStr(t)).filter(Boolean);
        return { tokens, compactTokens, rawCompact: compactStr(rawTerm) };
    }

    function applyGlobalSearch() {
        const rawTerm = (inputSearch.value || "").trim();

        if (!rawTerm) {
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

        const { tokens, compactTokens, rawCompact } = parseSearchTokens(rawTerm);

        table.setGroupBy(false);
        table.setSort([
            { column: "Producto", dir: "asc" },
            { column: "Lote", dir: "asc" }
        ]);

        table.setFilter(function (rowData) {
            const isReserved = Boolean(rowData.Reservado);
            if (currentTab === "inventory" && isReserved) return false;
            if (currentTab === "reserved" && !isReserved) return false;

            const ubicacion = cleanStr(rowData.Ubicacion);
            const producto = cleanStr(rowData.Producto);
            const nombre = cleanStr(rowData.Nombre);
            const lote = cleanStr(rowData.Lote);
            const comentarios = cleanStr(rowData.Comentarios);

            const compactUbicacion = compactStr(rowData.Ubicacion);
            const compactProducto = compactStr(rowData.Producto);
            const compactNombre = compactStr(rowData.Nombre);
            const compactLote = compactStr(rowData.Lote);
            const compactComentarios = compactStr(rowData.Comentarios);

            const cleanedTerm = cleanStr(rawTerm);

            // 1. Direct match on any field (full or partial, compact or normalized)
            if (rawCompact && (
                compactUbicacion.includes(rawCompact) ||
                ubicacion.includes(cleanedTerm) ||
                compactProducto.includes(rawCompact) ||
                producto.includes(cleanedTerm) ||
                compactNombre.includes(rawCompact) ||
                nombre.includes(cleanedTerm) ||
                compactLote.includes(rawCompact) ||
                lote.includes(cleanedTerm) ||
                compactComentarios.includes(rawCompact) ||
                comentarios.includes(cleanedTerm)
            )) {
                return true;
            }

            // 2. Tokenized multi-word search (every token must match at least one field)
            return tokens.length > 0 && tokens.every((token, idx) => {
                const compactToken = compactTokens[idx] || token;
                return (
                    compactUbicacion.includes(compactToken) ||
                    ubicacion.includes(token) ||
                    compactProducto.includes(compactToken) ||
                    producto.includes(token) ||
                    compactNombre.includes(compactToken) ||
                    nombre.includes(token) ||
                    compactLote.includes(compactToken) ||
                    lote.includes(token) ||
                    compactComentarios.includes(compactToken) ||
                    comentarios.includes(token)
                );
            });
        });
    }

    tabInventory?.addEventListener("click", () => setTab("inventory"));
    tabReserved?.addEventListener("click", () => setTab("reserved"));
    tabPeticiones?.addEventListener("click", () => setTab("peticiones"));
    tabHistorial?.addEventListener("click", () => {
        setTab("historial");
        // Lazy-load historial data on first click
        if (!historialLoaded) {
            historialLoaded = true;
            fetch("/api/historial")
                .then(r => r.json())
                .then(payload => {
                    historialTable.setData(Array.isArray(payload.historial) ? payload.historial : []);
                })
                .catch(err => console.error("Error cargando historial:", err));
        }
    });

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

    socket.on("inventory_row_added", async function (row) {
        isApplyingRemoteData = true;
        await table.updateOrAddData([row]);
        isApplyingRemoteData = false;
        applyGlobalSearch();
        populateLocationSelects();
    });

    socket.on("inventory_row_updated", async function (row) {
        isApplyingRemoteData = true;
        await table.updateOrAddData([row]);
        isApplyingRemoteData = false;
        applyGlobalSearch();
        populateLocationSelects();
    });

    socket.on("inventory_row_deleted", async function (id) {
        isApplyingRemoteData = true;
        await table.deleteRow(id).catch(e => console.log('Fila ya estaba eliminada', e));
        isApplyingRemoteData = false;
        applyGlobalSearch();
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

        // Historial is lazy-loaded: only apply if tab was already opened
        if (payload.historial && historialLoaded) {
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
        // Only update historial table if user has already opened the tab
        if (historialLoaded) {
            historialTable.setData(Array.isArray(historial) ? historial : []);
        }
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
        loadInventoryFromServer(false); // Refrescar en caso de desconexion
    });

    // =========================================================================
    // POP-UP / MODAL REAL-TIME SCANNING ENGINE
    // =========================================================================

    // 5. Audio feedback with Web Audio API (no external file needed)
    function playConfirmationBeep() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime); // 880Hz (A5)
            osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.08); // 1174Hz (D6)
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.16);
        } catch (e) {
            // Audio context can fail gracefully without throwing
        }
    }

    function showModalFeedback(text, isError = false) {
        if (!modalFeedbackBar || !modalFeedbackText) return;
        if (modalFeedbackTimer) clearTimeout(modalFeedbackTimer);

        modalFeedbackText.textContent = text;
        modalFeedbackBar.style.backgroundColor = isError ? "#fef2f2" : "#ecfdf5";
        modalFeedbackBar.style.borderLeftColor = isError ? "#ef4444" : "#10b981";
        modalFeedbackBar.style.color = isError ? "#991b1b" : "#065f46";
        modalFeedbackBar.classList.remove("hidden");

        modalFeedbackTimer = setTimeout(() => {
            modalFeedbackBar.classList.add("hidden");
            modalFeedbackTimer = null;
        }, 3500);
    }

    function setModalStep(step) {
        if (step === 1) {
            stepColProducto?.classList.add("active");
            stepColLote?.classList.remove("active");
        } else if (step === 2) {
            stepColProducto?.classList.remove("active");
            stepColLote?.classList.add("active");
        }
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function renderSessionTable() {
        if (!modalScannedTbody || !modalEmptyState) return;

        const count = sessionScannedRows.length;
        if (modalSessionCount) {
            modalSessionCount.textContent = `${count} escaneado${count === 1 ? "" : "s"}`;
        }
        if (modalFooterTotal) {
            modalFooterTotal.textContent = `${count} tambo${count === 1 ? "" : "s"}`;
        }

        if (count === 0) {
            modalEmptyState.classList.remove("hidden");
            modalScannedTbody.innerHTML = "";
            return;
        }

        modalEmptyState.classList.add("hidden");

        let html = "";
        sessionScannedRows.forEach((row, index) => {
            const isLatest = index === 0;
            html += `
                <tr class="${isLatest ? 'newly-scanned' : ''}">
                    <td class="cell-index">${count - index}</td>
                    <td class="cell-time">${row._scannedAt || '--:--'}</td>
                    <td><span class="cell-area-badge">${escapeHtml(row.Ubicacion || activeArea)}</span></td>
                    <td class="cell-prod-code">${escapeHtml(row.Producto)}</td>
                    <td class="cell-prod-name">${escapeHtml(row.Nombre || 'Sin Nombre')}</td>
                    <td><span class="cell-lote-badge">${escapeHtml(row.Lote)}</span></td>
                    <td class="cell-kg">${row.KG ?? 25} kg</td>
                    <td style="text-align: center;">
                        <button class="btn-del-scanned" data-row-id="${row.id}" title="Eliminar este escaneo">❌</button>
                    </td>
                </tr>
            `;
        });

        modalScannedTbody.innerHTML = html;

        // Attach event listeners for delete buttons
        modalScannedTbody.querySelectorAll(".btn-del-scanned").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const rowId = e.currentTarget.getAttribute("data-row-id");
                await deleteRowFromSession(rowId);
            });
        });
    }

    async function deleteRowFromSession(rowId) {
        const targetRow = sessionScannedRows.find(r => String(r.id) === String(rowId));
        if (!targetRow) return;

        const result = await Swal.fire({
            title: '¿Eliminar registro?',
            text: `¿Deseas eliminar ${targetRow.Producto} (Lote: ${targetRow.Lote}) de la sesión e inventario?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#f44336',
            cancelButtonColor: '#718096',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
        });

        if (result.isConfirmed) {
            sessionScannedRows = sessionScannedRows.filter(r => String(r.id) !== String(rowId));
            renderSessionTable();

            try {
                await table.deleteRow(rowId).catch(e => console.log('Fila ya no existía en tabla:', e));
                await fetch(`/api/inventory/delete/${rowId}`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ usuario: activeUser })
                });
                showModalFeedback(`🗑️ Se eliminó ${targetRow.Producto} (Lote: ${targetRow.Lote})`);
            } catch (err) {
                console.error("Error al eliminar fila desde modal:", err);
            }

            modalInputProducto?.focus();
        }
    }

    function updateSessionLocations(newArea) {
        const cleanArea = normalizeArea(newArea);
        if (!cleanArea || sessionScannedRows.length === 0) return;

        // Update all rows in current session
        sessionScannedRows.forEach(r => {
            r.Ubicacion = cleanArea;
            fetch("/api/inventory/update", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ row: r, usuario: activeUser })
            }).catch(e => console.error("Error al actualizar ubicación de fila:", e));
        });

        // Update Tabulator table
        table.updateOrAddData(sessionScannedRows);
        renderSessionTable();
        showModalFeedback(`📍 Ubicación de ${sessionScannedRows.length} tambo(s) actualizada a: ${cleanArea}`);
    }

    function openScannerModal(initialProduct = "") {
        isScannerModalOpen = true;
        scannerModal?.classList.remove("hidden");

        if (modalBadgeUser) modalBadgeUser.textContent = activeUser;
        populateLocationSelects();
        if (searchableModal) searchableModal.setValue(activeArea);
        if (modalFooterArea) modalFooterArea.textContent = activeArea;

        renderSessionTable();

        if (initialProduct) {
            if (modalInputProducto) modalInputProducto.value = initialProduct;
            if (modalInputLote) modalInputLote.value = "";
            setModalStep(2);
            setTimeout(() => modalInputLote?.focus(), 50);
        } else {
            if (modalInputProducto) modalInputProducto.value = "";
            if (modalInputLote) modalInputLote.value = "";
            setModalStep(1);
            setTimeout(() => modalInputProducto?.focus(), 50);
        }
    }

    function closeScannerModal(isFinalizing = true) {
        const totalSavedInSession = sessionScannedRows.length;

        isScannerModalOpen = false;
        scannerModal?.classList.add("hidden");

        // Sync modal area if user changed it in dropdown
        if (modalSelectArea) {
            const nextArea = normalizeArea(modalSelectArea.value);
            if (nextArea && nextArea !== activeArea && nextArea !== "__NEW_LOCATION__") {
                activeArea = nextArea;
                safeStorageSet(ACTIVE_AREA_KEY, activeArea);
                renderActiveArea();
                pushActiveAreaToServer(activeArea);
            }
        }

        // Reset session state for the next scan batch
        if (isFinalizing) {
            sessionScannedRows = [];
            renderSessionTable();
            if (modalInputProducto) modalInputProducto.value = "";
            if (modalInputLote) modalInputLote.value = "";
            setModalStep(1);

            // Re-apply search filter & refresh location dropdowns
            applyGlobalSearch();
            populateLocationSelects();

            if (totalSavedInSession > 0) {
                Swal.fire({
                    icon: 'success',
                    title: 'Captura Finalizada',
                    text: `Se registraron ${totalSavedInSession} tambo(s) en la ubicación ${activeArea}.`,
                    timer: 2200,
                    showConfirmButton: false
                });
            }
        }

        inputProducto?.focus();
    }

    async function queryProductName(prodVal) {
        if (!prodVal) return "";
        // 1. Re-use local in-memory table data if present (instant)
        const localData = (typeof table !== "undefined" && table && table.getData) ? table.getData() : [];
        const prevOccurence = localData.find(r => 
            String(r.Producto).trim().toUpperCase() === prodVal.toUpperCase() && 
            String(r.Nombre).trim() !== ""
        );

        if (prevOccurence) {
            return prevOccurence.Nombre;
        }

        // 2. Fetch from DB endpoint with fast timeout (600ms) so scanner never lags
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600);
        try {
            const resp = await fetch(`/api/product/${encodeURIComponent(prodVal)}`, {
                signal: controller.signal,
            });
            if (resp.ok) {
                const queryData = await resp.json();
                return queryData.name || "";
            }
        } catch (error) {
            // DB lookup offline or slow, proceed gracefully
        } finally {
            clearTimeout(timeoutId);
        }
        return "";
    }

    async function addNewRowFromModal() {
        const prodVal = (modalInputProducto?.value || "").trim().replace(/'/g, "-");
        const loteVal = (modalInputLote?.value || "").trim().replace(/'/g, "-").replace(/S$/i, "");
        const kgVal = parseFloat(modalInputKg?.value) || 25;

        // Target area from modal select or activeArea
        const targetArea = normalizeArea(modalSelectArea?.value) || activeArea;
        if (targetArea !== activeArea && targetArea !== "__NEW_LOCATION__") {
            activeArea = targetArea;
            safeStorageSet(ACTIVE_AREA_KEY, activeArea);
            renderActiveArea();
            pushActiveAreaToServer(activeArea);
            if (modalFooterArea) modalFooterArea.textContent = activeArea;
        }

        if (!prodVal) {
            showModalFeedback("⚠️ Ingresa o escanea el Código de Producto.", true);
            setModalStep(1);
            modalInputProducto?.focus();
            return;
        }

        if (!loteVal) {
            showModalFeedback("⚠️ Falta escanear el Lote.", true);
            setModalStep(2);
            modalInputLote?.focus();
            return;
        }

        // Instant input reset and step transition (Non-blocking: ready for next scan immediately)
        if (modalInputProducto) modalInputProducto.value = "";
        if (modalInputLote) modalInputLote.value = "";
        setModalStep(1);
        modalInputProducto?.focus();

        // Audio & Visual confirmation immediately
        playConfirmationBeep();
        showModalFeedback(`⚡ Registrando: ${prodVal} (Lote: ${loteVal})...`);

        // Check local cache for product name first
        const localData = (typeof table !== "undefined" && table && table.getData) ? table.getData() : [];
        const prevOccurence = localData.find(r => 
            String(r.Producto).trim().toUpperCase() === prodVal.toUpperCase() && 
            String(r.Nombre).trim() !== ""
        );
        let immediateName = prevOccurence ? prevOccurence.Nombre : "";

        const rowId = Date.now() + Math.random();
        const newRow = {
            id: rowId,
            Ubicacion: targetArea,
            Producto: prodVal,
            Nombre: immediateName,
            Lote: loteVal,
            KG: kgVal,
            Comentarios: "",
            Reservado: false,
            _scannedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };

        // Add to active session immediately
        sessionScannedRows.unshift(newRow);
        renderSessionTable();

        // Optimistic UI update on main table
        table.updateOrAddData([newRow]);

        // Background lookup & server push without blocking user input
        (async () => {
            let finalName = immediateName;
            if (!finalName) {
                finalName = await queryProductName(prodVal);
                if (finalName) {
                    newRow.Nombre = finalName;
                    // Update session row reference
                    const targetSessionRow = sessionScannedRows.find(r => r.id === rowId);
                    if (targetSessionRow) targetSessionRow.Nombre = finalName;
                    // Update table & modal display
                    if (typeof table !== "undefined" && table.updateData) {
                        table.updateData([{ id: rowId, Nombre: finalName }]);
                    }
                    renderSessionTable();
                }
            }

            showModalFeedback(`✅ Registrado: ${prodVal} - ${finalName || 'Sin Nombre'} (Lote: ${loteVal})`);

            // Send to server
            fetch("/api/inventory/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ row: newRow, usuario: activeUser })
            }).catch(err => console.error("Error al agregar fila:", err));
        })();
    }

    // 6. Manual add from main screen
    async function addNewRow() {
        syncAreaFromInputSilently();

        const prodVal = inputProducto.value.trim().replace(/'/g, "-");
        const loteVal = inputLote.value.trim().replace(/'/g, "-").replace(/S$/i, "");

        if (!prodVal || !loteVal) {
            alert("Ambos campos de Producto y Lote deben estar llenos antes de agregar.");
            return;
        }

        // Instant reset
        inputProducto.value = "";
        inputLote.value = "";
        inputProducto.focus();
        playConfirmationBeep();

        const localData = (typeof table !== "undefined" && table && table.getData) ? table.getData() : [];
        const prevOccurence = localData.find(r => 
            String(r.Producto).trim().toUpperCase() === prodVal.toUpperCase() && 
            String(r.Nombre).trim() !== ""
        );
        let immediateName = prevOccurence ? prevOccurence.Nombre : "";

        const rowId = Date.now() + Math.random();
        const newRow = {
            id: rowId,
            Ubicacion: activeArea,
            Producto: prodVal,
            Nombre: immediateName,
            Lote: loteVal,
            KG: 25,
            Comentarios: "",
            Reservado: false,
            _scannedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };

        sessionScannedRows.unshift(newRow);
        table.updateOrAddData([newRow]);

        // Background lookup & server push
        (async () => {
            let finalName = immediateName;
            if (!finalName) {
                finalName = await queryProductName(prodVal);
                if (finalName) {
                    newRow.Nombre = finalName;
                    if (typeof table !== "undefined" && table.updateData) {
                        table.updateData([{ id: rowId, Nombre: finalName }]);
                    }
                }
            }

            fetch("/api/inventory/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ row: newRow, usuario: activeUser })
            }).catch(err => console.error("Error al agregar fila:", err));
        })();
    }

    // 7. Modal and Scanner Event Listeners with Intelligent Burst Detection & Multi-Key Support
    let modalProdBurstTimer = null;
    let modalLoteBurstTimer = null;
    let mainProdBurstTimer = null;

    btnOpenScannerModal?.addEventListener("click", () => {
        // Sync active user if typed in main input
        if (inputUsuario && inputUsuario.value.trim()) {
            activeUser = normalizeUser(inputUsuario.value.trim());
            safeStorageSet(ACTIVE_USER_KEY, activeUser);
            renderActiveUser();
        }
        // Sync active area if typed in search input
        const currentAreaVal = normalizeArea(selectArea ? selectArea.value : "");
        if (currentAreaVal && currentAreaVal !== activeArea) {
            activeArea = currentAreaVal;
            safeStorageSet(ACTIVE_AREA_KEY, activeArea);
            renderActiveArea();
            pushActiveAreaToServer(activeArea);
        }
        openScannerModal();
    });
    modalBtnClose?.addEventListener("click", () => closeScannerModal(true));
    modalBtnDone?.addEventListener("click", () => closeScannerModal(true));

    modalBtnClearSession?.addEventListener("click", () => {
        if (sessionScannedRows.length === 0) return;
        sessionScannedRows = [];
        renderSessionTable();
        showModalFeedback("Lista de sesión limpiada");
        modalInputProducto?.focus();
    });

    // Click anywhere on Step 1 or Step 2 box to switch focus
    stepColProducto?.addEventListener("click", () => {
        setModalStep(1);
        modalInputProducto?.focus();
        modalInputProducto?.select();
    });

    stepColLote?.addEventListener("click", () => {
        setModalStep(2);
        modalInputLote?.focus();
        modalInputLote?.select();
    });

    function advanceToStep2() {
        const val = modalInputProducto?.value?.trim() || "";
        if (val !== "") {
            setModalStep(2);
            modalInputLote?.focus();
            modalInputLote?.select();
        }
    }

    // Modal Product Input Listeners
    modalInputProducto?.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === "Tab" || e.keyCode === 13 || e.keyCode === 9) {
            e.preventDefault();
            clearTimeout(modalProdBurstTimer);
            advanceToStep2();
        }
    });

    modalInputProducto?.addEventListener("input", function () {
        clearTimeout(modalProdBurstTimer);
        const val = (this.value || "").trim();
        // If scanner inputs a full barcode (>3 chars) and pauses for 350ms without Enter, auto-advance to Step 2
        if (val.length >= 3) {
            modalProdBurstTimer = setTimeout(() => {
                if (modalInputProducto && modalInputProducto.value.trim().length >= 3 && stepColProducto?.classList.contains("active")) {
                    advanceToStep2();
                }
            }, 350);
        }
    });

    // Modal Lote Input Listeners
    modalInputLote?.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === "Tab" || e.keyCode === 13 || e.keyCode === 9) {
            e.preventDefault();
            clearTimeout(modalLoteBurstTimer);
            addNewRowFromModal();
        }
    });

    modalInputLote?.addEventListener("input", function () {
        clearTimeout(modalLoteBurstTimer);
        const val = (this.value || "").trim();
        // If scanner inputs a full batch (>2 chars) and pauses for 350ms without Enter, auto-submit
        if (val.length >= 2) {
            modalLoteBurstTimer = setTimeout(() => {
                if (modalInputLote && modalInputLote.value.trim().length >= 2 && stepColLote?.classList.contains("active")) {
                    addNewRowFromModal();
                }
            }, 350);
        }
    });

    modalBtnAdd?.addEventListener("click", addNewRowFromModal);


    // Note: selectArea and modalSelectArea change handling is now done
    // by the searchableMain and searchableModal combobox instances above.


    // Auto-open modal on full barcode scan / Enter / Tab from main screen
    inputProducto?.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === "Tab" || e.keyCode === 13 || e.keyCode === 9) {
            e.preventDefault();
            clearTimeout(mainProdBurstTimer);
            const val = inputProducto.value.trim();
            inputProducto.value = "";
            openScannerModal(val);
        }
    });

    inputProducto?.addEventListener("input", function () {
        clearTimeout(mainProdBurstTimer);
        const val = (this.value || "").trim();
        // If barcode scanned on main screen without Enter key, auto-open modal after 350ms
        if (val.length >= 3 && !isScannerModalOpen) {
            mainProdBurstTimer = setTimeout(() => {
                if (inputProducto && inputProducto.value.trim().length >= 3 && !isScannerModalOpen) {
                    const scannedVal = inputProducto.value.trim();
                    inputProducto.value = "";
                    openScannerModal(scannedVal);
                }
            }, 350);
        }
    });

    inputLote?.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === "Tab" || e.keyCode === 13 || e.keyCode === 9) {
            e.preventDefault();
            addNewRow();
        }
    });

    // Global Key shortcuts & Smart barcode scanner listener
    window.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isScannerModalOpen) {
            closeScannerModal(true);
            return;
        }
        if (e.key === "F2" && !isScannerModalOpen) {
            e.preventDefault();
            openScannerModal();
            return;
        }

        // Ignore modifier / navigation keys
        if (e.ctrlKey || e.altKey || e.metaKey || e.key === "Tab" || e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "CapsLock") {
            return;
        }

        const activeEl = document.activeElement;
        const isInputFocused = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT");

        if (isScannerModalOpen) {
            // When modal is open: if focus is NOT on the active modal scan input (and not in area search)
            const isSearchableSelectFocused = activeEl === modalSelectAreaSearch;
            const isModalScanInput = activeEl === modalInputProducto || activeEl === modalInputLote || activeEl === modalInputKg;

            if (!isModalScanInput && !isSearchableSelectFocused) {
                const targetInput = (stepColLote && stepColLote.classList.contains("active")) ? modalInputLote : modalInputProducto;
                if (targetInput) {
                    targetInput.focus();
                    if (e.key.length === 1) {
                        targetInput.value += e.key;
                        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
                        e.preventDefault();
                    }
                }
            }
        } else {
            // When modal is closed: if focus is not in search/user input, redirect keystrokes directly to inputProducto
            const isMainAppInput = activeEl === inputSearch || activeEl === inputUsuario || activeEl === selectAreaSearch;
            if (!isMainAppInput && e.key.length === 1) {
                inputProducto?.focus();
                inputProducto.value += e.key;
                inputProducto.dispatchEvent(new Event("input", { bubbles: true }));
                e.preventDefault();
            }
        }
    });

    btnAdd.addEventListener("click", addNewRow);
    btnSetArea?.addEventListener("click", setActiveArea);
    btnDeleteArea?.addEventListener("click", () => promptDeleteLocation(selectArea));
    modalBtnDeleteArea?.addEventListener("click", () => promptDeleteLocation(modalSelectArea));

    inputUsuario.addEventListener("blur", syncUserFromInput);
    inputUsuario.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            syncUserFromInput();
            inputProducto.focus();
        }
    });

    inputSearch.addEventListener("input", applyGlobalSearch);

    // Global delete selected button logic
    const btnDeleteSelected = document.getElementById("btn-delete-selected");
    
    function updateDeleteButtonAndHeader() {
        const activeRows = table.getRows("active");
        const selectedActiveRows = activeRows.filter(r => r.isSelected());
        
        if (btnDeleteSelected) {
            const count = selectedActiveRows.length;
            btnDeleteSelected.disabled = count === 0;
            btnDeleteSelected.textContent = count > 0 ? `❌ Eliminar Seleccionados (${count})` : "❌ Eliminar Seleccionados";
        }

        const masterCb = document.querySelector(".global-select-all-checkbox");
        if (masterCb) {
            if (activeRows.length === 0) {
                masterCb.checked = false;
                masterCb.indeterminate = false;
            } else {
                const selectedActiveCount = selectedActiveRows.length;
                masterCb.checked = selectedActiveCount === activeRows.length;
                masterCb.indeterminate = selectedActiveCount > 0 && selectedActiveCount < activeRows.length;
            }
        }
    }

    if (btnDeleteSelected) {
        btnDeleteSelected.addEventListener("click", async function () {
            const activeRows = table.getRows("active");
            const selectedActiveRows = activeRows.filter(r => r.isSelected());
            if (selectedActiveRows.length === 0) return;

            const result = await Swal.fire({
                title: '¿Confirmar eliminación?',
                text: `¿Estás seguro de que deseas eliminar ${selectedActiveRows.length} registro(s) SELECCIONADO(S) de todas las áreas?`,
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
                    const idsToDelete = selectedActiveRows.map(row => row.getIndex());
                    await table.deleteRow(idsToDelete);
                    await syncInventoryDataToServer();

                    Swal.fire({
                        icon: 'success',
                        title: 'Eliminados',
                        text: 'Los registros han sido eliminados correctamente.',
                        timer: 2000,
                        showConfirmButton: false
                    });
                } catch (error) {
                    console.error("Error al eliminar seleccionados:", error);
                    Swal.fire('Error', 'No se pudieron eliminar todos los registros.', 'error');
                } finally {
                    isInventoryDeletionInProgress = false;
                    loadingOverlay.classList.add("hidden");
                }
            }
        });
    }

    table.on("rowSelectionChanged", updateDeleteButtonAndHeader);
    table.on("dataFiltered", updateDeleteButtonAndHeader);

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

    // Initial data is loaded via Socket.IO bootstrap_sync event (no need for separate HTTP fetch)
    // loadInventoryFromServer is only used for reconnection scenarios
    inputProducto.focus();
    updatePendingRequestsWarning();
}
