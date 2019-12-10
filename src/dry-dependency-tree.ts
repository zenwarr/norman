import { ModuleInfo } from "./module-info";
import * as utils from "./utils";
import { getConfig } from "./config";


export enum WalkerAction {
  Continue,
  Stop
}


export type LocalModuleWalker = (module: ModuleInfo) => Promise<WalkerAction | void>;


export function getDirectLocalDeps(module: ModuleInfo): ModuleInfo[] {
  const config = getConfig();
  return utils.getDirectDeps(module.path).map(moduleName => config.getModuleInfo(moduleName)).filter(dep => dep != null) as ModuleInfo[];
}


export async function walkDryLocalTreeSubset(modules: ModuleInfo[], walker: LocalModuleWalker): Promise<void> {
  const walked = new Set<string>();

  const walkModule = async(module: ModuleInfo, deps: ModuleInfo[], parents: string[]): Promise<WalkerAction> => {
    if (walked.has(module.name)) {
      return WalkerAction.Continue;
    }

    for (let dep of deps) {
      if (parents.indexOf(dep.name) >= 0) {
        throw new Error(`Recursive dependency: ${ dep.name }, required by ${ parents.join(" -> ") }`);
      }

      const action = await walkModule(dep, getDirectLocalDeps(dep), [ ...parents, module.name ]);
      if (action === WalkerAction.Stop) {
        return WalkerAction.Stop;
      }
    }

    walked.add(module.name);

    return await walker(module) || WalkerAction.Continue;
  };

  for (let module of modules) {
    const action = await walkModule(module, getDirectLocalDeps(module), []);
    if (action === WalkerAction.Stop) {
      return;
    }
  }
}


export async function walkDryLocalTree(walker: LocalModuleWalker): Promise<void> {
  return walkDryLocalTreeSubset(getConfig().modules, walker);
}
