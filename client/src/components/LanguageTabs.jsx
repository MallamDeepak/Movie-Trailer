import { languageOptions } from '../constants/languages';

export default function LanguageTabs({ selected, onSelect }) {
  return (
    <div className="flex flex-wrap gap-3">
      {languageOptions.map((language) => {
        const active = selected === language.value;
        return (
          <button
            key={language.value}
            type="button"
            onClick={() => onSelect(language.value)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              active
                ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                : 'border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
            }`}
          >
            {language.label}
          </button>
        );
      })}
    </div>
  );
}
