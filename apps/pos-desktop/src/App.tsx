import { LoginGate } from './LoginGate.js';
import { WorkspaceRouter } from './WorkspaceRouter.js';

export function App() {
  return (
    <LoginGate>
      <WorkspaceRouter />
    </LoginGate>
  );
}
