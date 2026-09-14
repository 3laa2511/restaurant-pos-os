import { KitchenDisplay } from './KitchenDisplay.js';
import { LoginGate } from './LoginGate.js';
import { RealPosApp } from './RealPosApp.js';
import { getPosRuntimeIdentity } from './pos/runtime-identity.js';

function AuthenticatedApp() {
  const identity = getPosRuntimeIdentity();
  const forceKitchenDisplay = typeof window !== 'undefined' && window.location.hash === '#kds';

  if (identity.kitchenStation || forceKitchenDisplay) {
    return <KitchenDisplay />;
  }

  return <RealPosApp />;
}

export function App() {
  return (
    <LoginGate>
      <AuthenticatedApp />
    </LoginGate>
  );
}
