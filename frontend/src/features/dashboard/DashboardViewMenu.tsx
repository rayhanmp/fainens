import { useEffect, useRef } from 'react';
import { Activity, BarChart3, CalendarClock, Check, ChevronDown, List, PencilLine, PieChart, Plus, RotateCcw, SlidersHorizontal, TrendingUp, X } from 'lucide-react';
import { dashboardPreset, dashboardSectionLabels, selectedDashboardPreset, type DashboardMetric, type DashboardPreset, type DashboardViewPreferences } from './view-preferences';

const panelIcons = { budget: PieChart, payments: CalendarClock, activity: List, netWorth: TrendingUp, spending: BarChart3, pulse: Activity };

export function DashboardViewMenu({ preferences, onChange, preset, onEditLayout }: { preferences: DashboardViewPreferences; onChange: (next: DashboardViewPreferences) => void; preset?: DashboardPreset; onEditLayout: () => void }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = menuRef.current;
      if (event.key === 'Escape' && menu?.open) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  const visibleCount = preferences.sectionOrder.length - preferences.hiddenSections.length;
  const close = () => { if (menuRef.current) menuRef.current.open = false; };
  return <details ref={menuRef} className="dashboard-view-menu">
    <summary className="dashboard-view-trigger"><SlidersHorizontal size={15} aria-hidden />View<ChevronDown size={12} aria-hidden /></summary>
    <div className="dashboard-view-popover" role="region" aria-label="Customize dashboard">
      <header><h2>Customize dashboard</h2><button type="button" onClick={close} aria-label="Close dashboard view options"><X size={16} aria-hidden /></button></header>
      <div className="dashboard-view-fields">
      <label className="dashboard-view-field">Preset
        <select value={preset ?? selectedDashboardPreset(preferences)} onChange={event => onChange(dashboardPreset(event.target.value as DashboardPreset))}>
          <option value="original">Original dashboard</option><option value="everyday">Everyday</option><option value="overview">Money overview</option><option value="minimal">Minimal</option><option value="custom" disabled>Custom</option>
        </select>
      </label>
      <label className="dashboard-view-field">Main balance
        <select value={preferences.mainMetric} onChange={event => onChange({ ...preferences, mainMetric: event.target.value as DashboardMetric })}>
          <option value="cash">Available cash</option><option value="budget">Budget left</option><option value="netWorth">Net worth</option>
        </select>
      </label>
      </div>
      <p className="dashboard-view-caption">Panels <span>{visibleCount} of {preferences.sectionOrder.length} shown</span></p>
      <div className="dashboard-panel-options">{preferences.sectionOrder.map(id => {
        const visible = !preferences.hiddenSections.includes(id);
        const Icon = panelIcons[id];
        const Status = visible ? Check : Plus;
        return <button type="button" className="dashboard-panel-option" key={id} aria-pressed={visible} disabled={visible && visibleCount === 1} onClick={() => onChange({ ...preferences, hiddenSections: visible ? [...preferences.hiddenSections, id] : preferences.hiddenSections.filter(section => section !== id) })}>
          <Icon size={16} aria-hidden /><span>{dashboardSectionLabels[id]}</span><Status size={13} className="dashboard-panel-option-status" aria-hidden />
        </button>;
      })}</div>
      <footer><button type="button" className="dashboard-edit-action" onClick={() => { close(); onEditLayout(); }}><PencilLine size={14} aria-hidden />Edit layout</button><button type="button" className="dashboard-reset-action" title="Restore the original dashboard" onClick={() => onChange(dashboardPreset('original'))}><RotateCcw size={14} aria-hidden />Reset view</button><button type="button" className="dashboard-view-done" onClick={close}>Done</button></footer>
    </div>
  </details>;
}
