import * as path from "path";
import * as fs from "fs-extra";
import { NpmRunner } from "./module-npm-runner";
import { LocalModule } from "./local-module";
import { buildModuleIfChanged } from "./build";


function needsDepsInstall(mod: LocalModule): boolean {
  if (!mod.useNpm || !mod.config.path) {
    return false;
  }

  let packagePath = path.join(mod.config.path, "node_modules");
  if (fs.existsSync(packagePath)) {
    return true;
  }

  let content: any;
  try {
    content = fs.readJSONSync(path.join(mod.config.path, "package.json"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    } else {
      throw error;
    }
  }

  return !!(
      (content.dependencies && Object.keys(content.dependencies).length) ||
      (content.devDependencies && Object.keys(content.devDependencies).length)
  );
}


export async function installModuleDepsIfNotInitialized(mod: LocalModule) {
  if (!needsDepsInstall(mod)) {
    return;
  }

  await NpmRunner.install(mod);

  await buildModuleIfChanged(mod);
}
