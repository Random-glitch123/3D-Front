// Starting Hex Countdown Bar - Top bar that fills left-to-right over 5 seconds
// Single-click globe to claim starting hex (color from lobby)

import type { WorldMapData } from '../shared/protocol';
import { isHexOwnable } from './economy';
import { eventToCanvasPoint, pickHexAtScreen } from './input/raycast';

export interface StartingHexSelectorConfig {
  worldMap: WorldMapData;
  globeRenderer: any;
  camera: any;
  canvas: HTMLCanvasElement;
  onComplete: (hexId: number) => void;
  localPlayerId: string;
}

const COUNTDOWN_SECONDS = 5;

export class StartingHexSelector {
  private worldMap: WorldMapData;
  private globeRenderer: any;
  private camera: any;
  private canvas: HTMLCanvasElement;
  private onComplete: (hexId: number) => void;

  private overlay: HTMLElement;
  private barFill!: HTMLElement;
  private hintEl!: HTMLElement;
  private isSelecting: boolean = false;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private selectedHexId: number = -1;

  constructor(config: StartingHexSelectorConfig) {
    this.worldMap = config.worldMap;
    this.globeRenderer = config.globeRenderer;
    this.camera = config.camera;
    this.canvas = config.canvas;
    this.onComplete = config.onComplete;

    this.overlay = this.createOverlay();
    document.body.appendChild(this.overlay);
    this.setupEventListeners();
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'starting-hex-selector';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 6px;
      z-index: 200;
      pointer-events: none;
      background: transparent;
    `;

    overlay.innerHTML = `
      <style>
        #starting-hex-selector .bar-track {
          height: 6px;
          background: rgba(0, 255, 255, 0.15);
          overflow: hidden;
        }
        #starting-hex-selector .bar-fill {
          height: 6px;
          background: linear-gradient(90deg, #00b7ff, #00ffff);
          width: 0%;
          box-shadow: 0 0 8px rgba(0, 255, 255, 0.7);
          transition: width 1s linear;
        }
        #starting-hex-selector .hint {
          position: fixed;
          bottom: 26px;
          left: 50%;
          transform: translateX(-50%);
          color: rgba(220, 245, 255, 0.85);
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 0.85rem;
          letter-spacing: 0.04em;
          text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
          white-space: nowrap;
        }
      </style>
      <div class="bar-track">
        <div class="bar-fill" id="countdown-bar-fill"></div>
      </div>
      <div class="hint" id="starting-hex-hint">Click a land tile to claim your starting hex</div>
    `;

    this.barFill = overlay.querySelector('#countdown-bar-fill')!;
    this.hintEl = overlay.querySelector('#starting-hex-hint')!;
    return overlay;
  }

  private setupEventListeners() {
    this.mouseMoveHandler = (e: MouseEvent) => this.onMouseMove(e);
    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);

    this.clickHandler = (e: MouseEvent) => this.onCanvasClick(e);
    this.canvas.addEventListener('click', this.clickHandler);

    // Freeze the idle menu rotation while the player picks a hex.
    (this.camera as any).autoRotate = false;
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.isSelecting) return;
    const { x, y } = eventToCanvasPoint(e, this.canvas);
    const hexId = this.pickHex(x, y);
    this.highlightHex(hexId);
  }

  private onCanvasClick(e: MouseEvent) {
    if (!this.isSelecting) return;
    if (e.button !== 0) return;

    const { x, y } = eventToCanvasPoint(e, this.canvas);
    const hexId = this.pickHex(x, y);
    if (hexId >= 0 && this.isValidStartingHex(hexId)) {
      this.selectHex(hexId);
    } else if (hexId >= 0) {
      this.setHint('That tile cannot be claimed — pick land, not ocean or beach');
    }
  }

  private pickHex(x: number, y: number): number {
    return pickHexAtScreen(this.globeRenderer.scene, this.camera, this.worldMap, x, y);
  }

  private isValidStartingHex(hexId: number): boolean {
    const hex = this.worldMap.hexes[hexId];
    return !!hex && isHexOwnable(hex.biome);
  }

  private selectHex(hexId: number) {
    this.selectedHexId = hexId;
    this.confirm();
  }

  private highlightHex(_hexId: number) {
    // Optional: could add subtle visual feedback here
  }

  private setHint(text: string) {
    if (this.hintEl) this.hintEl.textContent = text;
  }

  /** Update countdown bar width as the countdown progresses (fills left->right). */
  updateCountdown(secondsRemaining: number) {
    const elapsed = COUNTDOWN_SECONDS - Math.max(0, Math.min(COUNTDOWN_SECONDS, secondsRemaining));
    const progress = (elapsed / COUNTDOWN_SECONDS) * 100;
    if (this.barFill) {
      this.barFill.style.width = `${progress}%`;
    }
  }

  private confirm() {
    if (this.selectedHexId < 0) return;
    this.cleanup();
    this.onComplete(this.selectedHexId);
  }

  /** Start the selection process */
  start() {
    this.isSelecting = true;
    this.overlay.style.display = 'block';
    if (this.barFill) {
      this.barFill.style.width = '0%';
    }
    this.setHint('Click a land tile to claim your starting hex');
  }

  /** Cleanup event listeners and DOM */
  private cleanup() {
    this.isSelecting = false;
    this.overlay.style.display = 'none';

    if (this.mouseMoveHandler) {
      this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
    }
    if (this.clickHandler) {
      this.canvas.removeEventListener('click', this.clickHandler);
    }

    // IMPORTANT: never re-enable auto-rotation here. Cleanup runs when the game
    // starts; re-enabling it makes the world keep spinning during play.
    (this.camera as any).autoRotate = false;
    this.overlay.remove();
  }

  /** Force cleanup (e.g., on disconnect) */
  dispose() {
    this.cleanup();
  }
}
