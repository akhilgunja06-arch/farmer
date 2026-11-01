/**
 * Weather, from Open-Meteo.
 *
 * Open-Meteo needs no API key for non-commercial use, so this works on a fresh
 * deployment without any credential. That matters: the advisor's season and
 * irrigation guidance is much weaker without a forecast, and a key requirement
 * would mean most deployments never had one.
 *
 * Two behaviours are deliberate:
 *
 *  1. Coordinates are rounded before use. A forecast for a village centre is as
 *     useful as one for the exact field, and rounding means every farmer in the
 *     same village shares a single upstream call.
 *  2. A failure returns `available: false` with a reason rather than throwing.
 *     The advisor can then say "weather is unavailable right now" and still
 *     answer the question, instead of the whole turn failing.
 */
import { config, capabilities } from '../config.js';
import { q, q1 } from './helpers.js';
import { bestEffort, privilegedBlock } from '../db/pool.js';

export interface WeatherDay {
  date: string;
  temp_max_c: number | null;
  temp_min_c: number | null;
  rain_mm: number | null;
  rain_probability_pct: number | null;
  wind_max_kmh: number | null;
}

export interface WeatherResult {
  available: boolean;
  /** Why weather is missing, when it is. Rendered to the farmer verbatim. */
  reason?: string;
  granularity: 'village' | 'district' | null;
  place_name: string | null;
  latitude: number | null;
  longitude: number | null;
  current: {
    temp_c: number | null;
    humidity_pct: number | null;
    rain_mm: number | null;
    wind_kmh: number | null;
    observed_at: string | null;
  } | null;
  forecast: WeatherDay[];
  /** Total rain over the forecast window, for a quick "is rain coming" read. */
  rain_total_mm: number | null;
  fetched_at: string | null;
  source: string;
}

const UNAVAILABLE_SOURCE = 'Open-Meteo';

function unavailable(reason: string, extra: Partial<WeatherResult> = {}): WeatherResult {
  return {
    available: false,
    reason,
    granularity: null,
    place_name: null,
    latitude: null,
    longitude: null,
    current: null,
    forecast: [],
    rain_total_mm: null,
    fetched_at: null,
    source: UNAVAILABLE_SOURCE,
    ...extra,
  };
}

/** Two decimals is roughly a kilometre — the same weather for the whole village. */
function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function locationKey(lat: number, lng: number): string {
  return `${roundCoord(lat).toFixed(2)},${roundCoord(lng).toFixed(2)}`;
}

/**
 * Look up coordinates for a place name.
 *
 * Only used when a farm has no pin. Open-Meteo's geocoder is built on GeoNames,
 * so it resolves a district or town but not a hamlet, which is why the caller
 * treats a miss as "fall back to the district centre" rather than an error.
 */
export async function geocodePlace(
  name: string,
  options: { country?: string } = {},
): Promise<{ latitude: number; longitude: number; name: string } | null> {
  if (!capabilities.weather || !name.trim()) return null;

  const url = new URL(config.weather.geocodeUrl);
  url.searchParams.set('name', name.trim());
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  if (options.country) url.searchParams.set('countryCode', options.country);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.weather.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string }>;
    };
    const hit = payload.results?.[0];
    if (!hit) return null;
    return { latitude: hit.latitude, longitude: hit.longitude, name: hit.name };
  } catch {
    // A geocoder miss is not an error worth surfacing — the caller falls back.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Call Open-Meteo. Returns null on any failure; the caller decides the message. */
async function fetchForecast(
  latitude: number,
  longitude: number,
): Promise<{ current: WeatherResult['current']; forecast: WeatherDay[] } | null> {
  const url = new URL(config.weather.forecastUrl);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m');
  url.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
  );
  url.searchParams.set('timezone', 'Asia/Kolkata');
  url.searchParams.set('forecast_days', '7');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.weather.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.error('[weather] provider returned', response.status);
      return null;
    }
    const payload = (await response.json()) as OpenMeteoResponse;

    const daily = payload.daily;
    const dates = daily?.time ?? [];
    const forecast: WeatherDay[] = dates.map((date, i) => ({
      date,
      temp_max_c: num(daily?.temperature_2m_max?.[i]),
      temp_min_c: num(daily?.temperature_2m_min?.[i]),
      rain_mm: num(daily?.precipitation_sum?.[i]),
      rain_probability_pct: num(daily?.precipitation_probability_max?.[i]),
      wind_max_kmh: num(daily?.wind_speed_10m_max?.[i]),
    }));

    const current = payload.current
      ? {
          temp_c: num(payload.current.temperature_2m),
          humidity_pct: num(payload.current.relative_humidity_2m),
          rain_mm: num(payload.current.precipitation),
          wind_kmh: num(payload.current.wind_speed_10m),
          observed_at: payload.current.time ?? null,
        }
      : null;

    return { current, forecast };
  } catch (caught) {
    console.error('[weather] request failed', (caught as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Weather for a farmer's location.
 *
 * Prefers a stored farm pin, then the village name, then the district name. The
 * response says which of those it used, so the interface can be explicit that a
 * district-centre forecast is an approximation.
 */
export async function weatherForLocation(input: {
  latitude?: number | null;
  longitude?: number | null;
  village?: string | null;
  district?: string | null;
  state?: string | null;
}): Promise<WeatherResult> {
  if (!capabilities.weather) {
    return unavailable('Weather is not configured on this deployment.');
  }

  let latitude = typeof input.latitude === 'number' ? input.latitude : null;
  let longitude = typeof input.longitude === 'number' ? input.longitude : null;
  let granularity: 'village' | 'district' = 'village';
  let placeName = input.village ?? null;

  if (latitude === null || longitude === null) {
    // No pin: try the village, then the district. Both go through the geocoder.
    const candidates: Array<{ name: string; level: 'village' | 'district' }> = [];
    if (input.village) candidates.push({ name: `${input.village}, ${input.district ?? ''}, India`, level: 'village' });
    if (input.district) candidates.push({ name: `${input.district}, ${input.state ?? ''}, India`, level: 'district' });

    for (const candidate of candidates) {
      const hit = await geocodePlace(candidate.name, { country: 'IN' });
      if (hit) {
        latitude = hit.latitude;
        longitude = hit.longitude;
        granularity = candidate.level;
        placeName = candidate.level === 'district' ? `${hit.name} (district)` : hit.name;
        break;
      }
    }
  }

  if (latitude === null || longitude === null) {
    return unavailable(
      'Weather needs a farm location. Add a village, district or map pin to your farm profile.',
    );
  }

  const key = locationKey(latitude, longitude);
  const roundedLat = roundCoord(latitude);
  const roundedLng = roundCoord(longitude);

  // Serve from cache when a fresh snapshot exists.
  const cached = await q1<{
    current_json: WeatherResult['current'];
    forecast_json: WeatherDay[];
    fetched_at: string;
    granularity: 'village' | 'district';
    place_name: string | null;
  }>(
    `SELECT current_json, forecast_json, fetched_at, granularity, place_name
       FROM weather_snapshots
      WHERE location_key = $1 AND expires_at > now()`,
    [key],
  );

  if (cached) {
    return buildResult({
      granularity: cached.granularity,
      placeName: cached.place_name,
      latitude: roundedLat,
      longitude: roundedLng,
      current: cached.current_json,
      forecast: cached.forecast_json ?? [],
      // pg hands back a Date for timestamptz; the response contract is an ISO
      // string, and a Date would serialise differently from the fresh path.
      fetchedAt: new Date(cached.fetched_at).toISOString(),
    });
  }

  const fetched = await fetchForecast(roundedLat, roundedLng);
  if (!fetched) {
    return unavailable(
      'The weather service could not be reached. Your question was still answered without it.',
      { granularity, place_name: placeName, latitude: roundedLat, longitude: roundedLng },
    );
  }

  // Cache it. Writes need the privileged flag because only the server decides
  // what to store. This is wrapped so a cache failure cannot take down the
  // farmer's request — a forecast is useful, a saved cache row is not essential.
  const cachedWrite = await bestEffort(() =>
    privilegedBlock(async () => {
      await q(
        `INSERT INTO weather_snapshots
           (latitude, longitude, location_key, state, district, granularity, place_name,
            current_json, forecast_json, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
                 now() + ($10 || ' minutes')::interval)
         ON CONFLICT (location_key) DO UPDATE SET
           current_json = EXCLUDED.current_json,
           forecast_json = EXCLUDED.forecast_json,
           fetched_at = now(),
           expires_at = EXCLUDED.expires_at,
           granularity = EXCLUDED.granularity,
           place_name = EXCLUDED.place_name`,
        [
          roundedLat, roundedLng, key, input.state ?? null, input.district ?? null,
          granularity, placeName,
          JSON.stringify(fetched.current), JSON.stringify(fetched.forecast),
          String(config.weather.cacheTtlMinutes),
        ],
      );
    }),
  );
  if (!cachedWrite.ok) {
    console.error('[weather] cache write failed', cachedWrite.error.message);
  }

  return buildResult({
    granularity,
    placeName,
    latitude: roundedLat,
    longitude: roundedLng,
    current: fetched.current,
    forecast: fetched.forecast,
    fetchedAt: new Date().toISOString(),
  });
}

function buildResult(input: {
  granularity: 'village' | 'district';
  placeName: string | null;
  latitude: number;
  longitude: number;
  current: WeatherResult['current'];
  forecast: WeatherDay[];
  fetchedAt: string;
}): WeatherResult {
  const total = input.forecast.reduce((sum, day) => sum + (day.rain_mm ?? 0), 0);

  return {
    available: true,
    granularity: input.granularity,
    place_name: input.placeName,
    latitude: input.latitude,
    longitude: input.longitude,
    current: input.current,
    forecast: input.forecast,
    rain_total_mm: Math.round(total * 10) / 10,
    fetched_at: input.fetchedAt,
    source: UNAVAILABLE_SOURCE,
  };
}
