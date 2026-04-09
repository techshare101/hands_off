"use client";
import React, { useState, useCallback } from 'react';
import {
  Calendar, Clock, ChevronDown, ChevronUp, ExternalLink,
  Check, X, AlertCircle, Info, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import type {
  A2UIComponent, A2UIWidgetPayload, A2UIUserAction,
  A2UIText, A2UIHeading, A2UIButton, A2UITextInput, A2UITextarea,
  A2UISelect, A2UICheckbox, A2UIRadioGroup, A2UIDatePicker,
  A2UITimePicker, A2UINumberInput, A2UISlider, A2UIToggle,
  A2UIImage, A2UILink, A2UICard, A2UITable,
  A2UIProgress, A2UIBadge, A2UIAlert, A2UIForm, A2UIList,
  A2UITabs, A2UIAccordion, A2UIStepper, A2UIChipGroup,
} from '../../agent/a2ui';

// ── Props ─────────────────────────────────────────────────────────────────

interface WidgetRendererProps {
  payload: A2UIWidgetPayload;
  onAction: (action: A2UIUserAction) => void;
  onDismiss?: () => void;
}

// ── Main Renderer ─────────────────────────────────────────────────────────

export default function WidgetRenderer({ payload, onAction, onDismiss }: WidgetRendererProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});

  const updateValue = useCallback((id: string, value: unknown) => {
    setFormValues(prev => ({ ...prev, [id]: value }));
  }, []);

  const emitAction = useCallback((actionId: string, componentId: string, extraValues?: Record<string, unknown>) => {
    onAction({
      widgetId: payload.widgetId,
      actionId,
      componentId,
      values: { ...formValues, ...extraValues },
      timestamp: Date.now(),
    });
  }, [payload.widgetId, formValues, onAction]);

  return (
    <div className="bg-handoff-surface/80 border border-handoff-dark rounded-xl overflow-hidden my-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header */}
      {(payload.title || onDismiss) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-handoff-dark/50 bg-handoff-dark/30">
          {payload.title && (
            <span className="text-sm font-medium text-white">{payload.title}</span>
          )}
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 hover:bg-handoff-dark rounded-md transition-colors">
              <X className="w-3.5 h-3.5 text-handoff-muted" />
            </button>
          )}
        </div>
      )}

      {/* Body */}
      <div className="p-4 space-y-3">
        {payload.components.map(comp => (
          <ComponentRenderer
            key={comp.id}
            component={comp}
            formValues={formValues}
            updateValue={updateValue}
            emitAction={emitAction}
          />
        ))}
      </div>
    </div>
  );
}

// ── Component Renderer (recursive) ────────────────────────────────────────

interface ComponentRendererProps {
  component: A2UIComponent;
  formValues: Record<string, unknown>;
  updateValue: (id: string, value: unknown) => void;
  emitAction: (actionId: string, componentId: string, extra?: Record<string, unknown>) => void;
}

function ComponentRenderer({ component: comp, formValues, updateValue, emitAction }: ComponentRendererProps) {
  if (comp.visible === false) return null;

  switch (comp.type) {
    case 'text':
      return <TextComp c={comp as A2UIText} />;
    case 'heading':
      return <HeadingComp c={comp as A2UIHeading} />;
    case 'button':
      return <ButtonComp c={comp as A2UIButton} emitAction={emitAction} />;
    case 'text_input':
      return <TextInputComp c={comp as A2UITextInput} value={formValues[comp.id] as string} onChange={v => updateValue(comp.id, v)} />;
    case 'textarea':
      return <TextareaComp c={comp as A2UITextarea} value={formValues[comp.id] as string} onChange={v => updateValue(comp.id, v)} />;
    case 'select':
      return <SelectComp c={comp as A2UISelect} value={formValues[comp.id] as string} onChange={v => updateValue(comp.id, v)} />;
    case 'checkbox':
      return <CheckboxComp c={comp as A2UICheckbox} checked={formValues[comp.id] as boolean} onChange={v => updateValue(comp.id, v)} />;
    case 'radio_group':
      return <RadioGroupComp c={comp as A2UIRadioGroup} value={formValues[comp.id] as string} onChange={v => updateValue(comp.id, v)} />;
    case 'date_picker':
      return <DatePickerComp c={comp as A2UIDatePicker} value={formValues[comp.id] as string} onChange={v => updateValue(comp.id, v)} />;
    case 'time_picker':
      return <TimePickerComp c={comp as A2UITimePicker} value={formValues[comp.id] as string} onChange={v => updateValue(comp.id, v)} />;
    case 'number_input':
      return <NumberInputComp c={comp as A2UINumberInput} value={formValues[comp.id] as number} onChange={v => updateValue(comp.id, v)} />;
    case 'slider':
      return <SliderComp c={comp as A2UISlider} value={formValues[comp.id] as number} onChange={v => updateValue(comp.id, v)} />;
    case 'toggle':
      return <ToggleComp c={comp as A2UIToggle} checked={formValues[comp.id] as boolean} onChange={v => updateValue(comp.id, v)} />;
    case 'image':
      return <ImageComp c={comp as A2UIImage} />;
    case 'link':
      return <LinkComp c={comp as A2UILink} />;
    case 'divider':
      return <div className="border-t border-handoff-dark/50 my-2" />;
    case 'card':
      return <CardComp c={comp as A2UICard} formValues={formValues} updateValue={updateValue} emitAction={emitAction} />;
    case 'table':
      return <TableComp c={comp as A2UITable} />;
    case 'progress':
      return <ProgressComp c={comp as A2UIProgress} />;
    case 'badge':
      return <BadgeComp c={comp as A2UIBadge} />;
    case 'alert':
      return <AlertComp c={comp as A2UIAlert} />;
    case 'form':
      return <FormComp c={comp as A2UIForm} formValues={formValues} updateValue={updateValue} emitAction={emitAction} />;
    case 'list':
      return <ListComp c={comp as A2UIList} value={formValues[comp.id] as string} onChange={v => updateValue(comp.id, v)} />;
    case 'tabs':
      return <TabsComp c={comp as A2UITabs} formValues={formValues} updateValue={updateValue} emitAction={emitAction} />;
    case 'accordion':
      return <AccordionComp c={comp as A2UIAccordion} formValues={formValues} updateValue={updateValue} emitAction={emitAction} />;
    case 'stepper':
      return <StepperComp c={comp as A2UIStepper} />;
    case 'chip_group':
      return <ChipGroupComp c={comp as A2UIChipGroup} formValues={formValues} updateValue={updateValue} />;
    default:
      return <div className="text-xs text-red-400">Unknown component: {(comp as any).type}</div>;
  }
}

// ── Individual Component Implementations ──────────────────────────────────

const fieldLabel = (label?: string, required?: boolean) =>
  label ? <label className="block text-xs font-medium text-handoff-muted mb-1">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label> : null;

function TextComp({ c }: { c: A2UIText }) {
  const cls = c.variant === 'caption' ? 'text-[11px] text-handoff-muted' :
    c.variant === 'muted' ? 'text-xs text-handoff-muted' :
    'text-sm text-white/90';
  return <p className={cls}>{c.content}</p>;
}

function HeadingComp({ c }: { c: A2UIHeading }) {
  const cls = c.level === 1 ? 'text-lg font-bold' :
    c.level === 2 ? 'text-base font-semibold' :
    c.level === 4 ? 'text-xs font-semibold' :
    'text-sm font-semibold';
  return <div className={`${cls} text-white`}>{c.content}</div>;
}

function ButtonComp({ c, emitAction }: { c: A2UIButton; emitAction: ComponentRendererProps['emitAction'] }) {
  const variants: Record<string, string> = {
    primary: 'bg-handoff-primary hover:bg-handoff-primary/80 text-white',
    secondary: 'bg-handoff-dark hover:bg-handoff-dark/80 text-white',
    danger: 'bg-red-500/20 hover:bg-red-500/30 text-red-400',
    ghost: 'bg-transparent hover:bg-handoff-dark/50 text-handoff-muted',
  };
  return (
    <button
      onClick={() => emitAction(c.action, c.id)}
      disabled={c.disabled || c.loading}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${variants[c.variant || 'primary']}`}
    >
      {c.loading ? 'Loading...' : c.text}
    </button>
  );
}

function TextInputComp({ c, value, onChange }: { c: A2UITextInput; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      {fieldLabel(c.label, c.required)}
      <input
        type="text"
        value={value ?? c.value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={c.placeholder}
        disabled={c.disabled}
        maxLength={c.maxLength}
        className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
      />
    </div>
  );
}

function TextareaComp({ c, value, onChange }: { c: A2UITextarea; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      {fieldLabel(c.label)}
      <textarea
        value={value ?? c.value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={c.placeholder}
        disabled={c.disabled}
        rows={c.rows || 3}
        maxLength={c.maxLength}
        className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
      />
    </div>
  );
}

function SelectComp({ c, value, onChange }: { c: A2UISelect; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      {fieldLabel(c.label, c.required)}
      <select
        value={value ?? c.value ?? ''}
        onChange={e => onChange(e.target.value)}
        disabled={c.disabled}
        className="w-full bg-handoff-dark text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
      >
        {c.placeholder && <option value="">{c.placeholder}</option>}
        {c.options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function CheckboxComp({ c, checked, onChange }: { c: A2UICheckbox; checked?: boolean; onChange: (v: boolean) => void }) {
  const val = checked ?? c.checked ?? false;
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        onClick={() => !c.disabled && onChange(!val)}
        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${val ? 'bg-handoff-primary border-handoff-primary' : 'border-handoff-muted bg-handoff-dark'}`}
      >
        {val && <Check className="w-3 h-3 text-white" />}
      </div>
      {c.label && <span className="text-sm text-white">{c.label}</span>}
    </label>
  );
}

function RadioGroupComp({ c, value, onChange }: { c: A2UIRadioGroup; value?: string; onChange: (v: string) => void }) {
  const selected = value ?? c.value ?? '';
  return (
    <div>
      {fieldLabel(c.label, c.required)}
      <div className="space-y-1.5">
        {c.options.map(opt => (
          <label key={opt.value} className="flex items-start gap-2 cursor-pointer" onClick={() => !c.disabled && onChange(opt.value)}>
            <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${selected === opt.value ? 'border-handoff-primary' : 'border-handoff-muted'}`}>
              {selected === opt.value && <div className="w-2 h-2 rounded-full bg-handoff-primary" />}
            </div>
            <div>
              <span className="text-sm text-white">{opt.label}</span>
              {opt.description && <p className="text-[11px] text-handoff-muted">{opt.description}</p>}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function DatePickerComp({ c, value, onChange }: { c: A2UIDatePicker; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      {fieldLabel(c.label, c.required)}
      <div className="relative">
        <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-handoff-muted pointer-events-none" />
        <input
          type="date"
          value={value ?? c.value ?? ''}
          onChange={e => onChange(e.target.value)}
          min={c.min}
          max={c.max}
          disabled={c.disabled}
          className="w-full bg-handoff-dark text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-handoff-primary/50 [color-scheme:dark]"
        />
      </div>
    </div>
  );
}

function TimePickerComp({ c, value, onChange }: { c: A2UITimePicker; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      {fieldLabel(c.label, c.required)}
      <div className="relative">
        <Clock className="absolute left-3 top-2.5 w-4 h-4 text-handoff-muted pointer-events-none" />
        <input
          type="time"
          value={value ?? c.value ?? ''}
          onChange={e => onChange(e.target.value)}
          min={c.min}
          max={c.max}
          step={c.step ? c.step * 60 : undefined}
          disabled={c.disabled}
          className="w-full bg-handoff-dark text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-handoff-primary/50 [color-scheme:dark]"
        />
      </div>
    </div>
  );
}

function NumberInputComp({ c, value, onChange }: { c: A2UINumberInput; value?: number; onChange: (v: number) => void }) {
  return (
    <div>
      {fieldLabel(c.label, c.required)}
      <input
        type="number"
        value={value ?? c.value ?? ''}
        onChange={e => onChange(Number(e.target.value))}
        min={c.min}
        max={c.max}
        step={c.step}
        disabled={c.disabled}
        className="w-full bg-handoff-dark text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
      />
    </div>
  );
}

function SliderComp({ c, value, onChange }: { c: A2UISlider; value?: number; onChange: (v: number) => void }) {
  const val = value ?? c.value ?? c.min ?? 0;
  return (
    <div>
      {c.label && <div className="flex justify-between mb-1"><span className="text-xs text-handoff-muted">{c.label}</span><span className="text-xs text-white">{val}</span></div>}
      <input
        type="range"
        value={val}
        onChange={e => onChange(Number(e.target.value))}
        min={c.min ?? 0}
        max={c.max ?? 100}
        step={c.step ?? 1}
        className="w-full accent-handoff-primary"
      />
    </div>
  );
}

function ToggleComp({ c, checked, onChange }: { c: A2UIToggle; checked?: boolean; onChange: (v: boolean) => void }) {
  const val = checked ?? c.checked ?? false;
  return (
    <label className="flex items-center justify-between cursor-pointer">
      {c.label && <span className="text-sm text-white">{c.label}</span>}
      <button
        type="button"
        onClick={() => !c.disabled && onChange(!val)}
        className={`relative w-9 h-5 rounded-full transition-colors ${val ? 'bg-emerald-500' : 'bg-handoff-dark'}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${val ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

function ImageComp({ c }: { c: A2UIImage }) {
  return <img src={c.src} alt={c.alt || ''} width={c.width} height={c.height} className="rounded-lg max-w-full" />;
}

function LinkComp({ c }: { c: A2UILink }) {
  return (
    <a href={c.href} target={c.external ? '_blank' : undefined} rel="noopener noreferrer" className="text-sm text-handoff-primary hover:underline inline-flex items-center gap-1">
      {c.text}
      {c.external && <ExternalLink className="w-3 h-3" />}
    </a>
  );
}

function CardComp({ c, formValues, updateValue, emitAction }: { c: A2UICard } & Omit<ComponentRendererProps, 'component'>) {
  return (
    <div className="bg-handoff-dark/50 rounded-lg p-3 border border-handoff-dark/50">
      {c.title && <div className="text-sm font-medium text-white mb-0.5">{c.title}</div>}
      {c.subtitle && <div className="text-xs text-handoff-muted mb-2">{c.subtitle}</div>}
      <div className="space-y-2">
        {c.children?.map(child => (
          <ComponentRenderer key={child.id} component={child} formValues={formValues} updateValue={updateValue} emitAction={emitAction} />
        ))}
      </div>
    </div>
  );
}

function TableComp({ c }: { c: A2UITable }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-handoff-dark/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-handoff-dark/50">
            {c.headers.map((h, i) => <th key={i} className="px-3 py-2 text-left text-xs font-medium text-handoff-muted">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {c.rows.map((row, ri) => (
            <tr key={ri} className="border-t border-handoff-dark/30 hover:bg-handoff-dark/20">
              {row.map((cell, ci) => <td key={ci} className="px-3 py-2 text-white/90">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressComp({ c }: { c: A2UIProgress }) {
  const colors = { default: 'bg-handoff-primary', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-red-500' };
  return (
    <div>
      {c.label && <div className="flex justify-between mb-1"><span className="text-xs text-handoff-muted">{c.label}</span><span className="text-xs text-white">{c.value}%</span></div>}
      <div className="w-full h-2 bg-handoff-dark rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${colors[c.variant || 'default']}`} style={{ width: `${Math.min(100, c.value)}%` }} />
      </div>
    </div>
  );
}

function BadgeComp({ c }: { c: A2UIBadge }) {
  const colors = {
    default: 'bg-handoff-dark text-white', success: 'bg-emerald-500/20 text-emerald-400',
    warning: 'bg-amber-500/20 text-amber-400', error: 'bg-red-500/20 text-red-400', info: 'bg-sky-500/20 text-sky-400',
  };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[c.variant || 'default']}`}>{c.text}</span>;
}

function AlertComp({ c }: { c: A2UIAlert }) {
  const config = {
    info: { icon: Info, bg: 'bg-sky-500/10 border-sky-500/30', text: 'text-sky-400' },
    success: { icon: CheckCircle2, bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-400' },
    warning: { icon: AlertTriangle, bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-400' },
    error: { icon: AlertCircle, bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-400' },
  };
  const s = config[c.variant || 'info'];
  const Icon = s.icon;
  return (
    <div className={`flex gap-2 p-3 rounded-lg border ${s.bg}`}>
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${s.text}`} />
      <div>
        {c.title && <div className={`text-sm font-medium ${s.text}`}>{c.title}</div>}
        <div className="text-xs text-white/80">{c.message}</div>
      </div>
    </div>
  );
}

function FormComp({ c, formValues, updateValue, emitAction }: { c: A2UIForm } & Omit<ComponentRendererProps, 'component'>) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); emitAction(c.submitAction, c.id); }}
      className="space-y-3"
    >
      {c.children?.map(child => (
        <ComponentRenderer key={child.id} component={child} formValues={formValues} updateValue={updateValue} emitAction={emitAction} />
      ))}
      <button type="submit" className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-handoff-primary hover:bg-handoff-primary/80 text-white transition-colors">
        {c.submitLabel || 'Submit'}
      </button>
    </form>
  );
}

function ListComp({ c, value, onChange }: { c: A2UIList; value?: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      {c.items.map(item => (
        <div
          key={item.id}
          onClick={() => c.selectable && onChange(item.id)}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            c.selectable ? 'cursor-pointer hover:bg-handoff-dark/50' : ''
          } ${value === item.id ? 'bg-handoff-primary/20 border border-handoff-primary/40' : 'bg-handoff-dark/30'}`}
        >
          {item.icon && <span className="text-lg">{item.icon}</span>}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white truncate">{item.primary}</div>
            {item.secondary && <div className="text-[11px] text-handoff-muted truncate">{item.secondary}</div>}
          </div>
          {c.selectable && value === item.id && <Check className="w-4 h-4 text-handoff-primary" />}
        </div>
      ))}
    </div>
  );
}

function TabsComp({ c, formValues, updateValue, emitAction }: { c: A2UITabs } & Omit<ComponentRendererProps, 'component'>) {
  const [active, setActive] = useState(c.activeTab || c.tabs[0]?.id);
  const activeTab = c.tabs.find(t => t.id === active);

  return (
    <div>
      <div className="flex gap-1 border-b border-handoff-dark/50 mb-3">
        {c.tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
              active === tab.id ? 'bg-handoff-dark text-white border-b-2 border-handoff-primary' : 'text-handoff-muted hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab && (
        <div className="space-y-2">
          {activeTab.children.map(child => (
            <ComponentRenderer key={child.id} component={child} formValues={formValues} updateValue={updateValue} emitAction={emitAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccordionComp({ c, formValues, updateValue, emitAction }: { c: A2UIAccordion } & Omit<ComponentRendererProps, 'component'>) {
  const [open, setOpen] = useState<Set<string>>(new Set(c.openSections || []));

  const toggle = (id: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {c.sections.map(sec => (
        <div key={sec.id} className="rounded-lg overflow-hidden border border-handoff-dark/50">
          <button onClick={() => toggle(sec.id)} className="w-full flex items-center justify-between px-3 py-2 bg-handoff-dark/30 hover:bg-handoff-dark/50 transition-colors">
            <span className="text-sm font-medium text-white">{sec.title}</span>
            {open.has(sec.id) ? <ChevronUp className="w-4 h-4 text-handoff-muted" /> : <ChevronDown className="w-4 h-4 text-handoff-muted" />}
          </button>
          {open.has(sec.id) && (
            <div className="p-3 space-y-2">
              {sec.children.map(child => (
                <ComponentRenderer key={child.id} component={child} formValues={formValues} updateValue={updateValue} emitAction={emitAction} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StepperComp({ c }: { c: A2UIStepper }) {
  return (
    <div className="flex items-center gap-2">
      {c.steps.map((step, i) => (
        <React.Fragment key={step.id}>
          <div className="flex items-center gap-1.5">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
              step.status === 'completed' ? 'bg-emerald-500 text-white' :
              step.status === 'active' ? 'bg-handoff-primary text-white' :
              step.status === 'error' ? 'bg-red-500 text-white' :
              'bg-handoff-dark text-handoff-muted'
            }`}>
              {step.status === 'completed' ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={`text-xs ${step.status === 'active' ? 'text-white font-medium' : 'text-handoff-muted'}`}>{step.label}</span>
          </div>
          {i < c.steps.length - 1 && <div className="flex-1 h-px bg-handoff-dark/50" />}
        </React.Fragment>
      ))}
    </div>
  );
}

function ChipGroupComp({ c, formValues, updateValue }: { c: A2UIChipGroup } & Pick<ComponentRendererProps, 'formValues' | 'updateValue'>) {
  const selected = (formValues[c.id] as string[] | undefined) ?? c.chips.filter(ch => ch.selected).map(ch => ch.value);

  const toggle = (val: string) => {
    if (c.multiSelect) {
      const next = selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val];
      updateValue(c.id, next);
    } else {
      updateValue(c.id, [val]);
    }
  };

  return (
    <div>
      {fieldLabel(c.label)}
      <div className="flex flex-wrap gap-1.5">
        {c.chips.map(chip => (
          <button
            key={chip.value}
            onClick={() => toggle(chip.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selected.includes(chip.value)
                ? 'bg-handoff-primary text-white'
                : 'bg-handoff-dark text-handoff-muted hover:text-white'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
