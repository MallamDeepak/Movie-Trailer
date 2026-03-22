const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
const curatedTrailerCatalog = require('./data/latest2024Trailers.json');

const {
  createTmdbClient,
  createYoutubeClient,
  fetchTmdbHomeRows,
  fetchTmdbMovieByExternalId,
  fetchTmdbTrailersForAllLanguages,
  fetchTmdbVideosForMovie,
  resolveLanguage,
  searchTmdbMovies,
  searchYoutubeTrailer,
  LANGUAGE_MAP,
} = require('./omdb');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const curatedEntries = Array.isArray(curatedTrailerCatalog?.movies) ? curatedTrailerCatalog.movies : [];
const YOUTUBE_OEMBED_URL = 'https://www.youtube.com/oembed';
const EMBED_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const embedAvailabilityCache = new Map();

function extractYoutubeKey(trailer) {
  const directKey = String(trailer?.youtubeKey || '').trim();
  if (directKey) {
    return directKey;
  }

  const embedUrl = String(trailer?.youtubeEmbedUrl || '').trim();
  if (embedUrl) {
    const match = embedUrl.match(/embed\/([a-zA-Z0-9_-]{6,})/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return '';
}

function getCachedEmbedStatus(youtubeKey) {
  const cached = embedAvailabilityCache.get(youtubeKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.checkedAt > EMBED_CHECK_TTL_MS) {
    embedAvailabilityCache.delete(youtubeKey);
    return null;
  }

  return cached.embeddable;
}

async function isCuratedTrailerEmbeddable(trailer) {
  const youtubeKey = extractYoutubeKey(trailer);
  if (!youtubeKey) {
    return false;
  }

  const cachedStatus = getCachedEmbedStatus(youtubeKey);
  if (cachedStatus !== null) {
    return cachedStatus;
  }

  try {
    const response = await axios.get(YOUTUBE_OEMBED_URL, {
      timeout: 5000,
      params: {
        url: `https://www.youtube.com/watch?v=${youtubeKey}`,
        format: 'json',
      },
      validateStatus: (status) => status >= 200 && status < 500,
    });

    const embeddable = response.status >= 200 && response.status < 300;
    embedAvailabilityCache.set(youtubeKey, {
      embeddable,
      checkedAt: Date.now(),
    });

    return embeddable;
  } catch {
    embedAvailabilityCache.set(youtubeKey, {
      embeddable: false,
      checkedAt: Date.now(),
    });
    return false;
  }
}

function normalizeCuratedSummary(entry, language) {
  const movie = entry?.movie || {};
  const tmdbId = Number.parseInt(movie.tmdbId, 10);
  const voteAverage = Number(movie.voteAverage);
  const popularity = Number(movie.popularity);

  return {
    id: Number.isFinite(tmdbId) ? String(tmdbId) : null,
    tmdbId: Number.isFinite(tmdbId) ? tmdbId : null,
    imdbId: null,
    title: movie.title || 'Unknown Title',
    overview: movie.overview || 'Overview unavailable.',
    releaseDate: movie.releaseDate || null,
    voteAverage: Number.isFinite(voteAverage) ? voteAverage : null,
    popularity: Number.isFinite(popularity) ? popularity : null,
    language,
    poster: movie.poster || null,
    backdrop: movie.backdrop || movie.poster || null,
  };
}

function normalizeCuratedTrailer(trailer, language) {
  if (!trailer?.youtubeEmbedUrl) {
    return null;
  }

  return {
    id: trailer.youtubeKey || trailer.youtubeEmbedUrl,
    name: trailer.name || 'Official Trailer',
    youtubeKey: trailer.youtubeKey || null,
    youtubeWatchUrl: trailer.youtubeWatchUrl || null,
    youtubeEmbedUrl: trailer.youtubeEmbedUrl,
    languageCode: trailer.languageCode || LANGUAGE_MAP[resolveLanguage(language)]?.code || 'en',
    type: trailer.type || 'Trailer',
    official: Boolean(trailer.official),
  };
}

async function getCuratedMoviePayload(movieId, language) {
  const normalizedLanguage = resolveLanguage(language);
  const parsedId = Number.parseInt(String(movieId || '').trim(), 10);
  if (!Number.isFinite(parsedId)) {
    return null;
  }

  const entry = curatedEntries.find((item) => Number.parseInt(item?.movie?.tmdbId, 10) === parsedId);
  if (!entry) {
    return null;
  }

  const base = normalizeCuratedSummary(entry, normalizedLanguage);
  const trailersByLanguage = {};
  const languagesNeedingFallback = new Set();

  const trailerEntries = Object.entries(entry?.trailers || {});
  const trailerResults = await Promise.all(
    trailerEntries.map(async ([lang, trailer]) => {
      const langKey = resolveLanguage(lang);
      const payload = normalizeCuratedTrailer(trailer, langKey);
      if (!payload) {
        return null;
      }

      const embeddable = await isCuratedTrailerEmbeddable(payload);
      if (!embeddable) {
        languagesNeedingFallback.add(langKey);
        return null;
      }

      return { langKey, payload };
    })
  );

  trailerResults.forEach((result) => {
    if (!result) {
      return;
    }
    trailersByLanguage[result.langKey] = result.payload;
  });

  const year = String(entry?.movie?.year || '').trim() || (base.releaseDate ? String(base.releaseDate).slice(0, 4) : null);

  const preferredLanguages = [
    normalizedLanguage,
    'english',
    'hindi',
    'tamil',
    'telugu',
    'malayalam',
  ].filter((value, index, list) => value && list.indexOf(value) === index);

  // YouTube fallback for languages that don't have embeddable trailers
  const languagesWithoutTrailer = preferredLanguages.filter((lang) => !trailersByLanguage[lang]);
  if (languagesWithoutTrailer.length > 0) {
    try {
      const youtubeClient = createYoutubeClient();
      for (const langKey of languagesWithoutTrailer) {
        const fallbackTrailer = await searchYoutubeTrailer(youtubeClient, base.title, year, langKey);
        if (fallbackTrailer?.youtubeEmbedUrl) {
          trailersByLanguage[langKey] = {
            ...fallbackTrailer,
            official: Boolean(fallbackTrailer.official),
          };
        }
      }
    } catch {
      // Ignore YouTube fallback errors and continue with available data.
    }
  }

  const trailer =
    trailersByLanguage[normalizedLanguage] ||
    trailersByLanguage.english ||
    Object.values(trailersByLanguage)[0] ||
    null;

  return {
    movie: {
      ...base,
      runtime: null,
      genres: [],
      cast: [],
      year,
      trailer,
      trailersByLanguage,
      trailers: Object.entries(trailersByLanguage).map(([lang, item]) => ({
        language: lang,
        ...item,
      })),
    },
    trailer,
  };
}

async function getCuratedHomePayload(language) {
  const normalizedLanguage = resolveLanguage(language);
  const summaries = curatedEntries
    .map((entry) => normalizeCuratedSummary(entry, normalizedLanguage))
    .filter((item) => item.tmdbId)
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

  if (!summaries.length) {
    return null;
  }

  const latest = summaries.slice(0, 10);
  const popular = summaries.slice(10, 20).length ? summaries.slice(10, 20) : latest;
  const topRated = summaries.slice(20, 30).length ? summaries.slice(20, 30) : latest;

  const heroMovie = latest[0] || null;
  const heroData = heroMovie ? await getCuratedMoviePayload(heroMovie.tmdbId, normalizedLanguage) : null;

  return {
    language: normalizedLanguage,
    hero: heroMovie
      ? {
          ...heroMovie,
          trailer: heroData?.trailer || null,
        }
      : null,
    rows: {
      trending: latest,
      blockbusters: popular,
      globalHits: topRated,
    },
  };
}

function searchCuratedMovies(query, language) {
  const normalizedLanguage = resolveLanguage(language);
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) {
    return [];
  }

  return curatedEntries
    .map((entry) => normalizeCuratedSummary(entry, normalizedLanguage))
    .filter((item) => {
      const title = String(item.title || '').toLowerCase();
      const overview = String(item.overview || '').toLowerCase();
      return title.includes(needle) || overview.includes(needle);
    });
}

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
  const language = resolveLanguage(req.query.language);

  try {
    const tmdb = getTmdbClient();
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
    const fallbackPayload = await getCuratedHomePayload(language);
    if (fallbackPayload) {
      return res.json(fallbackPayload);
    }

    const message = error.response?.data?.Error || error.message;
    res.status(500).json({ error: 'Failed to load home movies', message });
  }
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.query || '').trim();
  const language = resolveLanguage(req.query.language);

  try {
    const tmdb = getTmdbClient();

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
    const fallbackResults = searchCuratedMovies(query, language);
    if (fallbackResults.length) {
      return res.json({
        query,
        language,
        results: fallbackResults,
      });
    }

    const message = error.response?.data?.Error || error.message;
    res.status(500).json({ error: 'Failed to search movies', message });
  }
});

app.get('/api/movie/:id', async (req, res) => {
  const movieId = req.params.id;
  const language = resolveLanguage(req.query.language);

  try {
    const tmdb = getTmdbClient();

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
    const fallback = await getCuratedMoviePayload(movieId, language);
    if (fallback?.movie) {
      return res.json({ movie: fallback.movie });
    }

    const message = error.response?.data?.Error || error.message;
    res.status(500).json({ error: 'Failed to load movie details', message });
  }
});

app.get('/api/movie/:id/trailer', async (req, res) => {
  const movieId = req.params.id;
  const language = resolveLanguage(req.query.language);
  const includeAll = String(req.query.includeAll || '').trim() === '1';

  try {
    const tmdb = getTmdbClient();

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
    const fallback = await getCuratedMoviePayload(movieId, language);
    if (fallback?.movie) {
      if (includeAll) {
        return res.json({
          trailer: fallback.trailer,
          trailersByLanguage: fallback.movie.trailersByLanguage,
          trailers: fallback.movie.trailers,
        });
      }

      return res.json({ trailer: fallback.trailer });
    }

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
