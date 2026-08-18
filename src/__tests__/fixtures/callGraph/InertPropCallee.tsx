import React from 'react';

/** BATCH 10 — receives an untainted prop and must stay out of the caller set. */
export default function InertPropCallee({ label }: { label: string }): React.ReactElement {
  return <span>{label}</span>;
}
