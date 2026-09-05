import { LoginGate } from './LoginGate.js';
import { RealPosApp } from './RealPosApp.js';

export function App() {
  return (
    <LoginGate>
      <RealPosApp />
    </LoginGate>
  );
}
