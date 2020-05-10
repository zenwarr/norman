import * as path from "path";
import * as fs from "fs-extra";
import { NpmRunner } from "../module-npm-runner";
import { LocalModule } from "../local-module";
import { buildModuleIfChanged } from "../build";
import { getPackageReader } from "../package-reader";


function needsDepsInstall(mod: LocalModule): boolean {
  if (!mod.useNpm || !mod.config.path) {
    return false;
  }

  let modulesDir = path.join(mod.config.path, "node_modules");

  let content: any;
  try {
    content = getPackageReader().readPackageMetadata(mod.config.path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    } else {
      throw error;
    }
  }

  let depCount = Object.keys(content.dependencies || {}).length + Object.keys(content.devDependencies || {}).length;
  let installedModulesCount: number;
  if (!fs.existsSync(modulesDir)) {
    installedModulesCount = 0;
  } else {
    installedModulesCount = fs.readdirSync(modulesDir).filter(x => !x.startsWith(".")).length;
  }

  return !!(depCount && !installedModulesCount);
}


export async function installModuleDepsIfNotInitialized(mod: LocalModule) {
  if (!needsDepsInstall(mod)) {
    return;
  }

  await NpmRunner.install(mod);

  await buildModuleIfChanged(mod);
}
