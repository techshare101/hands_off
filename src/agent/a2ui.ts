// ═══════════════════════════════════════════════════════════════════════════
// A2UI Engine — Agent-to-User Interface for HandOff
// Declarative JSON → Native UI Widgets rendered in the sidepanel.
// Security-first: only pre-approved components from the catalog can render.
// ═══════════════════════════════════════════════════════════════════════════

// ── Component Types (the trusted catalog) ─────────────────────────────────

export type A2UIComponentType =
  | 'text'
  | 'heading'
  | 'button'
  | 'text_input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio_group'
  | 'date_picker'
  | 'time_picker'
  | 'number_input'
  | 'slider'
  | 'toggle'
  | 'image'
  | 'link'
  | 'divider'
  | 'card'
  | 'table'
  | 'progress'
  | 'badge'
  | 'alert'
  | 'form'
  | 'list'
  | 'tabs'
  | 'accordion'
  | 'stepper'
  | 'chip_group';

// ── Base Component Schema ─────────────────────────────────────────────────

export interface A2UIBaseComponent {
  id: string;
  type: A2UIComponentType;
  label?: string;
  description?: string;
  visible?: boolean;
  disabled?: boolean;
  className?: string;
  children?: A2UIComponent[];
}

// ── Specific Component Schemas ────────────────────────────────────────────

export interface A2UIText extends A2UIBaseComponent {
  type: 'text';
  content: string;
  variant?: 'body' | 'caption' | 'muted';
}

export interface A2UIHeading extends A2UIBaseComponent {
  type: 'heading';
  content: string;
  level?: 1 | 2 | 3 | 4;
}

export interface A2UIButton extends A2UIBaseComponent {
  type: 'button';
  text: string;
  action: string; // action ID sent back to agent
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: string;
  loading?: boolean;
}

export interface A2UITextInput extends A2UIBaseComponent {
  type: 'text_input';
  placeholder?: string;
  value?: string;
  required?: boolean;
  pattern?: string;
  maxLength?: number;
}

export interface A2UITextarea extends A2UIBaseComponent {
  type: 'textarea';
  placeholder?: string;
  value?: string;
  rows?: number;
  maxLength?: number;
}

export interface A2UISelect extends A2UIBaseComponent {
  type: 'select';
  options: { value: string; label: string; disabled?: boolean }[];
  value?: string;
  placeholder?: string;
  required?: boolean;
}

export interface A2UICheckbox extends A2UIBaseComponent {
  type: 'checkbox';
  checked?: boolean;
  required?: boolean;
}

export interface A2UIRadioGroup extends A2UIBaseComponent {
  type: 'radio_group';
  options: { value: string; label: string; description?: string }[];
  value?: string;
  required?: boolean;
}

export interface A2UIDatePicker extends A2UIBaseComponent {
  type: 'date_picker';
  value?: string; // ISO date
  min?: string;
  max?: string;
  required?: boolean;
}

export interface A2UITimePicker extends A2UIBaseComponent {
  type: 'time_picker';
  value?: string; // HH:mm
  min?: string;
  max?: string;
  step?: number; // minutes
  required?: boolean;
}

export interface A2UINumberInput extends A2UIBaseComponent {
  type: 'number_input';
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

export interface A2UISlider extends A2UIBaseComponent {
  type: 'slider';
  value?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface A2UIToggle extends A2UIBaseComponent {
  type: 'toggle';
  checked?: boolean;
}

export interface A2UIImage extends A2UIBaseComponent {
  type: 'image';
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface A2UILink extends A2UIBaseComponent {
  type: 'link';
  text: string;
  href: string;
  external?: boolean;
}

export interface A2UIDivider extends A2UIBaseComponent {
  type: 'divider';
}

export interface A2UICard extends A2UIBaseComponent {
  type: 'card';
  title?: string;
  subtitle?: string;
  // children rendered inside
}

export interface A2UITable extends A2UIBaseComponent {
  type: 'table';
  headers: string[];
  rows: string[][];
  selectable?: boolean;
}

export interface A2UIProgress extends A2UIBaseComponent {
  type: 'progress';
  value: number; // 0-100
  variant?: 'default' | 'success' | 'warning' | 'error';
}

export interface A2UIBadge extends A2UIBaseComponent {
  type: 'badge';
  text: string;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

export interface A2UIAlert extends A2UIBaseComponent {
  type: 'alert';
  title?: string;
  message: string;
  variant?: 'info' | 'success' | 'warning' | 'error';
}

export interface A2UIForm extends A2UIBaseComponent {
  type: 'form';
  submitAction: string;  // action ID when form is submitted
  submitLabel?: string;
  // children are the form fields
}

export interface A2UIList extends A2UIBaseComponent {
  type: 'list';
  items: { id: string; primary: string; secondary?: string; icon?: string }[];
  selectable?: boolean;
  selectedId?: string;
}

export interface A2UITabs extends A2UIBaseComponent {
  type: 'tabs';
  tabs: { id: string; label: string; children: A2UIComponent[] }[];
  activeTab?: string;
}

export interface A2UIAccordion extends A2UIBaseComponent {
  type: 'accordion';
  sections: { id: string; title: string; children: A2UIComponent[] }[];
  openSections?: string[];
}

export interface A2UIStepper extends A2UIBaseComponent {
  type: 'stepper';
  steps: { id: string; label: string; description?: string; status: 'pending' | 'active' | 'completed' | 'error' }[];
  activeStep?: string;
}

export interface A2UIChipGroup extends A2UIBaseComponent {
  type: 'chip_group';
  chips: { value: string; label: string; selected?: boolean }[];
  multiSelect?: boolean;
}

// ── Union Type ────────────────────────────────────────────────────────────

export type A2UIComponent =
  | A2UIText
  | A2UIHeading
  | A2UIButton
  | A2UITextInput
  | A2UITextarea
  | A2UISelect
  | A2UICheckbox
  | A2UIRadioGroup
  | A2UIDatePicker
  | A2UITimePicker
  | A2UINumberInput
  | A2UISlider
  | A2UIToggle
  | A2UIImage
  | A2UILink
  | A2UIDivider
  | A2UICard
  | A2UITable
  | A2UIProgress
  | A2UIBadge
  | A2UIAlert
  | A2UIForm
  | A2UIList
  | A2UITabs
  | A2UIAccordion
  | A2UIStepper
  | A2UIChipGroup;

// ── Widget Payload (what the agent outputs) ───────────────────────────────

export interface A2UIWidgetPayload {
  widgetId: string;
  title?: string;
  description?: string;
  components: A2UIComponent[];
  // Metadata for the agent loop
  intent?: string;          // "book_restaurant", "select_flight", etc.
  contextData?: Record<string, unknown>; // data the agent passes through
  expiresAt?: number;       // auto-dismiss timestamp
}

// ── User Action (sent back to the agent) ──────────────────────────────────

export interface A2UIUserAction {
  widgetId: string;
  actionId: string;         // which button/form was triggered
  componentId: string;      // which component
  values: Record<string, unknown>; // form data / selections
  timestamp: number;
}

// ── Trusted Catalog ───────────────────────────────────────────────────────
// Only these component types can be rendered. Anything else is rejected.

const TRUSTED_CATALOG: Set<A2UIComponentType> = new Set([
  'text', 'heading', 'button', 'text_input', 'textarea', 'select',
  'checkbox', 'radio_group', 'date_picker', 'time_picker', 'number_input',
  'slider', 'toggle', 'image', 'link', 'divider', 'card', 'table',
  'progress', 'badge', 'alert', 'form', 'list', 'tabs', 'accordion',
  'stepper', 'chip_group',
]);

// ── Validation Engine ─────────────────────────────────────────────────────

export interface A2UIValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedPayload?: A2UIWidgetPayload;
}

function validateComponent(component: A2UIComponent, path: string): string[] {
  const errors: string[] = [];

  if (!component.id) {
    errors.push(`${path}: missing 'id'`);
  }

  if (!component.type) {
    errors.push(`${path}: missing 'type'`);
  } else if (!TRUSTED_CATALOG.has(component.type)) {
    errors.push(`${path}: untrusted component type '${component.type}'`);
  }

  // Validate children recursively
  if (component.children) {
    component.children.forEach((child, i) => {
      errors.push(...validateComponent(child, `${path}.children[${i}]`));
    });
  }

  // Type-specific validation
  switch (component.type) {
    case 'form': {
      const form = component as A2UIForm;
      if (!form.submitAction) errors.push(`${path}: form missing 'submitAction'`);
      break;
    }
    case 'button': {
      const btn = component as A2UIButton;
      if (!btn.action) errors.push(`${path}: button missing 'action'`);
      if (!btn.text) errors.push(`${path}: button missing 'text'`);
      break;
    }
    case 'select': {
      const sel = component as A2UISelect;
      if (!sel.options?.length) errors.push(`${path}: select has no options`);
      break;
    }
    case 'table': {
      const tbl = component as A2UITable;
      if (!tbl.headers?.length) errors.push(`${path}: table has no headers`);
      break;
    }
    case 'image': {
      const img = component as A2UIImage;
      // Security: only allow https and data URLs
      if (img.src && !img.src.startsWith('https://') && !img.src.startsWith('data:')) {
        errors.push(`${path}: image src must be https or data URL`);
      }
      break;
    }
    case 'link': {
      const lnk = component as A2UILink;
      if (lnk.href && !lnk.href.startsWith('https://') && !lnk.href.startsWith('http://')) {
        errors.push(`${path}: link href must be http(s)`);
      }
      break;
    }
  }

  return errors;
}

export function validateWidgetPayload(payload: unknown): A2UIValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }

  const p = payload as A2UIWidgetPayload;

  if (!p.widgetId) errors.push("Missing 'widgetId'");
  if (!p.components?.length) errors.push("Missing or empty 'components'");

  // Validate each component
  if (p.components) {
    p.components.forEach((comp, i) => {
      errors.push(...validateComponent(comp, `components[${i}]`));
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], sanitizedPayload: p };
}

// ── A2UI Engine (manages active widgets) ──────────────────────────────────

class A2UIEngine {
  private activeWidgets: Map<string, A2UIWidgetPayload> = new Map();
  private actionHistory: A2UIUserAction[] = [];
  private listeners: Set<(event: A2UIEngineEvent) => void> = new Set();

  // Render a new widget from the agent
  renderWidget(payload: A2UIWidgetPayload): A2UIValidationResult {
    const validation = validateWidgetPayload(payload);
    if (!validation.valid) {
      console.error('[A2UI] Invalid widget payload:', validation.errors);
      return validation;
    }

    this.activeWidgets.set(payload.widgetId, payload);
    this.emit({ type: 'widget_rendered', widgetId: payload.widgetId, payload });
    console.log(`[A2UI] Widget rendered: ${payload.widgetId} (${payload.components.length} components)`);
    return validation;
  }

  // Handle user interaction with a widget
  handleUserAction(action: A2UIUserAction): void {
    this.actionHistory.push(action);
    this.emit({ type: 'user_action', widgetId: action.widgetId, action });
    console.log(`[A2UI] User action: ${action.actionId} on widget ${action.widgetId}`);
  }

  // Dismiss a widget
  dismissWidget(widgetId: string): void {
    this.activeWidgets.delete(widgetId);
    this.emit({ type: 'widget_dismissed', widgetId });
  }

  // Update an existing widget
  updateWidget(widgetId: string, updates: Partial<A2UIWidgetPayload>): void {
    const existing = this.activeWidgets.get(widgetId);
    if (!existing) return;

    const updated = { ...existing, ...updates, widgetId };
    this.activeWidgets.set(widgetId, updated);
    this.emit({ type: 'widget_updated', widgetId, payload: updated });
  }

  // Get active widgets
  getActiveWidgets(): A2UIWidgetPayload[] {
    return Array.from(this.activeWidgets.values());
  }

  getWidget(widgetId: string): A2UIWidgetPayload | undefined {
    return this.activeWidgets.get(widgetId);
  }

  // Get recent actions (for agent context)
  getRecentActions(limit = 10): A2UIUserAction[] {
    return this.actionHistory.slice(-limit);
  }

  // Clear all widgets
  clearAll(): void {
    this.activeWidgets.clear();
    this.emit({ type: 'all_cleared' });
  }

  // Event system
  on(listener: (event: A2UIEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: A2UIEngineEvent): void {
    this.listeners.forEach(fn => fn(event));
  }

  // Format for agent prompt context
  formatActiveWidgetsForPrompt(): string {
    const widgets = this.getActiveWidgets();
    if (widgets.length === 0) return '';

    return `\n[ACTIVE UI WIDGETS]: ${widgets.length} widget(s) currently shown to user.\n` +
      widgets.map(w => `  - Widget "${w.widgetId}": ${w.title || 'Untitled'} (${w.components.length} components)`).join('\n') +
      '\nUser may interact with these widgets. Wait for their response before proceeding.\n';
  }

  // Format user action for agent context
  formatActionForPrompt(action: A2UIUserAction): string {
    return `\n[USER WIDGET ACTION]: User interacted with widget "${action.widgetId}".\n` +
      `  Action: ${action.actionId}\n` +
      `  Values: ${JSON.stringify(action.values)}\n` +
      `Process this user input and continue the task.\n`;
  }
}

// ── Engine Events ─────────────────────────────────────────────────────────

export type A2UIEngineEvent =
  | { type: 'widget_rendered'; widgetId: string; payload: A2UIWidgetPayload }
  | { type: 'widget_updated'; widgetId: string; payload: A2UIWidgetPayload }
  | { type: 'widget_dismissed'; widgetId: string }
  | { type: 'user_action'; widgetId: string; action: A2UIUserAction }
  | { type: 'all_cleared' };

// ── Pre-built Widget Templates ────────────────────────────────────────────

export const A2UI_TEMPLATES = {
  // Restaurant booking widget
  restaurantBooking: (restaurantName: string): A2UIWidgetPayload => ({
    widgetId: `booking_${Date.now()}`,
    title: `Book a table at ${restaurantName}`,
    intent: 'book_restaurant',
    contextData: { restaurantName },
    components: [
      { id: 'heading', type: 'heading', content: `Reserve at ${restaurantName}`, level: 3 },
      { id: 'date', type: 'date_picker', label: 'Date', required: true, min: new Date().toISOString().split('T')[0] },
      { id: 'time', type: 'time_picker', label: 'Time', required: true, step: 30, min: '11:00', max: '22:00' },
      { id: 'guests', type: 'number_input', label: 'Number of guests', value: 2, min: 1, max: 20, required: true },
      { id: 'notes', type: 'textarea', label: 'Special requests', placeholder: 'Allergies, seating preference...', rows: 2 },
      { id: 'submit', type: 'button', text: 'Book Table', action: 'confirm_booking', variant: 'primary' },
    ] as A2UIComponent[],
  }),

  // Confirmation dialog
  confirmation: (title: string, message: string, confirmAction: string): A2UIWidgetPayload => ({
    widgetId: `confirm_${Date.now()}`,
    title,
    components: [
      { id: 'alert', type: 'alert', title, message, variant: 'info' },
      { id: 'confirm', type: 'button', text: 'Confirm', action: confirmAction, variant: 'primary' },
      { id: 'cancel', type: 'button', text: 'Cancel', action: 'cancel', variant: 'ghost' },
    ] as A2UIComponent[],
  }),

  // Search/filter widget
  searchFilter: (title: string, options: { value: string; label: string }[]): A2UIWidgetPayload => ({
    widgetId: `filter_${Date.now()}`,
    title,
    components: [
      { id: 'heading', type: 'heading', content: title, level: 3 },
      { id: 'search', type: 'text_input', label: 'Search', placeholder: 'Type to filter...' },
      { id: 'category', type: 'select', label: 'Category', options, placeholder: 'Select a category' },
      { id: 'apply', type: 'button', text: 'Apply Filters', action: 'apply_filters', variant: 'primary' },
    ] as A2UIComponent[],
  }),

  // Data results table
  dataResults: (title: string, headers: string[], rows: string[][]): A2UIWidgetPayload => ({
    widgetId: `results_${Date.now()}`,
    title,
    components: [
      { id: 'heading', type: 'heading', content: title, level: 3 },
      { id: 'count', type: 'badge', text: `${rows.length} results`, variant: 'info' },
      { id: 'table', type: 'table', headers, rows, selectable: true },
      { id: 'export', type: 'button', text: 'Export Results', action: 'export_results', variant: 'secondary' },
    ] as A2UIComponent[],
  }),

  // Multi-step wizard
  stepWizard: (title: string, steps: { id: string; label: string }[]): A2UIWidgetPayload => ({
    widgetId: `wizard_${Date.now()}`,
    title,
    components: [
      { id: 'heading', type: 'heading', content: title, level: 3 },
      { id: 'stepper', type: 'stepper', steps: steps.map((s, i) => ({ ...s, description: '', status: i === 0 ? 'active' as const : 'pending' as const })) },
    ] as A2UIComponent[],
  }),

  // Selection picker (e.g., choosing a flight, hotel, etc.)
  selectionPicker: (title: string, items: { id: string; primary: string; secondary?: string }[]): A2UIWidgetPayload => ({
    widgetId: `picker_${Date.now()}`,
    title,
    components: [
      { id: 'heading', type: 'heading', content: title, level: 3 },
      { id: 'list', type: 'list', items, selectable: true },
      { id: 'select', type: 'button', text: 'Select', action: 'item_selected', variant: 'primary' },
    ] as A2UIComponent[],
  }),

  // Progress tracker (for long-running tasks)
  taskProgress: (title: string, percent: number, status: string): A2UIWidgetPayload => ({
    widgetId: `progress_${Date.now()}`,
    title,
    components: [
      { id: 'heading', type: 'heading', content: title, level: 3 },
      { id: 'progress', type: 'progress', value: percent, variant: percent === 100 ? 'success' : 'default' },
      { id: 'status', type: 'text', content: status, variant: 'muted' },
    ] as A2UIComponent[],
  }),
};

// Singleton
export const a2ui = new A2UIEngine();
