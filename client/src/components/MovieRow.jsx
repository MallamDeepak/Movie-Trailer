import { Link } from 'react-router-dom';
import SafeImage from './SafeImage';

export default function MovieRow({ title, movies, language }) {
  if (!movies?.length) {
    return null;
  }

  return (
    <section className="space-y-4">
      {title ? <h2 className="text-xl font-bold text-white md:text-2xl">{title}</h2> : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {movies.map((movie, index) => (
          <Link
            key={`${movie.id}-${movie.title}-${index}`}
            to={`/movie/${movie.id}?language=${language}`}
            className="group overflow-hidden rounded-xl border border-white/10 bg-slate-900/70"
          >
            <div className="aspect-[2/3] overflow-hidden bg-slate-800">
              <SafeImage
                src={movie.poster}
                alt={movie.title}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                fallback={<div className="flex h-full items-center justify-center text-sm text-slate-300">No Image</div>}
              />
            </div>
            <div className="space-y-1 p-3">
              <h3 className="line-clamp-1 text-sm font-semibold text-white">{movie.title}</h3>
              <p className="text-xs text-slate-400">Rating: {movie.voteAverage?.toFixed(1) || 'N/A'}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
