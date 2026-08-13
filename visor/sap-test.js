require('dotenv').config({ path: '../.env' });
const hana = require('@sap/hana-client');

const connection = hana.createConnection();

const connOptions = {
    serverNode: process.env.HANA_SERVER_NODE,
    uid: process.env.HANA_USER,
    pwd: process.env.HANA_PASSWORD,
    currentSchema: process.env.HANA_DB_NAME
};

connection.connect(connOptions, function(err) {
    if (err) {
        console.error("Connect error", err);
        return;
    }
    
    // Test query to get Delivery Notes for recent orders
    const query = `
        SELECT TOP 10 
            T0."DocNum" as "DeliveryNote", 
            T0."DocDate", 
            T0."DocTime", 
            T1."BaseEntry" as "SalesOrderEntry",
            T1."BaseRef" as "SalesOrderNum",
            T1."ItemCode"
        FROM "${process.env.HANA_DB_NAME}"."ODLN" T0
        INNER JOIN "${process.env.HANA_DB_NAME}"."DLN1" T1 ON T0."DocEntry" = T1."DocEntry"
        ORDER BY T0."DocDate" DESC, T0."DocTime" DESC
    `;
    
    connection.exec(query, function(err, rows) {
        if (err) {
            console.error("Query error:", err);
            connection.disconnect();
            return;
        }
        console.log("Recent Delivery Notes:", rows);
        connection.disconnect();
    });
});
