import { registerAnalysisHandlers } from './analysis';
import { registerCatalogHandlers } from './catalog';
import { registerFileHandlers } from './files';
import { registerLabelHandlers } from './labels';
import { registerLicenseHandlers } from './licenses';
import { registerModelHandlers } from './models';
import { registerSettingsHandlers } from './settings';

export async function registerHandlers(): Promise<void> {
  registerAnalysisHandlers();
  registerCatalogHandlers();
  registerFileHandlers();
  registerLabelHandlers();
  registerLicenseHandlers();
  registerModelHandlers();
  await registerSettingsHandlers();
}
