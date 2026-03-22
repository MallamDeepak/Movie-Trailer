import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Star } from 'lucide-react';
import Header from '../components/Header';
import LoadingScreen from '../components/LoadingScreen';
import MovieRow from '../components/MovieRow';
import SafeImage from '../components/SafeImage';
import { fetchHome, searchMovies } from '../api';

export default function HomePage() {
  const language = 'english';
  const [homeData, setHomeData] = useState(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadHome() {
      try {
        setLoading(true);
        setError('');
        const data = await fetchHome(language);
        if (mounted) {
          setHomeData(data);
        }
      } catch (requestError) {
        if (mounted) {
          setError(requestError.response?.data?.message || 'Unable to load movies.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadHome();

    return () => {
      mounted = false;
    };
  }, [language]);

  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (!query.trim()) {
        setSearchLoading(false);
        setSearchResults([]);
        return;
      }

      try {
        setSearchLoading(true);
        const results = await searchMovies(query, language);
        setSearchResults(results.slice(0, 10));
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, language]);

  const hasSearch = useMemo(() => query.trim().length > 0, [query]);

  if (loading) {
    return <LoadingScreen label="Fetching latest movies..." />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b_0%,_#020617_40%,_#000_100%)]">
      <Header query={query} onQueryChange={setQuery} />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 md:px-6">
        {error ? <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">{error}</p> : null}

        {hasSearch ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-white md:text-2xl">Search Results</h2>
              <p className="text-xs text-slate-400">Showing results for "{query.trim()}"</p>
            </div>

            {searchLoading ? <p className="text-sm text-slate-300">Searching movies...</p> : null}

            {!searchLoading && searchResults.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                No results found. Try a different movie name.
              </p>
            ) : null}

            {!searchLoading && searchResults.length > 0 ? (
              <MovieRow title="" movies={searchResults} language={language} />
            ) : null}
          </section>
        ) : null}

        {!hasSearch && homeData?.hero ? (
          <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
            <SafeImage
              src={homeData.hero.backdrop}
              alt={homeData.hero.title}
              className="absolute inset-0 h-full w-full object-cover opacity-35"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-black/10" />
            <div className="relative z-10 flex min-h-[360px] flex-col justify-end gap-4 p-6 md:min-h-[420px] md:p-10">
              <p className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-widest text-slate-200">
                <Star className="h-3.5 w-3.5 text-amber-400" />
                Featured Now
              </p>
              <h2 className="max-w-2xl text-4xl font-black uppercase leading-none text-white md:text-6xl">
                {homeData.hero.title}
              </h2>
              <p className="max-w-xl text-sm text-slate-200 md:text-base">{homeData.hero.overview}</p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={`/movie/${homeData.hero.id}?language=${language}`}
                  className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400"
                >
                  <Play className="h-4 w-4" />
                  Watch Trailer
                </Link>
                {homeData.hero.trailer?.youtubeWatchUrl ? (
                  <a
                    href={homeData.hero.trailer.youtubeWatchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/30 px-5 py-2.5 text-sm font-semibold text-white"
                  >
                    Open YouTube
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {!hasSearch ? (
          <>
            <MovieRow title="Trending In India" movies={homeData?.rows?.trending} language={language} />
            <MovieRow title="Popular Now" movies={homeData?.rows?.blockbusters} language={language} />
            <MovieRow title="Top Rated" movies={homeData?.rows?.globalHits} language={language} />
          </>
        ) : null}
      </main>
    </div>
  );
}
