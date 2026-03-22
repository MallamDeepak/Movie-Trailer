import { Film, Search } from 'lucide-react';

export default function Header({ query, onQueryChange }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-6">
        <div className="flex items-center gap-2 text-white">
          <Film className="h-6 w-6 text-red-500" />
          <h1 className="text-xl font-black tracking-wide">CineVerse</h1>
        </div>
        <label className="flex w-full max-w-sm items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-slate-200">
          <Search className="h-4 w-4" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="Search live movies..."
          />
        </label>
      </div>
    </header>
  );
}
