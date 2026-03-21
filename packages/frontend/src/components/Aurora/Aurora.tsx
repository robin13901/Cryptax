import './Aurora.css';

interface AuroraProps {
  colorStops?: string[];
  amplitude?: number;
  blend?: number;
  speed?: number;
  time?: number;
}

// Placeholder Aurora component — will be replaced with WebGL implementation in 01-05
export default function Aurora(_props: AuroraProps) {
  return <div className="aurora-placeholder" />;
}
