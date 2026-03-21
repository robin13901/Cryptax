import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import FloatingLines from './components/FloatingLines/FloatingLines';
import GlassSurface from './components/GlassSurface/GlassSurface';
import './App.css';

type TabId = 'dashboard' | 'transactions' | 'report';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'transactions', label: 'Transaktionen' },
    { id: 'report', label: 'Steuerreport' },
  ];

  return (
    <div className="app">
      {/* FloatingLines background layer */}
      <div className="floating-lines-bg">
        <FloatingLines
          lineCount={35}
          animationSpeed={0.8}
          linesGradient={['#0070F2', '#354A5F', '#0070F2', '#5fdc8a']}
          mixBlendMode="screen"
        />
      </div>

      {/* Content layer */}
      <div className="content">
        <header className="header">
          <h1>Cryptax</h1>
          <p className="subtitle">Krypto-Steuerreport & Portfolio Dashboard</p>
        </header>

        {/* Tab Navigation */}
        <div className="tab-bar-container">
          <div className="nav-pills">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`nav-pill ${activeTab === tab.id ? 'nav-pill-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <main className="main">
          <AnimatePresence mode="sync">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <div className="kpi-grid">
                  <GlassSurface
                    width="auto"
                    height="auto"
                    borderRadius={10}
                    backgroundOpacity={0.12}
                  >
                    <div className="kpi-card">
                      <span className="kpi-value" style={{ color: 'var(--crypto-green)' }}>
                        --
                      </span>
                      <span className="kpi-label">Gesamtgewinn</span>
                      <span className="kpi-sub">2025</span>
                    </div>
                  </GlassSurface>
                  <GlassSurface
                    width="auto"
                    height="auto"
                    borderRadius={10}
                    backgroundOpacity={0.12}
                  >
                    <div className="kpi-card">
                      <span className="kpi-value">--</span>
                      <span className="kpi-label">Trades</span>
                      <span className="kpi-sub">Gesamt</span>
                    </div>
                  </GlassSurface>
                  <GlassSurface
                    width="auto"
                    height="auto"
                    borderRadius={10}
                    backgroundOpacity={0.12}
                  >
                    <div className="kpi-card">
                      <span className="kpi-value">--</span>
                      <span className="kpi-label">Steuerpflichtig</span>
                      <span className="kpi-sub">Spot + Futures</span>
                    </div>
                  </GlassSurface>
                  <GlassSurface
                    width="auto"
                    height="auto"
                    borderRadius={10}
                    backgroundOpacity={0.12}
                  >
                    <div className="kpi-card">
                      <span className="kpi-value">--</span>
                      <span className="kpi-label">Steuer (est.)</span>
                      <span className="kpi-sub">Abgeltungssteuer</span>
                    </div>
                  </GlassSurface>
                </div>

                <div className="empty-state">
                  <div className="empty-state-icon">&#128200;</div>
                  <p>Noch keine Daten importiert</p>
                  <p style={{ fontSize: '0.78rem' }}>
                    Importiere deine Bitget CSV-Exporte unter &quot;Transaktionen&quot;
                  </p>
                </div>
              </motion.div>
            )}

            {activeTab === 'transactions' && (
              <motion.div
                key="transactions"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <div className="empty-state">
                  <div className="empty-state-icon">&#128196;</div>
                  <p>Transaktionen</p>
                  <p style={{ fontSize: '0.78rem' }}>
                    CSV-Import und Transaktionsliste kommen hier hin
                  </p>
                </div>
              </motion.div>
            )}

            {activeTab === 'report' && (
              <motion.div
                key="report"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <div className="empty-state">
                  <div className="empty-state-icon">&#128203;</div>
                  <p>Steuerreport</p>
                  <p style={{ fontSize: '0.78rem' }}>
                    Report-Generierung und Export kommen hier hin
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

export default App;
