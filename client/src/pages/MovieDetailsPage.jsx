import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clock3, Languages, Star } from 'lucide-react';
import { fetchMovie } from '../api';
import LoadingScreen from '../components/LoadingScreen';
import SafeImage from '../components/SafeImage';
import { languageOptions } from '../constants/languages';

function hasValidEmbedUrl(trailer) {
  return Boolean(String(trailer?.youtubeEmbedUrl || '').trim());
}

export default function MovieDetailsPage() {
  const { movieId } = useParams();
  const [searchParams] = useSearchParams();
  const language = searchParams.get('language') || 'english';

  const [movie, setMovie] = useState(null);
  const [selectedTrailerLanguage, setSelectedTrailerLanguage] = useState(language);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadMovie() {
      try {
        setLoading(true);
        setError('');
        const data = await fetchMovie(movieId, language);
        if (mounted) {
          setMovie(data);
        }
      } catch (requestError) {
        if (mounted) {
          setError(requestError.response?.data?.message || 'Unable to load movie details.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadMovie();

    return () => {
      mounted = false;
    };
  }, [movieId, language]);

  const trailersByLanguage = movie?.trailersByLanguage || {};

  const availableTrailerLanguages = useMemo(() => {
    return languageOptions.filter((option) => hasValidEmbedUrl(trailersByLanguage[option.value]));
  }, [trailersByLanguage]);

  const availableLanguageSet = useMemo(() => {
    return new Set(availableTrailerLanguages.map((option) => option.value));
  }, [availableTrailerLanguages]);

  useEffect(() => {
    if (!movie) {
      return;
    }

    if (availableLanguageSet.has(language)) {
      setSelectedTrailerLanguage(language);
      return;
    }

    if (availableLanguageSet.has('english')) {
      setSelectedTrailerLanguage('english');
      return;
    }

    const firstLanguage = availableTrailerLanguages[0]?.value;
    if (firstLanguage) {
      setSelectedTrailerLanguage(firstLanguage);
    }
  }, [movie, language, availableTrailerLanguages, availableLanguageSet]);

  const activeTrailer = useMemo(() => {
    if (!movie) {
      return null;
    }

    return (
      (availableLanguageSet.has(selectedTrailerLanguage) ? trailersByLanguage[selectedTrailerLanguage] : null) ||
      (availableLanguageSet.has(language) ? trailersByLanguage[language] : null) ||
      (availableLanguageSet.has('english') ? trailersByLanguage.english : null) ||
      (hasValidEmbedUrl(movie.trailer) ? movie.trailer : null) ||
      null
    );
  }, [movie, selectedTrailerLanguage, trailersByLanguage, language, availableLanguageSet]);

  const trailerEmbedUrl = useMemo(() => {
    return String(activeTrailer?.youtubeEmbedUrl || '').trim();
  }, [activeTrailer]);

  if (loading) {
    return <LoadingScreen label="Loading movie trailer..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-red-200">
        <p>{error}</p>
        <Link to={`/?language=${language}`} className="mt-4 inline-block text-slate-100 underline">
          Back to home
        </Link>
      </div>
    );
  }

  if (!movie) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b_0%,_#020617_45%,_#000_100%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4 md:p-6">
            <div className="aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
              {trailerEmbedUrl ? (
                <iframe
                  title={`${movie.title} trailer`}
                  src={trailerEmbedUrl}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-300">
                  Trailer not available in this language.
                </div>
              )}
            </div>

            {availableTrailerLanguages.length ? (
              <div className="flex flex-wrap gap-2">
                {availableTrailerLanguages.map((option) => {
                  const active = selectedTrailerLanguage === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedTrailerLanguage(option.value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                        active
                          ? 'bg-red-500 text-white shadow-md shadow-red-500/30'
                          : 'border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      {option.label} Trailer
                    </button>
                  );
                })}
              </div>
            ) : null}

            <h1 className="text-3xl font-black uppercase md:text-4xl">{movie.title}</h1>
            <p className="text-slate-300">{movie.overview}</p>

            <div className="flex flex-wrap gap-3 text-xs text-slate-200">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5">
                <Star className="h-3.5 w-3.5 text-amber-400" />
                {movie.voteAverage?.toFixed(1) || 'N/A'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                {movie.runtime ? `${movie.runtime} min` : 'Runtime N/A'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5">
                <Languages className="h-3.5 w-3.5" />
                {language}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {(movie.genres || []).map((genre) => (
                <span key={genre} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs">
                  {genre}
                </span>
              ))}
            </div>
          </section>

          <aside className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4 md:p-6">
            <h2 className="text-xl font-bold">Top Cast</h2>
            <div className="space-y-3">
              {(movie.cast || []).length ? (
                movie.cast.map((person) => (
                  <div key={person.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2">
                    <div className="h-14 w-14 overflow-hidden rounded-lg bg-slate-700">
                      <SafeImage
                        src={person.profile}
                        alt={person.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{person.name}</p>
                      <p className="text-xs text-slate-400">{person.character}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-300">Cast details unavailable.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
