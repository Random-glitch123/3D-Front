// Hex Info Tooltip - Shows on hex hover with biome, owner, soldier info

import { HexOwnershipManager } from '../hex-ownership';
import { getBiomeName, isHexOwnable, getHexBaseValue, getBiomeColor } from '../economy';
import { PLAYER_COLORS } from '../../shared/protocol';

export interface HexInfoTooltipConfig {
  hexManager: HexOwnershipManager;
  worldHexes: Array<{ biome: number }>;
  container: HTMLElement;
  getPlayerName: (playerId: string) => string;
}

export class HexInfoTooltip {
  private hexManager: HexOwnershipManager;
  private worldHexes: Array<{ biome: number }>;
  private container: HTMLElement;
  private getPlayerName: (playerId: string) => string;
  private tooltip: HTMLElement;
  private currentHexId: number = -1;
  private isVisible: boolean = false;
  private hideTimeout: number | null = null;

  constructor(config: HexInfoTooltipConfig) {
    this.hexManager = config.hexManager;
    this.worldHexes = config.worldHexes;
    this.container = config.container;
    this.getPlayerName = config.getPlayerName;
    this.tooltip = this.createTooltip();
    this.container.appendChild(this.tooltip);
  }

  private createTooltip(): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.id = 'hex-info-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      z-index: 100;
      pointer-events: none;
      font-family: 'Segoe UI', system-ui, sans-serif;
      transform: translate(-50%, -100%);
      transition: opacity 0.15s ease, transform 0.15s ease;
      opacity: 0;
      display: none;
    `;

    tooltip.innerHTML = `
      <style>
        #hex-info-tooltip .tooltip-bg {
          background: linear-gradient(135deg, rgba(10, 10, 25, 0.95), rgba(20, 20, 45, 0.9));
          border: 1px solid rgba(0, 255, 255, 0.25);
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          backdrop-filter: blur(10px);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
          min-width: 160px;
          max-width: 220px;
        }
        #hex-info-tooltip .tooltip-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
          margin: 0.25rem 0;
        }
        #hex-info-tooltip .tooltip-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(200, 220, 255, 0.55);
          font-weight: 600;
          white-space: nowrap;
        }
        #hex-info-tooltip .tooltip-value {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 0.8rem;
          color: #e0e8ff;
          text-align: right;
          white-space: nowrap;
        }
        #hex-info-tooltip .tooltip-value.owner {
          color: #00ffff;
        }
        #hex-info-tooltip .tooltip-value.unowned {
          color: #888;
        }
        #hex-info-tooltip .tooltip-divider {
          width: 100%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(0, 255, 255, 0.2), transparent);
          margin: 0.4rem 0;
        }
        #hex-info-tooltip .biome-badge {
          display: inline-block;
          padding: 0.1rem 0.4rem;
          border-radius: 3px;
          font-size: 0.6rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        #hex-info-tooltip .owner-color-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          margin-right: 0.4rem;
          vertical-align: middle;
          box-shadow: 0 0 6px currentColor;
        }
      </style>
      <div class="tooltip-bg" id="tooltip-content"></div>
    `;

    return tooltip;
  }

  /** Show tooltip for a hex at screen position */
  show(hexId: number, screenX: number, screenY: number) {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    this.currentHexId = hexId;
    this.updateContent();
    this.positionAt(screenX, screenY);
    this.tooltip.style.display = 'block';
    // Force reflow for transition
    this.tooltip.offsetHeight;
    this.tooltip.style.opacity = '1';
    this.tooltip.style.transform = 'translate(-50%, calc(-100% - 8px))';
    this.isVisible = true;
  }

  /** Reposition an already-visible tooltip and refresh its contents. */
  move(screenX: number, screenY: number) {
    if (!this.isVisible) return;
    this.updateContent();
    this.positionAt(screenX, screenY);
  }

  /** Hide tooltip */
  hide() {
    if (this.hideTimeout) return; // Already hiding

    this.isVisible = false;
    this.tooltip.style.opacity = '0';
    this.tooltip.style.transform = 'translate(-50%, -100%)';

    this.hideTimeout = window.setTimeout(() => {
      if (!this.isVisible) {
        this.tooltip.style.display = 'none';
      }
      this.hideTimeout = null;
    }, 150);
  }

  /** Update tooltip content for current hex */
  private updateContent() {
    const hexId = this.currentHexId;
    const ownership = this.hexManager.getHexOwnership(hexId);
    const worldHex = this.worldHexes[hexId];
    
    if (!ownership || !worldHex) {
      this.setContent('<div style="color: #888; padding: 0.5rem;">Unknown hex</div>');
      return;
    }

    const biome = worldHex.biome;
    const biomeName = getBiomeName(biome);
    const isOwnable = isHexOwnable(biome);
    const baseValue = isOwnable ? getHexBaseValue(biome) : 0;
    const ownerId = ownership.ownerId;
    const soldiers = ownership.soldiers;

    let html = '';

    // Biome row
    const biomeColor = getBiomeColor(biome);
    html += `
      <div class="tooltip-row">
        <span class="tooltip-label">Biome</span>
        <span class="tooltip-value">
          <span class="biome-badge" style="background: ${biomeColor}; color: #000;">${biomeName}</span>
        </span>
      </div>
    `;

    // Ownership row
    if (ownerId) {
      const color = PLAYER_COLORS[this.hexManager.getEconomy(ownerId)?.colorIndex ?? 0] ?? 0x00ffff;
      const colorHex = '#' + color.toString(16).padStart(6, '0');
      const playerName = this.getPlayerName(ownerId);
      const isLocal = this.hexManager.getLocalPlayerId() === ownerId;
      
      html += `
        <div class="tooltip-row">
          <span class="tooltip-label">Owner</span>
          <span class="tooltip-value owner">
            <span class="owner-color-dot" style="background: ${colorHex};"></span>
            ${playerName}${isLocal ? ' (You)' : ''}
          </span>
        </div>
      `;
    } else {
      html += `
        <div class="tooltip-row">
          <span class="tooltip-label">Owner</span>
          <span class="tooltip-value unowned">Unclaimed</span>
        </div>
      `;
    }

    // Soldier info
    if (isOwnable) {
      html += `<div class="tooltip-divider"></div>`;
      html += `
        <div class="tooltip-row">
          <span class="tooltip-label">Soldiers</span>
          <span class="tooltip-value">${soldiers.toLocaleString()} / 500</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Base Value</span>
          <span class="tooltip-value">${baseValue}</span>
        </div>
      `;
    } else {
      html += `<div class="tooltip-divider"></div>`;
      html += `
        <div class="tooltip-row">
          <span class="tooltip-label">Status</span>
          <span class="tooltip-value unowned">Not Capturable</span>
        </div>
      `;
    }

    this.setContent(html);
  }

  private setContent(html: string) {
    const contentEl = this.tooltip.querySelector('#tooltip-content');
    if (contentEl) contentEl.innerHTML = html;
  }

  private positionAt(x: number, y: number) {
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  // getBiomeColor is imported from ../economy

  /** Check if tooltip is currently showing for a hex */
  isShowingFor(hexId: number): boolean {
    return this.isVisible && this.currentHexId === hexId;
  }

  /** Cleanup */
  dispose() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    this.tooltip.remove();
  }
}