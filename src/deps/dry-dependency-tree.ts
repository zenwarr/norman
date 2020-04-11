import { LocalModule } from "../local-module";
import * as utils from "../utils";
import { getProject } from "../project";


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

  const config = getProject();
  return utils.getDirectDeps(module.path).map(moduleName => config.getModuleInfo(moduleName)).filter(dep => dep != null) as LocalModule[];
}


export async function walkModuleDependants(mod: LocalModule, walker: (dep: LocalModule) => Promise<void>, walked?: Set<LocalModule>): Promise<void> {
  let config = getProject();

  let dependants: LocalModule[] = [];

  if (!walked) {
    walked = new Set<LocalModule>();
  }

  for (let anotherMod of config.modules) {
    let directDeps = getDirectLocalDeps(anotherMod);
    if (directDeps.includes(mod) && (!walked || !walked.has(anotherMod))) {
      await walker(anotherMod);
      walked.add(anotherMod);
      dependants.push(anotherMod);
    }
  }

  for (let dep of dependants) {
    await walkModuleDependants(dep, walker, walked);
  }
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
  return walkDryLocalTreeFromMultipleRoots(getProject().modules, walker);
}
