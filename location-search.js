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

async function handleSearchInput(val) {
    const resultsBox = document.getElementById('search-results');
    if (!resultsBox) return;

    if (val.length < 3) {
        resultsBox.innerHTML = '';
        resultsBox.style.display = 'none';
        return;
    }

    clearTimeout(locationSearchTimeout);
    locationSearchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&addressdetails=1&limit=5`);
            const data = await res.json();
            resultsBox.innerHTML = '';

            if (data.length > 0) {
                resultsBox.style.display = 'block';
                data.forEach(item => {
                    const fullString = buildCityState(item.address, item.display_name);
                    const div = document.createElement('div');
                    div.className = 'search-item';
                    div.innerText = fullString;
                    div.onclick = () => {
                        const input = document.getElementById('city-in');
                        if (input) input.value = fullString;
                        resultsBox.style.display = 'none';
                        onLocationSelected(item.lat, item.lon, fullString);
                    };
                    resultsBox.appendChild(div);
                });
            } else {
                resultsBox.style.display = 'none';
            }
        } catch (err) {
            console.error(err);
        }
    }, 300);
}

async function geocodeFetch() {
    const input = document.getElementById('city-in');
    const q = input ? input.value : '';
    if (!q) return;

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=1`);
        const data = await res.json();
        if (data.length) {
            const fullString = buildCityState(data[0].address, data[0].display_name);
            onLocationSelected(data[0].lat, data[0].lon, fullString);
        }
    } catch (e) {
        console.error(e);
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