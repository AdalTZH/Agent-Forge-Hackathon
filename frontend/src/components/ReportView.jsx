import { useState } from 'react';

export function ReportView({ report, screenshots }) {
  const [activeTab, setActiveTab] = useState('brief');
  const [copied, setCopied] = useState(false);

  if (!report?.opportunityBrief) {
    return (
      <div className="glass rounded-2xl p-8 text-center animate-fade-in">
        <div className="text-4xl mb-3">📄</div>
        <p className="text-slate-400 text-sm">Opportunity Brief will appear here when the agent completes.</p>
      </div>
    );
  }

  const brief = report.opportunityBrief;

  const handleExport = () => {
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market-gap-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    const text = [
      `MARKET GAP OPPORTUNITY BRIEF`,
      `Niche: ${report.niche}`,
      ``,
      `HEADLINE: ${brief.headline}`,
      `ONE-LINER: ${brief.one_liner}`,
      ``,
      `PROBLEM: ${brief.problem_statement}`,
      `TARGET USER: ${brief.target_user}`,
      ``,
      `MVP FEATURES:`,
      ...(brief.mvp_features ?? []).map((f) => `  • ${f.feature} (${f.priority})`),
      ``,
      `GO-TO-MARKET: ${brief.go_to_market_angle}`,
      `CONFIDENCE: ${brief.validation_confidence}`,
    ].join('\n');

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Report header */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium mono ${
                  brief.validation_confidence === 'high'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : brief.validation_confidence === 'medium'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                }`}
              >
                {brief.validation_confidence?.toUpperCase()} CONFIDENCE
              </span>
              <span className="text-xs text-slate-500 mono">Niche: {report.niche}</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-1">{brief.headline}</h2>
            <p className="text-slate-400 text-sm italic">{brief.one_liner}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-400 hover:text-white transition-all"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-1.5 rounded-lg bg-brand-500/20 hover:bg-brand-500/30 border border-brand-500/30 text-xs text-brand-400 hover:text-brand-300 transition-all"
            >
              Export JSON
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
        {['brief', 'evidence', 'competitors', 'screenshots'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
              activeTab === tab
                ? 'bg-brand-500 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="glass rounded-2xl p-5 min-h-64 animate-fade-in">
        {activeTab === 'brief' && <BriefTab brief={brief} />}
        {activeTab === 'evidence' && <EvidenceTab brief={brief} painPoints={report.painPoints} />}
        {activeTab === 'competitors' && <CompetitorsTab brief={brief} competitors={report.competitorResults} gap={report.gapAnalysis} />}
        {activeTab === 'screenshots' && <ScreenshotsTab screenshots={screenshots} />}
      </div>
    </div>
  );
}

function BriefTab({ brief }) {
  return (
    <div className="space-y-5">
      <Section title="Problem" icon="🎯">
        <p className="text-slate-300 text-sm leading-relaxed">{brief.problem_statement}</p>
        <div className="mt-2 flex gap-2">
          <InfoChip label="Target User" value={brief.target_user} />
          <InfoChip label="Market" value={brief.market_size_estimate} />
        </div>
      </Section>

      <Section title="MVP Features" icon="🛠️">
        <div className="space-y-2">
          {(brief.mvp_features ?? []).map((f, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 px-1.5 py-0.5 rounded text-xs mono flex-shrink-0 ${
                  f.priority === 'must-have'
                    ? 'bg-brand-500/20 text-brand-400'
                    : 'bg-white/5 text-slate-500'
                }`}
              >
                {f.priority === 'must-have' ? 'MUST' : 'NICE'}
              </span>
              <div>
                <p className="text-sm text-slate-200">{f.feature}</p>
                <p className="text-xs text-slate-500">{f.why}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Go-to-Market" icon="🚀">
        <p className="text-slate-300 text-sm leading-relaxed">{brief.go_to_market_angle}</p>
      </Section>

      <Section title="Next Steps" icon="📋">
        <ol className="space-y-1">
          {(brief.next_steps ?? []).map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
              <span className="text-brand-400 mono flex-shrink-0">{i + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

function EvidenceTab({ brief, painPoints }) {
  return (
    <div className="space-y-4">
      <Section title="Evidence Summary" icon="📊">
        <p className="text-slate-300 text-sm leading-relaxed">{brief.evidence_summary}</p>
      </Section>

      {painPoints?.length > 0 && (
        <Section title="Pain Points Collected" icon="💬">
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {painPoints.slice(0, 10).map((p, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-white/3 border border-white/5">
                <p className="text-xs text-slate-300">{p.problem || p}</p>
                {p.verbatim_quote && (
                  <p className="text-xs text-slate-500 italic mt-1">"{p.verbatim_quote?.slice(0, 120)}"</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function CompetitorsTab({ brief, competitors, gap }) {
  return (
    <div className="space-y-4">
      {gap && (
        <div className={`p-3 rounded-xl border ${gap.gap_confirmed ? 'bg-green-500/10 border-green-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
          <p className={`text-xs font-medium mono mb-1 ${gap.gap_confirmed ? 'text-green-400' : 'text-amber-400'}`}>
            GAP {gap.gap_confirmed ? 'CONFIRMED' : 'UNCONFIRMED'} · {gap.confidence} confidence
          </p>
          <p className="text-xs text-slate-300">{gap.gap_summary}</p>
        </div>
      )}

      <Section title="Competitor Landscape" icon="🏢">
        <div className="space-y-2">
          {(brief.competitor_landscape ?? competitors ?? []).map((c, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-white/3 border border-white/5">
              <span className="text-sm">🔴</span>
              <div>
                <p className="text-sm font-medium text-slate-200">{c.name}</p>
                <p className="text-xs text-slate-400">{c.weakness || c.notes}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {gap?.differentiator && (
        <Section title="Your Differentiator" icon="⚡">
          <p className="text-slate-300 text-sm leading-relaxed">{gap.differentiator}</p>
        </Section>
      )}
    </div>
  );
}

function ScreenshotsTab({ screenshots }) {
  const [active, setActive] = useState(null);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        These screenshots are the "receipts" — evidence that the market gap was verified by actually navigating competitor websites.
      </p>
      {screenshots?.length === 0 ? (
        <p className="text-slate-600 text-sm text-center py-8">No screenshots available.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {screenshots.map((s, i) => (
            <button
              key={i}
              onClick={() => setActive(s.screenshot)}
              className="group relative rounded-xl overflow-hidden border border-white/10 hover:border-brand-500/50 transition-all"
            >
              <img src={s.screenshot} alt={s.name} className="w-full h-28 object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-2">
                <span className="text-white text-xs font-medium">{s.name}</span>
              </div>
              <div className="absolute inset-0 bg-brand-500/20 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">View</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setActive(null)}>
          <img src={active} alt="Evidence" className="max-w-3xl w-full rounded-xl border border-white/10" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span>{icon}</span>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div className="flex-1 p-2 rounded-lg bg-white/3 border border-white/5">
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-xs text-slate-300">{value}</p>
    </div>
  );
}
