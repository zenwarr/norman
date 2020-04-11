import { LocalModule } from "../local-module";
import { NpmRunner } from "../module-npm-runner";
import { Lockfile } from "../lockfile";
import { getDirectLocalDeps, walkModuleDependants } from "../deps/dry-dependency-tree";


export interface ModSpecifier {
  mod: LocalModule;
  version: string;
}


export async function updateDependencies(parent: LocalModule, children: ModSpecifier[]) {
  let parts = children.map(child => `${ child.mod.checkedName.name }@${ child.version }`);

  await NpmRunner.run(parent, [ "install", ...parts ]);

  if (Lockfile.existsInModule(parent)) {
    let lockfile = Lockfile.forModule(parent);
    lockfile.updateResolveUrl();
  }
}


export async function updateModuleInDependants(actualVersion: string, mod: LocalModule) {
  await walkModuleDependants(mod, async dep => {
    let shouldBeInstalled = getDirectLocalDeps(dep).includes(mod);
    if (shouldBeInstalled) {
      await updateDependencies(dep, [
        {
          mod,
          version: actualVersion
        }
      ]);
    }
  });
}
