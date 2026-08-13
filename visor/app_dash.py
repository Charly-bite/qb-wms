import dash
from dash import dcc, html, Input, Output
import dash_bootstrap_components as dbc
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
import numpy as np
from data_loader import get_all_data

# Cargar los datos
data = get_all_data()

app = dash.Dash(__name__, external_stylesheets=[dbc.themes.DARKLY], suppress_callback_exceptions=True)
app.title = "Visor Analítico - Plotly Dash"

# Función para agrupar en bins
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


app.layout = dbc.Container([
    html.H1("Analítica de Desempeño (Plotly Dash)", className="my-4 text-center"),
    
    dcc.Tabs(id='tabs', value='tab-factura', children=[
        dcc.Tab(label='Surtido por Factura', value='tab-factura', style={'backgroundColor': '#222'}, selected_style={'backgroundColor': '#3b82f6'}),
        dcc.Tab(label='SGA vs SAP (Envasado)', value='tab-shipping', style={'backgroundColor': '#222'}, selected_style={'backgroundColor': '#10b981'}),
        dcc.Tab(label='Envasado por Tipo', value='tab-product', style={'backgroundColor': '#222'}, selected_style={'backgroundColor': '#ec4899'})
    ]),
    
    html.Div(id='tab-content', className="p-4")
], fluid=True)

@app.callback(
    Output('tab-content', 'children'),
    [Input('tabs', 'value')]
)
def render_content(tab):
    if tab == 'tab-factura':
        return html.Div([
            dbc.Row([
                dbc.Col([
                    html.Label("Max Minutos"),
                    dcc.Input(id='inv-max', type='number', value=180, className="form-control mb-2")
                ], width=2),
                dbc.Col([
                    html.Label("Agrupar Cada"),
                    dcc.Dropdown(id='inv-bin', options=[
                        {'label': 'Auto', 'value': 'auto'},
                        {'label': '5 min', 'value': '5'},
                        {'label': '15 min', 'value': '15'},
                        {'label': '30 min', 'value': '30'},
                        {'label': '60 min', 'value': '60'},
                    ], value='auto')
                ], width=2),
                dbc.Col([
                    html.Label("Orientación"),
                    dcc.Dropdown(id='inv-ori', options=[
                        {'label': 'Vertical', 'value': 'v'},
                        {'label': 'Horizontal', 'value': 'h'}
                    ], value='v')
                ], width=2)
            ]),
            dcc.Graph(id='inv-graph')
        ])
    elif tab == 'tab-shipping':
        return html.Div([
            html.H3(id='ship-avg', className="text-success my-3"),
            dbc.Row([
                dbc.Col([html.Label("Max Minutos"), dcc.Input(id='ship-max', type='number', value=180, className="form-control")]),
                dbc.Col([html.Label("Agrupar Cada"), dcc.Dropdown(id='ship-bin', options=[{'label': 'Auto', 'value': 'auto'}, {'label': '5 min', 'value': '5'}, {'label': '15 min', 'value': '15'}], value='auto')]),
                dbc.Col([html.Label("Orientación"), dcc.Dropdown(id='ship-ori', options=[{'label': 'Vertical', 'value': 'v'}, {'label': 'Horizontal', 'value': 'h'}], value='v')])
            ]),
            dcc.Graph(id='ship-graph')
        ])
    elif tab == 'tab-product':
        prefixes = sorted(list(data['shipping_prod'].keys()))
        opts = [{'label': 'TODOS', 'value': 'TODOS'}] + [{'label': p, 'value': p} for p in prefixes]
        return html.Div([
            html.H3(id='prod-avg', className="text-warning my-3"),
            dbc.Row([
                dbc.Col([html.Label("Familia"), dcc.Dropdown(id='prod-type', options=opts, value='TODOS')]),
                dbc.Col([html.Label("Max Minutos"), dcc.Input(id='prod-max', type='number', value=180, className="form-control")]),
            ]),
            dcc.Graph(id='prod-graph')
        ])

@app.callback(
    Output('inv-graph', 'figure'),
    [Input('inv-max', 'value'), Input('inv-bin', 'value'), Input('inv-ori', 'value')]
)
def update_inv(max_val, bin_val, ori):
    if max_val is None: max_val = 180
    df, _, _ = create_histogram_data(data['facturas'], max_val, bin_val)
    if ori == 'h':
        fig = px.bar(df, x='Frecuencia', y='Rango', orientation='h', color_discrete_sequence=['#3b82f6'])
    else:
        fig = px.bar(df, x='Rango', y='Frecuencia', color_discrete_sequence=['#3b82f6'])
    fig.update_layout(template='plotly_dark', plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)')
    return fig

@app.callback(
    [Output('ship-graph', 'figure'), Output('ship-avg', 'children')],
    [Input('ship-max', 'value'), Input('ship-bin', 'value'), Input('ship-ori', 'value')]
)
def update_ship(max_val, bin_val, ori):
    if max_val is None: max_val = 180
    df, avg, count = create_histogram_data(data['shipping'], max_val, bin_val)
    if ori == 'h':
        fig = px.bar(df, x='Frecuencia', y='Rango', orientation='h', color_discrete_sequence=['#10b981'])
    else:
        fig = px.bar(df, x='Rango', y='Frecuencia', color_discrete_sequence=['#10b981'])
    fig.update_layout(template='plotly_dark', plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)')
    return fig, f"Promedio Real: {avg:.2f} min (Analizados: {count})"

@app.callback(
    [Output('prod-graph', 'figure'), Output('prod-avg', 'children')],
    [Input('prod-max', 'value'), Input('prod-type', 'value')]
)
def update_prod(max_val, prod_type):
    if max_val is None: max_val = 180
    if prod_type == 'TODOS':
        t_data = data['shipping']
    else:
        t_data = data['shipping_prod'].get(prod_type, [])
        
    df, avg, count = create_histogram_data(t_data, max_val, 'auto')
    fig = px.bar(df, x='Rango', y='Frecuencia', color_discrete_sequence=['#ec4899'])
    fig.update_layout(template='plotly_dark', plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)')
    return fig, f"Promedio {prod_type}: {avg:.2f} min (Analizados: {count})"

if __name__ == '__main__':
    app.run(debug=True, port=8050, host='0.0.0.0')
