import React from 'react';
import { formatFileSize } from './extractor';

/** Imports from the extractor's own module, but only the export that is not a root. */
export default function Unrelated(): React.ReactElement {
  return <span>{formatFileSize(2048)}</span>;
}
