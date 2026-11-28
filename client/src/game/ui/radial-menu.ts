// Radial Menu UI - Right-click context menu with real SVG icons
// Compact, polished, works for both singleplayer and multiplayer
// Actions: Attack, Build (submenu), Ally, Trade, Transfer, Defend, Scout, Cancel

import type { BuildingType, RadialMenuAction } from '../../shared/protocol';

export interface RadialMenuContext {
  hexId: number;
  owner: string | null;
  isOwned: boolean;
  isFrontline: boolean;
  selectedHexIds: number[];
  biome: number;
  soldiers: number;
  hasBuilding: boolean;
  buildingType?: BuildingType;
  canBuild: boolean;
}

export interface RadialMenuActionResult {
  action: RadialMenuAction | string;
  hexId: number;
  params?: any;
}

export interface RadialMenuConfig {
  container: HTMLElement;
  onAction: (result: RadialMenuActionResult) => void;
}

// Inline SVG icons (no external dependencies needed)
const ICONS: Record<string, string> = {
  attack: `<svg viewBox="0 0 24 24" fill="none" stroke="#ff4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  build: `<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><line x1="12" y1="11" x2="12" y2="22"/><line x1="3" y1="15" x2="21" y2="15"/></svg>`,
  ally: `<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 21 9"/></svg>`,
  trade: `<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="16" x2="16" y2="16"/><line x1="12" y1="20" x2="12" y2="16"/><line x1="16" y1="8" x2="8" y2="8"/><line x1="12" y1="4" x2="12" y2="8"/></svg>`,
  transfer: `<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><line x1="10" y1="10" x2="14" y2="14"/></svg>`,
  defend: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M5 12h14"/></svg>`,
  scout: `<svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 7v5l2 2"/></svg>`,
  cancel: `<svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  city: `<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="11" rx="2"/><line x1="12" y1="11" x2="12" y2="22"/><line x1="4" y1="15" x2="20" y2="15"/></svg>`,
  factory: `<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><line x1="12" y1="11" x2="12" y2="22"/><line x1="3" y1="15" x2="21" y2="15"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/></svg>`,
  base: `<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 18 22 6 22"/><circle cx="12" cy="12" r="3"/></svg>`,
  capital: `<svg viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><line x1="12" y1="1" x2="12" y2="15"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  demolish: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  upgrade: `<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4v12m-4 0h8m-4 0 3-3m-3 3-3-3"/></svg>`,
};

const MENU_RADIUS = 95;
const ICON_RADIUS = 62;
const LABEL_RADIUS = 82;

const ACTIONS: Array<{ id: RadialMenuAction; label: string; iconKey: string }> = [
  { id: 'attack', label: 'Attack', iconKey: 'attack' },
  { id: 'build', label: 'Build', iconKey: 'build' },
  { id: 'ally', label: 'Ally', iconKey: 'ally' },
  { id: 'trade', label: 'Trade', iconKey: 'trade' },
  { id: 'transfer', label: 'Transfer', iconKey: 'transfer' },
  { id: 'defend', label: 'Defend', iconKey: 'defend' },
  { id: 'scout', label: 'Scout', iconKey: 'scout' },
  { id: 'cancel', label: 'Cancel', iconKey: 'cancel' },
];

const BUILD_ACTIONS: Array<{ id: string; label: string; iconKey: string; buildingType?: BuildingType }> = [
  { id: 'build_city', label: 'City', iconKey: 'city', buildingType: 'city' },
  { id: 'build_factory', label: 'Factory', iconKey: 'factory', buildingType: 'factory' },
  { id: 'build_base', label: 'Base', iconKey: 'base', buildingType: 'base' },
  { id: 'build_capital', label: 'Capital', iconKey: 'capital', buildingType: 'capital' },
  { id: 'upgrade', label: 'Upgrade', iconKey: 'upgrade' },
  { id: 'demolish', label: 'Demolish', iconKey: 'demolish' },
  { id: 'cancel', label: 'Back', iconKey: 'cancel' },
];

export class RadialMenu {
  private container: HTMLElement;
  private onAction: (result: RadialMenuActionResult) => void;

  private menuEl: HTMLElement | null = null;
  private submenuEl: HTMLElement | null = null;
  private isVisible: boolean = false;
  private currentContext: RadialMenuContext | null = null;

  constructor(config: RadialMenuConfig) {
    this.container = config.container;
    this.onAction = config.onAction;

    document.addEventListener('mousedown', (e) => {
      if (this.isVisible && this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.hide();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });
  }

  show(x: number, y: number, context: RadialMenuContext): void {
    this.currentContext = context;
    this.createMenu();
    this.positionMenu(x, y);
    this.menuEl!.style.display = 'block';
    // Force reflow then animate in
    void this.menuEl!.offsetHeight;
    this.menuEl!.style.opacity = '1';
    this.menuEl!.style.transform = 'translate(-50%, -50%) scale(1)';
    this.isVisible = true;
  }

  private showBuildSubmenu(): void {
    if (this.menuEl) this.menuEl.style.display = 'none';
    this.createSubmenu();

    const menuRect = this.menuEl?.getBoundingClientRect();
    if (menuRect) {
      this.positionSubmenu(menuRect.left + menuRect.width / 2, menuRect.top + menuRect.height / 2);
    }

    this.submenuEl!.style.display = 'block';
    void this.submenuEl!.offsetHeight;
    this.submenuEl!.style.opacity = '1';
    this.submenuEl!.style.transform = 'translate(-50%, -50%) scale(1)';
  }

  hide(): void {
    this.isVisible = false;
    if (this.menuEl) {
      this.menuEl.style.opacity = '0';
      this.menuEl.style.transform = 'translate(-50%, -50%) scale(0.85)';
      setTimeout(() => {
        if (this.menuEl && this.menuEl.parentNode) {
          this.menuEl.remove();
          this.menuEl = null;
        }
      }, 120);
    }
    if (this.submenuEl) {
      this.submenuEl.remove();
      this.submenuEl = null;
    }
    this.currentContext = null;
  }

  private createMenu(): void {
    if (this.menuEl) return;

    const menu = document.createElement('div');
    menu.className = 'radial-menu';
    menu.style.cssText = `
      position: fixed;
      z-index: 1000;
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.85);
      transition: opacity 0.12s ease, transform 0.12s ease;
      width: ${MENU_RADIUS * 2}px;
      height: ${MENU_RADIUS * 2}px;
      pointer-events: none;
    `;

    const ctx = this.currentContext!;
    const count = ACTIONS.length;
    const angleStep = (2 * Math.PI) / count;

    ACTIONS.forEach((action, i) => {
      const angle = i * angleStep - Math.PI / 2;
      if (!this.shouldShowAction(action.id, ctx)) return;

      const disabled = this.isActionDisabled(action.id, ctx);

      const wedge = document.createElement('div');
      wedge.style.cssText = `
        position: absolute;
        left: 50%; top: 50%;
        width: ${MENU_RADIUS * 2}px;
        height: ${MENU_RADIUS * 2}px;
        pointer-events: none;
      `;

      const iconContainer = document.createElement('div');
      const iconX = Math.cos(angle) * ICON_RADIUS + MENU_RADIUS;
      const iconY = Math.sin(angle) * ICON_RADIUS + MENU_RADIUS;
      iconContainer.style.cssText = `
        position: absolute;
        left: ${iconX - 16}px;
        top: ${iconY - 16}px;
        width: 32px;
        height: 32px;
        background: rgba(10, 14, 28, 0.92);
        border: 1.5px solid ${disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.35)'};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: ${disabled ? 'not-allowed' : 'pointer'};
        transition: all 0.1s ease;
        pointer-events: auto;
        opacity: ${disabled ? 0.45 : 1};
        filter: ${disabled ? 'grayscale(1)' : 'none'};
      `;
      iconContainer.innerHTML = ICONS[action.iconKey];

      const label = document.createElement('div');
      const labelX = Math.cos(angle) * LABEL_RADIUS + MENU_RADIUS - 28;
      const labelY = Math.sin(angle) * LABEL_RADIUS + MENU_RADIUS - 9;
      label.style.cssText = `
        position: absolute;
        left: ${labelX}px;
        top: ${labelY}px;
        width: 56px;
        height: 18px;
        font-size: 0.62rem;
        color: ${disabled ? 'rgba(220,245,255,0.35)' : 'rgba(220, 245, 255, 0.95)'};
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-weight: 700;
        text-align: center;
        pointer-events: none;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
        opacity: ${disabled ? 0.5 : 1};
      `;
      label.textContent = action.label;

      iconContainer.addEventListener('mouseenter', () => {
        if (disabled) return;
        iconContainer.style.background = 'rgba(20, 30, 50, 0.95)';
        iconContainer.style.borderColor = 'rgba(0, 255, 255, 0.7)';
        iconContainer.style.transform = 'scale(1.12)';
      });
      iconContainer.addEventListener('mouseleave', () => {
        if (disabled) return;
        iconContainer.style.background = 'rgba(10, 14, 28, 0.92)';
        iconContainer.style.borderColor = 'rgba(255,255,255,0.35)';
        iconContainer.style.transform = 'scale(1)';
      });

      iconContainer.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (disabled) return;
        this.handleActionClick(action.id);
      });

      wedge.appendChild(iconContainer);
      wedge.appendChild(label);
      menu.appendChild(wedge);
    });

    this.container.appendChild(menu);
    this.menuEl = menu;
  }

  private createSubmenu(): void {
    if (this.submenuEl) return;

    const sub = document.createElement('div');
    sub.className = 'radial-submenu';
    sub.style.cssText = `
      position: fixed;
      z-index: 1001;
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.85);
      transition: opacity 0.12s ease, transform 0.12s ease;
      width: ${MENU_RADIUS * 2}px;
      height: ${MENU_RADIUS * 2}px;
      pointer-events: none;
    `;

    const count = BUILD_ACTIONS.length;
    const angleStep = (2 * Math.PI) / count;
    const ctx = this.currentContext!;

    BUILD_ACTIONS.forEach((action, i) => {
      const angle = i * angleStep - Math.PI / 2;
      if (!this.shouldShowBuildAction(action.id)) return;

      const disabled = this.isBuildActionDisabled(action.id, ctx);

      const wedge = document.createElement('div');
      wedge.style.cssText = `
        position: absolute;
        left: 50%; top: 50%;
        width: ${MENU_RADIUS * 2}px;
        height: ${MENU_RADIUS * 2}px;
        pointer-events: none;
      `;

      const iconContainer = document.createElement('div');
      const iconX = Math.cos(angle) * ICON_RADIUS + MENU_RADIUS;
      const iconY = Math.sin(angle) * ICON_RADIUS + MENU_RADIUS;
      iconContainer.style.cssText = `
        position: absolute;
        left: ${iconX - 16}px;
        top: ${iconY - 16}px;
        width: 32px;
        height: 32px;
        background: rgba(10, 14, 28, 0.92);
        border: 1.5px solid ${disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.35)'};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: ${disabled ? 'not-allowed' : 'pointer'};
        transition: all 0.1s ease;
        pointer-events: auto;
        opacity: ${disabled ? 0.45 : 1};
        filter: ${disabled ? 'grayscale(1)' : 'none'};
      `;
      iconContainer.innerHTML = ICONS[action.iconKey];

      const label = document.createElement('div');
      const labelX = Math.cos(angle) * LABEL_RADIUS + MENU_RADIUS - 28;
      const labelY = Math.sin(angle) * LABEL_RADIUS + MENU_RADIUS - 9;
      label.style.cssText = `
        position: absolute;
        left: ${labelX}px;
        top: ${labelY}px;
        width: 56px;
        height: 18px;
        font-size: 0.62rem;
        color: ${disabled ? 'rgba(220,245,255,0.35)' : 'rgba(220, 245, 255, 0.95)'};
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-weight: 700;
        text-align: center;
        pointer-events: none;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
        opacity: ${disabled ? 0.5 : 1};
      `;
      label.textContent = action.label;

      iconContainer.addEventListener('mouseenter', () => {
        if (disabled) return;
        iconContainer.style.background = 'rgba(20, 30, 50, 0.95)';
        iconContainer.style.borderColor = 'rgba(0, 255, 255, 0.7)';
        iconContainer.style.transform = 'scale(1.12)';
      });
      iconContainer.addEventListener('mouseleave', () => {
        if (disabled) return;
        iconContainer.style.background = 'rgba(10, 14, 28, 0.92)';
        iconContainer.style.borderColor = 'rgba(255,255,255,0.35)';
        iconContainer.style.transform = 'scale(1)';
      });

      iconContainer.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (disabled) return;
        this.handleBuildActionClick(action.id);
      });

      wedge.appendChild(iconContainer);
      wedge.appendChild(label);
      sub.appendChild(wedge);
    });

    this.container.appendChild(sub);
    this.submenuEl = sub;
  }

  private positionMenu(x: number, y: number): void {
    if (!this.menuEl) return;
    const rect = this.menuEl.getBoundingClientRect();
    let px = x - rect.width / 2;
    let py = y - rect.height / 2;
    px = Math.max(8, Math.min(px, window.innerWidth - rect.width - 8));
    py = Math.max(8, Math.min(py, window.innerHeight - rect.height - 8));
    this.menuEl.style.left = `${px + rect.width / 2}px`;
    this.menuEl.style.top = `${py + rect.height / 2}px`;
  }

  private positionSubmenu(x: number, y: number): void {
    if (!this.submenuEl) return;
    const rect = this.submenuEl.getBoundingClientRect();
    let px = x - rect.width / 2;
    let py = y - rect.height / 2;
    px = Math.max(8, Math.min(px, window.innerWidth - rect.width - 8));
    py = Math.max(8, Math.min(py, window.innerHeight - rect.height - 8));
    this.submenuEl.style.left = `${px + rect.width / 2}px`;
    this.submenuEl.style.top = `${py + rect.height / 2}px`;
  }

  private shouldShowAction(action: RadialMenuAction, ctx: RadialMenuContext): boolean {
    if (action === 'cancel') return true;
    if (action === 'attack') return !ctx.isOwned; // Can attack any non-owned hex
    if (action === 'build') return ctx.isOwned && ctx.canBuild;
    if (action === 'ally') return !ctx.isOwned && !!ctx.owner; // Ally with enemy owner
    if (action === 'trade') return !!ctx.owner; // Trade with any owned hex
    if (action === 'transfer') return ctx.isOwned;
    if (action === 'defend') return ctx.isOwned;
    if (action === 'scout') return true;
    return false;
  }

  private isActionDisabled(action: RadialMenuAction, ctx: RadialMenuContext): boolean {
    if (action === 'attack') {
      // Need at least one owned adjacent hex or selected hexes
      if (ctx.selectedHexIds.length > 0) return false;
      if (ctx.isFrontline) return false; // Has adjacent owned hexes
      return true; // No adjacent owned hexes to attack from
    }
    if (action === 'build') return !ctx.isOwned || !ctx.canBuild;
    if (action === 'ally') return !ctx.owner; // Can't ally with unowned
    if (action === 'transfer') return ctx.selectedHexIds.length === 0;
    if (action === 'defend') return false;
    if (action === 'scout') return false;
    return false;
  }

  private shouldShowBuildAction(action: string): boolean {
    if (action === 'cancel') return true;
    const ctx = this.currentContext!;
    if (!ctx.isOwned) return false;

    if (action === 'build_city') return !ctx.hasBuilding;
    if (action === 'build_factory') return !ctx.hasBuilding;
    if (action === 'build_base') return !ctx.hasBuilding;
    if (action === 'build_capital') return !ctx.hasBuilding;
    if (action === 'upgrade') return ctx.hasBuilding && ctx.buildingType === 'city';
    if (action === 'demolish') return ctx.hasBuilding;

    return false;
  }

  private isBuildActionDisabled(action: string, _ctx: RadialMenuContext): boolean {
    // Let server validate costs - client just checks basics
    if (action === 'build_capital') {
      // Can't check if player has capital client-side reliably, server validates
      return false;
    }
    return false;
  }

  private handleActionClick(action: RadialMenuAction): void {
    if (!this.currentContext) return;

    if (action === 'build') {
      this.showBuildSubmenu();
      return;
    }

    this.hide();
    this.onAction({
      action,
      hexId: this.currentContext.hexId,
      params: { context: this.currentContext },
    });
  }

  private handleBuildActionClick(action: string): void {
    if (!this.currentContext) return;

    const buildingType = this.buildingTypeFromAction(action);
    this.hide();
    this.onAction({
      action: action as RadialMenuAction,
      hexId: this.currentContext.hexId,
      params: {
        buildingType,
        context: this.currentContext,
      },
    });
  }

  private buildingTypeFromAction(action: string): BuildingType | undefined {
    if (action === 'build_city') return 'city';
    if (action === 'build_factory') return 'factory';
    if (action === 'build_base') return 'base';
    if (action === 'build_capital') return 'capital';
    return undefined;
  }

  dispose(): void {
    this.hide();
  }
}
