"use client";

import { useState, useEffect, useCallback } from 'react';
import { 
  Sparkles, Brain, Zap, Trash2, ChevronDown, ChevronUp, 
  BarChart3, Shield, Globe, BookOpen, RefreshCw, FlaskConical, TrendingUp, Play
} from 'lucide-react';

interface LearningStats {
  memory: {
    totalTraces: number;
    successfulTraces: number;
    totalPatterns: number;
    topSites: string[];
  };
  skills: {
    totalSkills: number;
    provenSkills: number;
    stableSkills: number;
    experimentalSkills: number;
    topSkills: Array<{ name: string; successRate: number; executions: number }>;
  };
  brain: {
    totalSites: number;
    avgDomReliability: number;
    avgVisionReliability: number;
    topSites: Array<{ site: string; actions: number; domR: number; visionR: number }>;
  };
  failures: {
    totalFailures: number;
    topCategories: Record<string, number>;
  };
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  metadata: {
    totalExecutions: number;
    successRate: number;
    reliability: 'experimental' | 'stable' | 'proven';
    avgDuration: number;
    userApproved: boolean;
  };
  steps: Array<{ description: string; successRate: number }>;
  version: number;
}

const reliabilityColors = {
  experimental: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  stable: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  proven: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
};

const reliabilityIcons = {
  experimental: '🧪',
  stable: '🔵',
  proven: '✅',
};

function StatCard({ label, value, sub, icon: Icon }: { 
  label: string; value: string | number; sub?: string; icon: typeof Brain 
}) {
  return (
    <div className="bg-handoff-surface rounded-xl p-3 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-handoff-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-handoff-primary" />
      </div>
      <div>
        <div className="text-lg font-bold text-white">{value}</div>
        <div className="text-xs text-handoff-muted">{label}</div>
        {sub && <div className="text-[10px] text-handoff-muted/60 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function SkillCard({ skill, onDelete }: { skill: SkillItem; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const rel = skill.metadata.reliability;

  return (
    <div className="bg-handoff-surface rounded-xl overflow-hidden border border-handoff-surface">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-handoff-surface/80 transition-colors text-left"
      >
        <span className="text-lg">{reliabilityIcons[rel]}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{skill.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${reliabilityColors[rel]}`}>
              {rel}
            </span>
            <span className="text-[10px] text-handoff-muted">
              {Math.round(skill.metadata.successRate * 100)}% success
            </span>
            <span className="text-[10px] text-handoff-muted">
              v{skill.version}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-handoff-muted">{skill.metadata.totalExecutions}x</span>
          {expanded ? <ChevronUp className="w-3 h-3 text-handoff-muted" /> : <ChevronDown className="w-3 h-3 text-handoff-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-handoff-surface">
          <p className="text-xs text-handoff-muted mt-2 mb-2">{skill.description}</p>
          
          <div className="space-y-1 mb-2">
            {skill.steps.slice(0, 6).map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-handoff-muted w-4 text-right">{i + 1}.</span>
                <span className="text-white flex-1 truncate">{step.description}</span>
                <span className={step.successRate >= 0.8 ? 'text-emerald-400' : step.successRate >= 0.5 ? 'text-amber-400' : 'text-red-400'}>
                  {Math.round(step.successRate * 100)}%
                </span>
              </div>
            ))}
            {skill.steps.length > 6 && (
              <div className="text-[10px] text-handoff-muted pl-6">+{skill.steps.length - 6} more steps</div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-handoff-muted">
              Avg: {Math.round(skill.metadata.avgDuration / 1000)}s
            </span>
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(skill.id); }}
              className="p-1 hover:bg-red-500/10 rounded text-red-400/60 hover:text-red-400 transition-colors"
              title="Delete skill"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SiteRow({ site }: { site: { site: string; actions: number; domR: number; visionR: number } }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <Globe className="w-3 h-3 text-handoff-muted flex-shrink-0" />
      <span className="text-white flex-1 truncate">{site.site}</span>
      <span className="text-handoff-muted">{site.actions} acts</span>
      <div className="flex gap-1.5">
        <span className="text-blue-400" title="DOM reliability">D:{site.domR}%</span>
        <span className="text-purple-400" title="Vision reliability">V:{site.visionR}%</span>
      </div>
    </div>
  );
}

interface MetaStats {
  totalExperiments: number;
  activePatches: number;
  provenPatches: number;
  rejectedPatches: number;
  siteStrategies: number;
  overallScoreImprovement: number;
  lastOptimizationRun: number;
}

interface PatchItem {
  id: string;
  content: string;
  section?: string;
  status: string;
  score: number;
  appliedCount: number;
  successCount: number;
  generatedFrom: string;
}

interface SiteStrategyItem {
  sitePattern: string;
  preferredMode: string;
  customRules: string[];
  avgSuccessRate: number;
  totalRuns: number;
}

export default function LearningPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'overview' | 'skills' | 'sites' | 'meta'>('overview');
  const [metaStats, setMetaStats] = useState<MetaStats | null>(null);
  const [metaScore, setMetaScore] = useState<number | null>(null);
  const [metaPatches, setMetaPatches] = useState<PatchItem[]>([]);
  const [metaStrategies, setMetaStrategies] = useState<SiteStrategyItem[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationInsights, setOptimizationInsights] = useState<string[]>([]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, skillsRes, metaStatsRes, metaScoreRes, patchesRes, strategiesRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_LEARNING_STATS' }),
        chrome.runtime.sendMessage({ type: 'GET_SKILLS' }),
        chrome.runtime.sendMessage({ type: 'META_GET_STATS' }),
        chrome.runtime.sendMessage({ type: 'META_GET_SCORE' }),
        chrome.runtime.sendMessage({ type: 'META_GET_PATCHES' }),
        chrome.runtime.sendMessage({ type: 'META_GET_SITE_STRATEGIES' }),
      ]);
      if (statsRes?.success) setStats(statsRes.stats);
      if (skillsRes?.success) setSkills(skillsRes.skills || []);
      if (metaStatsRes?.success) setMetaStats(metaStatsRes);
      if (metaScoreRes?.success) setMetaScore(metaScoreRes.score);
      if (patchesRes?.success) setMetaPatches(patchesRes.patches || []);
      if (strategiesRes?.success) setMetaStrategies(strategiesRes.strategies || []);
    } catch (e) {
      console.error('[LearningPanel] Failed to fetch stats:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) fetchStats();
  }, [isOpen, fetchStats]);

  const handleDeleteSkill = async (skillId: string) => {
    await chrome.runtime.sendMessage({ type: 'DELETE_SKILL', payload: { skillId } });
    setSkills((prev) => prev.filter((s) => s.id !== skillId));
  };

  const handleClearAll = async () => {
    if (!confirm('Clear all learning data? Skills and memory will be reset.')) return;
    await Promise.all([
      chrome.runtime.sendMessage({ type: 'CLEAR_LEARNING_DATA' }),
      chrome.runtime.sendMessage({ type: 'META_CLEAR_ALL' }),
    ]);
    fetchStats();
  };

  const handleRunOptimization = async () => {
    setOptimizing(true);
    setOptimizationInsights([]);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'META_RUN_OPTIMIZATION' });
      if (res?.success) {
        setOptimizationInsights(res.insights || []);
        fetchStats();
      }
    } catch (e) {
      console.error('[LearningPanel] Optimization failed:', e);
    }
    setOptimizing(false);
  };

  if (!isOpen) return null;

  const memoryRate = stats?.memory 
    ? (stats.memory.totalTraces > 0 
        ? Math.round((stats.memory.successfulTraces / stats.memory.totalTraces) * 100) 
        : 0)
    : 0;

  return (
    <div className="fixed inset-0 z-50 bg-handoff-dark flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-handoff-surface">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-white">Self-Learning</span>
            <span className="text-[10px] text-handoff-muted block -mt-0.5">gets better every run</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchStats} className="p-1.5 hover:bg-handoff-surface rounded-lg transition-colors" title="Refresh">
            <RefreshCw className={`w-4 h-4 text-handoff-muted ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="text-sm text-handoff-muted hover:text-white px-2 py-1 rounded-lg hover:bg-handoff-surface transition-colors">
            Close
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-handoff-surface">
        {(['overview', 'skills', 'sites', 'meta'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
              tab === t ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-handoff-muted hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!stats ? (
          <div className="text-center text-handoff-muted text-sm py-12">
            {loading ? 'Loading learning data...' : 'No learning data yet. Run some tasks first.'}
          </div>
        ) : tab === 'overview' ? (
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard icon={Brain} label="Execution Traces" value={stats.memory.totalTraces} sub={`${memoryRate}% success rate`} />
              <StatCard icon={BookOpen} label="Learned Patterns" value={stats.memory.totalPatterns} />
              <StatCard icon={Zap} label="Auto-Skills" value={stats.skills.totalSkills} sub={`${stats.skills.provenSkills} proven`} />
              <StatCard icon={Shield} label="Failures Analyzed" value={stats.failures.totalFailures} />
            </div>

            {/* Skill breakdown */}
            {stats.skills.totalSkills > 0 && (
              <div className="bg-handoff-surface rounded-xl p-3">
                <h4 className="text-xs font-medium text-handoff-muted mb-2">Skill Reliability</h4>
                <div className="flex gap-2">
                  <div className="flex-1 bg-emerald-500/10 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-emerald-400">{stats.skills.provenSkills}</div>
                    <div className="text-[10px] text-emerald-400/70">Proven</div>
                  </div>
                  <div className="flex-1 bg-blue-500/10 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-blue-400">{stats.skills.stableSkills}</div>
                    <div className="text-[10px] text-blue-400/70">Stable</div>
                  </div>
                  <div className="flex-1 bg-amber-500/10 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-amber-400">{stats.skills.experimentalSkills}</div>
                    <div className="text-[10px] text-amber-400/70">Experimental</div>
                  </div>
                </div>
              </div>
            )}

            {/* Top failure categories */}
            {stats.failures.totalFailures > 0 && (
              <div className="bg-handoff-surface rounded-xl p-3">
                <h4 className="text-xs font-medium text-handoff-muted mb-2">Failure Analysis</h4>
                <div className="space-y-1">
                  {Object.entries(stats.failures.topCategories)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([cat, count]) => (
                      <div key={cat} className="flex items-center justify-between text-xs">
                        <span className="text-white">{cat.replace(/_/g, ' ')}</span>
                        <span className="text-handoff-muted">{count}x</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Top learned sites */}
            {stats.memory.topSites.length > 0 && (
              <div className="bg-handoff-surface rounded-xl p-3">
                <h4 className="text-xs font-medium text-handoff-muted mb-2">Top Sites</h4>
                <div className="space-y-1">
                  {stats.memory.topSites.map((site) => (
                    <div key={site} className="flex items-center gap-2 text-xs">
                      <Globe className="w-3 h-3 text-handoff-muted" />
                      <span className="text-white">{site}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clear button */}
            <button
              onClick={handleClearAll}
              className="w-full text-xs text-red-400/60 hover:text-red-400 py-2 hover:bg-red-500/5 rounded-lg transition-colors"
            >
              Clear all learning data
            </button>
          </div>

        ) : tab === 'skills' ? (
          <div className="space-y-2">
            {skills.length === 0 ? (
              <div className="text-center py-12">
                <Zap className="w-8 h-8 text-handoff-muted mx-auto mb-2" />
                <p className="text-sm text-handoff-muted">No skills yet</p>
                <p className="text-xs text-handoff-muted/60 mt-1">Skills auto-generate after 3+ successful runs of the same task</p>
              </div>
            ) : (
              skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onDelete={handleDeleteSkill} />
              ))
            )}
          </div>

        ) : tab === 'meta' ? (
          <div className="space-y-4">
            {/* Agent Score */}
            <div className="bg-gradient-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/20 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-medium text-white">Agent Score</span>
                </div>
                <span className="text-2xl font-bold text-purple-400">
                  {metaScore !== null ? `${(metaScore * 100).toFixed(1)}%` : '--'}
                </span>
              </div>
              <p className="text-[10px] text-handoff-muted">Composite score from success rate, efficiency, and skill reliability</p>
              {metaStats && metaStats.overallScoreImprovement !== 0 && (
                <div className={`flex items-center gap-1 mt-2 text-xs ${
                  metaStats.overallScoreImprovement > 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  <TrendingUp className="w-3 h-3" />
                  {metaStats.overallScoreImprovement > 0 ? '+' : ''}
                  {(metaStats.overallScoreImprovement * 100).toFixed(1)}% since optimization started
                </div>
              )}
            </div>

            {/* Optimization Button */}
            <button
              onClick={handleRunOptimization}
              disabled={optimizing}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors ${
                optimizing
                  ? 'bg-purple-500/20 text-purple-400 animate-pulse'
                  : 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400'
              }`}
            >
              {optimizing ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing traces...</>
              ) : (
                <><Play className="w-4 h-4" /> Run Optimization Cycle</>
              )}
            </button>

            {/* Optimization Insights */}
            {optimizationInsights.length > 0 && (
              <div className="bg-handoff-surface rounded-xl p-3">
                <h4 className="text-xs font-medium text-purple-400 mb-2">Optimization Results</h4>
                <div className="space-y-1">
                  {optimizationInsights.map((insight, i) => (
                    <div key={i} className="text-[11px] text-handoff-muted flex gap-2">
                      <span className="text-purple-400">{'>'}</span>
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stats Grid */}
            {metaStats && (
              <div className="grid grid-cols-2 gap-2">
                <StatCard icon={FlaskConical} label="Experiments" value={metaStats.totalExperiments} sub={`${metaStats.provenPatches} proven`} />
                <StatCard icon={Zap} label="Active Patches" value={metaStats.activePatches} sub={`${metaStats.rejectedPatches} rejected`} />
              </div>
            )}

            {/* Active Patches */}
            {metaPatches.length > 0 && (
              <div className="bg-handoff-surface rounded-xl p-3">
                <h4 className="text-xs font-medium text-handoff-muted mb-2">Active Prompt Patches</h4>
                <div className="space-y-2">
                  {metaPatches.slice(0, 5).map((patch) => (
                    <div key={patch.id} className="text-[11px] border-l-2 border-purple-500/40 pl-2">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                          patch.status === 'proven' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-purple-500/10 text-purple-400'
                        }`}>
                          {patch.status}
                        </span>
                        {patch.section && <span className="text-handoff-muted">{patch.section}</span>}
                        <span className="text-handoff-muted ml-auto">{Math.round(patch.score * 100)}%</span>
                      </div>
                      <p className="text-handoff-muted line-clamp-2">{patch.content}</p>
                      <p className="text-[9px] text-handoff-muted/50 mt-0.5">From: {patch.generatedFrom}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Site Strategies */}
            {metaStrategies.length > 0 && (
              <div className="bg-handoff-surface rounded-xl p-3">
                <h4 className="text-xs font-medium text-handoff-muted mb-2">Optimized Site Strategies</h4>
                <div className="space-y-1.5">
                  {metaStrategies.map((s) => (
                    <div key={s.sitePattern} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Globe className="w-3 h-3 text-handoff-muted" />
                        <span className="text-white truncate max-w-[140px]">{s.sitePattern}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-purple-400 text-[10px]">{s.preferredMode}</span>
                        <span className="text-handoff-muted text-[10px]">{Math.round(s.avgSuccessRate * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-handoff-surface rounded-xl p-3">
              <h4 className="text-xs font-medium text-handoff-muted mb-2">How Meta-Agent Works</h4>
              <div className="space-y-2 text-[11px] text-handoff-muted">
                <div className="flex gap-2">
                  <FlaskConical className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <span><strong className="text-purple-400">Analyze</strong> — Reads execution traces to find failure patterns and inefficiencies</span>
                </div>
                <div className="flex gap-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span><strong className="text-amber-400">Generate</strong> — Creates prompt patches that address identified weaknesses</span>
                </div>
                <div className="flex gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span><strong className="text-emerald-400">Evaluate</strong> — Measures patch impact over 5+ tasks. Keep if better, discard if worse.</span>
                </div>
              </div>
            </div>
          </div>

        ) : tab === 'sites' ? (
          <div className="space-y-2">
            {stats.brain.topSites.length === 0 ? (
              <div className="text-center py-12">
                <Globe className="w-8 h-8 text-handoff-muted mx-auto mb-2" />
                <p className="text-sm text-handoff-muted">No site profiles yet</p>
                <p className="text-xs text-handoff-muted/60 mt-1">Site reliability profiles build as you use HandOff</p>
              </div>
            ) : (
              <div className="bg-handoff-surface rounded-xl p-3">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-medium text-handoff-muted">Site Profiles</h4>
                  <div className="flex gap-3 text-[10px]">
                    <span className="text-blue-400">D = DOM</span>
                    <span className="text-purple-400">V = Vision</span>
                  </div>
                </div>
                <div className="space-y-0.5 divide-y divide-handoff-surface">
                  {stats.brain.topSites.map((site) => (
                    <SiteRow key={site.site} site={site} />
                  ))}
                </div>
                <div className="mt-3 pt-2 border-t border-handoff-surface flex justify-between text-[10px] text-handoff-muted">
                  <span>{stats.brain.totalSites} total sites</span>
                  <span>Avg DOM: {Math.round(stats.brain.avgDomReliability * 100)}% | Vision: {Math.round(stats.brain.avgVisionReliability * 100)}%</span>
                </div>
              </div>
            )}

            <div className="bg-handoff-surface rounded-xl p-3 mt-3">
              <h4 className="text-xs font-medium text-handoff-muted mb-2">How Hybrid Brain Works</h4>
              <div className="space-y-2 text-[11px] text-handoff-muted">
                <div className="flex gap-2">
                  <BarChart3 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <span><strong className="text-blue-400">DOM mode</strong> — Fast selector-based clicks. Used when site has reliable DOM structure.</span>
                </div>
                <div className="flex gap-2">
                  <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <span><strong className="text-purple-400">Vision mode</strong> — Screenshot analysis. Used for dynamic UIs or unknown sites.</span>
                </div>
                <div className="flex gap-2">
                  <Zap className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span><strong className="text-emerald-400">Skill mode</strong> — Instant replay of proven workflows. Fastest and most reliable.</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
