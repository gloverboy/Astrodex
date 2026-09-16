// ── Shared Location Search (Nominatim) ───────────────────────────
// Powers the city search box + autocomplete dropdown used on both the
// Moon Phase and Cloud Cover pages.
//
// Each page must define a global onLocationSelected(lat, lon, cityName)
// function BEFORE the user interacts with the search box - it's called
// whenever a place is picked, either from the dropdown or via the
// Search button / Enter key.
//
// Location data © OpenStreetMap contributors (nominatim.openstreetmap.org)

let locationSearchTimeout;
let locationSearchController; // cancels a stale in-flight request

// Caches autocomplete results for this page session so retyping or
// backspacing to a query already looked up doesn't hit the network again.
const locationSearchCache = new Map();

// Builds a "City, State" string from a Nominatim address object, falling
// back to the first two comma-separated parts of display_name when the
// address doesn't cleanly resolve to a city + state/country (e.g. rural
// areas, POIs). Used everywhere a place gets turned into a display name
// so Moon Phase and Cloud Cover always produce the same result for the
// same search.
function buildCityState(address, displayName) {
    const city = address.city || address.town || address.village || address.suburb || address.hamlet;
    const state = address.state || address.country;
    if (city && state) return `${city}, ${state}`;
    return displayName.split(',').slice(0, 2).join(', ');
}

function renderSearchResults(results) {
    const resultsBox = document.getElementById('search-results');
    if (!resultsBox) return;

    resultsBox.innerHTML = '';

    if (!results.length) {
        resultsBox.style.display = 'none';
        return;
    }

    resultsBox.style.display = 'block';
    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerText = item.fullString;
        div.onclick = () => {
            const input = document.getElementById('city-in');
            if (input) input.value = item.fullString;
            resultsBox.style.display = 'none';
            onLocationSelected(item.lat, item.lon, item.fullString);
        };
        resultsBox.appendChild(div);
    });
}

async function runLocationSearch(val) {
    const key = val.trim().toLowerCase();

    if (locationSearchCache.has(key)) {
        renderSearchResults(locationSearchCache.get(key));
        return;
    }

    // Cancel whatever search is still in flight so a slow earlier response
    // (for a shorter, less-specific query) can't land after a newer one
    // and overwrite the dropdown with stale results.
    if (locationSearchController) locationSearchController.abort();
    locationSearchController = new AbortController();

    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&addressdetails=1&limit=5`,
            { signal: locationSearchController.signal }
        );
        const data = await res.json();
        const results = data.map(item => ({
            fullString: buildCityState(item.address, item.display_name),
            lat: item.lat,
            lon: item.lon
        }));
        locationSearchCache.set(key, results);
        renderSearchResults(results);
    } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
    }
}

async function handleSearchInput(val) {
    const resultsBox = document.getElementById('search-results');
    if (!resultsBox) return;

    if (val.length < 3) {
        resultsBox.innerHTML = '';
        resultsBox.style.display = 'none';
        return;
    }

    clearTimeout(locationSearchTimeout);
    locationSearchTimeout = setTimeout(() => runLocationSearch(val), 400);
}

async function geocodeFetch() {
    const input = document.getElementById('city-in');
    const q = input ? input.value : '';
    if (!q) return;

    if (locationSearchController) locationSearchController.abort();
    locationSearchController = new AbortController();

    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=1`,
            { signal: locationSearchController.signal }
        );
        const data = await res.json();
        if (data.length) {
            const fullString = buildCityState(data[0].address, data[0].display_name);
            onLocationSelected(data[0].lat, data[0].lon, fullString);
        }
    } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('city-in');
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') geocodeFetch();
        });
    }
});