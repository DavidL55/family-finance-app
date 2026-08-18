import React from 'react';

type Extract = (req: { fileBase64: string; modelId: string }) => Promise<string>;

/** R-3(b) — calls a function it was handed. No import edge to anything. */
export default function PropCallee({ onExtract }: { onExtract: Extract }): React.ReactElement {
  const send = (): void => {
    void onExtract({ fileBase64: 'JVBERi0=', modelId: 'm' });
  };
  return <button onClick={send}>d</button>;
}
