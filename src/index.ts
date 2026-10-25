import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const WEATHER_CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle',
  55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'light showers',
  81: 'showers', 82: 'violent showers', 95: 'thunderstorm',
  96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail',
};

const describe = (code: number) => WEATHER_CODES[code] ?? `unknown (code ${code})`;

const rateAqi = (v: number) =>
  v <= 20 ? 'good' : v <= 40 ? 'fair' : v <= 60 ? 'moderate'
  : v <= 80 ? 'poor' : v <= 100 ? 'very poor' : 'extremely poor';

const rateUv = (v: number) =>
  v < 3 ? 'low' : v < 6 ? 'moderate' : v < 8 ? 'high' : v < 11 ? 'very high' : 'extreme';

async function geocode(city: string) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '1');

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);

  const data = await res.json();
  return data.results?.[0] ?? null;
}

serveStdio(() => {
  const server = new McpServer(
    { name: 'weather', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_weather',
    {
      title: 'Get weather',
      description:
        'Get current conditions and a daily forecast for any city worldwide. ' +
        'Accepts a plain city name and resolves coordinates automatically. ' +
        'Use this for questions about temperature, rain, or what to wear.',
      inputSchema: z.object({
        city: z.string().describe('City name, e.g. "Colombo" or "Tokyo"'),
        days: z.number().int().min(1).max(7).default(3)
          .describe('How many days of forecast to return'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ city, days }) => {
      const place = await geocode(city);

      if (!place) {
        return {
          content: [{ type: 'text', text: `No city found matching "${city}". Try a different spelling.` }],
          isError: true,
        };
      }

      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(place.latitude));
      url.searchParams.set('longitude', String(place.longitude));
      url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m');
      url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
      url.searchParams.set('timezone', 'auto');
      url.searchParams.set('forecast_days', String(days));

      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        return {
          content: [{ type: 'text', text: `Weather lookup failed (HTTP ${res.status}). The service may be down.` }],
          isError: true,
        };
      }

      const raw = await res.json();

      // --- the trimming step ---
      const summary = {
        location: `${place.name}, ${place.country}`,
        current: {
          temperature_c: raw.current.temperature_2m,
          feels_like_c: raw.current.apparent_temperature,
          conditions: describe(raw.current.weather_code),
          wind_kmh: raw.current.wind_speed_10m,
        },
        forecast: raw.daily.time.map((date: string, i: number) => ({
          date,
          high_c: raw.daily.temperature_2m_max[i],
          low_c: raw.daily.temperature_2m_min[i],
          conditions: describe(raw.daily.weather_code[i]),
          rain_chance_pct: raw.daily.precipitation_probability_max[i],
        })),
      };

      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.registerTool(
    'get_air_quality',
    {
      title: 'Get Air Quality',
      description:
        'Get current air pollution and UV levels for any city. ' +
        'Returns the European AQI, PM2.5 and PM10 particulates, and UV index. ' +
        'Use this for questions about outdoor exercise, running, cycling, ' +
        'whether the air is safe to breathe, sun exposure, or pollution levels. ' +
        'For temperature and rain, use get_weather instead.',
      inputSchema: z.object({
        city: z.string().describe('City name, e.g. "Colombo"'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ city }) => {
      const place = await geocode(city);

      if (!place) {
        return {
          content: [{ type: 'text', text: `No city found matching "${city}". Try a different spelling.` }],
          isError: true,
        };
      }

      const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
      url.searchParams.set('latitude', String(place.latitude));
      url.searchParams.set('longitude', String(place.longitude));
      url.searchParams.set('current', 'pm10,pm2_5,uv_index,european_aqi');
      url.searchParams.set('timezone', 'auto');

      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        return {
          content: [{ type: 'text', text: `Air quality lookup failed (HTTP ${res.status}). The service may be down.` }],
          isError: true,
        };
      }

      const raw = await res.json();

      const summary = {
        location: `${place.name}, ${place.country}`,
        air_quality_index: raw.current.european_aqi,
        aqi_rating: rateAqi(raw.current.european_aqi),
        pm2_5: raw.current.pm2_5,
        m10: raw.current.pm10,
        uv_index: raw.current.uv_index,
      };

      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };

    }
  );

  return server;
});