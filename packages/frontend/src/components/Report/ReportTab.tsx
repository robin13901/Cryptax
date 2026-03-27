import type { ReportData } from '@cryptax/shared';
import { useEffect, useState } from 'react';
import { YearSelector } from '../Dashboard/YearSelector';
import GlassSurface from '../GlassSurface/GlassSurface';
import ReportPreview from './ReportPreview';
import './ReportTab.css';

type DownloadState = 'pdf' | 'csv' | null;

interface ReportTabProps {
  selectedYear: number;
  onYearChange: (year: number) => void;
}

function ReportTab({ selectedYear, onYearChange }: ReportTabProps) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [downloading, setDownloading] = useState<DownloadState>(null);

  // On mount: fetch available years
  useEffect(() => {
    fetch('/api/report/years')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ years: number[] }>;
      })
      .then((json) => {
        const years = json.years ?? [];
        setAvailableYears(years);
        if (years.length > 0 && !years.includes(selectedYear)) {
          onYearChange(Math.max(...years));
        }
      })
      .catch(() => {
        setAvailableYears([]);
      })
      .finally(() => {
        setYearsLoading(false);
      });
  }, [onYearChange, selectedYear]);

  // Fetch preview data whenever selectedYear changes (and years have loaded)
  useEffect(() => {
    if (yearsLoading) return;
    let cancelled = false;
    setLoading(true);
    setReportData(null);

    fetch(`/api/report/${selectedYear}/preview`)
      .then((res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ReportData>;
      })
      .then((json) => {
        if (!cancelled) setReportData(json);
      })
      .catch(() => {
        if (!cancelled) setReportData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYear, yearsLoading]);

  const downloadPdf = async () => {
    setDownloading('pdf');
    try {
      const res = await fetch(`/api/report/${selectedYear}/pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cryptax-steuerreport-${selectedYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  const downloadCsv = async () => {
    setDownloading('csv');
    try {
      const res = await fetch(`/api/report/${selectedYear}/csv`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cryptax-steuerberater-${selectedYear}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  const canDownload = reportData !== null && downloading === null;

  return (
    <div className="report-tab">
      {/* Header row */}
      <div className="report-tab__header">
        <h2 className="report-tab__title">Steuerreport</h2>
        <YearSelector years={availableYears} selected={selectedYear} onChange={onYearChange} />
      </div>

      {/* Download buttons */}
      <div className="report-tab__actions">
        <button
          type="button"
          className="report-btn report-btn--primary"
          onClick={downloadPdf}
          disabled={!canDownload}
          aria-label="PDF herunterladen"
        >
          {downloading === 'pdf' ? 'Wird geladen...' : 'PDF herunterladen'}
        </button>
        <button
          type="button"
          className="report-btn report-btn--secondary"
          onClick={downloadCsv}
          disabled={!canDownload}
          aria-label="CSV exportieren"
        >
          {downloading === 'csv' ? 'Wird geladen...' : 'CSV exportieren'}
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="report-tab__loading">
          <p>Lade Report...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && reportData === null && (
        <GlassSurface width="100%" height="auto" borderRadius={16}>
          <div className="report-tab__empty">
            <div className="report-tab__empty-icon">&#128203;</div>
            <p className="report-tab__empty-title">Keine Daten für {selectedYear}</p>
            <p className="report-tab__empty-hint">
              Bitte zuerst Transaktionen importieren und die Steuerberechnung ausführen.
            </p>
          </div>
        </GlassSurface>
      )}

      {/* Preview */}
      {!loading && reportData !== null && <ReportPreview data={reportData} />}
    </div>
  );
}

export default ReportTab;
