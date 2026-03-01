import { registerAnalysisHandlers } from './analysis';
import { registerCatalogHandlers } from './catalog';
import { registerCudaHandlers } from './cuda';
import { registerFileHandlers } from './files';
import { registerGpuHandlers } from './gpu';
import { registerLabelHandlers } from './labels';
import { registerLicenseHandlers } from './licenses';
import { registerModelHandlers } from './models';
import { registerSettingsHandlers } from './settings';
import { registerSpeciesHandlers } from './species';
import { registerSystemHandlers } from './system';

export async function registerHandlers(): Promise<void> {
  registerAnalysisHandlers();
  registerCatalogHandlers();
  registerCudaHandlers();
  registerFileHandlers();
  registerGpuHandlers();
  registerLabelHandlers();
  registerLicenseHandlers();
  registerModelHandlers();
  registerSpeciesHandlers();
  registerSystemHandlers();
  await registerSettingsHandlers();
}
