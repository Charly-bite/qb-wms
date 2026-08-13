require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const hana = require('@sap/hana-client');

async function testMatch() {
    const sgaHistoryPath = 'c:/Users/QB_DESARROLLO/Desktop/SGA PROD/history.json';
    let printsByItem = {};

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
        
        let printCount = 0;
        for (const item in printsByItem) {
            printsByItem[item].sort((a, b) => a - b);
            printCount += printsByItem[item].length;
        }
        console.log(`Found ${printCount} print timestamps across ${Object.keys(printsByItem).length} items in SGA history.`);
        // console.log("Some items in SGA:", Object.keys(printsByItem).slice(0, 10));
    } else {
        console.log("SGA history not found");
        return;
    }

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
            return;
        }
        
        const query = `
            SELECT 
                T0."DocNum" as "DeliveryNote", 
                T0."DocDate", 
                T0."DocTime", 
                T1."ItemCode"
            FROM "${process.env.HANA_DB_NAME}"."ODLN" T0
            INNER JOIN "${process.env.HANA_DB_NAME}"."DLN1" T1 ON T0."DocEntry" = T1."DocEntry"
            WHERE T0."DocDate" >= '2026-05-01'
            ORDER BY T0."DocDate" DESC, T0."DocTime" DESC
        `;
        
        connection.exec(query, function(err, rows) {
            if (err) {
                console.error("Query error:", err);
                connection.disconnect();
                return;
            }
            console.log(`Fetched ${rows.length} rows from SAP.`);
            connection.disconnect();
            
            let matchCount = 0;
            
            rows.forEach(row => {
                const docDateStr = row.DocDate; 
                let docTime = row.DocTime ? row.DocTime.toString() : "0";
                docTime = docTime.padStart(4, '0');
                
                const year = docDateStr.substring(0, 4);
                const month = docDateStr.substring(5, 7);
                const day = docDateStr.substring(8, 10);
                const hour = docTime.substring(0, 2);
                const min = docTime.substring(2, 4);
                
                const deliveryDate = new Date(`${year}-${month}-${day}T${hour}:${min}:00Z`);
                const itemCode = row.ItemCode;
                
                if (printsByItem[itemCode] && printsByItem[itemCode].length > 0) {
                    const posiblesImpresiones = printsByItem[itemCode];
                    let closestDiff = Infinity;
                    let bestPrint = null;
                    
                    posiblesImpresiones.forEach(pDate => {
                        const diffMins = (deliveryDate - pDate) / (1000 * 60);
                        if (diffMins > -120 && diffMins < 4320) { 
                            if (Math.abs(diffMins) < Math.abs(closestDiff)) {
                                closestDiff = diffMins;
                                bestPrint = pDate;
                            }
                        }
                    });
                    
                    if (bestPrint !== null) {
                        matchCount++;
                    } else {
                        // Let's see why it failed
                        const pDate = posiblesImpresiones[0];
                        const diffMins = (deliveryDate - pDate) / (1000 * 60);
                        console.log(`Item ${itemCode} found, but diffMins is ${diffMins} (out of bounds). Delivery: ${deliveryDate.toISOString()}, Print: ${pDate.toISOString()}`);
                    }
                }
            });
            console.log(`Matches found: ${matchCount}`);
        });
    });
}

testMatch();
