import { NpmRegistry } from "../registry";
import { getArgs } from "../arguments";
import { getDirectLocalDeps, walkAllLocalModules } from "../deps/dry-dependency-tree";
import { fetchLocalModule } from "../fetch";
import { installModuleDepsIfNotInitialized } from "../deps/deps";
import { publishModuleIfChanged } from "./publish";
import { updateDependencies, updateModuleInDependants } from "./update-deps";
import { LocalModule } from "../local-module";


export async function syncAllCommand() {
  let args = getArgs();

  if (args.subCommand !== "sync-all") {
    return;
  }

  await NpmRegistry.init();

  await walkAllLocalModules(async module => fetchLocalModule(module));

  await walkAllLocalModules(async module => installModuleDepsIfNotInitialized(module));

  let publishInfo = new Map<LocalModule, string>();
  await walkAllLocalModules(async mod => {
    let localDeps = getDirectLocalDeps(mod);

    let depsToInstall = localDeps.filter(m => publishInfo.has(m));
    if (depsToInstall.length) {
      await updateDependencies(mod, depsToInstall.map(dep => {
        return {
          mod: dep,
          version: publishInfo.get(dep)!
        };
      }));
    }

    let publishedVersion = await publishModuleIfChanged(mod);
    if (publishedVersion) {
      publishInfo.set(mod, publishedVersion);
    }
  });
}
