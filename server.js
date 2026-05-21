require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const http = require('http');
const sql = require('mssql');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const PORT = 5002;
const HOST = '192.168.2.218'; // Tu IP asignada para el servidor local
const DATA_FILE = path.join(__dirname, 'inventory-data.json');
const PETICIONES_FILE = path.join(__dirname, 'peticiones-data.json');
const HISTORIAL_FILE = path.join(__dirname, 'historial-data.json');
const ACTIVE_AREA_FILE = path.join(__dirname, 'active-area.txt');

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
    },
});

function loadInventoryData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            return [];
        }

        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('No se pudo leer inventory-data.json:', error.message);
        return [];
    }
}

async function saveInventoryData(data) {
    try {
        await fsPromises.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('No se pudo guardar inventory-data.json:', error.message);
    }
}

function loadPeticionesData() {
    try {
        if (!fs.existsSync(PETICIONES_FILE)) {
            return [];
        }
        const raw = fs.readFileSync(PETICIONES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('No se pudo leer peticiones-data.json:', error.message);
        return [];
    }
}

async function savePeticionesData(data) {
    try {
        await fsPromises.writeFile(PETICIONES_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('No se pudo guardar peticiones-data.json:', error.message);
    }
}

function loadHistorialData() {
    try {
        if (!fs.existsSync(HISTORIAL_FILE)) {
            return [];
        }
        const raw = fs.readFileSync(HISTORIAL_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('No se pudo leer historial-data.json:', error.message);
        return [];
    }
}

async function saveHistorialData(data) {
    try {
        await fsPromises.writeFile(HISTORIAL_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('No se pudo guardar historial-data.json:', error.message);
    }
}

function normalizeActor(value) {
    const actor = String(value || '').trim();
    return actor || 'Usuario no identificado';
}

function registerHistorialEvent(action, actor, details) {
    const event = {
        id: Date.now() + Math.random(),
        fecha: new Date().toISOString(),
        usuario: normalizeActor(actor),
        accion: action,
        detalle: details || '',
    };

    historialData.unshift(event);

    // Limita crecimiento del archivo de historial sin perder trazabilidad reciente.
    if (historialData.length > 2000) {
        historialData = historialData.slice(0, 2000);
    }

    saveHistorialData(historialData).catch(console.error);
    io.emit('historial_sync', historialData);
}

function loadActiveArea() {
    try {
        if (!fs.existsSync(ACTIVE_AREA_FILE)) {
            return 'A1';
        }

        const raw = fs.readFileSync(ACTIVE_AREA_FILE, 'utf8').trim();
        return raw || 'A1';
    } catch (error) {
        console.error('No se pudo leer active-area.txt:', error.message);
        return 'A1';
    }
}

async function saveActiveArea(area) {
    try {
        await fsPromises.writeFile(ACTIVE_AREA_FILE, String(area || 'A1'), 'utf8');
    } catch (error) {
        console.error('No se pudo guardar active-area.txt:', error.message);
    }
}

let inventoryData = loadInventoryData();
let peticionesData = loadPeticionesData();
let historialData = loadHistorialData();
let activeArea = loadActiveArea();

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname)); // Sirve index.html, style.css y app.js

io.on('connection', (socket) => {
    socket.emit('bootstrap_sync', {
        data: inventoryData,
        peticiones: peticionesData,
        historial: historialData,
        activeArea,
    });
});

app.get('/api/inventory', (_req, res) => {
    res.json({ data: inventoryData, activeArea });
});

app.get('/api/peticiones', (_req, res) => {
    res.json({ peticiones: peticionesData });
});

app.get('/api/historial', (_req, res) => {
    res.json({ historial: historialData });
});

app.post('/api/peticiones', (req, res) => {
    const newPeticion = req.body;
    if (!newPeticion.usuario || !newPeticion.producto || !newPeticion.cantidad) {
        return res.status(400).json({ error: 'Faltan datos requeridos (usuario, producto, cantidad)' });
    }
    
    const peticion = {
        id: Date.now() + Math.random(),
        usuario: newPeticion.usuario,
        producto: newPeticion.producto,
        cantidad: newPeticion.cantidad,
        estado: 'Pendiente', // Pendiente, Surtido
        fecha: new Date().toISOString()
    };
    
    peticionesData.push(peticion);
    savePeticionesData(peticionesData).catch(console.error);
    registerHistorialEvent(
        'Peticion creada',
        newPeticion.usuario,
        `${newPeticion.usuario} solicito ${newPeticion.cantidad} tambo(s) de ${newPeticion.producto}`
    );
    
    // Emitir nueva petición a todos, ideal para mostrar un popup
    io.emit('nueva_peticion', peticion);
    io.emit('peticiones_sync', peticionesData);
    
    res.json({ ok: true, peticion });
});

app.put('/api/peticiones', (req, res) => {
    const nextData = req.body && req.body.peticiones;
    const actor = req.body && req.body.usuario;
    if (!Array.isArray(nextData)) {
        return res.status(400).json({ error: 'Formato invalido.' });
    }

    const prevCount = peticionesData.length;
    peticionesData = nextData;
    savePeticionesData(peticionesData).catch(console.error);
    registerHistorialEvent(
        'Peticiones actualizadas',
        actor,
        `Total de peticiones: ${prevCount} -> ${peticionesData.length}`
    );
    io.emit('peticiones_sync', peticionesData);
    res.json({ ok: true });
});

app.put('/api/inventory', (req, res) => {
    const nextData = req.body && req.body.data;
    const actor = req.body && req.body.usuario;

    if (!Array.isArray(nextData)) {
        return res.status(400).json({ error: 'Formato invalido. Se espera { data: [] }' });
    }

    const previousCount = inventoryData.length;
    inventoryData = nextData;
    // Dispara el guardado en segundo plano (RAM primero, HDD despues) para respuesta instantánea
    saveInventoryData(inventoryData).catch(console.error);
    registerHistorialEvent(
        'Inventario actualizado',
        actor,
        `Registros de inventario: ${previousCount} -> ${inventoryData.length}`
    );
    io.emit('inventory_sync', inventoryData);

    res.json({ ok: true, count: inventoryData.length });
});

app.get('/api/active-area', (_req, res) => {
    res.json({ activeArea });
});

app.put('/api/active-area', (req, res) => {
    const incoming = req.body && req.body.activeArea;
    const actor = req.body && req.body.usuario;
    const nextArea = String(incoming || '').trim().toUpperCase();

    if (!nextArea) {
        return res.status(400).json({ error: 'activeArea es requerido' });
    }

    const previousArea = activeArea;
    activeArea = nextArea;
    // Dispara el guardado en segundo plano (RAM primero, HDD despues) para respuesta instantánea
    saveActiveArea(activeArea).catch(console.error);
    registerHistorialEvent(
        'Area activa modificada',
        actor,
        `Area: ${previousArea} -> ${activeArea}`
    );
    io.emit('area_sync', activeArea);

    res.json({ ok: true, activeArea });
});

// Configuración de la conexión a SQL Server
const sqlConfig = {
    user: 'sga_app_user',
    password: 'QuimicaBoss_2026!',
    database: 'SGA_Database',
    server: '192.168.2.237',
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    options: {
        encrypt: false,
        trustServerCertificate: false
    }
};

// Crear un pool de conexiones para reutilizar
const dbPool = new sql.ConnectionPool(sqlConfig);
const poolConnect = dbPool.connect().catch(err => {
    console.error('Error conectando inicialmente a SQL Server:', err);
});

// API Endpoint: Consultar el nombre del producto en SQL Server
app.get('/api/product/:code', async (req, res) => {
    const productCode = req.params.code;

    // Solo consultar para codigos IFF. Para el resto no se intenta conexion.
    if (!/^IFF/i.test(String(productCode || '').trim())) {
        return res.json({ name: '', source: 'skip_non_iff' });
    }
    
    try {
        await poolConnect; // asegurar que el pool este conectado
        
        const request = dbPool.request();
        request.input('code', sql.NVarChar, productCode);
        
        const result = await request.query(`SELECT chemical_name FROM products_master WHERE product_id = @code`);
        
        if (result.recordset && result.recordset.length > 0) {
            // Producto encontrado
            res.json({ name: result.recordset[0].chemical_name, source: 'sqlserver' });
        } else {
            // El producto no existe en la base de datos
            res.json({ name: '', source: 'not_found' });
        }
    } catch (err) {
        console.error("Error en la consulta de SQL Server:", err.message);
        return res.json({ name: '', source: 'query_error' });
    }
});

httpServer.listen(PORT, HOST, () => {
    console.log(`===============================================`);
    console.log(`Servidor de Captura de Inventario Iniciado`);
    console.log(`>> Accesible en: http://${HOST}:${PORT}/`);
    console.log(`>> Sync en tiempo real habilitado para varios equipos`);
    console.log(`===============================================`);
});
