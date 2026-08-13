from data_loader import get_hana_connection
import json
import pandas as pd
import os

def debug():
    sga_history_path = r'c:\Users\QB_DESARROLLO\Desktop\SGA PROD\history.json'
    prints_by_item = {}
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

    conn = get_hana_connection()
    query = """
        SELECT 
            T1."ItemCode",
            T0."DocNum",
            T0."DocDate",
            T0."DocTime"
        FROM 
            ODLN T0
        INNER JOIN 
            DLN1 T1 ON T0."DocEntry" = T1."DocEntry"
        WHERE 
            T0."DocDate" >= ADD_DAYS(CURRENT_DATE, -15)
    """
    df = pd.read_sql(query, conn)
    conn.close()

    count_matches = 0
    count_valid_diffs = 0
    
    for _, row in df.iterrows():
        item_code = row['ItemCode']
        if item_code in prints_by_item and len(prints_by_item[item_code]) > 0:
            doc_date_str = str(row['DocDate'])[:10]
            doc_time_str = str(row['DocTime']).zfill(4)
            delivery_date = pd.to_datetime(f"{doc_date_str} {doc_time_str[:2]}:{doc_time_str[2:]}:00")
            
            posibles = prints_by_item[item_code]
            if count_matches < 5:
                print(f"Item: {item_code}")
                print(f"Delivery: {delivery_date}")
                print(f"Prints: {posibles}")
            
            closest_diff = float('inf')
            
            for p_date in posibles:
                diff_mins = (delivery_date - p_date).total_seconds() / 60.0
                if count_matches < 5:
                    print(f"  -> diff_mins: {diff_mins}")
                
                if -120 < diff_mins < 21600:
                    if abs(diff_mins) < abs(closest_diff):
                        closest_diff = diff_mins
            
            if closest_diff != float('inf'):
                count_valid_diffs += 1
                
            count_matches += 1

    print(f"Total HANA rows: {len(df)}")
    print(f"Items found in history.json: {count_matches}")
    print(f"Valid diffs (-120 < diff < 21600): {count_valid_diffs}")

if __name__ == '__main__':
    debug()
