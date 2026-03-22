const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');

const {
  createTmdbClient,
  fetchTmdbHomeRows,
  fetchTmdbMovieByExternalId,
  fetchTmdbTrailersForAllLanguages,
  fetchTmdbVideosForMovie,
  resolveLanguage,
  searchTmdbMovies,
  LANGUAGE_MAP,
} = require('./omdb');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  const configuredOrigins = String(process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (configuredOrigins.includes(origin)) {
    return true;
  }

  if (origin === 'http://localhost:5173') {
    return true;
  }

  return /^https:\/\/client(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin);
}

function getTmdbClient() {
  return createTmdbClient();
}

app.use(
  (req, res, next) => {
    const requestOrigin = req.headers.origin;

    if (process.env.VERCEL === '1') {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
    } else if (!requestOrigin || isAllowedOrigin(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
    }

    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(204).send();
    }

    return next();
  }
);
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'movie-trailer-api', docs: '/api/health' });
});

app.get('/api/image-proxy', async (req, res) => {
  const sourceUrl = String(req.query.url || '').trim();

  if (!sourceUrl) {
    return res.status(400).json({ error: 'url query parameter is required' });
  }

  try {
    const parsed = new URL(sourceUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Only http/https image URLs are allowed' });
    }

    const response = await axios.get(sourceUrl, {
      responseType: 'arraybuffer',
      timeout: 8000,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(Buffer.from(response.data));
  } catch {
    const placeholder =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" fill="#0f172a"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#cbd5e1" font-size="24" font-family="Arial, sans-serif">No Image</text></svg>';
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(placeholder);
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'movie-trailer-api' });
});

app.get('/api/languages', (_req, res) => {
  const languages = Object.entries(LANGUAGE_MAP).map(([name, code]) => ({
    name,
    code: code.code,
  }));

  res.json({ languages });
});

app.get('/api/home', async (req, res) => {
  try {
    const tmdb = getTmdbClient();
    const language = resolveLanguage(req.query.language);
    const page = Number(req.query.page || 1);
    const rows = await fetchTmdbHomeRows(tmdb, language, page);

    const latest = rows.latest.slice(0, 10);
    const popular = rows.popular.slice(0, 10);
    const topRated = rows.topRated.slice(0, 10);

    const heroMovie = latest[0] || popular[0] || topRated[0] || null;
    const heroTrailer = heroMovie ? await fetchTmdbVideosForMovie(tmdb, heroMovie.tmdbId || heroMovie.id, language) : null;

    res.json({
      language,
      hero: heroMovie
        ? {
            ...heroMovie,
            trailer: heroTrailer,
          }
        : null,
      rows: {
        trending: latest,
        blockbusters: popular,
        globalHits: topRated,
      },
    });
  } catch (error) {
    const message = error.response?.data?.Error || error.message;
    res.status(500).json({ error: 'Failed to load home movies', message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const tmdb = getTmdbClient();
    const query = String(req.query.query || '').trim();
    const language = resolveLanguage(req.query.language);

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const results = await searchTmdbMovies(tmdb, query, language, 1);

    res.json({
      query,
      language,
      results,
    });
  } catch (error) {
    const message = error.response?.data?.Error || error.message;
    res.status(500).json({ error: 'Failed to search movies', message });
  }
});

app.get('/api/movie/:id', async (req, res) => {
  try {
    const tmdb = getTmdbClient();
    const movieId = req.params.id;
    const language = resolveLanguage(req.query.language);

    const { movie, trailer } = await fetchTmdbMovieByExternalId(tmdb, movieId, language);
    const multilingualTrailers = await fetchTmdbTrailersForAllLanguages(tmdb, movie.tmdbId || movie.id);

    res.json({
      movie: {
        ...movie,
        trailer,
        trailersByLanguage: multilingualTrailers.trailersByLanguage,
        trailers: multilingualTrailers.trailers,
      },
    });
  } catch (error) {
    const message = error.response?.data?.Error || error.message;
    res.status(500).json({ error: 'Failed to load movie details', message });
  }
});

app.get('/api/movie/:id/trailer', async (req, res) => {
  try {
    const tmdb = getTmdbClient();
    const movieId = req.params.id;
    const language = resolveLanguage(req.query.language);
    const includeAll = String(req.query.includeAll || '').trim() === '1';

    const { movie, trailer } = await fetchTmdbMovieByExternalId(tmdb, movieId, language);
    const multilingualTrailers = await fetchTmdbTrailersForAllLanguages(tmdb, movie.tmdbId || movie.id);

    if (!trailer && !multilingualTrailers.trailers.length) {
      return res.status(404).json({ error: 'No TMDB trailer found for this movie' });
    }

    if (includeAll) {
      return res.json({
        trailer: trailer || multilingualTrailers.trailers[0] || null,
        trailersByLanguage: multilingualTrailers.trailersByLanguage,
        trailers: multilingualTrailers.trailers,
      });
    }

    res.json({ trailer: trailer || multilingualTrailers.trailers[0] || null });
  } catch (error) {
    const message = error.response?.data?.Error || error.message;
    res.status(500).json({ error: 'Failed to load movie trailer', message });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`Movie trailer API running on http://localhost:${port}`);
  });
}

module.exports = app;
