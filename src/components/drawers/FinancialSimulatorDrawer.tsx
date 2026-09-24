import React, { useState, useMemo } from 'react';
import { 
  X, 
  TrendingUp, 
  DollarSign, 
  Sparkles, 
  ShieldCheck, 
  AlertTriangle, 
  RefreshCw, 
  Save, 
  Download, 
  Percent, 
  ArrowRight,
  Layers,
  ChevronRight,
  HelpCircle
} from 'lucide-react';
import type { JourneyNode, FunnelForecast } from '../../types/journey';
import { 
  DEFAULT_FORECAST, 
  SCENARIO_PRESETS, 
  extractPricingFromNodes, 
  calculateFunnelForecast 
} from '../../lib/funnelForecaster';

interface FinancialSimulatorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: JourneyNode[];
  initialForecast?: FunnelForecast;
  onSaveForecast: (forecast: FunnelForecast) => void;
}

export const FinancialSimulatorDrawer: React.FC<FinancialSimulatorDrawerProps> = ({
  isOpen,
  onClose,
  nodes,
  initialForecast,
  onSaveForecast
}) => {
  // Active forecast state
  const [forecast, setForecast] = useState<FunnelForecast>(() => {
    if (initialForecast) return initialForecast;
    const extracted = extractPricingFromNodes(nodes);
    return {
      ...DEFAULT_FORECAST,
      corePrice: extracted.corePrice,
      bumpPrice: extracted.bumpPrice,
      upsellPrice: extracted.upsellPrice
    };
  });

  const [activePreset, setActivePreset] = useState<'conservative' | 'target' | 'aggressive' | 'custom'>('target');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Compute real-time simulation metrics
  const sim = useMemo(() => calculateFunnelForecast(forecast), [forecast]);

  if (!isOpen) return null;

  // Handle Preset Switch
  const applyPreset = (presetKey: 'conservative' | 'target' | 'aggressive') => {
    setActivePreset(presetKey);
    const p = SCENARIO_PRESETS[presetKey].values;
    setForecast(prev => ({
      ...prev,
      monthlyAdSpend: p.monthlyAdSpend,
      cpc: p.cpc,
      conversionRate: p.conversionRate,
      bumpTakeRate: p.bumpTakeRate,
      upsellTakeRate: p.upsellTakeRate,
      cogsPercentage: p.cogsPercentage
    }));
  };

  // Sync pricing directly from active canvas nodes
  const handleSyncFromCanvas = () => {
    const extracted = extractPricingFromNodes(nodes);
    setForecast(prev => ({
      ...prev,
      corePrice: extracted.corePrice,
      bumpPrice: extracted.bumpPrice,
      upsellPrice: extracted.upsellPrice
    }));
    setSyncNotice(`Synced: Core $${extracted.corePrice.toFixed(2)}${extracted.hasBump ? ` | Bump $${extracted.bumpPrice.toFixed(2)}` : ''}${extracted.hasUpsell ? ` | Upsell $${extracted.upsellPrice.toFixed(2)}` : ''}`);
    setTimeout(() => setSyncNotice(null), 4000);
  };

  // Save forecast
  const handleSave = () => {
    const toSave: FunnelForecast = {
      ...forecast,
      savedAt: new Date().toISOString()
    };
    onSaveForecast(toSave);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  // Export CSV summary
  const handleExportCsv = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Monthly Ad Spend', `$${forecast.monthlyAdSpend.toFixed(2)}`],
      ['Average CPC', `$${forecast.cpc.toFixed(2)}`],
      ['Total Clicks / Traffic', sim.totalClicks.toString()],
      ['Landing Page Conversion Rate', `${forecast.conversionRate.toFixed(2)}%`],
      ['Front-End Orders', sim.frontEndOrders.toString()],
      ['Core Product Price', `$${forecast.corePrice.toFixed(2)}`],
      ['Order Bump Take Rate', `${forecast.bumpTakeRate.toFixed(1)}%`],
      ['Order Bump Price', `$${forecast.bumpPrice.toFixed(2)}`],
      ['Order Bump Units', sim.bumpSales.toString()],
      ['Post-Purchase Upsell Take Rate', `${forecast.upsellTakeRate.toFixed(1)}%`],
      ['Post-Purchase Upsell Price', `$${forecast.upsellPrice.toFixed(2)}`],
      ['Upsell Units', sim.upsellSales.toString()],
      ['Product COGS %', `${forecast.cogsPercentage.toFixed(1)}%`],
      ['Gross Projected Revenue', `$${sim.grossRevenue.toFixed(2)}`],
      ['Effective AOV', `$${sim.effectiveAov.toFixed(2)}`],
      ['AOV Lift vs Base', `+$${sim.aovLift.toFixed(2)}`],
      ['Net Profit After Ads & COGS', `$${sim.netProfit.toFixed(2)}`],
      ['Blended ROAS', `${sim.blendedRoas.toFixed(2)}x`],
      ['Max Breakeven CAC', `$${sim.breakevenCac.toFixed(2)}`],
      ['Projected Acquisition CAC', `$${sim.projectedCac.toFixed(2)}`],
      ['Safety Buffer Per Buyer', `$${sim.profitBuffer.toFixed(2)}`],
      ['Breakeven Conversion Rate %', `${sim.breakevenCvr.toFixed(2)}%`],
      ['Exported At', new Date().toISOString()]
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `jourvance_roas_forecast_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const updateField = <K extends keyof FunnelForecast>(key: K, val: FunnelForecast[K]) => {
    setActivePreset('custom');
    setForecast(prev => ({ ...prev, [key]: val }));
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end transition-opacity">
      <div className="w-full max-w-4xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
        
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <TrendingUp className="w-5 h-5 text-slate-950 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">Funnel Economics & ROAS Forecaster</h2>
                <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Pre-Flight Simulator
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Model traffic volume, AOV expansion, and breakeven margins before launching paid ads.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncFromCanvas}
              title="Pull prices from active canvas nodes"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700/60 rounded-lg transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-rose-400" />
              <span>Sync Canvas Prices</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sync Notice Alert */}
        {syncNotice && (
          <div className="px-6 py-2 bg-emerald-950/60 border-b border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>{syncNotice}</span>
          </div>
        )}

        {/* Scenario Presets Bar */}
        <div className="px-6 py-3 bg-slate-950/60 border-b border-slate-800/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Presets:</span>
            <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => applyPreset('conservative')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  activePreset === 'conservative' 
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Conservative
              </button>
              <button
                onClick={() => applyPreset('target')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  activePreset === 'target' 
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Target Benchmark
              </button>
              <button
                onClick={() => applyPreset('aggressive')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  activePreset === 'aggressive' 
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Aggressive Scale
              </button>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[11px] text-slate-500 italic">
              {activePreset !== 'custom' 
                ? SCENARIO_PRESETS[activePreset].description 
                : 'Custom user-adjusted assumptions'}
            </span>
          </div>
        </div>

        {/* Drawer Body: 2-Column Split */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-800">
          
          {/* LEFT COLUMN: Input Sliders & Controls (5 Cols) */}
          <div className="p-6 md:col-span-5 space-y-6 overflow-y-auto bg-slate-900/40">
            
            {/* Section 1: Traffic & Ad Spend */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  Traffic & Ad Spend
                </span>
                <span className="text-xs font-mono font-medium text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                  {sim.totalClicks.toLocaleString()} Clicks
                </span>
              </div>

              {/* Monthly Ad Budget */}
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/70 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <label htmlFor="ad-spend-input" className="text-slate-400 font-medium">Monthly Ad Budget</label>
                  <div className="flex items-center gap-1 font-mono font-bold text-white text-sm">
                    <span>$</span>
                    <input
                      id="ad-spend-input"
                      type="number"
                      min="100"
                      max="100000"
                      step="100"
                      value={forecast.monthlyAdSpend}
                      onChange={e => updateField('monthlyAdSpend', Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min="200"
                  max="30000"
                  step="100"
                  value={forecast.monthlyAdSpend}
                  onChange={e => updateField('monthlyAdSpend', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>$200</span>
                  <span>$15,000</span>
                  <span>$30,000</span>
                </div>
              </div>

              {/* Average CPC */}
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/70 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <label htmlFor="cpc-input" className="text-slate-400 font-medium">Average Cost Per Click (CPC)</label>
                  <div className="flex items-center gap-1 font-mono font-bold text-white text-sm">
                    <span>$</span>
                    <input
                      id="cpc-input"
                      type="number"
                      min="0.10"
                      max="20"
                      step="0.05"
                      value={forecast.cpc}
                      onChange={e => updateField('cpc', Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                      className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min="0.20"
                  max="6.00"
                  step="0.05"
                  value={forecast.cpc}
                  onChange={e => updateField('cpc', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>$0.20</span>
                  <span>$3.00</span>
                  <span>$6.00</span>
                </div>
              </div>
            </div>

            {/* Section 2: Front-End Core Offer */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-rose-400" />
                  Front-End Conversion
                </span>
                <span className="text-xs font-mono font-medium text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/40">
                  {sim.frontEndOrders} Orders
                </span>
              </div>

              {/* Conversion Rate */}
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/70 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <label htmlFor="cvr-input" className="text-slate-400 font-medium">Landing Page Conversion Rate</label>
                  <div className="flex items-center gap-1 font-mono font-bold text-white text-sm">
                    <input
                      id="cvr-input"
                      type="number"
                      min="0.1"
                      max="30"
                      step="0.1"
                      value={forecast.conversionRate}
                      onChange={e => updateField('conversionRate', Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                      className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-white focus:outline-none focus:border-rose-500"
                    />
                    <span>%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="10.0"
                  step="0.1"
                  value={forecast.conversionRate}
                  onChange={e => updateField('conversionRate', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>0.5%</span>
                  <span>5.0%</span>
                  <span>10.0%</span>
                </div>
              </div>

              {/* Core Product Price */}
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/70 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <label htmlFor="core-price-input" className="text-slate-400 font-medium">Core Product Price</label>
                  <div className="flex items-center gap-1 font-mono font-bold text-white text-sm">
                    <span>$</span>
                    <input
                      id="core-price-input"
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      value={forecast.corePrice}
                      onChange={e => updateField('corePrice', Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-white focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min="10"
                  max="250"
                  step="1"
                  value={forecast.corePrice}
                  onChange={e => updateField('corePrice', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
                />
              </div>

              {/* COGS Percentage */}
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/70 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400 font-medium">
                    <label htmlFor="cogs-input">Product COGS & Fulfillment</label>
                    <span title="Cost of Goods Sold (inventory manufacturing, packaging, and shipping). Digital/SaaS is typically 0% to 10%." className="cursor-help">
                      <HelpCircle className="w-3 h-3 text-slate-500" />
                    </span>
                  </div>
                  <div className="flex items-center gap-1 font-mono font-bold text-white text-sm">
                    <input
                      id="cogs-input"
                      type="number"
                      min="0"
                      max="80"
                      step="1"
                      value={forecast.cogsPercentage}
                      onChange={e => updateField('cogsPercentage', Math.max(0, Math.min(80, parseFloat(e.target.value) || 0)))}
                      className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-white focus:outline-none focus:border-slate-500"
                    />
                    <span>%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={forecast.cogsPercentage}
                  onChange={e => updateField('cogsPercentage', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-slate-400"
                />
              </div>
            </div>

            {/* Section 3: AOV Boosters (Bump & Upsell) */}
            <div className="space-y-4 pt-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                AOV Multipliers (Bumps & Upsells)
              </span>

              {/* Order Bump */}
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/70 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-semibold text-slate-300">Checkout Order Bump</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-mono">Price:</span>
                    <div className="flex items-center text-xs font-mono text-white">
                      <span>$</span>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value={forecast.bumpPrice}
                        onChange={e => updateField('bumpPrice', Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-right font-mono text-white text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>Take Rate: {forecast.bumpTakeRate}%</span>
                    <span className="font-mono text-amber-400">{sim.bumpSales} buyers (${sim.bumpRevenue.toFixed(0)})</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="60"
                    step="1"
                    value={forecast.bumpTakeRate}
                    onChange={e => updateField('bumpTakeRate', parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>
              </div>

              {/* Post-Purchase Upsell (OTO) */}
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/70 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-semibold text-slate-300">Post-Purchase Upsell (OTO)</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-mono">Price:</span>
                    <div className="flex items-center text-xs font-mono text-white">
                      <span>$</span>
                      <input
                        type="number"
                        min="1"
                        max="500"
                        step="1"
                        value={forecast.upsellPrice}
                        onChange={e => updateField('upsellPrice', Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-right font-mono text-white text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>Take Rate: {forecast.upsellTakeRate}%</span>
                    <span className="font-mono text-emerald-400">{sim.upsellSales} buyers (${sim.upsellRevenue.toFixed(0)})</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="1"
                    value={forecast.upsellTakeRate}
                    onChange={e => updateField('upsellTakeRate', parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Live Projections & Decision Intelligence (7 Cols) */}
          <div className="p-6 md:col-span-7 space-y-6 overflow-y-auto bg-slate-950/70">
            
            {/* Top Scorecard Grid (4 KPIs) */}
            <div className="grid grid-cols-2 gap-3">
              
              {/* Card 1: Gross Revenue */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Projected Gross Revenue
                </div>
                <div className="text-2xl font-black font-mono text-white mt-1">
                  ${sim.grossRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-mono">
                  <span>{sim.frontEndOrders} orders</span>
                  <span>•</span>
                  <span>${forecast.monthlyAdSpend.toLocaleString()} spend</span>
                </div>
              </div>

              {/* Card 2: Net Take-Home Profit */}
              <div className={`border rounded-xl p-3.5 relative overflow-hidden ${
                sim.isProfitable 
                  ? 'bg-emerald-950/30 border-emerald-500/40' 
                  : 'bg-rose-950/30 border-rose-500/40'
              }`}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Net Profit (After Ads)
                </div>
                <div className={`text-2xl font-black font-mono mt-1 ${
                  sim.isProfitable ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {sim.netProfit >= 0 ? '+' : '-'}${Math.abs(sim.netProfit).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] mt-1 font-mono flex items-center gap-1">
                  <span className={sim.isProfitable ? 'text-emerald-400' : 'text-rose-400'}>
                    {sim.grossRevenue > 0 ? ((sim.netProfit / sim.grossRevenue) * 100).toFixed(1) : 0}% Net Margin
                  </span>
                </div>
              </div>

              {/* Card 3: Blended ROAS */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Blended ROAS
                </div>
                <div className="text-2xl font-black font-mono text-white mt-1 flex items-baseline gap-2">
                  <span>{sim.blendedRoas.toFixed(2)}x</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    sim.blendedRoas >= 2.2 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : sim.blendedRoas >= 1.3 
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}>
                    {sim.blendedRoas >= 2.2 ? 'Scaling Zone' : sim.blendedRoas >= 1.3 ? 'Modest Margin' : 'Unprofitable'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-mono">
                  ${(sim.blendedRoas).toFixed(2)} return per $1 spent
                </div>
              </div>

              {/* Card 4: Effective AOV & Lift */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Effective AOV
                </div>
                <div className="text-2xl font-black font-mono text-white mt-1 flex items-baseline gap-2">
                  <span>${sim.effectiveAov.toFixed(2)}</span>
                  {sim.aovLift > 0 && (
                    <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                      +${sim.aovLift.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-mono">
                  Base: ${sim.baseAov.toFixed(2)} • +{((sim.aovLift / sim.baseAov) * 100).toFixed(0)}% AOV Expansion
                </div>
              </div>

            </div>

            {/* Breakeven & Acquisition CAC Safety Line */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Acquisition Safety & Breakeven CAC
                </span>
                <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${
                  sim.profitBuffer >= 0 ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                }`}>
                  {sim.profitBuffer >= 0 ? 'Safe Cushion' : 'Danger: Losing Money On Ads'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                  <div className="text-slate-400 text-[11px]">Maximum Breakeven CAC</div>
                  <div className="text-lg font-bold font-mono text-white mt-0.5">
                    ${sim.breakevenCac.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500">Max allowable cost to acquire 1 buyer</div>
                </div>

                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                  <div className="text-slate-400 text-[11px]">Projected Cost Per Buyer (CAC)</div>
                  <div className={`text-lg font-bold font-mono mt-0.5 ${
                    sim.projectedCac <= sim.breakevenCac ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    ${sim.projectedCac.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500">Based on ${forecast.cpc.toFixed(2)} CPC & {forecast.conversionRate}% CVR</div>
                </div>
              </div>

              {/* Profit Buffer Bar */}
              <div className="pt-1">
                <div className="flex justify-between text-xs font-mono text-slate-400 mb-1">
                  <span>Profit Buffer Per Customer:</span>
                  <span className={`font-bold ${sim.profitBuffer >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {sim.profitBuffer >= 0 ? '+' : '-'}${Math.abs(sim.profitBuffer).toFixed(2)} / buyer
                  </span>
                </div>
                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800 flex">
                  <div 
                    className={`h-full ${sim.profitBuffer >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    style={{ width: `${Math.min(100, Math.max(5, (sim.projectedCac / Math.max(1, sim.breakevenCac)) * 100))}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
                  <span>$0 CAC</span>
                  <span>Breakeven Line: ${sim.breakevenCac.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Waterfall Unit Economics Breakdown */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2.5">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Unit Economics Waterfall
              </span>

              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/60 text-slate-300">
                  <span className="text-slate-400">Front-End Product Sales ({sim.frontEndOrders} @ ${forecast.corePrice})</span>
                  <span className="text-white">+${sim.coreRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-800/60 text-slate-300">
                  <span className="text-amber-400/90 flex items-center gap-1">
                    <span>↳ Order Bump Sales ({sim.bumpSales} @ ${forecast.bumpPrice})</span>
                  </span>
                  <span className="text-amber-400">+${sim.bumpRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-800/60 text-slate-300">
                  <span className="text-emerald-400/90 flex items-center gap-1">
                    <span>↳ Post-Purchase Upsell Sales ({sim.upsellSales} @ ${forecast.upsellPrice})</span>
                  </span>
                  <span className="text-emerald-400">+${sim.upsellRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-800/60 text-slate-200 font-bold bg-slate-950/40 px-2 rounded">
                  <span>Gross Cash Collected</span>
                  <span>${sim.grossRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between py-1 text-slate-400">
                  <span>Ad Spend Outflow ({sim.totalClicks} clicks @ ${forecast.cpc.toFixed(2)})</span>
                  <span className="text-rose-400">-${forecast.monthlyAdSpend.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>

                {forecast.cogsPercentage > 0 && (
                  <div className="flex justify-between py-1 text-slate-400">
                    <span>Product Manufacturing & COGS ({forecast.cogsPercentage}%)</span>
                    <span className="text-rose-400">-${sim.estimatedCogs.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                <div className={`flex justify-between py-2 px-2 rounded font-bold text-sm ${
                  sim.isProfitable ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/30' : 'bg-rose-950/40 text-rose-400 border border-rose-500/30'
                }`}>
                  <span>Net Estimated Profit</span>
                  <span>{sim.netProfit >= 0 ? '+' : '-'}${Math.abs(sim.netProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* Strategic Sensitivity Insights & Coaching */}
            <div className="p-3.5 bg-gradient-to-r from-slate-900 to-slate-900/60 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Actionable Sensitivity Insights</span>
              </div>
              <ul className="text-xs text-slate-300 space-y-1.5">
                <li className="flex items-start gap-2">
                  <ChevronRight className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>+5% Upsell Leverage:</strong> Boosting your Upsell Take Rate by just 5% (to {(forecast.upsellTakeRate + 5).toFixed(0)}%) generates an extra <strong className="text-emerald-400">+${sim.leverage5PctUpsellProfit.toFixed(0)}/mo in net profit</strong> with zero additional ad spend.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Breakeven Safety Line:</strong> Your funnel turns profitable as long as your landing page converts above <strong className="text-amber-300">{sim.breakevenCvr.toFixed(2)}%</strong>. You currently have a <strong className="text-white">+{sim.cvrBuffer.toFixed(2)}%</strong> buffer.
                  </span>
                </li>
              </ul>
            </div>

          </div>

        </div>

        {/* Drawer Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 backdrop-blur flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition shadow-lg ${
                saveSuccess 
                  ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/20' 
                  : 'bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 shadow-emerald-500/20'
              }`}
            >
              {saveSuccess ? (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Forecast Saved to Journey!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Forecast to Journey</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
