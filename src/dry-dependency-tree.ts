import { LocalModule } from "./local-module";
import * as utils from "./utils";
import { getConfig } from "./config";


export enum WalkerAction {
  Continue,
  Stop
}


export type LocalModuleWalker = (module: LocalModule) => Promise<WalkerAction | void>;


/**
 * Returns list of all local modules listed in `dependencies` and `devDependencies` of the given module.
 * @param module
 */
export function getDirectLocalDeps(module: LocalModule): LocalModule[] {
  if (!module.useNpm) {
    return [];
  }

  const config = getConfig();
  return utils.getDirectDeps(module.path).map(moduleName => config.getModuleInfo(moduleName)).filter(dep => dep != null) as LocalModule[];
}


export async function walkDryLocalTreeFromMultipleRoots(modules: LocalModule[], walker: LocalModuleWalker): Promise<void> {
  const walked = new Set<string>();

  const walkModule = async(module: LocalModule, deps: LocalModule[], parents: string[]): Promise<WalkerAction> => {
    if (!module.name || walked.has(module.name.name)) {
      return WalkerAction.Continue;
    }

    for (let dep of deps) {
      if (!dep.name) {
        continue;
      }

      if (parents.indexOf(dep.name.name) >= 0) {
        throw new Error(`Recursive dependency: ${ dep.name }, required by ${ parents.join(" -> ") }`);
      }

      const action = await walkModule(dep, getDirectLocalDeps(dep), [ ...parents, module.name.name ]);
      if (action === WalkerAction.Stop) {
        return WalkerAction.Stop;
      }
    }

    walked.add(module.name.name);

    return await walker(module) || WalkerAction.Continue;
  };

  for (let module of modules) {
    const action = await walkModule(module, getDirectLocalDeps(module), []);
    if (action === WalkerAction.Stop) {
      return;
    }
  }
}


export async function walkAllLocalModules(walker: LocalModuleWalker): Promise<void> {
  return walkDryLocalTreeFromMultipleRoots(getConfig().modules, walker);
}


/**
 * Walks dependency tree of the given module in bottom-up order.
 */
export async function walkDependencyTree(module: LocalModule, walker: LocalModuleWalker): Promise<void> {
  return walkDryLocalTreeFromMultipleRoots([ module ], walker);
}
