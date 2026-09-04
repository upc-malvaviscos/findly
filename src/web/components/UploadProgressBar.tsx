import React from 'react';

type Props = { percentage: number };
export function UploadProgressBar({ percentage }: Props) {
  return (
    <div
      className="progress-group"
      aria-label={`Subida completada al ${percentage}%`}
    >
      <div className="progress-label">
        <span>Subiendo tu selfie</span>
        <strong>{percentage}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
