// Bottom Economy Panel - Unified panel with soldier count, gold, population, and attack allocation
// All info at the bottom with 2 bars stacked on top of each other

import type { PlayerEconomy } from '../../shared/protocol';

export interface EconomyPanelConfig {
  container: HTMLElement;
  onSetSoldierAllocation: (ratio: number) => void;
  onSetAttackAllocation: (ratio: number) => void;
}

export class EconomyPanel {
  private container: HTMLElement;
  private onSetSoldierAllocation: (ratio: number) => void;
  private onSetAttackAllocation: (ratio: number) => void;

  private panel: HTMLElement;
  private soldierCountEl: HTMLElement;
  private goldEl: HTMLElement;
  private populationBarFill: HTMLElement;
  private populationLabel: HTMLElement;
  private attackBarFill: HTMLElement;
  private attackLabel: HTMLElement;
  private soldierSlider: HTMLInputElement;
  private attackSlider: HTMLInputElement;

  private soldierAllocation = 0.2; // Default 20%
  private attackAllocation = 0.5;  // Default 50%

  constructor(config: EconomyPanelConfig) {
    this.container = config.container;
    this.onSetSoldierAllocation = config.onSetSoldierAllocation;
    this.onSetAttackAllocation = config.onSetAttackAllocation;

    this.panel = this.createPanel();
    this.container.appendChild(this.panel);

    this.soldierCountEl = this.panel.querySelector('#soldier-count')!;
    this.goldEl = this.panel.querySelector('#economy-gold')!;
    this.populationBarFill = this.panel.querySelector('#population-bar-fill')!;
    this.populationLabel = this.panel.querySelector('#population-label')!;
    this.attackBarFill = this.panel.querySelector('#attack-bar-fill')!;
    this.attackLabel = this.panel.querySelector('#attack-label')!;
    this.soldierSlider = this.panel.querySelector('#soldier-slider') as HTMLInputElement;
    this.attackSlider = this.panel.querySelector('#attack-slider') as HTMLInputElement;

    this.setupSliders();
    this.updateDisplay();
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.id = 'economy-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 140px;
      z-index: 200;
      pointer-events: auto;
      background: linear-gradient(180deg, rgba(8, 8, 18, 0.95), rgba(16, 16, 38, 0.9));
      border-top: 2px solid rgba(0, 255, 255, 0.3);
      backdrop-filter: blur(20px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 2rem;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;

    panel.innerHTML = `
      <style>
        #economy-panel .top-row {
          display: flex;
          align-items: center;
          gap: 2rem;
          width: 100%;
          max-width: 900px;
          justify-content: space-between;
        }
        #economy-panel .stat-group {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: rgba(220, 245, 255, 0.95);
        }
        #economy-panel .stat-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(0, 255, 255, 0.7);
          font-weight: 700;
          white-space: nowrap;
        }
        #economy-panel .stat-value {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 1.3rem;
          font-weight: 800;
          color: #e0e8ff;
        }
        #economy-panel .stat-value.gold { color: #fbbf24; text-shadow: 0 0 12px rgba(251, 191, 36, 0.6); }
        #economy-panel .stat-value.soldiers { color: #00ffff; text-shadow: 0 0 12px rgba(0, 255, 255, 0.6); }
        #economy-panel .sep {
          color: rgba(0, 255, 255, 0.25);
          font-size: 1.1rem;
        }
        #economy-panel .bar-section {
          width: 100%;
          max-width: 700px;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        #economy-panel .bar-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
        }
        #economy-panel .bar-label {
          width: 110px;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: rgba(0, 255, 255, 0.6);
          font-weight: 600;
          text-align: left;
        }
        #economy-panel .bar-track {
          flex: 1;
          height: 10px;
          background: rgba(0, 255, 255, 0.1);
          border-radius: 5px;
          overflow: hidden;
          position: relative;
        }
        #economy-panel .bar-fill {
          height: 100%;
          border-radius: 5px;
          transition: width 0.3s ease;
        }
        #economy-panel #population-bar-fill { background: linear-gradient(90deg, #4ade80, #22c55e); box-shadow: 0 0 10px rgba(74, 222, 128, 0.5); }
        #economy-panel #attack-bar-fill { background: linear-gradient(90deg, #3b82f6, #2563eb); box-shadow: 0 0 10px rgba(59, 130, 246, 0.5); }
        #economy-panel .bar-value {
          width: 40px;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 0.85rem;
          font-weight: 700;
          color: #e0e8ff;
          text-align: right;
        }
        #economy-panel .slider-group {
          width: 100%;
          max-width: 500px;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        #economy-panel input[type=range] {
          flex: 1;
          accent-color: #00ffff;
          height: 6px;
        }
        #economy-panel .slider-text {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 0.8rem;
          min-width: 40px;
          text-align: right;
          color: #00ffff;
        }
      </style>
      <div class="top-row">
        <div class="stat-group">
          <span class="stat-label">Soldiers</span>
          <span class="stat-value soldiers" id="soldier-count">0</span>
        </div>
        <span class="sep">|</span>
        <div class="stat-group">
          <span class="stat-label">Gold</span>
          <span class="stat-value gold" id="economy-gold">0</span>
        </div>
      </div>
      <div class="bar-section">
        <div class="bar-row">
          <span class="bar-label">Population → Soldiers</span>
          <div class="bar-track">
            <div class="bar-fill" id="population-bar-fill" style="width: 20%"></div>
          </div>
          <span class="bar-value" id="population-label">20%</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">Attack Commitment</span>
          <div class="bar-track">
            <div class="bar-fill" id="attack-bar-fill" style="width: 50%"></div>
          </div>
          <span class="bar-value" id="attack-label">50%</span>
        </div>
      </div>
      <div class="slider-group">
        <input type="range" id="soldier-slider" min="0" max="100" value="20" />
        <span class="slider-text" id="soldier-slider-text">20%</span>
      </div>
      <div class="slider-group">
        <input type="range" id="attack-slider" min="0" max="100" value="50" />
        <span class="slider-text" id="attack-slider-text">50%</span>
      </div>
    `;

    return panel;
  }

  private setupSliders(): void {
    this.soldierSlider.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const val = parseInt(target.value, 10) / 100;
      this.soldierAllocation = val;
      this.populationBarFill.style.width = `${Math.round(val * 100)}%`;
      this.populationLabel.textContent = `${Math.round(val * 100)}%`;
      const textEl = this.panel.querySelector('#soldier-slider-text')!;
      textEl.textContent = `${Math.round(val * 100)}%`;
      this.onSetSoldierAllocation(val);
    });

    this.attackSlider.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const val = parseInt(target.value, 10) / 100;
      this.attackAllocation = val;
      this.attackBarFill.style.width = `${Math.round(val * 100)}%`;
      this.attackLabel.textContent = `${Math.round(val * 100)}%`;
      const textEl = this.panel.querySelector('#attack-slider-text')!;
      textEl.textContent = `${Math.round(val * 100)}%`;
      this.onSetAttackAllocation(val);
    });
  }

  /** Update display from economy state */
  updateDisplay(economy?: PlayerEconomy): void {
    if (!economy) return;
    this.soldierCountEl.textContent = Math.floor(economy.totalSoldiers).toLocaleString();
    this.goldEl.textContent = economy.gold.toLocaleString();

    // Update sliders if they differ from economy state
    if (Math.abs(this.soldierAllocation - economy.soldierAllocationRatio) > 0.001) {
      this.soldierAllocation = economy.soldierAllocationRatio;
      const pct = Math.round(this.soldierAllocation * 100);
      this.soldierSlider.value = String(pct);
      this.populationBarFill.style.width = `${pct}%`;
      this.populationLabel.textContent = `${pct}%`;
      const textEl = this.panel.querySelector('#soldier-slider-text')!;
      textEl.textContent = `${pct}%`;
    }
    if (Math.abs(this.attackAllocation - economy.attackAllocationRatio) > 0.001) {
      this.attackAllocation = economy.attackAllocationRatio;
      const pct = Math.round(this.attackAllocation * 100);
      this.attackSlider.value = String(pct);
      this.attackBarFill.style.width = `${pct}%`;
      this.attackLabel.textContent = `${pct}%`;
      const textEl = this.panel.querySelector('#attack-slider-text')!;
      textEl.textContent = `${pct}%`;
    }
  }

  /** Cleanup */
  dispose(): void {
    this.panel.remove();
  }
}
