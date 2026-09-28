import React, { useMemo } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Zap,
  ArrowRight,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  RotateCcw,
  ExternalLink,
  Flame,
  Layers
} from 'lucide-react';
import type { JourneyProject, Workspace } from '../../types/journey';
import { auditFunnel, applyAuditFix, type AuditCheckItem } from '../../lib/funnelAuditor';

interface PreFlightAuditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  project: JourneyProject;
  workspace?: Workspace | null;
  onUpdateProject: (updated: JourneyProject) => void;
  onOpenPublish?: () => void;
  onSelectNode?: (nodeId: string) => void;
}

export const PreFlightAuditDrawer: React.FC<PreFlightAuditDrawerProps> = ({
  isOpen,
  onClose,
  project,
  workspace,
  onUpdateProject,
  onOpenPublish,
  onSelectNode
}) => {
  // Dynamically evaluate funnel audit whenever project nodes/edges change
  const report = useMemo(() => auditFunnel(project, workspace), [project, workspace]);

  if (!isOpen) return null;

  const handleFix = (item: AuditCheckItem) => {
    if (!item.autoFixType) return;
    const updated = applyAuditFix(project, item.autoFixType, { targetNodeId: item.targetNodeId });
    onUpdateProject(updated);
  };

  const handleApplyAllQuickWins = () => {
    let current = { ...project };
    for (const pillar of report.pillars) {
      for (const item of pillar.items) {
        if (!item.passed && item.autoFixType) {
          current = applyAuditFix(current, item.autoFixType, { targetNodeId: item.targetNodeId });
        }
      }
    }
    onUpdateProject(current);
  };

  // Status visual themes
  const isReady = report.tier === 'ready';
  const isGood = report.tier === 'good';

  const tierColor = isReady ? 'text-emerald-400' : isGood ? 'text-amber-400' : 'text-rose-400';
  const tierBg = isReady ? 'bg-emerald-500/10' : isGood ? 'bg-amber-500/10' : 'bg-rose-500/10';
  const tierBorder = isReady ? 'border-emerald-500/30' : isGood ? 'border-amber-500/30' : 'border-rose-500/30';
  const tierRing = isReady ? '#10B981' : isGood ? '#F59E0B' : '#F43F5E';

  // SVG Circle parameters for Score Gauge
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (report.overallScore / 100) * circumference;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end transition-opacity">
      <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
        
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 via-rose-400 to-amber-400 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <Sparkles className="w-5 h-5 text-slate-950 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Pre-Flight Funnel Audit</h2>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${tierBg} ${tierColor} border ${tierBorder}`}>
                  {report.grade} Grade
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Empirical conversion & revenue leak inspection before scaling ad spend.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            aria-label="Close Audit Drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Audit Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Top Hero Scorecard */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-950/80 via-slate-900 to-slate-950/90 border border-slate-800/80 shadow-inner relative overflow-hidden">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              
              {/* Radial Gauge */}
              <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    className="stroke-slate-800"
                    strokeWidth="8"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    stroke={tierRing}
                    strokeWidth="8"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-700 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-2xl font-black font-mono text-white leading-none">
                    {report.overallScore}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                    / 100
                  </span>
                </div>
              </div>

              {/* Score Narrative & Leak Protection */}
              <div className="flex-1 space-y-2 text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h3 className="text-sm font-bold text-white tracking-tight">
                    {report.headline}
                  </h3>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {report.subhead}
                </p>

                {/* KPI metrics row */}
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <span className="text-[11px] font-semibold text-slate-300 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{report.passedChecks} of {report.totalChecks} Checks Passed</span>
                  </span>

                  {report.estimatedMarginAtRisk > 0 ? (
                    <span className="text-[11px] font-semibold text-amber-300 px-2.5 py-1 rounded-md bg-amber-950/50 border border-amber-800/40 flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-amber-400" />
                      <span>~${report.estimatedMarginAtRisk.toLocaleString()}/mo Margin at Risk</span>
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-emerald-300 px-2.5 py-1 rounded-md bg-emerald-950/50 border border-emerald-800/40 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>100% Margin Protected</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick-wins bulk banner */}
            {report.fixableChecks > 0 && (
              <div className="mt-4 pt-3.5 border-t border-slate-800/80 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-300 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>{report.fixableChecks} instant quick {report.fixableChecks === 1 ? 'win' : 'wins'} available</strong> to lift your conversion readiness score.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleApplyAllQuickWins}
                  className="shrink-0 px-3 py-1.5 text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 rounded-lg shadow-sm transition active:scale-95 flex items-center gap-1"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Apply All Quick Wins</span>
                </button>
              </div>
            )}
          </div>

          {/* 4 Conversion Pillars */}
          <div className="space-y-4">
            {report.pillars.map((pillar) => {
              const isPillarFull = pillar.score === pillar.maxScore;

              return (
                <div
                  key={pillar.id}
                  className="rounded-xl border border-slate-800/80 bg-slate-950/40 overflow-hidden transition-all shadow-sm"
                >
                  {/* Pillar Header */}
                  <div className="p-4 bg-slate-900/60 border-b border-slate-800/60 flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white tracking-tight">
                          {pillar.title}
                        </span>
                        {isPillarFull && (
                          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/80 px-1.5 py-0.2 rounded border border-emerald-800/50">
                            100% Cleared
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {pillar.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-mono font-bold ${isPillarFull ? 'text-emerald-400' : 'text-slate-300'}`}>
                        {pillar.score} / {pillar.maxScore} pts
                      </span>
                    </div>
                  </div>

                  {/* Checklist Items */}
                  <div className="p-3.5 space-y-2.5">
                    {pillar.items.map((item) => (
                      <div
                        key={item.id}
                        className={`p-3 rounded-lg border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                          item.passed
                            ? 'bg-slate-900/30 border-slate-800/50'
                            : 'bg-amber-950/20 border-amber-500/30'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {item.passed ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          )}
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-200">
                                {item.title}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                ({item.points}/{item.maxPoints} pts)
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-300">
                              {item.summary}
                            </p>
                            {!item.passed && (
                              <p className="text-[10px] text-amber-300/90 font-medium">
                                ✦ Impact: {item.conversionImpact}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="shrink-0 self-end sm:self-center">
                          {item.passed ? (
                            <span className="text-[11px] font-bold text-emerald-400">
                              Verified
                            </span>
                          ) : item.autoFixType ? (
                            <button
                              type="button"
                              onClick={() => handleFix(item)}
                              className="px-2.5 py-1 text-[11px] font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md shadow-sm transition active:scale-95 flex items-center gap-1"
                            >
                              <span>{item.autoFixLabel || '✦ Auto-Fix'}</span>
                            </button>
                          ) : item.targetNodeId && onSelectNode ? (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectNode(item.targetNodeId!);
                                onClose();
                              }}
                              className="text-[11px] font-semibold text-pink-400 hover:text-pink-300 underline underline-offset-2"
                            >
                              Configure on Canvas
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

        </div>

        {/* Drawer Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/95 backdrop-blur flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
          >
            Close Inspector
          </button>

          <div className="flex items-center gap-3">
            {onOpenPublish && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenPublish();
                }}
                className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition shadow-lg ${
                  report.overallScore >= 80
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 shadow-emerald-500/20'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                <span>Proceed to Publish</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
