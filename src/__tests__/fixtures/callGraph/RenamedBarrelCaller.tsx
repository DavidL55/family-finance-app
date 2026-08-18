import React from 'react';
import { sendForAnalysis } from './renamingBarrel';

export default function RenamedBarrelCaller(): React.ReactElement {
  const send = (): void => {
    void sendForAnalysis({ fileBase64: 'JVBERi0=', modelId: 'm' });
  };
  return <button onClick={send}>b</button>;
}
