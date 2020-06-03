import { NpmRegistry } from "../registry";
import { getArgs } from "../arguments";
import { getDirectLocalDeps, walkAllLocalModules, WalkerAction } from "../deps/dry-dependency-tree";
import { fetchLocalModule } from "../fetch";
import { publishModuleIfChanged } from "./publish";
import { ModSpecifier, updateDependencies } from "./update-deps";
import { LocalModule } from "../local-module";
import { NpmViewInfo } from "./npm-view";
import { getPackageReader } from "../package-reader";
import * as semver from "semver";
import * as path from "path";
import { getNpmInfoReader } from "../npm-info-reader";


interface PublishInfo {
  publishedVersion?: string;
  info: NpmViewInfo;
}


export enum DepRequirementType {
  Prod,
  Dev
}


export interface DepRequirement {
  type: DepRequirementType;
  range: string;
}


function getRequirementOf(depMap: any, dep: string, type: DepRequirementType): DepRequirement | undefined {
  if (depMap && typeof depMap === "object" && depMap[dep] && typeof depMap[dep] === "string") {
    return { type, range: depMap[dep] };
  } else {
    return undefined;
  }
}


function getRequirement(parent: LocalModule, dep: string): DepRequirement | undefined {
  let packageJSON = getPackageReader().readPackageMetadata(parent.path);
  if (!packageJSON) {
    return undefined;
  }

  return getRequirementOf(packageJSON.dependencies, dep, DepRequirementType.Prod)
      || getRequirementOf(packageJSON.devDependencies, dep, DepRequirementType.Dev);
}


export async function syncAllCommand() {
  let args = getArgs();

  if (args.subCommand !== "sync-all") {
    return;
  }

  await NpmRegistry.init();

  await walkAllLocalModules(async module => fetchLocalModule(module));

  async function shouldUpgradeDep(parent: LocalModule, dep: LocalModule): Promise<ModSpecifier | undefined> {
    let pInfo = publishInfo.get(dep);
    if (!pInfo) {
      if (!dep.useNpm) {
        throw new Error(`Module ${ parent.checkedName.name } depends on ${ dep.checkedName.name }, but the latter has "useNpm" flag set to false`);
      } else {
        throw new Error(`Internal error: broken walk order for parent ${ parent.checkedName.name } and child ${ dep.checkedName.name }`);
      }
    }

    let publishedVersions = pInfo.info.publishedVersions;

    let requirement = getRequirement(parent, dep.checkedName.name);
    if (!requirement) {
      return undefined;
    }

    console.log("published versions: ", publishedVersions);

    let wanted = semver.maxSatisfying(publishedVersions, requirement.range);

    console.log("wanted: ", wanted);

    if (!wanted) {
      // should we give some warning
      return undefined;
    }

    let installedDepVersion = await getInstalledVersion(parent, dep.checkedName.name);
    if (!installedDepVersion) {
      console.log(`should update ${ dep.checkedName.name } in ${ parent.checkedName.name }: ${ installedDepVersion } -> ${ wanted }`);
      return {
        mod: dep,
        version: wanted
      };
    }

    if (semver.gt(wanted, installedDepVersion)) {
      console.log(`should update ${ dep.checkedName.name } in ${ parent.checkedName.name }: ${ installedDepVersion } -> ${ wanted }`);
      return {
        mod: dep,
        version: wanted
      };
    }

    console.log(`wanted: ${wanted}, installed: ${installedDepVersion}`);

    return undefined;
  }

  async function getInstalledVersion(parent: LocalModule, dep: string): Promise<string | undefined> {
    let depPath = path.join(parent.path, "node_modules", dep);
    let packageJSON = getPackageReader().readPackageMetadata(depPath);
    if (!packageJSON) {
      return undefined;
    }

    if (typeof packageJSON.version !== "string" || !packageJSON.version) {
      return undefined;
    }

    return packageJSON.version;
  }

  let publishInfo = new Map<LocalModule, PublishInfo>();
  await walkAllLocalModules(async mod => {
    if (!mod.useNpm) {
      return WalkerAction.Continue;
    }

    let localDeps = getDirectLocalDeps(mod);

    // update dependencies that can be upgraded without breaking semver
    let depsToUpdate: ModSpecifier[] = [];
    for (let localDep of localDeps) {
      let req = await shouldUpgradeDep(mod, localDep);
      if (req) {
        depsToUpdate.push(req);
      }
    }

    await updateDependencies(mod, depsToUpdate);

    let packageInfo = await getNpmInfoReader().getNpmInfo(mod);

    let publishedVersion = await publishModuleIfChanged(mod);
    publishInfo.set(mod, {
      publishedVersion,
      info: packageInfo
    });

    return WalkerAction.Continue;
  });
}
