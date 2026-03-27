import type { ImportResponse } from '@cryptax/shared';
import { useRef, useState } from 'react';
import './ImportDropzone.css';

interface ImportDropzoneProps {
  onImportComplete: (response: ImportResponse) => void;
}

function ImportDropzone({ onImportComplete }: ImportDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: File[]) {
    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');

    if (csvFiles.length === 0) {
      return;
    }

    setIsUploading(true);
    setProgress(`Importing ${csvFiles.length} file${csvFiles.length > 1 ? 's' : ''}...`);

    try {
      const formData = new FormData();
      for (const file of csvFiles) {
        formData.append('files', file);
      }

      const res = await fetch('/api/import/csv', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.error('Import failed:', errBody);
        return;
      }

      const response = (await res.json()) as ImportResponse;
      onImportComplete(response);
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setIsUploading(false);
      setProgress('');
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    void uploadFiles(droppedFiles);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files ?? []);
    void uploadFiles(selectedFiles);
    // Reset input so the same file can be selected again
    e.target.value = '';
  }

  function handleBrowseClick() {
    fileInputRef.current?.click();
  }

  const zoneClass = [
    'import-dropzone',
    isDragging ? 'import-dropzone--dragging' : '',
    isUploading ? 'import-dropzone--uploading' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className={zoneClass}
      aria-label="CSV Datei Import Bereich"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv"
        className="import-dropzone__file-input"
        onChange={handleFileInput}
        aria-label="Select CSV files"
      />

      {isUploading ? (
        <div className="import-dropzone__uploading">
          <div className="import-dropzone__spinner" aria-hidden="true" />
          <p className="import-dropzone__progress">{progress}</p>
        </div>
      ) : (
        <div className="import-dropzone__content">
          <div className="import-dropzone__icon" aria-hidden="true">
            &#128196;
          </div>
          <p className="import-dropzone__label">CSV-Dateien hierher ziehen</p>
          <p className="import-dropzone__sublabel">
            Bitget Spot, Futures, Orders & Earn werden automatisch erkannt
          </p>
          <button type="button" className="import-dropzone__browse-btn" onClick={handleBrowseClick}>
            Dateien auswählen
          </button>
        </div>
      )}
    </section>
  );
}

export default ImportDropzone;
