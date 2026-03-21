import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './FloatingLines.css';

interface FloatingLinesProps {
  lineCount?: number;
  animationSpeed?: number;
  linesGradient?: string[];
  mixBlendMode?: string;
  className?: string;
  style?: React.CSSProperties;
  enabledWaves?: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const num = parseInt(cleaned, 16);
  return [(num >> 16) / 255, ((num >> 8) & 0xff) / 255, (num & 0xff) / 255];
}

type LineData = {
  yBase: number;
  speed: number;
  amplitude: number;
  frequency: number;
  offset: number;
  segmentCount: number;
};

export default function FloatingLines({
  lineCount = 35,
  animationSpeed = 0.8,
  linesGradient = ['#0070F2', '#354A5F', '#0070F2', '#5fdc8a'],
  mixBlendMode = 'screen',
  className = '',
  style,
  enabledWaves = true,
}: FloatingLinesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    // Scene & orthographic camera covering [-1,1] x [-1,1]
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
    };
    resize();

    // Parse gradient colors
    const parsedColors = linesGradient.map(hexToRgb);

    const lineMeshes: THREE.Line[] = [];
    const lineDataArr: LineData[] = [];

    for (let i = 0; i < lineCount; i++) {
      const t = lineCount > 1 ? i / (lineCount - 1) : 0;

      // Interpolate color along gradient
      const segCount = parsedColors.length - 1;
      const seg = Math.min(Math.floor(t * segCount), segCount - 1);
      const segT = t * segCount - seg;
      const c0 = parsedColors[seg];
      const c1 = parsedColors[Math.min(seg + 1, parsedColors.length - 1)];
      const r = c0[0] + (c1[0] - c0[0]) * segT;
      const g = c0[1] + (c1[1] - c0[1]) * segT;
      const b = c0[2] + (c1[2] - c0[2]) * segT;

      const color = new THREE.Color(r, g, b);
      const yBase = -1 + t * 2;
      const amplitude = 0.08 + Math.random() * 0.22;
      const frequency = 0.8 + Math.random() * 2.2;
      const offset = Math.random() * Math.PI * 2;
      const speed = (0.3 + Math.random() * 0.7) * animationSpeed;
      const segmentCount = 120;

      // Build initial positions
      const positions = new Float32Array((segmentCount + 1) * 3);
      for (let j = 0; j <= segmentCount; j++) {
        const x = -1 + (j / segmentCount) * 2;
        positions[j * 3] = x;
        positions[j * 3 + 1] = yBase;
        positions[j * 3 + 2] = 0;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35 + Math.random() * 0.45,
      });

      const mesh = new THREE.Line(geometry, material);
      scene.add(mesh);
      lineMeshes.push(mesh);
      lineDataArr.push({ yBase, speed, amplitude, frequency, offset, segmentCount });
    }

    // Animation loop
    let frameId: number;
    let elapsed = 0;
    let lastTime = performance.now();

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const now = performance.now();
      elapsed += (now - lastTime) / 1000;
      lastTime = now;

      for (let i = 0; i < lineMeshes.length; i++) {
        const mesh = lineMeshes[i];
        const data = lineDataArr[i];
        if (!mesh || !data) continue;

        const posAttr = mesh.geometry.attributes['position'] as THREE.BufferAttribute;

        for (let j = 0; j <= data.segmentCount; j++) {
          const x = -1 + (j / data.segmentCount) * 2;
          let y = data.yBase;
          if (enabledWaves) {
            const wave1 = Math.sin(x * data.frequency + elapsed * data.speed + data.offset);
            const wave2 = Math.sin(
              x * data.frequency * 0.5 + elapsed * data.speed * 0.7 + data.offset * 1.3,
            );
            y = data.yBase + (wave1 * 0.7 + wave2 * 0.3) * data.amplitude;
          }
          posAttr.setXYZ(j, x, y, 0);
        }
        posAttr.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      for (const mesh of lineMeshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        scene.remove(mesh);
      }
      renderer.dispose();
    };
  }, [lineCount, animationSpeed, linesGradient, mixBlendMode, enabledWaves]);

  return (
    <canvas
      ref={canvasRef}
      className={`floating-lines-canvas ${className}`}
      style={{ mixBlendMode: mixBlendMode as React.CSSProperties['mixBlendMode'], ...style }}
    />
  );
}
