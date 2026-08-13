const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const hana = require('@sap/hana-client');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3001;
const HOST = '192.168.2.218';

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/histogram', (req, res) => {
    const dataPath = path.join(__dirname, '../historial-data.json');
    if (!fs.existsSync(dataPath)) {
        return res.status(404).json({ error: 'Historial data not found' });
    }

    try {
        const rawData = fs.readFileSync(dataPath, 'utf8');
        const historial = JSON.parse(rawData);

        // 1. Filtrar solo 'Producto capturado'
        const capturados = historial.filter(d => d.accion === 'Producto capturado');

        // 2. Agrupar por usuario
        const byUser = {};
        capturados.forEach(d => {
            if (!byUser[d.usuario]) byUser[d.usuario] = [];
            byUser[d.usuario].push(d);
        });

        const tiemposPedido = []; // Tiempos en minutos

        // 3. Procesar sesiones y bloques de 10 productos
        for (const usuario in byUser) {
            const acciones = byUser[usuario].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
            
            let currentSession = [];
            
            for (let i = 0; i < acciones.length; i++) {
                const current = acciones[i];
                if (currentSession.length === 0) {
                    currentSession.push(current);
                } else {
                    const prev = currentSession[currentSession.length - 1];
                    const diffMins = (new Date(current.fecha) - new Date(prev.fecha)) / (1000 * 60);
                    
                    // Si pasaron más de 30 minutos sin escanear, empezamos una nueva sesión
                    if (diffMins > 30) {
                        // Procesar la sesión actual
                        extraerTiempos(currentSession, tiemposPedido);
                        currentSession = [current]; // Iniciar nueva sesión
                    } else {
                        currentSession.push(current);
                    }
                }
            }
            
            // Procesar la última sesión del usuario
            if (currentSession.length > 0) {
                extraerTiempos(currentSession, tiemposPedido);
            }
        }

        // 4. Crear los bins para el histograma
        const histograma = {
            labels: [],
            data: []
        };

        if (tiemposPedido.length > 0) {
            const maxTime = Math.ceil(Math.max(...tiemposPedido));
            // Definir tamaño de bin (ej. intervalos de 1 minuto o 0.5 dependiendo del max)
            const binSize = maxTime <= 10 ? 0.5 : (maxTime <= 50 ? 2 : 5);
            const numBins = Math.ceil(maxTime / binSize);
            
            const bins = new Array(numBins).fill(0);
            
            tiemposPedido.forEach(t => {
                let binIndex = Math.floor(t / binSize);
                if (binIndex >= numBins) binIndex = numBins - 1; // Manejo del límite superior
                bins[binIndex]++;
            });

            for (let i = 0; i < numBins; i++) {
                const start = (i * binSize).toFixed(1);
                const end = ((i + 1) * binSize).toFixed(1);
                histograma.labels.push(`${start} - ${end} min`);
                histograma.data.push(bins[i]);
            }
        }

        res.json({
            tiemposCrudos: tiemposPedido,
            histograma,
            totalPedidos: tiemposPedido.length
        });

    } catch (error) {
        console.error('Error processing data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function extraerTiempos(session, tiemposArr) {
    // Tomamos bloques NO superpuestos de 10 productos
    for (let i = 0; i <= session.length - 10; i += 10) {
        const bloque = session.slice(i, i + 10);
        const start = new Date(bloque[0].fecha);
        const end = new Date(bloque[9].fecha);
        const diffMins = (end - start) / (1000 * 60);
        tiemposArr.push(diffMins);
    }
}

app.get('/api/shipping-times', (req, res) => {
    // 1. Obtener eventos de impresión de etiquetas de SGA
    const sgaHistoryPath = 'c:/Users/QB_DESARROLLO/Desktop/SGA PROD/history.json';
    let printsByItem = {}; // ItemCode -> [timestamps]

    try {
        if (fs.existsSync(sgaHistoryPath)) {
            const raw = fs.readFileSync(sgaHistoryPath, 'utf8');
            const data = JSON.parse(raw);
            const prints = data.filter(d => d.event_type && d.event_type.includes('PRINT_JOB'));
            
            prints.forEach(p => {
                if (p.details && p.details.items) {
                    p.details.items.forEach(itemCode => {
                        if (!printsByItem[itemCode]) printsByItem[itemCode] = [];
                        printsByItem[itemCode].push(new Date(p.timestamp));
                    });
                }
            });
            // Ordenar por fecha para búsqueda binaria / rápida
            for (const item in printsByItem) {
                printsByItem[item].sort((a, b) => a - b);
            }
        }
    } catch (e) {
        console.error("Error leyendo SGA history:", e);
    }

    // 2. Conectar a SAP HANA para obtener Notas de Entrega (ODLN)
    const connection = hana.createConnection();
    const connOptions = {
        serverNode: process.env.HANA_SERVER_NODE,
        uid: process.env.HANA_USER,
        pwd: process.env.HANA_PASSWORD,
        currentSchema: process.env.HANA_DB_NAME
    };

    connection.connect(connOptions, function(err) {
        if (err) {
            console.error("SAP Connect error", err);
            return res.status(500).json({ error: 'SAP Connection failed' });
        }
        
        // Obtener remisiones recientes (ej. limitadas a 1000 o fechas recientes)
        const query = `
            SELECT TOP 5000
                T0."DocNum" as "DeliveryNote", 
                T0."DocDate", 
                T0."DocTime", 
                T1."ItemCode"
            FROM "${process.env.HANA_DB_NAME}"."ODLN" T0
            INNER JOIN "${process.env.HANA_DB_NAME}"."DLN1" T1 ON T0."DocEntry" = T1."DocEntry"
            ORDER BY T0."DocDate" DESC, T0."DocTime" DESC
        `;
        
        connection.exec(query, function(err, rows) {
            if (err) {
                console.error("Query error:", err);
                connection.disconnect();
                return res.status(500).json({ error: 'SAP Query failed' });
            }
            
            connection.disconnect();
            
            // 3. Cruzar datos (Heurística: encontrar la etiqueta impresa para el mismo Item más cercana en el tiempo antes de la entrega)
            const diferenciasMinutos = [];
            const diferenciasMinutosPorProducto = {};
            rows.forEach(row => {
                const docDateStr = row.DocDate; // "2026-06-29 00:00:00.000000000"
                const docTime = (row.DocTime ? row.DocTime.toString() : '0').padStart(4, '0'); // "1432"
                
                // Construir fecha de SAP
                const year = docDateStr.substring(0, 4);
                const month = docDateStr.substring(5, 7);
                const day = docDateStr.substring(8, 10);
                const hour = docTime.substring(0, 2);
                const min = docTime.substring(2, 4);
                
                const deliveryDate = new Date(`${year}-${month}-${day}T${hour}:${min}:00Z`); // Asumimos UTC o tiempo local
                const itemCode = row.ItemCode;
                
                if (printsByItem[itemCode] && printsByItem[itemCode].length > 0) {
                    // Buscar la impresión más reciente ANTES de deliveryDate, o el mismo día
                    const posiblesImpresiones = printsByItem[itemCode];
                    // Para simplificar, tomamos la impresión más cercana en absoluto (idealmente antes de la remisión)
                    let closestDiff = Infinity;
                    let bestPrint = null;
                    
                    posiblesImpresiones.forEach(pDate => {
                        // Asumiendo que el timezone del timestamp de SGA es similar al de SAP (Local Time)
                        // Ajustamos si SGA usa hora local de México y SAP también
                        const diffMins = (deliveryDate - pDate) / (1000 * 60);
                        
                        // Solo nos interesan las etiquetas impresas como máximo 15 días antes de la entrega, 
                        // y hasta unas horas después si hay desfase de reloj.
                        if (diffMins > -120 && diffMins < 21600) { 
                            if (Math.abs(diffMins) < Math.abs(closestDiff)) {
                                closestDiff = diffMins;
                                bestPrint = pDate;
                            }
                        }
                    });
                    
                    if (bestPrint !== null) {
                        const diff = Math.abs(closestDiff);
                        diferenciasMinutos.push(diff);
                        
                        const prefixMatch = itemCode.match(/^([A-Z]+)-/i);
                        const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : 'OTROS';
                        if (!diferenciasMinutosPorProducto[prefix]) {
                            diferenciasMinutosPorProducto[prefix] = [];
                        }
                        diferenciasMinutosPorProducto[prefix].push(diff);
                    }
                }
            });
            
            // Preparar histograma de cruces
            const histograma = { labels: [], data: [] };
            if (diferenciasMinutos.length > 0) {
                const maxTime = Math.ceil(Math.max(...diferenciasMinutos));
                const binSize = maxTime <= 60 ? 10 : (maxTime <= 240 ? 30 : 60);
                const numBins = Math.ceil(maxTime / binSize);
                const bins = new Array(numBins).fill(0);
                
                diferenciasMinutos.forEach(t => {
                    let binIndex = Math.floor(t / binSize);
                    if (binIndex >= numBins) binIndex = numBins - 1;
                    bins[binIndex]++;
                });

                for (let i = 0; i < numBins; i++) {
                    const start = (i * binSize).toFixed(0);
                    const end = ((i + 1) * binSize).toFixed(0);
                    histograma.labels.push(`${start}-${end} min`);
                    histograma.data.push(bins[i]);
                }
            }
            
            res.json({
                tiemposCrudos: diferenciasMinutos,
                tiemposCrudosPorProducto: diferenciasMinutosPorProducto,
                histograma,
                totalCruces: diferenciasMinutos.length,
                sapRows: rows.length
            });
        });
    });
});

app.get('/api/invoice-times', (req, res) => {
    const dbPath = 'C:/Users/QB_DESARROLLO/Desktop/SGA PROD/sga_web/core/webhook_events.db';
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('Error opening db:', err);
            return res.status(500).json({ error: 'Database connection error' });
        }

        db.all(`SELECT payload, created_at FROM webhook_events`, [], (err, rows) => {
            db.close();
            if (err) {
                console.error('Error querying db:', err);
                return res.status(500).json({ error: 'Query error' });
            }

            const times = {};
            rows.forEach(r => {
                try {
                    const p = JSON.parse(r.payload);
                    if (p.order_id) {
                        if (!times[p.order_id]) times[p.order_id] = [];
                        // Replace Z with +00:00 to avoid timezone parsing issues if any
                        const dateStr = r.created_at.replace('Z', '+00:00');
                        times[p.order_id].push(new Date(dateStr));
                    }
                } catch (e) {}
            });

            const durations = [];
            for (let oid in times) {
                const dts = times[oid];
                if (dts.length > 1) {
                    const mx = Math.max(...dts);
                    const mn = Math.min(...dts);
                    const diffMins = (mx - mn) / (1000 * 60);
                    durations.push(diffMins);
                }
            }
            res.json({ tiemposCrudos: durations });
        });
    });
});

app.listen(PORT, HOST, () => {
    console.log(`Visor Web corriendo en http://${HOST}:${PORT}`);
});
