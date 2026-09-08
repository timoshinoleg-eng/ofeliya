// Backward-compatible import surface during the Strain Zero migration.
// Gameplay code should gradually move from `MaxBridge` naming to the platform-neutral facade.
export { PlatformBridge as MaxBridge } from '../platform';
export type { PlatformUser as MaxBridgeUser } from '../platform';
