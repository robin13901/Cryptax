import type { ImportResponse, PerFileResult } from '@cryptax/shared';
import { useState } from 'react';
import './ImportSummary.css';

interface ImportSummaryProps {
  response: ImportResponse | null;
  onDismiss: () => void;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  spot_tx: 'Spot Tx',
  futures_tx: 'Futures Tx',
  spot_order: 'Spot Order',
  futures_order: 'Futures Order',
  earn: 'Earn',
};

function FileRow({ file }: { file: PerFileResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = file.errors.length > 0;
  const label = SOURCE_TYPE_LABELS[file.sourceType] ?? file.sourceType;

  return (
    <div className="import-summary__file">
      <div className="import-summary__file-header">
        <div className="import-summary__file-name">
          <span className="import-summary__source-badge">{label}</span>
          <span className="import-summary__filename">{file.filename}</span>
        </div>
        <div className="import-summary__file-counts">
          <span className="import-summary__count import-summary__count--green">
            +{file.imported}
          </span>
          {file.duplicatesSkipped > 0 && (
            <span className="import-summary__count import-summary__count--yellow">
              ~{file.duplicatesSkipped} dup
            </span>
          )}
          {hasErrors && (
            <button
              type="button"
              className="import-summary__count import-summary__count--red import-summary__error-toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {file.errors.length} err {expanded ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>

      {expanded && hasErrors && (
        <div className="import-summary__errors">
          {file.errors.map((err: { row: number; field: string; message: string }) => (
            <div key={`${err.row}-${err.field}`} className="import-summary__error-row">
              <span className="import-summary__error-loc">
                Row {err.row}, {err.field}
              </span>
              <span className="import-summary__error-msg">{err.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportSummary({ response, onDismiss }: ImportSummaryProps) {
  if (!response) {
    return null;
  }

  const { summary, results } = response;

  return (
    <div className="import-summary">
      <div className="import-summary__header">
        <h3 className="import-summary__title">Import abgeschlossen</h3>
        <button
          type="button"
          className="import-summary__dismiss"
          onClick={onDismiss}
          aria-label="Schließen"
        >
          ✕
        </button>
      </div>

      {/* Totals */}
      <div className="import-summary__totals">
        <div className="import-summary__kpi">
          <span className="import-summary__kpi-value import-summary__kpi-value--green">
            {summary.totalImported}
          </span>
          <span className="import-summary__kpi-label">Importiert</span>
        </div>
        <div className="import-summary__kpi">
          <span className="import-summary__kpi-value import-summary__kpi-value--yellow">
            {summary.totalDuplicates}
          </span>
          <span className="import-summary__kpi-label">Duplikate</span>
        </div>
        <div className="import-summary__kpi">
          <span className="import-summary__kpi-value import-summary__kpi-value--red">
            {summary.totalErrors}
          </span>
          <span className="import-summary__kpi-label">Fehler</span>
        </div>
      </div>

      {/* Per-file breakdown */}
      <div className="import-summary__files">
        {results.map((file: PerFileResult) => (
          <FileRow key={`${file.batchId}-${file.filename}`} file={file} />
        ))}
      </div>
    </div>
  );
}

export default ImportSummary;
