import React from 'react';
import BarrelCaller from './BarrelCaller';
import PropHolder from './PropHolder';

/**
 * THE ANTI-OVER-TAINT PIN. This file RENDERS two tainted components and must stay out of the
 * caller set: a JSX tag name is "render this", not "hold this function". Without that exclusion
 * the reference edge makes App.tsx an extraction surface, then Dashboard, then the whole tree —
 * and a guard that flags everything is a guard that gets deleted.
 */
export default function Renderer(): React.ReactElement {
  return (
    <div>
      <BarrelCaller />
      <PropHolder />
    </div>
  );
}
