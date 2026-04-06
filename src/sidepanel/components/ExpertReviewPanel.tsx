// 🧠 EXPERT REVIEW PANEL — Shows failure predictions and workflow challenges
// "Professional users want agents that challenge unsafe logic and predict failure"

import { useState } from 'react';
import { 
  AlertTriangle, 
  Shield, 
  Lightbulb, 
  ChevronDown, 
  ChevronUp, 
  AlertCircle,
  CheckCircle,
  XCircle,
  HelpCircle
} from 'lucide-react';
import type { RiskAssessment, FailurePrediction, ExpertWarning } from '../../agent/expertReview';

interface ExpertReviewPanelProps {
  assessment: RiskAssessment | null;
  isVisible: boolean;
  onProceed: () => void;
  onCancel: () => void;
  onRequestCautious: () => void;
}

const RISK_COLORS = {
  low: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400' },
  medium: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
  high: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' },
};

const SEVERITY_ICONS = {
  info: HelpCircle,
  warning: AlertTriangle,
  error: XCircle,
};

export default function ExpertReviewPanel({
  assessment,
  isVisible,
  onProceed,
  onCancel,
  onRequestCautious,
}: ExpertReviewPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['predictions']));

  if (!isVisible || !assessment) return null;

  const riskColors = RISK_COLORS[assessment.overallRisk];
  const hasIssues = assessment.predictions.length > 0 || assessment.warnings.length > 0;

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <div className={`${riskColors.bg} border ${riskColors.border} rounded-xl overflow-hidden`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-handoff-dark/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className={`w-5 h-5 ${riskColors.text}`} />
            <span className="font-medium text-white">Expert Review</span>
          </div>
          <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskColors.bg} ${riskColors.text} border ${riskColors.border}`}>
            {assessment.overallRisk.toUpperCase()} RISK
          </div>
        </div>
        {assessment.requiresHumanReview && (
          <p className="text-xs text-handoff-muted mt-1">
            ⚠️ This workflow requires your review before proceeding
          </p>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Failure Predictions */}
        {assessment.predictions.length > 0 && (
          <Section
            title="Failure Predictions"
            icon={AlertCircle}
            iconColor="text-orange-400"
            count={assessment.predictions.length}
            isExpanded={expandedSections.has('predictions')}
            onToggle={() => toggleSection('predictions')}
          >
            <div className="space-y-2">
              {assessment.predictions.map((pred) => (
                <PredictionCard key={pred.id} prediction={pred} />
              ))}
            </div>
          </Section>
        )}

        {/* Warnings */}
        {assessment.warnings.length > 0 && (
          <Section
            title="Warnings"
            icon={AlertTriangle}
            iconColor="text-yellow-400"
            count={assessment.warnings.length}
            isExpanded={expandedSections.has('warnings')}
            onToggle={() => toggleSection('warnings')}
          >
            <div className="space-y-2">
              {assessment.warnings.map((warning) => (
                <WarningCard key={warning.id} warning={warning} />
              ))}
            </div>
          </Section>
        )}

        {/* Suggestions */}
        {assessment.suggestions.length > 0 && (
          <Section
            title="Suggestions"
            icon={Lightbulb}
            iconColor="text-blue-400"
            count={assessment.suggestions.length}
            isExpanded={expandedSections.has('suggestions')}
            onToggle={() => toggleSection('suggestions')}
          >
            <ul className="space-y-1">
              {assessment.suggestions.map((suggestion, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-handoff-muted">
                  <Lightbulb className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                  {suggestion}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* No issues */}
        {!hasIssues && (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle className="w-4 h-4" />
            <span>No issues detected. Workflow looks safe to proceed.</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-handoff-dark/50 flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 bg-handoff-dark hover:bg-handoff-dark/70 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
        >
          Cancel
        </button>
        {assessment.overallRisk !== 'low' && (
          <button
            onClick={onRequestCautious}
            className="flex-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 text-sm font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Cautious Mode
          </button>
        )}
        <button
          onClick={onProceed}
          disabled={!assessment.shouldProceed}
          className={`flex-1 text-sm font-medium py-2 px-4 rounded-lg transition-colors ${
            assessment.shouldProceed
              ? 'bg-green-500 hover:bg-green-500/80 text-white'
              : 'bg-handoff-muted text-handoff-dark cursor-not-allowed'
          }`}
        >
          {assessment.shouldProceed ? 'Proceed' : 'Too Risky'}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  iconColor,
  count,
  isExpanded,
  onToggle,
  children,
}: {
  title: string;
  icon: typeof AlertCircle;
  iconColor: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-handoff-dark/30 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-handoff-dark/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconColor}`} />
          <span className="text-sm font-medium text-white">{title}</span>
          <span className="text-xs text-handoff-muted">({count})</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-handoff-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-handoff-muted" />
        )}
      </button>
      {isExpanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function PredictionCard({ prediction }: { prediction: FailurePrediction }) {
  const probabilityColor = 
    prediction.probability >= 0.7 ? 'text-red-400' :
    prediction.probability >= 0.4 ? 'text-orange-400' : 'text-yellow-400';

  return (
    <div className="bg-handoff-dark/50 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm text-white">{prediction.description}</span>
        <span className={`text-xs font-medium ${probabilityColor}`}>
          {Math.round(prediction.probability * 100)}%
        </span>
      </div>
      {prediction.mitigation && (
        <p className="text-xs text-handoff-muted">
          💡 {prediction.mitigation}
        </p>
      )}
    </div>
  );
}

function WarningCard({ warning }: { warning: ExpertWarning }) {
  const Icon = SEVERITY_ICONS[warning.severity];
  const severityColors = {
    info: 'text-blue-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
  };

  return (
    <div className="bg-handoff-dark/50 rounded-lg p-3">
      <div className="flex items-start gap-2 mb-1">
        <Icon className={`w-4 h-4 ${severityColors[warning.severity]} flex-shrink-0 mt-0.5`} />
        <div>
          <p className="text-sm text-white">{warning.message}</p>
          <p className="text-xs text-handoff-muted mt-1">
            → {warning.recommendation}
          </p>
        </div>
      </div>
    </div>
  );
}
