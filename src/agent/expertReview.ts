// 🧠 EXPERT REVIEW MODE — Agent flags brittle logic and predicts failure
// "Excessive agreeableness is a bug, not a feature"

import { ActionSchema } from './prompts';

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  predictions: FailurePrediction[];
  warnings: ExpertWarning[];
  suggestions: string[];
  shouldProceed: boolean;
  requiresHumanReview: boolean;
}

export interface FailurePrediction {
  id: string;
  type: 'element_not_found' | 'timing_issue' | 'state_change' | 'navigation_error' | 'input_validation' | 'permission_denied';
  probability: number; // 0-1
  description: string;
  mitigation?: string;
}

export interface ExpertWarning {
  id: string;
  severity: 'info' | 'warning' | 'error';
  category: 'brittle_selector' | 'unsafe_assumption' | 'missing_verification' | 'race_condition' | 'data_loss_risk';
  message: string;
  recommendation: string;
}

export interface WorkflowAnalysis {
  task: string;
  pageUrl: string;
  pageTitle: string;
  proposedActions: ActionSchema[];
  previousActions: ActionSchema[];
}

export class ExpertReviewEngine {
  
  analyzeWorkflow(analysis: WorkflowAnalysis): RiskAssessment {
    const predictions: FailurePrediction[] = [];
    const warnings: ExpertWarning[] = [];
    const suggestions: string[] = [];

    // Analyze each proposed action
    for (const action of analysis.proposedActions) {
      this.analyzeAction(action, analysis, predictions, warnings);
    }

    // Check for workflow-level issues
    this.analyzeWorkflowPatterns(analysis, predictions, warnings, suggestions);

    // Calculate overall risk
    const overallRisk = this.calculateOverallRisk(predictions, warnings);
    const requiresHumanReview = overallRisk === 'high' || overallRisk === 'critical' || warnings.some(w => w.severity === 'error');

    return {
      overallRisk,
      predictions,
      warnings,
      suggestions,
      shouldProceed: overallRisk !== 'critical',
      requiresHumanReview,
    };
  }

  private analyzeAction(
    action: ActionSchema,
    analysis: WorkflowAnalysis,
    predictions: FailurePrediction[],
    warnings: ExpertWarning[]
  ): void {
    // Check for coordinate-based clicks (brittle)
    if (action.type === 'click' && action.x !== undefined && action.y !== undefined) {
      if (!action.target) {
        warnings.push({
          id: `warn_${Date.now()}_coord`,
          severity: 'warning',
          category: 'brittle_selector',
          message: 'Click action uses coordinates without a target description',
          recommendation: 'Consider using element identification for more reliable targeting',
        });
        predictions.push({
          id: `pred_${Date.now()}_coord`,
          type: 'element_not_found',
          probability: 0.3,
          description: 'Coordinate-based clicks may fail if page layout changes',
          mitigation: 'The agent will attempt to find the element visually',
        });
      }
    }

    // Check for typing without prior click (unsafe assumption)
    if (action.type === 'type') {
      const lastAction = analysis.previousActions[analysis.previousActions.length - 1];
      if (!lastAction || lastAction.type !== 'click') {
        warnings.push({
          id: `warn_${Date.now()}_type`,
          severity: 'info',
          category: 'unsafe_assumption',
          message: 'Typing without explicitly clicking a field first',
          recommendation: 'Ensure the correct input field is focused before typing',
        });
      }
    }

    // Check for form submission without verification
    if (action.type === 'click' && action.target?.toLowerCase().includes('submit')) {
      const hasVerification = analysis.proposedActions.some(a => 
        a.type === 'wait' || (a.target?.toLowerCase().includes('confirm') || a.target?.toLowerCase().includes('success'))
      );
      if (!hasVerification) {
        warnings.push({
          id: `warn_${Date.now()}_submit`,
          severity: 'warning',
          category: 'missing_verification',
          message: 'Form submission without explicit success verification',
          recommendation: 'Add a verification step to confirm the submission was successful',
        });
      }
    }

    // Check for potentially destructive actions
    const destructiveKeywords = ['delete', 'remove', 'cancel', 'clear', 'reset'];
    if (action.target && destructiveKeywords.some(k => action.target!.toLowerCase().includes(k))) {
      warnings.push({
        id: `warn_${Date.now()}_destructive`,
        severity: 'error',
        category: 'data_loss_risk',
        message: `Potentially destructive action: "${action.target}"`,
        recommendation: 'Confirm this action is intentional before proceeding',
      });
    }
  }

  private analyzeWorkflowPatterns(
    analysis: WorkflowAnalysis,
    predictions: FailurePrediction[],
    warnings: ExpertWarning[],
    suggestions: string[]
  ): void {
    // Check for rapid sequential actions (race condition risk)
    const clickCount = analysis.proposedActions.filter(a => a.type === 'click').length;
    const waitCount = analysis.proposedActions.filter(a => a.type === 'wait').length;
    
    if (clickCount > 3 && waitCount === 0) {
      warnings.push({
        id: `warn_${Date.now()}_race`,
        severity: 'warning',
        category: 'race_condition',
        message: 'Multiple clicks without wait steps may cause timing issues',
        recommendation: 'Consider adding short waits between actions for page updates',
      });
      predictions.push({
        id: `pred_${Date.now()}_race`,
        type: 'timing_issue',
        probability: 0.4,
        description: 'Rapid actions may execute before page fully updates',
        mitigation: 'Agent will verify page state between actions',
      });
    }

    // Check for navigation without state preservation
    if (analysis.pageUrl.includes('checkout') || analysis.pageUrl.includes('payment')) {
      warnings.push({
        id: `warn_${Date.now()}_payment`,
        severity: 'error',
        category: 'data_loss_risk',
        message: 'Operating on a payment/checkout page',
        recommendation: 'Extra caution required - verify all actions before execution',
      });
    }

    // Suggest improvements
    if (analysis.proposedActions.length > 5) {
      suggestions.push('Consider breaking this into smaller, verifiable steps');
    }

    if (!analysis.proposedActions.some(a => a.type === 'wait')) {
      suggestions.push('Adding wait steps can improve reliability on dynamic pages');
    }
  }

  private calculateOverallRisk(
    predictions: FailurePrediction[],
    warnings: ExpertWarning[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    const errorWarnings = warnings.filter(w => w.severity === 'error').length;
    const warningWarnings = warnings.filter(w => w.severity === 'warning').length;
    const highProbPredictions = predictions.filter(p => p.probability > 0.5).length;

    if (errorWarnings >= 2 || highProbPredictions >= 3) return 'critical';
    if (errorWarnings >= 1 || highProbPredictions >= 2 || warningWarnings >= 3) return 'high';
    if (warningWarnings >= 1 || highProbPredictions >= 1) return 'medium';
    return 'low';
  }

  // Challenge unsafe workflows - the agent pushes back
  challengeWorkflow(analysis: WorkflowAnalysis): ChallengeResult | null {
    const challenges: string[] = [];

    // Challenge vague tasks
    if (analysis.task.split(' ').length < 3) {
      challenges.push('This task description is very brief. Can you provide more specific instructions?');
    }

    // Challenge potentially harmful patterns
    if (analysis.task.toLowerCase().includes('all') && analysis.task.toLowerCase().includes('delete')) {
      challenges.push('Deleting "all" items is a high-risk operation. Are you sure you want to proceed with bulk deletion?');
    }

    // Challenge automation on sensitive pages
    const sensitivePatterns = ['bank', 'payment', 'password', 'admin', 'settings'];
    if (sensitivePatterns.some(p => analysis.pageUrl.toLowerCase().includes(p))) {
      challenges.push('This page appears to contain sensitive functionality. Would you like me to proceed with extra caution and approval for each step?');
    }

    // Challenge repeated failures
    const failedActions = analysis.previousActions.filter(a => (a as any).failed);
    if (failedActions.length >= 2) {
      challenges.push('I\'ve encountered multiple failures. Should we try a different approach or would you like to guide me?');
    }

    if (challenges.length === 0) return null;

    return {
      shouldPause: true,
      challenges,
      suggestedMode: challenges.length >= 2 ? 'cautious' : 'balanced',
    };
  }
}

export interface ChallengeResult {
  shouldPause: boolean;
  challenges: string[];
  suggestedMode: 'cautious' | 'balanced' | 'autonomous';
}

// Singleton
export const expertReview = new ExpertReviewEngine();
