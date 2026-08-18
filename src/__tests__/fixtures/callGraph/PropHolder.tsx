import React from 'react';
import { extractDocument } from './extractor';
import PropCallee from './PropCallee';

/**
 * R-3(b) — imports the extractor and PASSES IT AS A PROP. It never calls it, so the
 * CallExpression-only walk saw nothing here and nothing in the child either.
 */
export default function PropHolder(): React.ReactElement {
  return <PropCallee onExtract={extractDocument} />;
}
