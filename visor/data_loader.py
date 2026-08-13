import os
import json
import pandas as pd
from datetime import datetime, timedelta
from dotenv import load_dotenv
import hdbcli.dbapi

# Load environment variables from parent or current dir
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

def get_hana_connection():
    server_node = os.environ.get('HANA_SERVER_NODE')
    user = os.environ.get('HANA_USER')
    password = os.environ.get('HANA_PASSWORD')
    db_name = os.environ.get('HANA_DB_NAME')
    
    if not server_node:
        raise ValueError("Missing HANA config in .env")

    address, port = server_node.split(':')
    
    conn = hdbcli.dbapi.connect(
        address=address,
        port=int(port),
        user=user,
        password=password,
        currentSchema=db_name
    )
    return conn

def load_invoice_data():
    conn = get_hana_connection()
    query = """
        SELECT 
            T0."DocNum",
            T0."DocDate",
            T0."DocTime"
        FROM 
            ODLN T0
        WHERE 
            T0."DocDate" >= ADD_DAYS(CURRENT_DATE, -15)
        ORDER BY T0."DocDate" DESC, T0."DocTime" DESC
    """
    df = pd.read_sql(query, conn)
    conn.close()
    
    # We need to calculate differences between consecutive invoices for the histogram
    # Wait, the nodejs logic for "invoice-times" is:
    # `SELECT payload FROM webhook_events` to get PRINT_JOB events!
    pass

def get_print_events():
    # Wait, the nodejs code uses sqlite3 webhook_events.db for invoice-times
    # And history.json for shipping-times. Let's just reproduce what server.js does!
    import sqlite3
    db_path = r'c:\Users\QB_DESARROLLO\Desktop\SGA PROD\sga_web\core\webhook_events.db'
    
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT payload, created_at FROM webhook_events")
    rows = cur.fetchall()
    conn.close()
    
    impresiones = {}
    for row in rows:
        try:
            data = json.loads(row[0])
            created_at = row[1]
            if data.get('order_id'):
                oid = str(data['order_id'])
                ts = pd.to_datetime(created_at.replace('Z', '+00:00'))
                if oid not in impresiones:
                    impresiones[oid] = []
                impresiones[oid].append(ts)
        except Exception as e:
            pass
            
    tiempos_factura = []
    for oid, timestamps in impresiones.items():
        if len(timestamps) >= 2:
            timestamps.sort()
            for i in range(0, len(timestamps) - 1, 2):
                bloque = timestamps[i:i+2]
                start = pd.to_datetime(bloque[0])
                end = pd.to_datetime(bloque[-1])
                diff_mins = (end - start).total_seconds() / 60.0
                tiempos_factura.append(diff_mins)
                
    return tiempos_factura

def get_shipping_times():
    sga_history_path = r'c:\Users\QB_DESARROLLO\Desktop\SGA PROD\history.json'
    prints_by_item = {}
    
    if os.path.exists(sga_history_path):
        with open(sga_history_path, 'r', encoding='latin1') as f:
            data = json.load(f)
            prints = [d for d in data if 'PRINT_JOB' in d.get('event_type', '')]
            for p in prints:
                details = p.get('details', {})
                items = details.get('items', [])
                for item in items:
                    if item not in prints_by_item:
                        prints_by_item[item] = []
                    prints_by_item[item].append(pd.to_datetime(p['timestamp']).tz_localize(None))
                    
    # SAP HANA ODLN
    conn = get_hana_connection()
    query = """
        SELECT TOP 5000
            T1."ItemCode",
            T0."DocNum",
            T0."DocDate",
            T0."DocTime"
        FROM 
            ODLN T0
        INNER JOIN 
            DLN1 T1 ON T0."DocEntry" = T1."DocEntry"
        ORDER BY T0."DocDate" DESC
    """
    df = pd.read_sql(query, conn)
    conn.close()
    
    diferencias = []
    dif_por_prod = {}
    
    for _, row in df.iterrows():
        item_code = row['ItemCode']
        if item_code in prints_by_item and len(prints_by_item[item_code]) > 0:
            doc_date_str = str(row['DocDate'])[:10]
            doc_time_str = str(row['DocTime']).zfill(4)
            delivery_date = pd.to_datetime(f"{doc_date_str} {doc_time_str[:2]}:{doc_time_str[2:]}:00")
            
            # Find closest print
            posibles = prints_by_item[item_code]
            closest_diff = float('inf')
            best_print = None
            
            for p_date in posibles:
                # Tratar de ignorar la zona horaria completamente (naive)
                if p_date.tzinfo is not None:
                    p_date = p_date.tz_convert('UTC').tz_localize(None)
                
                diff_mins = (delivery_date - p_date).total_seconds() / 60.0
                if -120 < diff_mins < 80000:
                    if abs(diff_mins) < abs(closest_diff):
                        closest_diff = diff_mins
                        best_print = p_date
            
            if best_print is not None:
                diff_abs = abs(closest_diff)
                diferencias.append(diff_abs)
                
                prefix = item_code.split('-')[0].upper() if '-' in item_code else 'OTROS'
                if prefix not in dif_por_prod:
                    dif_por_prod[prefix] = []
                dif_por_prod[prefix].append(diff_abs)
                
    return diferencias, dif_por_prod

def get_all_data():
    tiempos_factura = get_print_events()
    shipping_diferencias, shipping_por_prod = get_shipping_times()
    
    return {
        'facturas': tiempos_factura,
        'shipping': shipping_diferencias,
        'shipping_prod': shipping_por_prod
    }
