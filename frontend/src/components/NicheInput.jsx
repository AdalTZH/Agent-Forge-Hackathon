import { useState } from 'react';

const EXAMPLE_NICHES = [
  'solo content creators',
  'indie podcasters',
  'freelance designers',
  'solo SaaS founders',
  'YouTube automation channels',
];

export function NicheInput({ onStart, disabled }) {
  const [niche, setNiche] = useState('');

  const handleSubmit = () => {
    if (niche.trim().length >= 3) onStart(niche.trim());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div className="w-full max-w-2xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-medium mono mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          MARKET GAP AGENT v1.0
        </div>
        <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
          Find Your{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-cyan-300">
            Market Gap
          </span>
        </h1>
        <p className="text-slate-400 text-base leading-relaxed max-w-lg mx-auto">
          Enter a niche. The agent scrapes Reddit for pain points, then verifies competitor gaps using AI-powered browser automation — in under 3 minutes.
        </p>
      </div>

      {/* Tools row */}
      <div className="flex items-center justify-center gap-3 mb-8">
        {['Bright Data', 'Acontext', 'ActionBook', 'Claude AI'].map((tool) => (
          <span
            key={tool}
            className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-slate-400 mono"
          >
            {tool}
          </span>
        ))}
      </div>

      {/* Input */}
      <div className="glass rounded-2xl p-6 glow-cyan">
        <label className="block text-xs font-medium text-slate-400 mono mb-2 uppercase tracking-widest">
          Target Niche
        </label>
        <div className="flex gap-3">
          <input
            type="text"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. solo content creators"
            disabled={disabled}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 transition-all mono text-sm disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={disabled || niche.trim().length < 3}
            className="px-6 py-3 bg-brand-500 hover:bg-brand-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl font-semibold text-white text-sm transition-all hover:shadow-lg hover:shadow-brand-500/25 disabled:cursor-not-allowed"
          >
            {disabled ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Running…
              </span>
            ) : (
              '→ Run Agent'
            )}
          </button>
        </div>

        {/* Example niches */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-xs text-slate-500 mr-1 py-1">Try:</span>
          {EXAMPLE_NICHES.map((n) => (
            <button
              key={n}
              onClick={() => setNiche(n)}
              disabled={disabled}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-400 hover:text-slate-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
