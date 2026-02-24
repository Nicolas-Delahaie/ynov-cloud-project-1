import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { DeploymentState } from './types';

export const stateFilePath = path.resolve(__dirname, '../../.deployment-state.json');

export function saveState(state: DeploymentState): void {
  writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function loadState(): DeploymentState {
  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Fichier d'état introuvable: ${stateFilePath}. Lance d'abord le déploiement avec src/deploy-project.ts.`,
    );
  }
  return JSON.parse(readFileSync(stateFilePath, 'utf-8')) as DeploymentState;
}
