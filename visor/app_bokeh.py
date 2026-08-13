import pandas as pd
import numpy as np
from bokeh.io import curdoc
from bokeh.layouts import column, row
from bokeh.models import ColumnDataSource, Select, TextInput, Div, PreText, TabPanel, Tabs
from bokeh.plotting import figure
from data_loader import get_all_data

# Cargar los datos
data = get_all_data()

# Theme oscuro base para Bokeh (Bokeh tiene su propio theme system, usaremos colores manualmente para imitar dark theme)
curdoc().theme = 'dark_minimal'

def create_histogram_data(tiempos, max_val, bin_size_str):
    filtered = [t for t in tiempos if t <= max_val]
    if not filtered:
        return pd.DataFrame({'Rango': [], 'Frecuencia': []}), 0, 0
    
    max_t = max(filtered)
    if bin_size_str == 'auto':
        bin_size = 5 if max_t <= 60 else (15 if max_t <= 180 else 30)
    else:
        bin_size = int(bin_size_str)
        
    num_bins = int(np.ceil(max_t / bin_size)) or 1
    bins = [0] * num_bins
    
    for t in filtered:
        idx = int(t // bin_size)
        if idx >= num_bins: idx = num_bins - 1
        bins[idx] += 1
        
    labels = [f"{i*bin_size}-{(i+1)*bin_size} min" for i in range(num_bins)]
    df = pd.DataFrame({'Rango': labels, 'Frecuencia': bins})
    
    avg = sum(filtered) / len(filtered)
    return df, avg, len(filtered)

# ====== TAB 1: Surtido Factura ======
inv_max_input = TextInput(value="180", title="Max Minutos:")
inv_bin_select = Select(title="Agrupar Cada:", value="auto", options=["auto", "5", "15", "30", "60"])

inv_source = ColumnDataSource(data=dict(Rango=[], Frecuencia=[]))
inv_p = figure(x_range=[], height=400, title="Surtido por Factura", toolbar_location=None, tools="")
inv_p.vbar(x='Rango', top='Frecuencia', width=0.9, source=inv_source, color="#3b82f6")

def update_inv():
    try: max_val = float(inv_max_input.value)
    except: max_val = 180
    df, _, _ = create_histogram_data(data['facturas'], max_val, inv_bin_select.value)
    inv_source.data = dict(Rango=df['Rango'].tolist(), Frecuencia=df['Frecuencia'].tolist())
    inv_p.x_range.factors = df['Rango'].tolist()

inv_max_input.on_change('value', lambda attr, old, new: update_inv())
inv_bin_select.on_change('value', lambda attr, old, new: update_inv())

tab1_layout = column(row(inv_max_input, inv_bin_select), inv_p)
tab1 = TabPanel(child=tab1_layout, title="Surtido por Factura")

# ====== TAB 2: SGA vs SAP ======
ship_max_input = TextInput(value="180", title="Max Minutos:")
ship_bin_select = Select(title="Agrupar Cada:", value="auto", options=["auto", "5", "15"])
ship_avg_div = Div(text="<h3>Promedio: - min</h3>", styles={'color': '#10b981'})

ship_source = ColumnDataSource(data=dict(Rango=[], Frecuencia=[]))
ship_p = figure(x_range=[], height=400, title="SGA vs SAP (Envasado)", toolbar_location=None, tools="")
ship_p.vbar(x='Rango', top='Frecuencia', width=0.9, source=ship_source, color="#10b981")

def update_ship():
    try: max_val = float(ship_max_input.value)
    except: max_val = 180
    df, avg, count = create_histogram_data(data['shipping'], max_val, ship_bin_select.value)
    ship_source.data = dict(Rango=df['Rango'].tolist(), Frecuencia=df['Frecuencia'].tolist())
    ship_p.x_range.factors = df['Rango'].tolist()
    ship_avg_div.text = f"<h3>Promedio Real: {avg:.2f} min (Analizados: {count})</h3>"

ship_max_input.on_change('value', lambda attr, old, new: update_ship())
ship_bin_select.on_change('value', lambda attr, old, new: update_ship())

tab2_layout = column(ship_avg_div, row(ship_max_input, ship_bin_select), ship_p)
tab2 = TabPanel(child=tab2_layout, title="SGA vs SAP")

# ====== TAB 3: Producto ======
prefixes = sorted(list(data['shipping_prod'].keys()))
prod_type_select = Select(title="Familia:", value="TODOS", options=["TODOS"] + prefixes)
prod_max_input = TextInput(value="180", title="Max Minutos:")
prod_avg_div = Div(text="<h3>Promedio: - min</h3>", styles={'color': '#ec4899'})

prod_source = ColumnDataSource(data=dict(Rango=[], Frecuencia=[]))
prod_p = figure(x_range=[], height=400, title="Envasado por Producto", toolbar_location=None, tools="")
prod_p.vbar(x='Rango', top='Frecuencia', width=0.9, source=prod_source, color="#ec4899")

def update_prod():
    try: max_val = float(prod_max_input.value)
    except: max_val = 180
    
    ptype = prod_type_select.value
    t_data = data['shipping'] if ptype == 'TODOS' else data['shipping_prod'].get(ptype, [])
    
    df, avg, count = create_histogram_data(t_data, max_val, "auto")
    prod_source.data = dict(Rango=df['Rango'].tolist(), Frecuencia=df['Frecuencia'].tolist())
    prod_p.x_range.factors = df['Rango'].tolist()
    prod_avg_div.text = f"<h3>Promedio {ptype}: {avg:.2f} min (Analizados: {count})</h3>"

prod_max_input.on_change('value', lambda attr, old, new: update_prod())
prod_type_select.on_change('value', lambda attr, old, new: update_prod())

tab3_layout = column(prod_avg_div, row(prod_type_select, prod_max_input), prod_p)
tab3 = TabPanel(child=tab3_layout, title="Envasado por Tipo")

# ====== MAIN ======
update_inv()
update_ship()
update_prod()

tabs = Tabs(tabs=[tab1, tab2, tab3])
curdoc().add_root(column(Div(text="<h1>Analítica de Desempeño (Bokeh)</h1>"), tabs))
curdoc().title = "Visor Bokeh"
