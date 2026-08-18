import React from 'react';
import { extractDocument, formatFileSize } from './extractor';
import InertPropCallee from './InertPropCallee';

/**
 * BATCH 10 — THE PRECISION PIN FOR THE PROP HAND-OFF EDGE.
 *
 * This component IS tainted (it calls the extractor), and it renders a child while passing it a
 * prop — but the prop carries nothing tainted. The child must stay clean. If the edge were
 * "a tainted component renders a child with any attribute" rather than "a tainted VALUE is handed
 * to a child", this would taint InertPropCallee and the edge would creep back towards the
 * import-transitive noise R-3 fought off: most React components pass most of their props on.
 */
export default function InertPropHolder(): React.ReactElement {
  const send = (): void => {
    void extractDocument({ fileBase64: 'JVBERi0=', modelId: 'm' });
  };
  return (
    <button onClick={send}>
      <InertPropCallee label={formatFileSize(1024)} />
    </button>
  );
}
