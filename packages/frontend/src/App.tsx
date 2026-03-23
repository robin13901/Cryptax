import type { ImportResponse } from '@cryptax/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import LoginCard from './components/Auth/LoginCard';
import SetupCard from './components/Auth/SetupCard';
import Dashboard from './components/Dashboard/Dashboard';
import FloatingLines from './components/FloatingLines/FloatingLines';
import ImportDropzone from './components/ImportDropzone/ImportDropzone';
import ImportSummary from './components/ImportSummary/ImportSummary';
import PriceStatus from './components/PriceStatus/PriceStatus';
import ReportTab from './components/Report/ReportTab';
import SettingsTab from './components/Settings/SettingsTab';
import TransactionList from './components/Transactions/TransactionList';
import './App.css';

type AuthState = 'loading' | 'setup' | 'login' | 'authenticated';
type TabId = 'dashboard' | 'transactions' | 'report' | 'settings';

function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [importResponse, setImportResponse] = useState<ImportResponse | null>(null);

  // Determine auth state on mount
  useEffect(() => {
    fetch('/api/auth/status')
      .then((res) => res.json<{ hasPassword: boolean; authenticated: boolean }>())
      .then(({ hasPassword, authenticated }) => {
        if (!hasPassword) {
          setAuthState('setup');
        } else if (authenticated) {
          setAuthState('authenticated');
        } else {
          setAuthState('login');
        }
      })
      .catch(() => {
        // Graceful degradation on fetch error
        setAuthState('login');
      });
  }, []);

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
      setAuthState('login');
    });
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'transactions', label: 'Transaktionen' },
    { id: 'report', label: 'Steuerreport' },
    { id: 'settings', label: 'Einstellungen' },
  ];

  // ── Floating lines (shared background layer) ──────────────────────────────
  const floatingLinesBg = (
    <div className="floating-lines-bg">
      <FloatingLines
        linesGradient={['#0070F2', '#354A5F', '#0070F2', '#5fdc8a']}
        enabledWaves={['top', 'middle', 'bottom']}
        lineCount={[6, 8, 6]}
        lineDistance={[5, 4, 5]}
        animationSpeed={1.3}
        interactive
        bendRadius={3}
        bendStrength={-1.0}
        mouseDamping={0.08}
        parallax={false}
        mixBlendMode="screen"
      />
    </div>
  );

  // ── Loading state ─────────────────────────────────────────────────────────
  if (authState === 'loading') {
    return (
      <div className="app">
        {floatingLinesBg}
        <div className="auth-loading">
          <span className="auth-loading__spinner" aria-label="Laden..." />
        </div>
      </div>
    );
  }

  // ── Setup state ───────────────────────────────────────────────────────────
  if (authState === 'setup') {
    return (
      <div className="app">
        {floatingLinesBg}
        <SetupCard onSuccess={() => setAuthState('login')} />
      </div>
    );
  }

  // ── Login state ───────────────────────────────────────────────────────────
  if (authState === 'login') {
    return (
      <div className="app">
        {floatingLinesBg}
        <LoginCard onSuccess={() => setAuthState('authenticated')} />
      </div>
    );
  }

  // ── Authenticated app ─────────────────────────────────────────────────────
  return (
    <div className="app">
      {floatingLinesBg}

      {/* Content layer */}
      <div className="content">
        <header className="header">
          <h1>Cryptax</h1>
          <p className="subtitle">Krypto-Steuerreport &amp; Portfolio Dashboard</p>
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
                <Dashboard />
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
                {/* Collapsible import section */}
                <details className="import-toggle">
                  <summary className="import-toggle__summary">Import &amp; Preise</summary>
                  <div className="import-toggle__body">
                    <div className="transactions-import-area">
                      {importResponse ? (
                        <ImportSummary
                          response={importResponse}
                          onDismiss={() => setImportResponse(null)}
                        />
                      ) : (
                        <ImportDropzone onImportComplete={setImportResponse} />
                      )}
                    </div>
                    <div className="transactions-price-area" style={{ marginTop: '1.5rem' }}>
                      <PriceStatus />
                    </div>
                  </div>
                </details>

                {/* Transaction list */}
                <TransactionList />
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
                <ReportTab />
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <SettingsTab onLogout={handleLogout} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

export default App;
