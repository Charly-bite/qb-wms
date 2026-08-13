document.addEventListener('DOMContentLoaded', () => {
    fetchData();
    fetchInvoiceData();
    
    // Invoice Chart Events
    const maxInvoiceTimeInput = document.getElementById('maxInvoiceTime');
    const binSizeInput = document.getElementById('binSize');
    const chartOrientationInput = document.getElementById('chartOrientation');
    const redrawInvoice = () => { if (rawInvoiceData.length > 0) renderInvoiceChart(); };
    if (maxInvoiceTimeInput) maxInvoiceTimeInput.addEventListener('input', redrawInvoice);
    if (binSizeInput) binSizeInput.addEventListener('change', redrawInvoice);
    if (chartOrientationInput) chartOrientationInput.addEventListener('change', redrawInvoice);

    // Shipping Chart Events
    const maxShippingTimeInput = document.getElementById('maxShippingTime');
    const shippingBinSizeInput = document.getElementById('shippingBinSize');
    const shippingOrientationInput = document.getElementById('shippingOrientation');
    const redrawShipping = () => { if (rawShippingData.length > 0) renderShippingChart(); };
    if (maxShippingTimeInput) maxShippingTimeInput.addEventListener('input', redrawShipping);
    if (shippingBinSizeInput) shippingBinSizeInput.addEventListener('change', redrawShipping);
    if (shippingOrientationInput) shippingOrientationInput.addEventListener('change', redrawShipping);

    // Product Chart Events
    const productTypeFilter = document.getElementById('productTypeFilter');
    const maxProductTimeInput = document.getElementById('maxProductTime');
    const redrawProduct = () => { if (Object.keys(rawShippingDataByProduct).length > 0) renderProductChart(); };
    if (productTypeFilter) productTypeFilter.addEventListener('change', redrawProduct);
    if (maxProductTimeInput) maxProductTimeInput.addEventListener('input', redrawProduct);

    // Tabs Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active');
                b.style.opacity = '0.7';
            });
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            
            btn.classList.add('active');
            btn.style.opacity = '1';
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).style.display = 'block';
            
            if (invoiceChartInstance) invoiceChartInstance.resize();
            if (shippingChartInstance) shippingChartInstance.resize();
            if (chartInstance) chartInstance.resize();
            if (productChartInstance) productChartInstance.resize();
        });
    });
});

let chartInstance = null;
let shippingChartInstance = null;
let productChartInstance = null;
let invoiceChartInstance = null;
let rawInvoiceData = [];
let rawShippingData = [];
let rawShippingDataByProduct = {};

async function fetchData() {
    try {
        const [histResponse, shipResponse] = await Promise.all([
            fetch('/api/histogram'),
            fetch('/api/shipping-times')
        ]);
        
        if (!histResponse.ok || !shipResponse.ok) throw new Error('Error en la red');
        
        const histData = await histResponse.json();
        const shipData = await shipResponse.json();
        
        document.getElementById('loading').classList.add('hidden');
        
        if (histData.error || shipData.error) {
            showError();
            return;
        }

        updateStats(histData, shipData);
        renderChart(histData.histograma);
        
        rawShippingData = shipData.tiemposCrudos || [];
        rawShippingDataByProduct = shipData.tiemposCrudosPorProducto || {};
        
        // Populate dropdown
        const productSelect = document.getElementById('productTypeFilter');
        if (productSelect) {
            // Keep "TODOS" and clear the rest
            productSelect.innerHTML = '<option value="TODOS">TODOS</option>';
            const prefixes = Object.keys(rawShippingDataByProduct).sort();
            prefixes.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p;
                productSelect.appendChild(opt);
            });
        }

        renderShippingChart();
        renderProductChart();

    } catch (error) {
        console.error('Fetch error:', error);
        document.getElementById('loading').classList.add('hidden');
        showError();
    }
}

function updateStats(histData, shipData) {
    document.getElementById('totalPedidos').textContent = histData.totalPedidos;
    
    if (histData.tiemposCrudos && histData.tiemposCrudos.length > 0) {
        const sum = histData.tiemposCrudos.reduce((a, b) => a + b, 0);
        const avg = sum / histData.tiemposCrudos.length;
        document.getElementById('tiempoPromedio').textContent = `${avg.toFixed(2)} min`;
    } else {
        document.getElementById('tiempoPromedio').textContent = 'N/A';
    }
    
    document.getElementById('totalCruces').textContent = shipData.totalCruces || '0';
}

function showError() {
    document.getElementById('error').classList.remove('hidden');
}

function renderChart(histogramData) {
    const ctx = document.getElementById('histogramChart').getContext('2d');
    
    // Create gradient for bars
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.8)'); // Blue
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.2)'); // Purple transparent

    const hoverGradient = ctx.createLinearGradient(0, 0, 0, 400);
    hoverGradient.addColorStop(0, 'rgba(59, 130, 246, 1)');
    hoverGradient.addColorStop(1, 'rgba(139, 92, 246, 0.5)');

    if (chartInstance) {
        chartInstance.destroy();
    }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: histogramData.labels,
            datasets: [{
                label: 'Frecuencia (Cant. de Pedidos)',
                data: histogramData.data,
                backgroundColor: gradient,
                hoverBackgroundColor: hoverGradient,
                borderRadius: 8,
                borderSkipped: false,
                barPercentage: 0.8,
                categoryPercentage: 0.9
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(11, 15, 25, 0.9)',
                    titleFont: { size: 14, family: "'Inter', sans-serif", weight: '600' },
                    bodyFont: { size: 14, family: "'Inter', sans-serif" },
                    padding: 12,
                    cornerRadius: 8,
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        title: (context) => {
                            return `Tiempo: ${context[0].label}`;
                        },
                        label: (context) => {
                            return `Pedidos procesados: ${context.raw}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        font: { size: 12 },
                        padding: 10,
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Cantidad de Pedidos',
                        color: '#94a3b8',
                        font: { size: 12, weight: '500' },
                        padding: { bottom: 10 }
                    }
                },
                x: {
                    grid: {
                        display: false,
                        drawBorder: false
                    },
                    ticks: {
                        font: { size: 12 },
                        padding: 10
                    },
                    title: {
                        display: true,
                        text: 'Tiempo de procesamiento (minutos)',
                        color: '#94a3b8',
                        font: { size: 12, weight: '500' },
                        padding: { top: 10 }
                    }
                }
            },
            animation: {
                duration: 2000,
                easing: 'easeOutQuart'
            }
        }
    });
}

async function fetchInvoiceData() {
    try {
        const response = await fetch('/api/invoice-times');
        if (!response.ok) throw new Error('Error fetching invoice times');
        const data = await response.json();
        if (data.error) return;
        rawInvoiceData = data.tiemposCrudos || [];
        renderInvoiceChart();
    } catch (e) {
        console.error('Invoice times fetch error:', e);
    }
}

function renderInvoiceChart() {
    const maxMinsInput = document.getElementById('maxInvoiceTime');
    const binSizeInput = document.getElementById('binSize');
    const chartOrientationInput = document.getElementById('chartOrientation');
    
    const maxVal = maxMinsInput ? parseFloat(maxMinsInput.value) || 180 : 180;
    const manualBinSize = binSizeInput ? binSizeInput.value : 'auto';
    const isHorizontal = chartOrientationInput && chartOrientationInput.value === 'y';
    
    // Filter data
    const filtered = rawInvoiceData.filter(t => t <= maxVal);
    const totalSpan = document.getElementById('totalInvoices');
    if (totalSpan) totalSpan.textContent = filtered.length;
    
    const histograma = { labels: [], data: [] };
    if (filtered.length > 0) {
        const maxTime = Math.ceil(Math.max(...filtered));
        let binSize = 15;
        
        if (manualBinSize !== 'auto') {
            binSize = parseInt(manualBinSize, 10);
        } else {
            binSize = maxTime <= 60 ? 5 : (maxTime <= 180 ? 15 : 30);
        }
        
        const numBins = Math.ceil(maxTime / binSize) || 1;
        const bins = new Array(numBins).fill(0);
        
        filtered.forEach(t => {
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

    const ctx = document.getElementById('invoiceChart').getContext('2d');
    
    const gradient = ctx.createLinearGradient(0, 0, isHorizontal ? 400 : 0, isHorizontal ? 0 : 400);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.8)'); // Emerald
    gradient.addColorStop(1, 'rgba(5, 150, 105, 0.2)');

    const hoverGradient = ctx.createLinearGradient(0, 0, isHorizontal ? 400 : 0, isHorizontal ? 0 : 400);
    hoverGradient.addColorStop(0, 'rgba(16, 185, 129, 1)');
    hoverGradient.addColorStop(1, 'rgba(5, 150, 105, 0.5)');

    if (invoiceChartInstance) {
        invoiceChartInstance.destroy();
    }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    invoiceChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: histograma.labels,
            datasets: [{
                label: 'Facturas Procesadas',
                data: histograma.data,
                backgroundColor: gradient,
                hoverBackgroundColor: hoverGradient,
                borderRadius: 8,
                borderSkipped: false,
                barPercentage: 0.8,
                categoryPercentage: 0.9
            }]
        },
        options: {
            indexAxis: isHorizontal ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(11, 15, 25, 0.9)',
                    titleFont: { size: 14, family: "'Inter', sans-serif", weight: '600' },
                    bodyFont: { size: 14, family: "'Inter', sans-serif" },
                    padding: 12,
                    cornerRadius: 8,
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        title: (context) => `Tiempo: ${context[0].label}`,
                        label: (context) => `Facturas: ${context.raw}`
                    }
                }
            },
            scales: {
                [isHorizontal ? 'x' : 'y']: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { font: { size: 12 }, padding: 10, stepSize: 1 },
                    title: { display: true, text: 'Cantidad de Facturas', color: '#94a3b8', font: { size: 12, weight: '500' }, padding: { [isHorizontal ? 'top' : 'bottom']: 10 } }
                },
                [isHorizontal ? 'y' : 'x']: {
                    grid: { display: false, drawBorder: false },
                    ticks: { font: { size: 12 }, padding: 10 },
                    title: { display: true, text: 'Tiempo (minutos)', color: '#94a3b8', font: { size: 12, weight: '500' }, padding: { [isHorizontal ? 'bottom' : 'top']: 10 } }
                }
            },
            animation: { duration: 1500, easing: 'easeOutQuart' }
        }
    });
}

function renderShippingChart() {
    const maxShippingTimeInput = document.getElementById('maxShippingTime');
    const binSizeInput = document.getElementById('shippingBinSize');
    const chartOrientationInput = document.getElementById('shippingOrientation');
    
    const maxVal = maxShippingTimeInput ? parseFloat(maxShippingTimeInput.value) || 180 : 180;
    const manualBinSize = binSizeInput ? binSizeInput.value : 'auto';
    const isHorizontal = chartOrientationInput && chartOrientationInput.value === 'y';
    
    // Filter data
    const filtered = rawShippingData.filter(t => t <= maxVal);
    
    // Calculate Average
    const avgDiv = document.getElementById('shippingAvgTime');
    if (avgDiv) {
        if (filtered.length > 0) {
            const sum = filtered.reduce((a, b) => a + b, 0);
            const avg = sum / filtered.length;
            avgDiv.textContent = `${avg.toFixed(2)} min`;
        } else {
            avgDiv.textContent = '- min';
        }
    }
    
    const limitLabel = document.getElementById('shippingLimitLabel');
    if (limitLabel) limitLabel.textContent = maxVal;
    
    const totalSpan = document.getElementById('totalCruces');
    if (totalSpan) totalSpan.textContent = filtered.length;
    
    const histograma = { labels: [], data: [] };
    if (filtered.length > 0) {
        const maxTime = Math.ceil(Math.max(...filtered));
        let binSize = 15;
        
        if (manualBinSize !== 'auto') {
            binSize = parseInt(manualBinSize, 10);
        } else {
            binSize = maxTime <= 60 ? 5 : (maxTime <= 180 ? 15 : 30);
        }
        
        const numBins = Math.ceil(maxTime / binSize) || 1;
        const bins = new Array(numBins).fill(0);
        
        filtered.forEach(t => {
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

    const ctx = document.getElementById('shippingChart').getContext('2d');
    
    const gradient = ctx.createLinearGradient(0, 0, isHorizontal ? 400 : 0, isHorizontal ? 0 : 400);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.8)'); // Blue
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.2)');

    const hoverGradient = ctx.createLinearGradient(0, 0, isHorizontal ? 400 : 0, isHorizontal ? 0 : 400);
    hoverGradient.addColorStop(0, 'rgba(59, 130, 246, 1)');
    hoverGradient.addColorStop(1, 'rgba(59, 130, 246, 0.5)');

    if (shippingChartInstance) {
        shippingChartInstance.destroy();
    }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    shippingChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: histograma.labels,
            datasets: [{
                label: 'Cruces SGA vs SAP',
                data: histograma.data,
                backgroundColor: gradient,
                hoverBackgroundColor: hoverGradient,
                borderRadius: 8,
                borderSkipped: false,
                barPercentage: 0.8,
                categoryPercentage: 0.9
            }]
        },
        options: {
            indexAxis: isHorizontal ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(11, 15, 25, 0.9)',
                    titleFont: { size: 14, family: "'Inter', sans-serif", weight: '600' },
                    bodyFont: { size: 14, family: "'Inter', sans-serif" },
                    padding: 12,
                    cornerRadius: 8,
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        title: (context) => `Tiempo: ${context[0].label}`,
                        label: (context) => `Frecuencia: ${context.raw}`
                    }
                }
            },
            scales: {
                [isHorizontal ? 'x' : 'y']: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { font: { size: 12 }, padding: 10, stepSize: 1 },
                    title: { display: true, text: 'Cantidad de Facturas', color: '#94a3b8', font: { size: 12, weight: '500' }, padding: { [isHorizontal ? 'top' : 'bottom']: 10 } }
                },
                [isHorizontal ? 'y' : 'x']: {
                    grid: { display: false, drawBorder: false },
                    ticks: { font: { size: 12 }, padding: 10 },
                    title: { display: true, text: 'Tiempo (minutos)', color: '#94a3b8', font: { size: 12, weight: '500' }, padding: { [isHorizontal ? 'bottom' : 'top']: 10 } }
                }
            },
            animation: { duration: 1500, easing: 'easeOutQuart' }
        }
    });
}

function renderProductChart() {
    const productTypeFilter = document.getElementById('productTypeFilter');
    const maxProductTimeInput = document.getElementById('maxProductTime');
    
    const maxVal = maxProductTimeInput ? parseFloat(maxProductTimeInput.value) || 180 : 180;
    const selectedProduct = productTypeFilter ? productTypeFilter.value : 'TODOS';
    
    let baseData = [];
    if (selectedProduct === 'TODOS') {
        baseData = rawShippingData;
    } else {
        baseData = rawShippingDataByProduct[selectedProduct] || [];
    }
    
    // Filter data
    const filtered = baseData.filter(t => t <= maxVal);
    
    // Calculate Average
    const avgDiv = document.getElementById('productAvgTime');
    if (avgDiv) {
        if (filtered.length > 0) {
            const sum = filtered.reduce((a, b) => a + b, 0);
            const avg = sum / filtered.length;
            avgDiv.textContent = `${avg.toFixed(2)} min`;
        } else {
            avgDiv.textContent = '- min';
        }
    }
    
    const limitLabel = document.getElementById('productLimitLabel');
    if (limitLabel) limitLabel.textContent = maxVal;

    const labelSelected = document.getElementById('productLabelSelected');
    if (labelSelected) labelSelected.textContent = selectedProduct;
    
    const totalSpan = document.getElementById('totalProductCruces');
    if (totalSpan) totalSpan.textContent = filtered.length;
    
    const histograma = { labels: [], data: [] };
    if (filtered.length > 0) {
        const maxTime = Math.ceil(Math.max(...filtered));
        const binSize = maxTime <= 60 ? 5 : (maxTime <= 180 ? 15 : 30);
        
        const numBins = Math.ceil(maxTime / binSize) || 1;
        const bins = new Array(numBins).fill(0);
        
        filtered.forEach(t => {
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

    const ctx = document.getElementById('productChart').getContext('2d');
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(236, 72, 153, 0.8)'); // Pink
    gradient.addColorStop(1, 'rgba(236, 72, 153, 0.2)');

    const hoverGradient = ctx.createLinearGradient(0, 0, 0, 400);
    hoverGradient.addColorStop(0, 'rgba(236, 72, 153, 1)');
    hoverGradient.addColorStop(1, 'rgba(236, 72, 153, 0.5)');

    if (productChartInstance) {
        productChartInstance.destroy();
    }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    productChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: histograma.labels,
            datasets: [{
                label: `Envasado - ${selectedProduct}`,
                data: histograma.data,
                backgroundColor: gradient,
                hoverBackgroundColor: hoverGradient,
                borderRadius: 8,
                borderSkipped: false,
                barPercentage: 0.8,
                categoryPercentage: 0.9
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(11, 15, 25, 0.9)',
                    titleFont: { size: 14, family: "'Inter', sans-serif", weight: '600' },
                    bodyFont: { size: 14, family: "'Inter', sans-serif" },
                    padding: 12,
                    cornerRadius: 8,
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        title: (context) => `Tiempo: ${context[0].label}`,
                        label: (context) => `Frecuencia: ${context.raw}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { font: { size: 12 }, padding: 10, stepSize: 1 },
                    title: { display: true, text: 'Cantidad de Facturas', color: '#94a3b8', font: { size: 12, weight: '500' }, padding: { bottom: 10 } }
                },
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { font: { size: 12 }, padding: 10 },
                    title: { display: true, text: 'Tiempo (minutos)', color: '#94a3b8', font: { size: 12, weight: '500' }, padding: { top: 10 } }
                }
            },
            animation: { duration: 1500, easing: 'easeOutQuart' }
        }
    });
}
