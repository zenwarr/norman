import { getConfig } from "./config";
import { walkDryLocalTree } from "./dry-dependency-tree";


export async function fetchModules() {
  const config = getConfig();

  for (let module of config.modules) {
    try {
      await module.fetch();
    } catch (error) {
      console.error(`Failed to fetch module: ${ error.message }`);
    }
  }
}


export async function installModules() {
  await walkDryLocalTree(async module => {
    await module.install();
  });
}
