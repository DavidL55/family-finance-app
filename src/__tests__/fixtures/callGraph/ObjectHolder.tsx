import React from 'react';
import { extractDocument } from './extractor';

/** The same reference, one shape over: held in an object literal rather than a JSX attribute. */
export default function ObjectHolder(): React.ReactElement {
  const handlers = { extractDocument };
  return <button onClick={() => void handlers.extractDocument({ fileBase64: 'x', modelId: 'm' })}>e</button>;
}
