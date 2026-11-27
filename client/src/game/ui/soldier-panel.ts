// Soldier Panel UI - Top-left display showing soldier count and income
// Openfront style: dark glassmorphism, cyan accents, animated numbers

import type { PlayerState } from '../player-state';

export interface SoldierPanelConfig {
  playerState: PlayerState;
  container: HTMLElement; // Parent element to append to
}

export class SoldierPanel {
  private playerState: PlayerState;
  private container: HTMLElement;
  private panel: HTMLElement;
  private soldierCountEl!: HTMLElement;
  private incomeEl!: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor(config: SoldierPanelConfig) {
    this.playerState = config.playerState;
    this.container = config.container;
    this.panel = this.createPanel();
    this.container.appendChild(this.panel);

    // Subscribe to updates
    this.cleanup.push(
      this.playerState.onSoldierCountChange((current, target, income) => {
        this.updateDisplay(current, target, income);
      })
    );

    // Initial render
    this.updateDisplay(
      this.playerState.getCurrentSoldiers(),
      this.playerState.getTargetSoldiers(),
      this.playerState.getIncomePerSecond()
    );
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.id = 'soldier-panel';
    panel.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      z-index: 50;
      pointer-events: none;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;

    panel.innerHTML = `
      <style>
        #soldier-panel .panel-bg {
          background: linear-gradient(135deg, rgba(10, 10, 25, 0.95), rgba(20, 20, 45, 0.9));
          border: 1px solid rgba(0, 255, 255, 0.2);
          border-radius: 12px;
          padding: 1rem 1.5rem;
          backdrop-filter: blur(20px);
          box-shadow: 
            0 8px 32px rgba(0, 0, 0, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 0 0 1px rgba(0, 255, 255, 0.1);
          min-width: 220px;
        }
        #soldier-panel .stat-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 1rem;
        }
        #soldier-panel .stat-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(0, 255, 255, 0.6);
          font-weight: 600;
        }
        #soldier-panel .stat-value {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 1.5rem;
          font-weight: 700;
          color: #00ffff;
          text-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
          transition: transform 0.1s ease, text-shadow 0.1s ease;
        }
        #soldier-panel .stat-value.pulse {
          animation: soldier-pulse 0.5s ease-out;
        }
        #soldier-panel .income-value {
          font-size: 1rem;
          color: #44ff44;
          text-shadow: 0 0 8px rgba(68, 255, 68, 0.5);
        }
        #soldier-panel .divider {
          width: 100%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(0, 255, 255, 0.3), transparent);
          margin: 0.5rem 0;
        }
        @keyframes soldier-pulse {
          0% { transform: scale(1); text-shadow: 0 0 10px rgba(0, 255, 255, 0.5); }
          50% { transform: scale(1.05); text-shadow: 0 0 20px rgba(0, 255, 255, 0.8); }
          100% { transform: scale(1); text-shadow: 0 0 10px rgba(0, 255, 255, 0.5); }
        }
      </style>
      <div class="panel-bg">
        <div class="stat-row">
          <span class="stat-label">Soldiers</span>
          <span class="stat-value" id="soldier-count">0</span>
        </div>
        <div class="divider"></div>
        <div class="stat-row">
          <span class="stat-label">Income</span>
          <span class="stat-value income-value" id="soldier-income">+0/sec</span>
        </div>
      </div>
    `;

    this.soldierCountEl = panel.querySelector('#soldier-count')!;
    this.incomeEl = panel.querySelector('#soldier-income')!;

    return panel;
  }

  private updateDisplay(current: number, target: number, income: number) {
    // Format numbers with commas
    const formatNumber = (n: number) => Math.floor(n).toLocaleString();
    
    // Update soldier count
    const newCountText = formatNumber(current);
    if (this.soldierCountEl.textContent !== newCountText) {
      this.soldierCountEl.textContent = newCountText;
      
      // Pulse animation on significant changes
      if (Math.abs(current - target) > 1) {
        this.soldierCountEl.classList.add('pulse');
        setTimeout(() => this.soldierCountEl.classList.remove('pulse'), 500);
      }
    }

    // Update income
    this.incomeEl.textContent = `+${income.toFixed(income % 1 === 0 ? 0 : 1)}/sec`;
  }

  /** Show/hide panel */
  show() { this.panel.style.display = ''; }
  hide() { this.panel.style.display = 'none'; }

  /** Cleanup */
  dispose() {
    this.cleanup.forEach(fn => fn());
    this.cleanup = [];
    this.panel.remove();
  }
}