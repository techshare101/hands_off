// 🛡️ SMART SAFETY FRICTION — Context-aware approval prompts
// Users are crying for: "It does dangerous things without asking"

import { useState } from 'react';
import { Shield, AlertTriangle, CreditCard, Trash2, Send, Lock, ExternalLink, Check, X, Info } from 'lucide-react';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface SafetyContext {
  action: {
    type: string;
    target?: string;
    value?: string;
  };
  riskLevel: RiskLevel;
  reasons: string[];
  pageUrl: string;
  pageTitle: string;
  confidence: number;
}

interface SmartSafetyPromptProps {
  isVisible: boolean;
  context: SafetyContext | null;
  onApprove: () => void;
  onReject: () => void;
  onModify: (modification: string) => void;
}

const RISK_CONFIG = {
  low: {
    icon: Info,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    label: 'Low Risk',
    description: 'This action appears safe.',
  },
  medium: {
    icon: Shield,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
    label: 'Medium Risk',
    description: 'Please review before proceeding.',
  },
  high: {
    icon: AlertTriangle,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    label: 'High Risk',
    description: 'This action requires your approval.',
  },
  critical: {
    icon: Trash2,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    label: 'Critical Risk',
    description: 'This action could have serious consequences.',
  },
};

const ACTION_ICONS: Record<string, typeof CreditCard> = {
  payment: CreditCard,
  delete: Trash2,
  submit: Send,
  login: Lock,
  external: ExternalLink,
};

function getRiskIcon(action: string, defaultIcon: typeof Shield) {
  const lowerAction = action.toLowerCase();
  for (const [key, icon] of Object.entries(ACTION_ICONS)) {
    if (lowerAction.includes(key)) return icon;
  }
  return defaultIcon;
}

export default function SmartSafetyPrompt({
  isVisible,
  context,
  onApprove,
  onReject,
  onModify,
}: SmartSafetyPromptProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!isVisible || !context) return null;

  const riskConfig = RISK_CONFIG[context.riskLevel];
  const RiskIcon = riskConfig.icon;
  const ActionIcon = getRiskIcon(context.action.type, riskConfig.icon);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className={`bg-handoff-surface rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border ${riskConfig.borderColor}`}>
        {/* Header */}
        <div className={`${riskConfig.bgColor} px-4 py-3 border-b ${riskConfig.borderColor}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full ${riskConfig.bgColor} flex items-center justify-center`}>
              <RiskIcon className={`w-5 h-5 ${riskConfig.color}`} />
            </div>
            <div>
              <div className={`text-sm font-semibold ${riskConfig.color}`}>{riskConfig.label}</div>
              <div className="text-xs text-handoff-muted">{riskConfig.description}</div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Action being performed */}
          <div className="bg-handoff-dark rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <ActionIcon className="w-5 h-5 text-white" />
              <span className="text-white font-medium capitalize">{context.action.type}</span>
            </div>
            {context.action.target && (
              <div className="text-sm text-handoff-muted">
                Target: <span className="text-handoff-primary">"{context.action.target}"</span>
              </div>
            )}
            {context.action.value && (
              <div className="text-sm text-handoff-muted mt-1">
                Value: <span className="text-white">{context.action.value.substring(0, 50)}...</span>
              </div>
            )}
          </div>

          {/* Why approval is needed */}
          <div>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-handoff-primary hover:underline mb-2"
            >
              {showDetails ? 'Hide details' : 'Why is this flagged?'}
            </button>
            
            {showDetails && (
              <ul className="space-y-1.5">
                {context.reasons.map((reason, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-handoff-muted">
                    <AlertTriangle className={`w-3.5 h-3.5 ${riskConfig.color} flex-shrink-0 mt-0.5`} />
                    {reason}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Page context */}
          <div className="bg-handoff-dark/50 rounded-lg px-3 py-2 text-xs text-handoff-muted">
            <div className="truncate">📍 {context.pageTitle}</div>
            <div className="truncate opacity-60">{context.pageUrl}</div>
          </div>

          {/* Confidence indicator */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-handoff-muted">Agent confidence:</span>
            <div className="flex-1 h-1.5 bg-handoff-dark rounded-full overflow-hidden">
              <div
                className={`h-full ${
                  context.confidence >= 0.8 ? 'bg-green-500' :
                  context.confidence >= 0.6 ? 'bg-yellow-500' : 'bg-orange-500'
                }`}
                style={{ width: `${context.confidence * 100}%` }}
              />
            </div>
            <span className="text-xs text-handoff-muted">{Math.round(context.confidence * 100)}%</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 p-4 border-t border-handoff-dark">
          <button
            onClick={onReject}
            className="flex-1 flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium py-3 px-4 rounded-xl transition-colors"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
          <button
            onClick={() => onModify('Try a different approach')}
            className="flex items-center justify-center gap-2 bg-handoff-dark hover:bg-handoff-dark/70 text-white font-medium py-3 px-4 rounded-xl transition-colors"
          >
            Modify
          </button>
          <button
            onClick={onApprove}
            className={`flex-1 flex items-center justify-center gap-2 ${
              context.riskLevel === 'critical' 
                ? 'bg-orange-500 hover:bg-orange-500/80' 
                : 'bg-green-500 hover:bg-green-500/80'
            } text-white font-medium py-3 px-4 rounded-xl transition-colors`}
          >
            <Check className="w-4 h-4" />
            {context.riskLevel === 'critical' ? 'Approve Anyway' : 'Approve'}
          </button>
        </div>

        {/* Critical warning */}
        {context.riskLevel === 'critical' && (
          <div className="bg-red-500/10 border-t border-red-500/30 px-4 py-2">
            <p className="text-xs text-red-400 text-center">
              ⚠️ This action cannot be undone. Please review carefully.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
