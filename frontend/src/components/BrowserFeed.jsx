import { useState } from 'react';

const ACTION_ICONS = {
  starting: '⚡',
  navigating: '→',
  checked: '✓',
  screenshot: '📸',
  fallback: '↩',
  error: '✗',
};

export function BrowserFeed({ feed }) {
  const [activeScreenshot, setActiveScreenshot] = useState(null);
  const screenshotEvents = feed.filter((e) => e.screenshot);

  return (
    <div className="glass rounded-2xl overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/2">
        <span className="text-sm">🖥️</span>
        <span className="text-xs font-medium text-slate-300">ActionBook — Browser Feed</span>
        <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs mono">LIVE</span>
      </div>

      {/* Competitor groups */}
      <div className="p-4 space-y-4 max-h-72 overflow-y-auto">
        {feed.length === 0 ? (
          <p className="text-slate-600 text-xs mono text-center py-4">Waiting for ActionBook navigation…</p>
        ) : (
          <>
            {/* Action log */}
            <div className="space-y-1">
              {feed.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 text-xs animate-fade-in">
                  <span className="text-slate-600 mono flex-shrink-0">{entry.time}</span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 mono text-xs flex-shrink-0">
                    {entry.competitor}
                  </span>
                  <span className="text-slate-400 flex-shrink-0">{ACTION_ICONS[entry.action] ?? '·'}</span>
                  <span className="text-slate-300 break-all">{entry.message}</span>
                  {entry.screenshot && (
                    <button
                      onClick={() => setActiveScreenshot(entry.screenshot)}
                      className="ml-auto flex-shrink-0 px-2 py-0.5 rounded bg-brand-500/20 text-brand-400 text-xs hover:bg-brand-500/30 transition-all"
                    >
                      view
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Gap summary chips */}
            {feed.filter((e) => e.data?.hasFreeTier !== undefined).map((e) => (
              <div key={`gap-${e.id}`} className="flex flex-wrap gap-1.5 animate-slide-up">
                <span className="text-xs text-slate-500">{e.competitor}:</span>
                <GapChip label="Free Tier" confirmed={!e.data.hasFreeTier} />
              </div>
            ))}
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {screenshotEvents.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs text-slate-500 mono mb-2">Screenshots (receipts)</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {screenshotEvents.map((e) => (
              <button
                key={e.id}
                onClick={() => setActiveScreenshot(e.screenshot)}
                className="flex-shrink-0 relative group"
              >
                <img
                  src={e.screenshot}
                  alt={`${e.competitor} screenshot`}
                  className="w-24 h-16 object-cover rounded-lg border border-white/10 hover:border-brand-500/50 transition-all"
                />
                <div className="absolute inset-0 rounded-lg bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                  <span className="text-white text-xs">{e.competitor}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Screenshot modal */}
      {activeScreenshot && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setActiveScreenshot(null)}
        >
          <div className="relative max-w-3xl w-full animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setActiveScreenshot(null)}
              className="absolute -top-8 right-0 text-slate-400 hover:text-white text-sm"
            >
              ✕ Close
            </button>
            <img
              src={activeScreenshot}
              alt="Screenshot evidence"
              className="w-full rounded-xl border border-white/10 shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function GapChip({ label, confirmed }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs mono ${
        confirmed
          ? 'bg-green-500/20 border border-green-500/30 text-green-400'
          : 'bg-white/5 border border-white/10 text-slate-500'
      }`}
    >
      {confirmed ? `✗ ${label}` : `✓ ${label}`}
    </span>
  );
}
