const axios = require('axios');
const curatedTrailerCatalog = require('./data/latest2024Trailers.json');

const OMDB_BASE_URL = 'https://www.omdbapi.com';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const YOUTUBE_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_OEMBED_URL = 'https://www.youtube.com/oembed';
const OMDB_FALLBACK_KEYS = ['thewdb', 'trilogy', '564727fa'];
const YOUTUBE_EMBED_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const youtubeEmbedCheckCache = new Map();

function extractApiKey(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return (url.searchParams.get('apikey') || '').trim();
    } catch {
      return raw;
    }
  }

  const inlineMatch = raw.match(/(?:^|[?&])apikey=([^&]+)/i);
  if (inlineMatch?.[1]) {
    return decodeURIComponent(inlineMatch[1]).trim();
  }

  return raw;
}

const LANGUAGE_MAP = {
  english: { code: 'en', region: 'US', trailerHint: 'hollywood english' },
  hindi: { code: 'hi', region: 'IN', trailerHint: 'bollywood hindi' },
  tamil: { code: 'ta', region: 'IN', trailerHint: 'tamil' },
  telugu: { code: 'te', region: 'IN', trailerHint: 'telugu' },
  malayalam: { code: 'ml', region: 'IN', trailerHint: 'malayalam' },
};

function extractYoutubeKeyFromTrailerData(trailerData) {
  const directKey = String(trailerData?.youtubeKey || '').trim();
  if (directKey) {
    return directKey;
  }

  const embedUrl = String(trailerData?.youtubeEmbedUrl || '').trim();
  if (embedUrl) {
    const embedMatch = embedUrl.match(/embed\/([a-zA-Z0-9_-]{6,})/);
    if (embedMatch?.[1]) {
      return embedMatch[1];
    }
  }

  const watchUrl = String(trailerData?.youtubeWatchUrl || '').trim();
  if (watchUrl) {
    try {
      const parsed = new URL(watchUrl);
      const youtubeKey = parsed.searchParams.get('v');
      return String(youtubeKey || '').trim();
    } catch {
      return '';
    }
  }

  return '';
}

function buildCuratedTrailersMapFromCatalog(catalog) {
  const entries = Array.isArray(catalog?.movies) ? catalog.movies : [];
  const trailerMap = {};

  entries.forEach((entry) => {
    const tmdbId = Number.parseInt(entry?.movie?.tmdbId, 10);
    if (!Number.isFinite(tmdbId)) {
      return;
    }

    const trailers = entry?.trailers && typeof entry.trailers === 'object' ? entry.trailers : {};
    const byLanguage = {};

    Object.entries(trailers).forEach(([languageName, trailerData]) => {
      const language = String(languageName || '').trim().toLowerCase();
      if (!language) {
        return;
      }

      const youtubeKey = extractYoutubeKeyFromTrailerData(trailerData);
      if (!youtubeKey) {
        return;
      }

      byLanguage[language] = {
        youtubeKey,
        name: String(trailerData?.name || 'Official Trailer').trim(),
        official: Boolean(trailerData?.official),
        type: String(trailerData?.type || 'Trailer').trim(),
      };
    });

    if (Object.keys(byLanguage).length) {
      trailerMap[tmdbId] = byLanguage;
    }
  });

  return trailerMap;
}

const CURATED_MULTILINGUAL_TRAILERS = buildCuratedTrailersMapFromCatalog(curatedTrailerCatalog);

const HOME_QUERY_MAP = {
  english: {
    trending: 'new english movie',
    blockbusters: 'hollywood action',
    globalHits: 'oscar winning movies',
  },
  hindi: {
    trending: 'new hindi movie',
    blockbusters: 'bollywood blockbuster',
    globalHits: 'hindi top rated movie',
  },
  tamil: {
    trending: 'new tamil movie',
    blockbusters: 'kollywood action',
    globalHits: 'tamil top rated movie',
  },
  telugu: {
    trending: 'new telugu movie',
    blockbusters: 'tollywood action',
    globalHits: 'telugu top rated movie',
  },
  malayalam: {
    trending: 'new malayalam movie',
    blockbusters: 'malayalam blockbuster',
    globalHits: 'malayalam top rated movie',
  },
};

function resolveLanguage(language) {
  const normalized = String(language || 'english').trim().toLowerCase();
  return LANGUAGE_MAP[normalized] ? normalized : 'english';
}

function createOmdbClient() {
  return axios.create({
    baseURL: OMDB_BASE_URL,
    timeout: 10000,
  });
}

function createYoutubeClient() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY is missing. Add it in server/.env');
  }

  return axios.create({
    baseURL: YOUTUBE_BASE_URL,
    timeout: 10000,
    params: { key: apiKey },
  });
}

function createTmdbClient() {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is missing. Add it in server/.env');
  }

  return axios.create({
    baseURL: TMDB_BASE_URL,
    timeout: 10000,
    params: { api_key: apiKey },
  });
}

function sanitizePoster(poster) {
  if (!poster || poster === 'N/A') {
    return null;
  }
  return poster;
}

function normalizeMovieSummary(movie, language) {
  const title = movie.Title || movie.title || 'Unknown Title';
  const year = movie.Year || movie.year || '';
  const overview = movie.Plot && movie.Plot !== 'N/A' ? movie.Plot : `${title}${year ? ` (${year})` : ''}`;
  const releaseDate = movie.Released && movie.Released !== 'N/A' ? movie.Released : year || null;
  const voteAverage = movie.imdbRating && movie.imdbRating !== 'N/A' ? Number(movie.imdbRating) : null;

  return {
    id: movie.imdbID || movie.id,
    title,
    overview,
    releaseDate,
    voteAverage,
    popularity: null,
    language,
    poster: sanitizePoster(movie.Poster),
    backdrop: sanitizePoster(movie.Poster),
  };
}

function parseRuntime(runtimeValue) {
  if (!runtimeValue || runtimeValue === 'N/A') {
    return null;
  }

  const parsed = Number.parseInt(runtimeValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGenres(genreValue) {
  if (!genreValue || genreValue === 'N/A') {
    return [];
  }

  return genreValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCast(actorsValue) {
  if (!actorsValue || actorsValue === 'N/A') {
    return [];
  }

  return actorsValue
    .split(',')
    .map((name, index) => ({
      id: `${name.trim()}-${index}`,
      name: name.trim(),
      character: 'Cast',
      profile: null,
    }))
    .filter((person) => person.name);
}

function normalizeMovieDetails(movie, language) {
  return {
    id: movie.imdbID,
    title: movie.Title,
    overview: movie.Plot && movie.Plot !== 'N/A' ? movie.Plot : `${movie.Title} (${movie.Year})`,
    releaseDate: movie.Released && movie.Released !== 'N/A' ? movie.Released : movie.Year,
    voteAverage: movie.imdbRating && movie.imdbRating !== 'N/A' ? Number(movie.imdbRating) : null,
    popularity: null,
    language,
    poster: sanitizePoster(movie.Poster),
    backdrop: sanitizePoster(movie.Poster),
    runtime: parseRuntime(movie.Runtime),
    genres: parseGenres(movie.Genre),
    cast: parseCast(movie.Actors),
    year: movie.Year,
  };
}

async function searchOmdbMovies(omdbClient, query, page = 1) {
  const configuredKey = extractApiKey(process.env.OMDB_API_KEY);
  const keysToTry = [configuredKey, ...OMDB_FALLBACK_KEYS].filter(Boolean);

  for (const apikey of keysToTry) {
    try {
      const response = await omdbClient.get('/', {
        params: {
          apikey,
          s: query,
          type: 'movie',
          page,
        },
      });

      if (response.data?.Response === 'False') {
        if (/invalid api key|no api key provided/i.test(String(response.data?.Error || ''))) {
          continue;
        }
        return [];
      }

      return response.data?.Search || [];
    } catch (error) {
      const message = error.response?.data?.Error || error.message;
      if (/invalid api key|no api key provided/i.test(String(message))) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Invalid API key!');
}

async function fetchOmdbMovieById(omdbClient, movieId) {
  const configuredKey = extractApiKey(process.env.OMDB_API_KEY);
  const keysToTry = [configuredKey, ...OMDB_FALLBACK_KEYS].filter(Boolean);

  for (const apikey of keysToTry) {
    try {
      const response = await omdbClient.get('/', {
        params: {
          apikey,
          i: movieId,
          plot: 'full',
        },
      });

      if (response.data?.Response === 'False') {
        const reason = String(response.data?.Error || 'Movie not found');
        if (/invalid api key|no api key provided/i.test(reason)) {
          continue;
        }
        throw new Error(reason);
      }

      return response.data;
    } catch (error) {
      const message = error.response?.data?.Error || error.message;
      if (/invalid api key|no api key provided/i.test(String(message))) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Invalid API key!');
}

function buildTrailerQuery(title, year, language) {
  const meta = LANGUAGE_MAP[resolveLanguage(language)] || LANGUAGE_MAP.english;
  return `"${title}" ${year || ''} official trailer ${meta.trailerHint}`.trim();
}

function resolveTmdbLanguage(language) {
  const meta = LANGUAGE_MAP[resolveLanguage(language)] || LANGUAGE_MAP.english;
  return `${meta.code}-${meta.region}`;
}

function toTmdbImageUrl(path, size = 'w780') {
  if (!path) {
    return null;
  }
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

function buildYoutubeTrailerPayload(youtubeKey, language, options = {}) {
  if (!youtubeKey) {
    return null;
  }

  const normalizedLanguage = resolveLanguage(language);
  const meta = LANGUAGE_MAP[normalizedLanguage] || LANGUAGE_MAP.english;
  const trailerType = options.type || 'Trailer';

  return {
    id: youtubeKey,
    name: options.name || `${normalizedLanguage} ${trailerType}`,
    youtubeKey,
    youtubeWatchUrl: `https://www.youtube.com/watch?v=${youtubeKey}`,
    youtubeEmbedUrl: `https://www.youtube.com/embed/${youtubeKey}`,
    languageCode: meta.code,
    language: normalizedLanguage,
    type: trailerType,
    official: Boolean(options.official),
  };
}

function getCuratedTrailerForLanguage(tmdbMovieId, language) {
  const curatedMovieTrailers = CURATED_MULTILINGUAL_TRAILERS[tmdbMovieId];
  if (!curatedMovieTrailers) {
    return null;
  }

  const normalizedLanguage = resolveLanguage(language);
  const languageTrailer = curatedMovieTrailers[normalizedLanguage] || null;
  if (!languageTrailer) {
    return null;
  }

  return buildYoutubeTrailerPayload(languageTrailer.youtubeKey, normalizedLanguage, languageTrailer);
}

function getCuratedTrailersForMovie(tmdbMovieId) {
  const curatedMovieTrailers = CURATED_MULTILINGUAL_TRAILERS[tmdbMovieId];
  if (!curatedMovieTrailers) {
    return null;
  }

  const trailersByLanguage = {};
  const trailers = [];

  Object.entries(curatedMovieTrailers).forEach(([language, trailerDetails]) => {
    const payload = buildYoutubeTrailerPayload(trailerDetails.youtubeKey, language, trailerDetails);
    if (!payload) {
      return;
    }

    trailersByLanguage[language] = payload;
    trailers.push({
      language,
      ...payload,
    });
  });

  return {
    trailersByLanguage,
    trailers,
    uniqueCount: trailers.length,
  };
}

function getCachedYoutubeEmbedStatus(youtubeKey) {
  const cached = youtubeEmbedCheckCache.get(youtubeKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.checkedAt > YOUTUBE_EMBED_CHECK_TTL_MS) {
    youtubeEmbedCheckCache.delete(youtubeKey);
    return null;
  }

  return cached.embeddable;
}

async function isYoutubeEmbedAvailable(youtubeKey) {
  if (!youtubeKey) {
    return false;
  }

  const cachedStatus = getCachedYoutubeEmbedStatus(youtubeKey);
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

    youtubeEmbedCheckCache.set(youtubeKey, {
      embeddable,
      checkedAt: Date.now(),
    });
    return embeddable;
  } catch {
    youtubeEmbedCheckCache.set(youtubeKey, {
      embeddable: false,
      checkedAt: Date.now(),
    });
    return false;
  }
}

async function isTrailerEmbeddable(trailer) {
  const youtubeKey = String(trailer?.youtubeKey || '').trim();
  if (!youtubeKey) {
    return false;
  }

  return isYoutubeEmbedAvailable(youtubeKey);
}

function normalizeTmdbCast(credits) {
  const cast = Array.isArray(credits?.cast) ? credits.cast : [];

  return cast.slice(0, 12).map((person) => ({
    id: person.id,
    name: person.name || 'Unknown',
    character: person.character || 'Cast',
    profile: toTmdbImageUrl(person.profile_path, 'w185'),
  }));
}

function pickTmdbTrailer(videos, language) {
  const meta = LANGUAGE_MAP[resolveLanguage(language)] || LANGUAGE_MAP.english;
  const candidates = (videos || []).filter((video) => {
    if (!video?.key || video.site !== 'YouTube') {
      return false;
    }
    if (!['Trailer', 'Teaser'].includes(video.type)) {
      return false;
    }
    return true;
  });

  if (!candidates.length) {
    return null;
  }

  const scored = candidates
    .map((video) => {
      let score = 0;
      const name = normalizeText(video.name || '');

      if (video.type === 'Trailer') {
        score += 6;
      }
      if (video.official) {
        score += 4;
      }
      if (video.iso_639_1 === meta.code) {
        score += 3;
      }
      if (video.iso_3166_1 === meta.region) {
        score += 2;
      }
      if (/official trailer/.test(name)) {
        score += 3;
      }

      return { video, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.video;
  if (!best) {
    return null;
  }

  return {
    id: best.id,
    name: best.name || 'Official Trailer',
    youtubeKey: best.key,
    youtubeWatchUrl: `https://www.youtube.com/watch?v=${best.key}`,
    youtubeEmbedUrl: `https://www.youtube.com/embed/${best.key}`,
    languageCode: best.iso_639_1 || meta.code,
    type: best.type || 'Trailer',
  };
}

function normalizeTmdbMovieDetails(movie, language) {
  const releaseDate = movie.release_date || null;
  const year = releaseDate ? String(releaseDate).slice(0, 4) : null;

  return {
    id: movie.imdb_id || String(movie.id),
    tmdbId: movie.id,
    imdbId: movie.imdb_id || null,
    title: movie.title || movie.original_title || 'Unknown Title',
    overview: movie.overview || 'Overview unavailable.',
    releaseDate,
    voteAverage: Number.isFinite(movie.vote_average) ? movie.vote_average : null,
    popularity: Number.isFinite(movie.popularity) ? movie.popularity : null,
    language,
    poster: toTmdbImageUrl(movie.poster_path, 'w500'),
    backdrop: toTmdbImageUrl(movie.backdrop_path, 'w1280') || toTmdbImageUrl(movie.poster_path, 'w500'),
    runtime: Number.isFinite(movie.runtime) ? movie.runtime : null,
    genres: Array.isArray(movie.genres) ? movie.genres.map((genre) => genre.name).filter(Boolean) : [],
    cast: normalizeTmdbCast(movie.credits),
    year,
  };
}

function normalizeTmdbMovieSummary(movie, language) {
  const releaseDate = movie.release_date || null;
  const title = movie.title || movie.original_title || 'Unknown Title';

  return {
    id: String(movie.id),
    tmdbId: movie.id,
    imdbId: null,
    title,
    overview: movie.overview || `${title} description is unavailable for this language.`,
    releaseDate,
    voteAverage: Number.isFinite(movie.vote_average) ? movie.vote_average : null,
    popularity: Number.isFinite(movie.popularity) ? movie.popularity : null,
    language,
    poster: toTmdbImageUrl(movie.poster_path, 'w500'),
    backdrop: toTmdbImageUrl(movie.backdrop_path, 'w1280') || toTmdbImageUrl(movie.poster_path, 'w500'),
  };
}

async function fetchTmdbVideosForMovie(tmdbClient, tmdbMovieId, language, options = {}) {
  const curatedTrailer = getCuratedTrailerForLanguage(tmdbMovieId, language);
  if (curatedTrailer && (await isTrailerEmbeddable(curatedTrailer))) {
    return curatedTrailer;
  }

  const { allowEnglishFallback = true, strictLanguageMatch = false } = options;
  const normalizedLanguage = resolveLanguage(language);
  const meta = LANGUAGE_MAP[normalizedLanguage] || LANGUAGE_MAP.english;
  const tmdbLanguage = resolveTmdbLanguage(language);
  const response = await tmdbClient.get(`/movie/${tmdbMovieId}/videos`, {
    params: { language: tmdbLanguage },
  });

  let primaryVideos = response.data?.results || [];
  if (strictLanguageMatch) {
    primaryVideos = primaryVideos.filter((video) => video?.iso_639_1 === meta.code);
  }

  let trailer = pickTmdbTrailer(primaryVideos, language);
  if (trailer) {
    return trailer;
  }

  if (!allowEnglishFallback) {
    return null;
  }

  const fallbackResponse = await tmdbClient.get(`/movie/${tmdbMovieId}/videos`, {
    params: { language: 'en-US' },
  });

  trailer = pickTmdbTrailer(fallbackResponse.data?.results || [], 'english');
  return trailer;
}

async function fetchTmdbTrailersForAllLanguages(tmdbClient, tmdbMovieId) {
  const languageEntries = Object.keys(LANGUAGE_MAP);
  const trailerResults = await Promise.allSettled(
    languageEntries.map(async (language) => {
      const trailer = await fetchTmdbVideosForMovie(tmdbClient, tmdbMovieId, language, {
        allowEnglishFallback: false,
        strictLanguageMatch: true,
      });
      return { language, trailer };
    })
  );

  const trailersByLanguage = {};
  const seenKeys = new Set();

  trailerResults.forEach((result) => {
    if (result.status !== 'fulfilled' || !result.value?.trailer) {
      return;
    }

    const { language, trailer } = result.value;
    trailersByLanguage[language] = trailer;
    if (trailer.youtubeKey) {
      seenKeys.add(trailer.youtubeKey);
    }
  });

  if (!trailersByLanguage.english) {
    const englishTrailer = await fetchTmdbVideosForMovie(tmdbClient, tmdbMovieId, 'english', {
      allowEnglishFallback: true,
      strictLanguageMatch: true,
    });
    if (englishTrailer) {
      trailersByLanguage.english = englishTrailer;
      if (englishTrailer.youtubeKey) {
        seenKeys.add(englishTrailer.youtubeKey);
      }
    }
  }

  const trailers = Object.entries(trailersByLanguage).map(([language, trailer]) => ({
    language,
    ...trailer,
  }));

  return {
    trailersByLanguage,
    trailers,
    uniqueCount: seenKeys.size,
  };
}

async function fetchTmdbHomeRows(tmdbClient, language, page = 1) {
  const normalizedLanguage = resolveLanguage(language);
  const tmdbLanguage = resolveTmdbLanguage(normalizedLanguage);
  const meta = LANGUAGE_MAP[normalizedLanguage] || LANGUAGE_MAP.english;

  const [latestResponse, popularResponse, topRatedResponse] = await Promise.all([
    tmdbClient.get('/movie/now_playing', {
      params: {
        language: tmdbLanguage,
        region: meta.region,
        page,
      },
    }),
    tmdbClient.get('/movie/popular', {
      params: {
        language: tmdbLanguage,
        region: meta.region,
        page,
      },
    }),
    tmdbClient.get('/movie/top_rated', {
      params: {
        language: tmdbLanguage,
        page,
      },
    }),
  ]);

  const latest = (latestResponse.data?.results || []).map((movie) => normalizeTmdbMovieSummary(movie, normalizedLanguage));
  const popular = (popularResponse.data?.results || []).map((movie) => normalizeTmdbMovieSummary(movie, normalizedLanguage));
  const topRated = (topRatedResponse.data?.results || []).map((movie) => normalizeTmdbMovieSummary(movie, normalizedLanguage));

  return {
    latest,
    popular,
    topRated,
  };
}

async function searchTmdbMovies(tmdbClient, query, language, page = 1) {
  const normalizedLanguage = resolveLanguage(language);
  const tmdbLanguage = resolveTmdbLanguage(normalizedLanguage);

  const response = await tmdbClient.get('/search/movie', {
    params: {
      query,
      language: tmdbLanguage,
      page,
      include_adult: false,
    },
  });

  return (response.data?.results || []).map((movie) => normalizeTmdbMovieSummary(movie, normalizedLanguage));
}

async function fetchTmdbMovieByExternalId(tmdbClient, movieId, language) {
  const normalizedId = String(movieId || '').trim();
  const tmdbLanguage = resolveTmdbLanguage(language);
  let tmdbMovieId = null;

  if (/^tt\d+$/i.test(normalizedId)) {
    const findResponse = await tmdbClient.get(`/find/${normalizedId}`, {
      params: {
        external_source: 'imdb_id',
        language: tmdbLanguage,
      },
    });

    tmdbMovieId = findResponse.data?.movie_results?.[0]?.id || null;
    if (!tmdbMovieId) {
      throw new Error('Movie not found on TMDB for this IMDb ID');
    }
  } else {
    const parsedId = Number.parseInt(normalizedId, 10);
    if (!Number.isFinite(parsedId)) {
      throw new Error('Invalid movie id');
    }
    tmdbMovieId = parsedId;
  }

  const detailResponse = await tmdbClient.get(`/movie/${tmdbMovieId}`, {
    params: {
      language: tmdbLanguage,
      append_to_response: 'videos,credits',
    },
  });

  const rawMovie = detailResponse.data;
  const movie = normalizeTmdbMovieDetails(rawMovie, language);
  let trailer = getCuratedTrailerForLanguage(tmdbMovieId, language);
  if (trailer && !(await isTrailerEmbeddable(trailer))) {
    trailer = null;
  }
  if (!trailer) {
    trailer = pickTmdbTrailer(rawMovie.videos?.results || [], language);
  }
  if (!trailer) {
    trailer = await fetchTmdbVideosForMovie(tmdbClient, tmdbMovieId, language);
  }

  return {
    movie,
    trailer,
  };
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

const TITLE_STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for']);

function getImportantTitleTokens(title) {
  return tokenize(title).filter((token) => !TITLE_STOP_WORDS.has(token));
}

function isOfficialTrailerCandidate(video, title, year) {
  const candidateTitle = normalizeText(video?.snippet?.title || '');
  const candidateDescription = normalizeText(video?.snippet?.description || '');
  const channelTitle = normalizeText(video?.snippet?.channelTitle || '');
  const titleTokens = getImportantTitleTokens(title);

  if (!/official/.test(candidateTitle) || !/trailer/.test(candidateTitle)) {
    return false;
  }

  // Hard reject noisy/non-official trailer content.
  if (/parody|spoof|fan ?made|fan edit|reaction|review|explained|breakdown|recap|scene|clip|mashup/.test(candidateTitle)) {
    return false;
  }

  if (/parody|spoof|fan ?made|fan edit/.test(candidateDescription)) {
    return false;
  }

  const matchedTokens = titleTokens.filter((token) => candidateTitle.includes(token)).length;
  if (!titleTokens.length || matchedTokens / titleTokens.length < 0.6) {
    return false;
  }

  if (year && !candidateTitle.includes(String(year)) && !candidateDescription.includes(String(year))) {
    // We allow missing year only if the channel strongly signals an official source.
    if (!/(official|movie|film|studios?|pictures?|productions?)/.test(channelTitle)) {
      return false;
    }
  }

  return true;
}

function scoreTrailerCandidate(video, title, year) {
  const candidateTitle = String(video?.snippet?.title || '');
  const candidateDescription = String(video?.snippet?.description || '');
  const haystack = normalizeText(`${candidateTitle} ${candidateDescription}`);
  const movieTitle = normalizeText(title);
  const titleTokens = tokenize(title);

  const positiveSignals = [
    { pattern: /official trailer/, score: 6 },
    { pattern: /official/, score: 1 },
    { pattern: /trailer/, score: 2 },
  ];

  const negativeSignals = [
    { pattern: /parody|spoof|spoofed/, score: -15 },
    { pattern: /fan ?made|fan edit/, score: -10 },
    { pattern: /reaction|review|explained|breakdown|recap/, score: -10 },
    { pattern: /scene|clip|edit|mashup/, score: -6 },
    { pattern: /teaser/, score: -3 },
  ];

  let score = 0;

  if (movieTitle && haystack.includes(movieTitle)) {
    score += 14;
  }

  // Reward token overlap for long movie names where punctuation can differ.
  const matchedTokens = titleTokens.filter((token) => haystack.includes(token)).length;
  if (matchedTokens > 0) {
    score += Math.min(12, matchedTokens * 2);
  }

  if (year && haystack.includes(String(year))) {
    score += 5;
  }

  positiveSignals.forEach(({ pattern, score: delta }) => {
    if (pattern.test(haystack)) {
      score += delta;
    }
  });

  negativeSignals.forEach(({ pattern, score: delta }) => {
    if (pattern.test(haystack)) {
      score += delta;
    }
  });

  const channelTitle = normalizeText(video?.snippet?.channelTitle || '');
  if (/movies?|film|studios?|pictures?|official/.test(channelTitle)) {
    score += 2;
  }

  return score;
}

async function searchYoutubeTrailer(youtubeClient, title, year, language) {
  const normalizedLanguage = resolveLanguage(language);
  const langMeta = LANGUAGE_MAP[normalizedLanguage] || LANGUAGE_MAP.english;
  const query = buildTrailerQuery(title, year, normalizedLanguage);

  const response = await youtubeClient.get('/search', {
    params: {
      part: 'snippet',
      q: query,
      type: 'video',
      videoEmbeddable: 'true',
      maxResults: 12,
      relevanceLanguage: langMeta.code,
      regionCode: langMeta.region,
      safeSearch: 'strict',
    },
  });

  const candidates = (response.data?.items || [])
    .filter((item) => item?.id?.videoId)
    .filter((item) => isOfficialTrailerCandidate(item, title, year))
    .map((item) => ({
      item,
      score: scoreTrailerCandidate(item, title, year),
    }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 14) {
    return null;
  }

  const video = best.item;

  return {
    id: video.id.videoId,
    name: video.snippet?.title || `${title} trailer`,
    youtubeKey: video.id.videoId,
    youtubeWatchUrl: `https://www.youtube.com/watch?v=${video.id.videoId}`,
    youtubeEmbedUrl: `https://www.youtube.com/embed/${video.id.videoId}`,
    languageCode: langMeta.code,
    type: 'Trailer',
  };
}

function getHomeQueries(language) {
  return HOME_QUERY_MAP[resolveLanguage(language)] || HOME_QUERY_MAP.english;
}

module.exports = {
  LANGUAGE_MAP,
  createOmdbClient,
  createTmdbClient,
  createYoutubeClient,
  fetchOmdbMovieById,
  fetchTmdbHomeRows,
  fetchTmdbMovieByExternalId,
  fetchTmdbTrailersForAllLanguages,
  fetchTmdbVideosForMovie,
  getHomeQueries,
  normalizeMovieDetails,
  normalizeMovieSummary,
  resolveLanguage,
  searchOmdbMovies,
  searchTmdbMovies,
  searchYoutubeTrailer,
};
