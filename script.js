// ── Navigation & Dropdown Functions ─────────────────────────────
function toggleMetricsDropdown() {
    const options = document.getElementById('metrics-dropdown-options');
    if (options) {
        options.classList.toggle('open');
    }
}

function selectMetric(el, tabId) {
    const label = document.getElementById('metrics-dropdown-label');
    if (label) label.innerText = el.innerText;
    
    const options = document.getElementById('metrics-dropdown-options');
    if (options) options.classList.remove('open');
    
    document.querySelectorAll('.metrics-dropdown-option').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    
    openAuroraTabFromDropdown(tabId);
}

// ── Time Dropdown Functions ────────────────────────────────────
function toggleTimeDropdown(optionsId) {
    const options = document.getElementById(optionsId);
    if (options) {
        options.classList.toggle('open');
    }
}

function selectTimeFromDropdown(el, metricKey, minutes, labelId, optionsId) {
    const label = document.getElementById(labelId);
    if (label) label.innerText = el.innerText;

    const options = document.getElementById(optionsId);
    if (options) options.classList.remove('open');

    const parentOptions = el.closest('.metrics-dropdown-options');
    if (parentOptions) {
        parentOptions.querySelectorAll('.metrics-dropdown-option').forEach(o => o.classList.remove('active'));
    }
    el.classList.add('active');

    const activeTab = document.getElementById(`${metricKey}-tab`) || document.getElementById('proton-flux-tab');
    if (activeTab) {
        const desktopOptions = activeTab.querySelectorAll('.time-toggle-option');
        desktopOptions.forEach(opt => {
            opt.classList.toggle('active', opt.innerText.trim() === el.innerText.trim());
        });
    }

    selectedRange[metricKey] = minutes;
    renderMetricChart(metricKey);
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('metrics-dropdown');
    const options = document.getElementById('metrics-dropdown-options');
    if (dropdown && options && !dropdown.contains(e.target)) {
        options.classList.remove('open');
    }

    document.querySelectorAll('.time-dropdown').forEach(timeDropdown => {
        if (!timeDropdown.contains(e.target)) {
            const timeOptions = timeDropdown.querySelector('.metrics-dropdown-options');
            if (timeOptions) timeOptions.classList.remove('open');
        }
    });
});

// ── Charts & Data Storage ───────────────────────────────────────
const charts = {};

let latestWindArr = [];
let latestMagArr = [];
let latestAceEpamRaw = [];
let latestScoreArr = [];
let latestKpArr = [];

const selectedRange = { wind: 30, proton: 30, bz: 30, bt: 30, protonFlux: 1440, score: 30, kp: 56 };

// Only 'wind' is visible when the page first loads (it's the default active tab).
// A chart is only ever created for a metric once its tab has actually been shown -
// see the note on resizeActiveTabChart() below for why.
const visitedMetrics = new Set(['wind']);

// 'wind' is the one chart that gets created eagerly (from the first data fetch)
// rather than through activateTabChart()'s guarded "tab was just shown" path. That
// guarded path always waits a frame (via requestAnimationFrame) before measuring
// the container, so the layout - including any not-yet-loaded webfont metrics -
// has settled. The eager wind chart skips that wait, so it can occasionally lock
// in a size a beat too early and end up taller/shorter than every other graph.
// This flag lets us give it the same one-time, next-frame resize the others get.
let windChartFramedOnce = false;

const metricConfig = {
    wind:       { source: 'wind',       field: 'proton_speed',  graphId: 'wind-speed-graph',     avgId: 'wind-avg',          highId: 'wind-high',          lowId: 'wind-low',          min: 0,   max: 1000, color: 'rgba(157, 0, 255, 0.4)', titleId: 'wind-graph-title',        label: 'Solar Wind Speed', unit: 'km/s' },
    proton:     { source: 'wind',       field: 'proton_density', graphId: 'proton-density-graph', avgId: 'proton-avg',        highId: 'proton-high',        lowId: 'proton-low',        min: 0,   max: 50,   color: 'rgba(0, 4, 255, 0.4)',   titleId: 'proton-graph-title',      label: 'Proton Density',   unit: '/cm³' },
    bz:         { source: 'mag',        field: 'bz_gsm',         graphId: 'bz-graph',              avgId: 'bz-avg',            highId: 'bz-high',            lowId: 'bz-low',            min: -50, max: 50,   color: null,                     titleId: 'bz-graph-title',          label: 'Bz',                unit: 'nT'   },
    bt:         { source: 'mag',        field: 'bt',             graphId: 'bt-graph',              avgId: 'bt-avg',            highId: 'bt-high',            lowId: 'bt-low',            min: 0,   max: 50,   color: 'rgba(0, 247, 255, 0.4)', titleId: 'bt-graph-title',          label: 'Bt',                unit: 'nT'   },
    protonFlux: { source: 'aceEpam',    field: 'p1',             graphId: 'proton-flux-graph',     avgId: 'proton-flux-avg',   highId: 'proton-flux-high',   lowId: 'proton-flux-low',   min: 0.1, max: 100000, color: null,                      titleId: 'proton-flux-graph-title', label: 'ACE EPAM PROTON FLUX' },
    score:      { source: 'score',      field: 'score',          graphId: 'score-graph',           avgId: 'score-avg',         highId: 'score-high',         lowId: 'score-low',         min: 0,   max: 100,  color: 'rgba(255, 140, 0, 0.4)', titleId: 'score-graph-title',       label: 'Aurora Score',     unit: '/ 100' },
    kp:         { source: 'kp',         field: 'kp',             graphId: 'kp-graph',               avgId: 'kp-avg',            highId: 'kp-high',            lowId: 'kp-low',            min: 0,   max: 9,    color: null,                     titleId: 'kp-graph-title',          label: 'Planetary Kp Index', unit: '' }
};

// 5 Specific ACE EPAM Channels Requested
const epamChannels = [
    { key: 'p1', label: 'P1 (47-68 keV)',     color: '#FF0000' }, // Red
    { key: 'p3', label: 'P3 (115-195 keV)',   color: '#0000FF' }, // Blue
    { key: 'p5', label: 'P5 (310-580 keV)',   color: '#00FF00' }, // Green
    { key: 'p6', label: 'P6 (795-1193 keV)',  color: '#FF00FF' }, // Magenta
    { key: 'p7', label: 'P7 (1060-1900 keV)', color: '#00FFFF' }  // Cyan
];

const rangeLabels = { 30: '30 Min', 60: '1 Hr', 180: '3 Hr', 360: '6 Hr', 720: '12 Hr', 1440: '24 Hr' };

function getTimeTag(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(' ');
    return parts.length > 1 ? parts[1].substring(0, 5) : timeStr.substring(11, 16);
}

// Physically plausible ranges for each raw feed value. A reading outside
// its range almost certainly means a sensor glitch or bad parse rather
// than a real space weather event, so these are treated as invalid data
// - just like NOAA's own -999 sentinel values - and forward-filled instead
// of being allowed to flow into the Aurora Score. Bounds are set well
// beyond the most extreme *real* recorded conditions for each metric, so
// genuinely extreme (but real) storms are never mistaken for bad data.
const PLAUSIBLE_RANGES = {
    windSpeed:     { min: 100,  max: 3000 }, // km/s - typical solar wind is 250-800; recorded extremes are near 2000-2500
    protonDensity: { min: 0,    max: 100  }, // /cm³ - occasionally spikes hard during CME compression, but not past ~100
    bz:            { min: -100, max: 100  }, // nT - most extreme recorded storms sit around ±60nT
    bt:            { min: 0,    max: 100  }  // nT - total field strength; extreme events are around 50nT
};

// Helper to fill missing/invalid readings with last valid value.
// `bounds` is optional - pass a { min, max } object (see PLAUSIBLE_RANGES
// above) to also reject readings that are numerically valid but
// physically implausible for that metric.
function sanitizeDataWithForwardFill(arr, defaultVal = 0, bounds = null) {
    if (!Array.isArray(arr)) return [];
    let lastValid = null;

    const isValidReading = (val) => {
        if (isNaN(val) || val === -999 || val === -999.9 || val === -9999) return false;
        if (bounds && (val < bounds.min || val > bounds.max)) return false;
        return true;
    };

    for (let i = 0; i < arr.length; i++) {
        let val = parseFloat(arr[i]);
        if (isValidReading(val)) {
            lastValid = val;
            break;
        }
    }

    if (lastValid === null) lastValid = defaultVal;

    return arr.map(rawVal => {
        let val = parseFloat(rawVal);
        if (!isValidReading(val)) {
            return lastValid;
        } else {
            lastValid = val;
            return val;
        }
    });
}

function renderMetricChart(metricKey) {
    const cfg = metricConfig[metricKey];
    if (!cfg) return;

    if (metricKey === 'protonFlux') {
        renderAceEpamProtonChart();
        return;
    }

    if (metricKey === 'kp') {
        renderKpChart();
        return;
    }

    let sourceArr = [];
    if (cfg.source === 'wind') sourceArr = latestWindArr;
    else if (cfg.source === 'mag') sourceArr = latestMagArr;
    else if (cfg.source === 'score') sourceArr = latestScoreArr;

    if (!sourceArr.length) return;

    const minutes = selectedRange[metricKey] || 30;
    const sliced = sourceArr.slice(-minutes);
    if (sliced.length === 0) return;

    const labels = sliced.map(d => getTimeTag(d.time_tag));
    const rawData = sliced.map(d => d[cfg.field]);
    const data = sanitizeDataWithForwardFill(rawData, 0);

    updateChart(cfg.graphId, labels, data, cfg.min, cfg.max, cfg.color, cfg.unit);
    updateRecords(data, cfg.avgId, cfg.highId, cfg.lowId);

    const titleEl = document.getElementById(cfg.titleId);
    if (titleEl) titleEl.innerText = `${cfg.label} (${rangeLabels[minutes] || minutes + ' Min'})`;
}

function renderAceEpamProtonChart() {
    // Explicitly set Proton Flux stat boxes to N/A
    setElementText('proton-flux-score', 'N/A');
    setElementText('proton-flux-value', 'N/A');
    setElementText('proton-flux-high', 'N/A');
    setElementText('proton-flux-low', 'N/A');
    setElementText('proton-flux-avg', 'N/A');

    if (!latestAceEpamRaw.length) return;

    // ~288 points = 24 Hours of 5-minute sampling (sorted oldest to newest)
    const slicedData = latestAceEpamRaw.slice(-288);
    if (!slicedData.length) return;

    const labels = slicedData.map(d => getTimeTag(d.time_tag));

    const datasets = epamChannels.map(ch => {
        const rawArr = slicedData.map(d => d[ch.key] !== undefined ? d[ch.key] : d.p1);
        const cleanArr = sanitizeDataWithForwardFill(rawArr, 0.1);

        return {
            label: ch.label,
            data: cleanArr,
            borderColor: ch.color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.1,
            spanGaps: true
        };
    });

    updateEpamChart('proton-flux-graph', labels, datasets);
}

function formatKpLabel(timeStr) {
    if (!timeStr) return '';
    const iso = timeStr.replace(' ', 'T') + (timeStr.includes('Z') ? '' : 'Z');
    const d = new Date(iso);
    if (isNaN(d.getTime())) return timeStr;
    const datePart = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
    const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
    return `${datePart} ${timePart}`;
}

function renderKpChart() {
    // Set KP score box to N/A
    setElementText('kp-score', 'N/A');

    if (!latestKpArr.length) return;

    // Hard locked to 7 days (56 bars of 3-hour readings)
    const sliced = latestKpArr.slice(-56);
    if (!sliced.length) return;

    const labels = sliced.map(d => formatKpLabel(d.time_tag));
    const data = sliced.map(d => d.kp);

    updateKpBarChart('kp-graph', labels, data);
    updateRecords(data, 'kp-avg', 'kp-high', 'kp-low');

    const current = data[data.length - 1];
    setElementText('kp-value', typeof current === 'number' && !isNaN(current) ? current.toFixed(1) : '--');
}

function renderAllCharts() {
    Object.keys(metricConfig).forEach(key => {
        if (visitedMetrics.has(key)) renderMetricChart(key);
    });
}

function selectTimeRange(el, metricKey, minutes) {
    selectedRange[metricKey] = minutes;
    const container = el.closest('.time-toggle-container');
    if (container) {
        container.querySelectorAll('.time-toggle-option').forEach(o => o.classList.remove('active'));
    }
    el.classList.add('active');

    const activeTab = document.getElementById(`${metricKey}-tab`) || document.getElementById('proton-flux-tab');
    if (activeTab) {
        const dropdownOptions = activeTab.querySelectorAll('.metrics-dropdown-option');
        dropdownOptions.forEach(opt => {
            opt.classList.toggle('active', opt.innerText.trim() === el.innerText.trim());
        });
        const dropdownLabel = activeTab.querySelector(`#time-dropdown-label-${metricKey}`);
        if (dropdownLabel) dropdownLabel.innerText = el.innerText.trim();
    }

    renderMetricChart(metricKey);
}

// ── Chart Plugins ───────────────────────────────────────────────
const bzFillPlugin = {
    id: 'bzFillPlugin',
    beforeDatasetsDraw: (chart) => {
        if (chart.canvas.id !== 'bz-graph') return;
        const { ctx, chartArea, scales } = chart;
        if (!scales.x || !scales.y || !chartArea) return;

        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || meta.data.length < 2) return;

        const zeroY = scales.y.getPixelForValue(0);
        ctx.save();

        for (let i = 0; i < meta.data.length - 1; i++) {
            const p1 = meta.data[i];
            const p2 = meta.data[i + 1];
            const v1 = chart.data.datasets[0].data[i];
            const v2 = chart.data.datasets[0].data[i + 1];

            if (v1 === null || v2 === null || isNaN(v1) || isNaN(v2)) continue;

            if (v1 >= 0 && v2 >= 0) {
                ctx.beginPath(); ctx.moveTo(p1.x, zeroY); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p2.x, zeroY);
                ctx.closePath(); ctx.fillStyle = 'rgba(0, 255, 0, 0.3)'; ctx.fill();
            } else if (v1 <= 0 && v2 <= 0) {
                ctx.beginPath(); ctx.moveTo(p1.x, zeroY); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p2.x, zeroY);
                ctx.closePath(); ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'; ctx.fill();
            } else {
                const t = (0 - v1) / (v2 - v1);
                const x_cross = p1.x + t * (p2.x - p1.x);
                ctx.beginPath(); ctx.moveTo(p1.x, zeroY); ctx.lineTo(p1.x, p1.y); ctx.lineTo(x_cross, zeroY);
                ctx.closePath(); ctx.fillStyle = v1 > 0 ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)'; ctx.fill();
                ctx.beginPath(); ctx.moveTo(x_cross, zeroY); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p2.x, zeroY);
                ctx.closePath(); ctx.fillStyle = v2 > 0 ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)'; ctx.fill();
            }
        }
        ctx.restore();
    }
};

const multiColorFillPlugin = {
    id: 'multiColorFillPlugin',
    beforeDatasetsDraw: (chart) => {
        if (chart.canvas.id === 'bz-graph' || chart.canvas.id === 'proton-flux-graph') return;
        const { ctx, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || meta.data.length === 0) return;

        const dataset = chart.data.datasets[0];
        const fillColor = dataset.backgroundColor || 'rgba(0, 255, 0, 0.3)';
        
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(meta.data[0].x, chartArea.bottom);
        meta.data.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(meta.data[meta.data.length - 1].x, chartArea.bottom);
        ctx.closePath(); 
        ctx.fillStyle = fillColor; 
        ctx.fill(); 
        ctx.restore();
    }
};

const chartBorderPlugin = {
    id: 'chartBorderPlugin',
    afterDraw: chart => {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const { left, top, right, bottom } = chartArea;
        ctx.save(); 
        ctx.strokeStyle = '#FFFFFF'; 
        ctx.lineWidth = 2; 
        ctx.strokeRect(left, top, right - left, bottom - top); 
        ctx.restore();
    }
};

function getKpBarColor(val) {
    if (val >= 7) return 'rgba(231, 76, 60, 0.85)';    // Red for 7+
    if (val >= 4) return 'rgba(241, 196, 15, 0.85)';   // Yellow for 4 - 6.99
    return 'rgba(46, 204, 113, 0.85)';                 // Green for 3.99 and under
}

// ── Tab Management Functions ────────────────────────────────────
const tabToMetric = {
    'score-tab': 'score',
    'kp-tab': 'kp',
    'wind-tab': 'wind',
    'proton-tab': 'proton',
    'bz-tab': 'bz',
    'bt-tab': 'bt',
    'proton-flux-tab': 'protonFlux'
};

// A chart must never be created (or resized) while its container is
// display:none - Chart.js has no way to measure a hidden element, so it
// locks in a bogus size that doesn't correct itself later. On page load,
// renderAllCharts() used to build all 7 charts immediately, even though 6
// of those 7 tabs were hidden at that moment. Each hidden chart silently
// grabbed the wrong size. The first time you clicked into one of those
// tabs, the container became visible and the browser had to reflow it to
// the chart's real intended size - which is what showed up as the whole
// page suddenly, permanently changing size on that first click.
//
// The fix: never touch a metric's chart until its tab has actually been
// shown. The first time a tab is opened we create its chart fresh (now
// that the container has a real, measurable size); every time after that
// we just resize the existing chart to be safe.
function activateTabChart(tabId) {
    const metricKey = tabToMetric[tabId];
    if (!metricKey) return;

    if (!visitedMetrics.has(metricKey)) {
        visitedMetrics.add(metricKey);
        renderMetricChart(metricKey); // first-time creation, container is now visible
        return;
    }

    const cfg = metricConfig[metricKey];
    const chart = charts[cfg.graphId];
    if (chart) {
        chart.resize();
        chart.update('none');
    }
}

function openAuroraTabFromDropdown(tabId) {
    const tabContents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabContents.length; i++) tabContents[i].classList.remove("active-content");
    const subTabs = document.getElementsByClassName("sub-tab");
    const tabNames = ['score-tab', 'kp-tab', 'wind-tab', 'proton-tab', 'bz-tab', 'bt-tab', 'proton-flux-tab'];
    for (let i = 0; i < subTabs.length; i++) {
        if (subTabs[i]) subTabs[i].classList.toggle("active", tabNames[i] === tabId);
    }
    const target = document.getElementById(tabId);
    if (target) target.classList.add("active-content");
    requestAnimationFrame(() => activateTabChart(tabId));
}

function openAuroraTab(evt, tabId) {
    const tabContents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabContents.length; i++) tabContents[i].classList.remove("active-content");
    const subTabs = document.getElementsByClassName("sub-tab");
    for (let i = 0; i < subTabs.length; i++) subTabs[i].classList.remove("active");
    const target = document.getElementById(tabId);
    if (target) target.classList.add("active-content");
    if (evt && evt.currentTarget) evt.currentTarget.classList.add("active");
    requestAnimationFrame(() => activateTabChart(tabId));
}

// ── Metric Calculation & Utility Functions ─────────────────────
function setElementText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function updateRecords(dataArray, avgId, highId, lowId) {
    const validData = dataArray.filter(n => typeof n === 'number' && !isNaN(n));
    if (validData.length === 0) return;
    const maxVal = Math.max(...validData);
    const minVal = Math.min(...validData);
    const avgVal = validData.reduce((a, b) => a + b, 0) / validData.length;

    setElementText(highId, maxVal >= 1000 ? maxVal.toExponential(2) : maxVal.toFixed(1));
    setElementText(lowId, minVal >= 1000 ? minVal.toExponential(2) : minVal.toFixed(1));
    setElementText(avgId, avgVal >= 1000 ? avgVal.toExponential(2) : avgVal.toFixed(1));
}

function calculateGScale(kp) {
    if (kp >= 9) return "G5"; if (kp >= 8) return "G4"; if (kp >= 7) return "G3";
    if (kp >= 6) return "G2"; if (kp >= 5) return "G1"; return "G0";
}

function clampScore(value) {
    return Math.min(100, Math.max(0, value));
}

function calculateAuroraScores(windSpeed, protonDensity, bz, bt) {
    const bzRaw = Math.abs(bz) / 50 * 100;
    const bzScore = clampScore(Math.round(bz > 0 ? bzRaw * 0.20 : bzRaw));

    const windScore = clampScore(Math.round(windSpeed / 1000 * 100));

    const btScore = clampScore(Math.round(bt / 50 * 100));
    const protonScore = clampScore(Math.round(protonDensity / 50 * 100));

    const totalScore = clampScore(Math.round(
        bzScore     * 0.50 +
        windScore   * 0.25 +
        btScore     * 0.15 +
        protonScore * 0.10
    ));

    return { bzScore, windScore, btScore, protonScore, totalScore };
}

async function safeFetchJson(url) {
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return await res.json();
    } catch (e) {
        console.warn(`Fetch failed for ${url}:`, e);
    }
    return null;
}

// ── Widget Update Engine ────────────────────────────────────────
async function updateWidgets() {
    try {
        const [windData, magData, kpData, directScalesData, aceEpamData] = await Promise.all([
            safeFetchJson('https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json'),
            safeFetchJson('https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json'),
            safeFetchJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
            safeFetchJson('https://services.swpc.noaa.gov/products/noaa-scales.json'),
            safeFetchJson('https://services.swpc.noaa.gov/json/ace/epam/ace_epam_5m.json')
        ]);

        // 1. Planetary K-Index & G-Scale Calculation
        let currentKp = null;
        let directGScale = null;

        if (directScalesData) {
            const entry = directScalesData["-1"] || directScalesData["0"] || Object.values(directScalesData)[0];
            if (entry && entry.G && entry.G.Scale !== undefined) {
                const num = entry.G.Scale;
                directGScale = num === 0 ? "G0" : `G${num}`;
            }
        }

        // NOAA's planetary K-index feed is a header row followed by [time_tag, Kp, a_running, station_count] rows
        let kpSeries = [];
        if (Array.isArray(kpData) && kpData.length > 1) {
            const header = kpData[0];
            const timeIdx = Array.isArray(header) ? header.indexOf('time_tag') : -1;
            const kpIdx = Array.isArray(header) ? header.indexOf('Kp') : -1;

            if (timeIdx !== -1 && kpIdx !== -1) {
                kpSeries = kpData.slice(1)
                    .map(row => ({ time_tag: row[timeIdx], kp: parseFloat(row[kpIdx]) }))
                    .filter(d => d.time_tag && !isNaN(d.kp));
            } else {
                // Fallback: feed already returned as an array of objects
                kpSeries = kpData
                    .filter(d => d && d.time_tag && d.Kp !== undefined)
                    .map(d => ({ time_tag: d.time_tag, kp: parseFloat(d.Kp) }))
                    .filter(d => !isNaN(d.kp));
            }
        }

        if (kpSeries.length > 0) {
            currentKp = kpSeries[kpSeries.length - 1].kp;
        }

        if (currentKp !== null && !isNaN(currentKp)) {
            const formattedKp = currentKp.toFixed(2);
            setElementText('glimpse-kp', formattedKp);
        }

        const calculatedG = directGScale || (currentKp !== null ? calculateGScale(currentKp) : "G0");
        setElementText('glimpse-gscale', calculatedG);

        // 2. Solar Wind Plasma (Speed & Density) - Sorted Oldest to Newest
        // NOAA's rtsw feed now includes readings from BOTH DSCOVR and ACE at once,
        // distinguished by the "active" flag. Only the active spacecraft's readings
        // should be plotted, or the two sources get interleaved into a noisy series.
        const validWind = Array.isArray(windData) ? windData
            .filter(d => d && d.time_tag && (d.active === undefined || d.active === true))
            .sort((a, b) => new Date(a.time_tag) - new Date(b.time_tag)) : [];

        // 3. Solar Wind Magnetometer (Bz & Bt) - Sorted Oldest to Newest
        const validMag = Array.isArray(magData) ? magData
            .filter(d => d && d.time_tag && (d.active === undefined || d.active === true))
            .sort((a, b) => new Date(a.time_tag) - new Date(b.time_tag)) : [];

        // 4. ACE EPAM 5-minute Data - Sorted Oldest to Newest
        const validAceEpam = Array.isArray(aceEpamData) ? aceEpamData
            .filter(d => d && d.time_tag)
            .sort((a, b) => new Date(a.time_tag) - new Date(b.time_tag)) : [];

        if (validWind.length > 0) {
            const cleanWindSpeed = sanitizeDataWithForwardFill(validWind.map(d => d.proton_speed), 400, PLAUSIBLE_RANGES.windSpeed);
            const cleanProtonDensity = sanitizeDataWithForwardFill(validWind.map(d => d.proton_density), 5, PLAUSIBLE_RANGES.protonDensity);

            const windVal = cleanWindSpeed[cleanWindSpeed.length - 1].toFixed(1);
            const protonVal = cleanProtonDensity[cleanProtonDensity.length - 1].toFixed(1);

            setElementText('wind-speed', windVal);
            setElementText('glimpse-wind', windVal);
            setElementText('proton-density', protonVal);
            setElementText('glimpse-protons', protonVal);
        }

        if (validMag.length > 0) {
            const cleanBz = sanitizeDataWithForwardFill(validMag.map(d => d.bz_gsm), 0, PLAUSIBLE_RANGES.bz);
            const cleanBt = sanitizeDataWithForwardFill(validMag.map(d => d.bt), 5, PLAUSIBLE_RANGES.bt);

            const bzVal = cleanBz[cleanBz.length - 1].toFixed(1);
            const btVal = cleanBt[cleanBt.length - 1].toFixed(1);

            setElementText('bz-value', bzVal);
            setElementText('glimpse-bz', bzVal);
            setElementText('bt-value', btVal);
            setElementText('glimpse-bt', btVal);
        }

        if (validWind.length > 0 && validMag.length > 0) {
            const cleanWindSpeed = sanitizeDataWithForwardFill(validWind.map(d => d.proton_speed), 400, PLAUSIBLE_RANGES.windSpeed);
            const cleanProtonDensity = sanitizeDataWithForwardFill(validWind.map(d => d.proton_density), 5, PLAUSIBLE_RANGES.protonDensity);
            const cleanBz = sanitizeDataWithForwardFill(validMag.map(d => d.bz_gsm), 0, PLAUSIBLE_RANGES.bz);
            const cleanBt = sanitizeDataWithForwardFill(validMag.map(d => d.bt), 5, PLAUSIBLE_RANGES.bt);

            const scores = calculateAuroraScores(
                cleanWindSpeed[cleanWindSpeed.length - 1],
                cleanProtonDensity[cleanProtonDensity.length - 1],
                cleanBz[cleanBz.length - 1],
                cleanBt[cleanBt.length - 1]
            );
            setElementText('wind-score', scores.windScore);
            setElementText('proton-score', scores.protonScore);
            setElementText('bz-score', scores.bzScore);
            setElementText('bt-score', scores.btScore);
            setElementText('total-aurora-score', scores.totalScore);
            setElementText('score-value', scores.totalScore);
            setElementText('score-score', scores.totalScore);

            // Build a matching historical series of the total aurora score for the score graph
            const seriesLen = Math.min(cleanWindSpeed.length, cleanProtonDensity.length, cleanBz.length, cleanBt.length);
            const windTail = cleanWindSpeed.slice(-seriesLen);
            const protonTail = cleanProtonDensity.slice(-seriesLen);
            const bzTail = cleanBz.slice(-seriesLen);
            const btTail = cleanBt.slice(-seriesLen);
            const timeSource = (validWind.length >= validMag.length ? validWind : validMag).slice(-seriesLen);

            latestScoreArr = timeSource.map((d, i) => ({
                time_tag: d.time_tag,
                score: calculateAuroraScores(windTail[i], protonTail[i], bzTail[i], btTail[i]).totalScore
            }));
        } else {
            latestScoreArr = [];
        }

        latestWindArr = validWind;
        latestMagArr = validMag;
        latestAceEpamRaw = validAceEpam;
        latestKpArr = kpSeries;
        renderAllCharts();

        // Give the eagerly-created wind chart the same "settle, then resize"
        // treatment every other chart gets when its tab is first shown.
        if (!windChartFramedOnce) {
            windChartFramedOnce = true;
            requestAnimationFrame(() => {
                const windChart = charts[metricConfig.wind.graphId];
                if (windChart) {
                    windChart.resize();
                    windChart.update('none');
                }
            });
        }

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setElementText('update-time', timeStr);

    } catch (e) { 
        console.error('Error fetching NOAA space weather data:', e); 
    }
}

// ── Single Dataset Chart Renderer ───────────────────────────────
function updateChart(id, labels, data, yMin, yMax, fillColor = null, unit = '') {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (charts[id]) {
        charts[id].data.labels = labels; 
        charts[id].data.datasets = [{
            data,
            borderColor: '#FFFFFF',
            backgroundColor: fillColor || 'transparent',
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#FFFFFF',
            pointHoverBorderColor: '#FFFFFF',
            pointHoverBorderWidth: 2,
            borderWidth: 2,
            spanGaps: true
        }];
        charts[id].options.scales.y.min = yMin;
        charts[id].options.scales.y.max = yMax;
        charts[id].update('none'); 
        return;
    }

    charts[id] = new Chart(ctx, {
        type: 'line',
        data: { 
            labels, 
            datasets: [{ 
                data, 
                borderColor: '#FFFFFF', 
                backgroundColor: fillColor || 'transparent', 
                pointRadius: 0, 
                pointHoverRadius: 5,
                pointHoverBackgroundColor: '#FFFFFF',
                pointHoverBorderColor: '#FFFFFF',
                pointHoverBorderWidth: 2,
                borderWidth: 2,
                spanGaps: true
            }] 
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    position: 'nearest',
                    xAlign: 'center',
                    yAlign: 'bottom',
                    caretPadding: 8,
                    displayColors: false,
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    titleColor: '#FFF',
                    bodyColor: '#FFF',
                    borderWidth: 0,
                    cornerRadius: 8,
                    padding: 10,
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 13, weight: 'bold' },
                    callbacks: {
                        label: (context) => {
                            const val = context.parsed.y;
                            if (val === null || val === undefined || isNaN(val)) return '';
                            const formatted = Math.abs(val) >= 1000 ? val.toExponential(2) : val.toFixed(1);
                            return unit ? `${formatted} ${unit}` : formatted;
                        }
                    }
                }
            },
            scales: {
                y: { 
                    min: yMin, 
                    max: yMax, 
                    afterFit(scale) { scale.width = 65; }, 
                    ticks: { color: '#FFF', callback: val => val.toFixed(0) }, 
                    grid: { color: 'rgba(255,255,255,0.1)' } 
                },
                x: { 
                    ticks: { 
                        color: '#FFF',
                        minRotation: 45,
                        maxRotation: 45 
                    } 
                }
            }
        },
        plugins: id === 'bz-graph' ? [chartBorderPlugin, bzFillPlugin] : [chartBorderPlugin, multiColorFillPlugin]
    });
}

// ── Planetary Kp Index Bar Chart Renderer ────────────────────────
function updateKpBarChart(id, labels, data) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = data.map(getKpBarColor);

    if (charts[id]) {
        charts[id].data.labels = labels;
        charts[id].data.datasets = [{
            data,
            backgroundColor: colors,
            borderRadius: 2,
            maxBarThickness: 26
        }];
        charts[id].update('none');
        return;
    }

    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderRadius: 2,
                maxBarThickness: 26
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    position: 'nearest',
                    xAlign: 'center',
                    yAlign: 'bottom',
                    caretPadding: 8,
                    displayColors: false,
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    titleColor: '#FFF',
                    bodyColor: '#FFF',
                    borderWidth: 0,
                    cornerRadius: 8,
                    padding: 10,
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 13, weight: 'bold' },
                    callbacks: {
                        label: (context) => {
                            const val = context.parsed.y;
                            if (val === null || val === undefined || isNaN(val)) return '';
                            return `Kp ${val.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    min: 0,
                    max: 9,
                    afterFit(scale) { scale.width = 65; },
                    ticks: { color: '#FFF', stepSize: 1, callback: val => val.toFixed(0) },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                x: {
                    ticks: {
                        color: '#FFF',
                        minRotation: 45,
                        maxRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 16
                    },
                    grid: { display: false }
                }
            }
        },
        plugins: [chartBorderPlugin]
    });
}

// ── ACE EPAM Proton Chart Renderer ───────────────────────────────
function updateEpamChart(id, labels, datasets) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (charts[id]) {
        charts[id].data.labels = labels;
        charts[id].data.datasets = datasets;
        charts[id].update('none');
        return;
    }

    charts[id] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#FFFFFF',
                        font: { size: 10, weight: 'bold' },
                        usePointStyle: true,
                        pointStyle: 'line',
                        boxWidth: 20,
                        boxHeight: 4,
                        padding: 8
                    }
                },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    position: 'nearest',
                    xAlign: 'center',
                    yAlign: 'bottom',
                    caretPadding: 8,
                    displayColors: false,
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    titleColor: '#FFF',
                    bodyColor: '#FFF',
                    borderWidth: 0,
                    cornerRadius: 8,
                    padding: 10,
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 13, weight: 'bold' }
                }
            },
            scales: {
                y: {
                    type: 'logarithmic',
                    min: 0.1,
                    max: 100000,
                    title: {
                        display: true,
                        text: 'Particles / (cm² s sr MeV)',
                        color: '#FFF',
                        font: { size: 11, weight: 'bold' }
                    },
                    afterFit(scale) { scale.width = 65; },
                    ticks: {
                        color: '#FFF',
                        callback: function(val) {
                            if (val === 0.1) return '10⁻¹';
                            if (val === 1) return '10⁰';
                            if (val === 10) return '10¹';
                            if (val === 100) return '10²';
                            if (val === 1000) return '10³';
                            if (val === 10000) return '10⁴';
                            if (val === 100000) return '10⁵';
                            return null;
                        }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: {
                        color: '#FFF',
                        maxTicksLimit: 12,
                        minRotation: 45,
                        maxRotation: 45
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            }
        },
        plugins: [chartBorderPlugin]
    });
}

// ── Initialization & Lifecycle ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const hamburgerBtn = document.getElementById('hamburger');
    const navTabsEl = document.getElementById('nav-tabs');

    if (hamburgerBtn && navTabsEl) {
        hamburgerBtn.addEventListener('click', () => {
            const isOpen = navTabsEl.classList.toggle('open');
            hamburgerBtn.classList.toggle('open', isOpen);
            hamburgerBtn.setAttribute('aria-expanded', isOpen);
        });
    }

    updateWidgets();
    setInterval(updateWidgets, 30000); // Auto refresh data every 30 seconds
});