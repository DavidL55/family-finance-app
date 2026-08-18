import React from 'react';
import { extractDocument } from './starBarrel';

/** Two barrels deep: `export *` over `export { … } from`. */
export default function StarBarrelCaller(): React.ReactElement {
  const send = (): void => {
    void extractDocument({ fileBase64: 'JVBERi0=', modelId: 'm' });
  };
  return <button onClick={send}>c</button>;
}
