import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// StrictMode intentionally removed to prevent FloatingLines WebGL canvas from double-mounting
// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed to exist in index.html
createRoot(document.getElementById('root')!).render(<App />);
