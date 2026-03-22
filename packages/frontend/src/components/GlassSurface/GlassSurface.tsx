import './GlassSurface.css';

interface GlassSurfaceProps {
  children: React.ReactNode;
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  backgroundOpacity?: number;
  saturation?: number;
  className?: string;
  style?: React.CSSProperties;
}

const GlassSurface = ({
  children,
  width = 200,
  height = 80,
  borderRadius = 20,
  backgroundOpacity = 0,
  saturation = 1,
  className = '',
  style = {},
}: GlassSurfaceProps) => {
  const containerStyle: React.CSSProperties & Record<string, unknown> = {
    ...style,
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: `${borderRadius}px`,
    '--glass-bg-opacity': backgroundOpacity,
    '--glass-saturation': saturation,
  };

  return (
    <div className={`glass-surface ${className}`} style={containerStyle}>
      <div className="glass-surface__content">{children}</div>
    </div>
  );
};

export default GlassSurface;
