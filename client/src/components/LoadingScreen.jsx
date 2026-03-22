export default function LoadingScreen({ label = 'Loading movies...' }) {
  return (
    <div className="loader-scene min-h-screen px-6 py-10 text-slate-100">
      <div className="loader-grid" aria-hidden="true">
        <div className="loader-ring loader-ring-one" />
        <div className="loader-ring loader-ring-two" />
        <div className="loader-core">
          <div className="loader-play" />
        </div>
      </div>

      <div className="loader-content">
        <h2 className="loader-title">CineVerse</h2>
        <p className="loader-label">{label}</p>
        <div className="loader-dots" aria-label="Loading">
          <span />
          <span />
          <span />
        </div>
        <div className="loader-shimmer" />
      </div>
    </div>
  );
}
