import { ModuleInfo } from "./module-info";
import { ModuleInfoWithDeps } from "./server";
import * as utils from "./utils";
import { getConfig } from "./config";


export function getDependencyTree(modules: ModuleInfo[]): ModuleInfoWithDeps[] {
  const config = getConfig();

  return modules.map(module => {
    let subDeps = utils.getPackageDeps(module.path).map(moduleName => config.getModuleInfo(moduleName)).filter(dep => dep != null);

    return {
      module,
      dependencies: subDeps as ModuleInfo[]
    };
  });
}


export async function walkDependencyTree(modules: ModuleInfo[], walker: (module: ModuleInfo) => Promise<void>): Promise<void> {
  let tree = getDependencyTree(modules);

  const walkedModules: string[] = [];

  const markWalked = (module: ModuleInfo) => {
    if (walkedModules.indexOf(module.name) < 0) {
      walkedModules.push(module.name);
    }
  };

  const isAlreadyWalked = (module: ModuleInfo) => {
    return walkedModules.indexOf(module.name) >= 0;
  };

  const walkModule = async(module: ModuleInfoWithDeps, parents: string[]) => {
    if (isAlreadyWalked(module.module)) {
      return;
    }

    for (let dep of module.dependencies) {
      if (parents.indexOf(dep.name) >= 0) {
        // recursive dep
        throw new Error(`Recursive dependency: ${ dep.name }, required by ${ parents.join(" -> ") }`);
      }

      let depWithDeps = tree.find(mod => mod.module.name === dep.name);
      if (depWithDeps) {
        await walkModule(depWithDeps, parents.concat([ module.module.name ]));
      }
    }

    await walker(module.module);

    markWalked(module.module);
  };

  for (let module of tree) {
    await walkModule(module, []);
  }
}