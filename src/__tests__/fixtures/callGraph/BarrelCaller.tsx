import React from 'react';
import { extractDocument } from './barrel';

/** Reaches the extractor through a barrel that has no declaration of its own. */
export default function BarrelCaller(): React.ReactElement {
  const send = (): void => {
    void extractDocument({ fileBase64: 'JVBERi0=', modelId: 'm' });
  };
  return <button onClick={send}>a</button>;
}
