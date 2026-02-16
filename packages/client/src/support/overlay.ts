const STYLE_ID = 'uxrr-support-overlay-style';
const SVG_NS = 'http://www.w3.org/2000/svg';

const CSS = `
.uxrr-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 2147483646;
    overflow: hidden;
}

.uxrr-highlight {
    position: absolute;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(59, 130, 246, 0.5);
    transform: translate(-50%, -50%) scale(0);
    animation: uxrr-pulse 2s ease-out forwards;
}

@keyframes uxrr-pulse {
    0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
    50% { transform: translate(-50%, -50%) scale(3); opacity: 0.6; }
    100% { transform: translate(-50%, -50%) scale(5); opacity: 0; }
}

.uxrr-cursor {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: rgba(59, 130, 246, 0.8);
    border: 2px solid rgba(255, 255, 255, 0.9);
    transform: translate(-50%, -50%);
    transition: left 0.03s linear, top 0.03s linear;
    display: none;
}

.uxrr-pen-svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}

.uxrr-pen-stroke {
    fill: none;
    stroke: rgba(239, 68, 68, 0.8);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.uxrr-pen-stroke--fading {
    animation: uxrr-pen-fade 3s ease-out forwards;
}

@keyframes uxrr-pen-fade {
    0% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: 0; }
}
`;

export class SupportOverlay {
    private container: HTMLDivElement;
    private cursorEl: HTMLDivElement | null = null;
    private svgEl: SVGSVGElement | null = null;
    private currentPath: SVGPolylineElement | null = null;
    private penPoints: string[] = [];

    constructor() {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }

        this.container = document.createElement('div');
        this.container.className = 'uxrr-overlay rr-ignore';
        document.body.appendChild(this.container);
    }

    showHighlight(x: number, y: number): void {
        const el = document.createElement('div');
        el.className = 'uxrr-highlight';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        this.container.appendChild(el);
        setTimeout(() => el.remove(), 2000);
    }

    moveCursor(x: number, y: number): void {
        if (!this.cursorEl) {
            this.cursorEl = document.createElement('div');
            this.cursorEl.className = 'uxrr-cursor';
            this.container.appendChild(this.cursorEl);
        }
        this.cursorEl.style.left = `${x}px`;
        this.cursorEl.style.top = `${y}px`;
        this.cursorEl.style.display = 'block';
    }

    hideCursor(): void {
        if (this.cursorEl) {
            this.cursorEl.style.display = 'none';
        }
    }

    penStart(x: number, y: number): void {
        if (!this.svgEl) {
            this.svgEl = document.createElementNS(SVG_NS, 'svg');
            this.svgEl.setAttribute('class', 'uxrr-pen-svg');
            this.svgEl.setAttribute('width', '100%');
            this.svgEl.setAttribute('height', '100%');
            this.container.appendChild(this.svgEl);
        }

        this.penPoints = [`${x},${y}`];
        this.currentPath = document.createElementNS(SVG_NS, 'polyline');
        this.currentPath.setAttribute('points', this.penPoints.join(' '));
        this.currentPath.setAttribute('class', 'uxrr-pen-stroke');
        this.svgEl.appendChild(this.currentPath);
    }

    penMove(x: number, y: number): void {
        if (!this.currentPath) return;
        this.penPoints.push(`${x},${y}`);
        this.currentPath.setAttribute('points', this.penPoints.join(' '));
    }

    penEnd(): void {
        const path = this.currentPath;
        this.currentPath = null;
        this.penPoints = [];
        if (path) {
            path.classList.add('uxrr-pen-stroke--fading');
            setTimeout(() => path.remove(), 3000);
        }
    }

    destroy(): void {
        this.container.remove();
    }
}
