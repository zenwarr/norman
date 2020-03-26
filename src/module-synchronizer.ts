import * as path from "path";
import { LocalModule } from "./local-module";
import { getDirectLocalDeps, walkDependencyTree, walkDryLocalTreeFromMultipleRoots } from "./dry-dependency-tree";
import { Lockfile } from "./lockfile";
import { getRidOfIt } from "./utils";
import { quickSync } from "./quick-sync";
import { NpmRunner } from "./module-npm-runner";
import { getConfig } from "./config";
import {buildModuleIfChanged} from "./build";
import { getPublisher } from "./ModulePublisher";


export interface SyncResult {
  /**
   * Defined only if shouldPackage = true
   */
  actualIntegrity?: string;
}


export interface SyncStep {
  module: LocalModule;
  shouldPackage: boolean;
}


export class ModuleSynchronizer {
  public constructor(protected module: LocalModule) {

  }

  private static async buildSynchronizePlan(roots: LocalModule[]): Promise<SyncStep[]> {
    const plan: SyncStep[] = [];

    await walkDryLocalTreeFromMultipleRoots(roots, async module => {
      plan.push({
        module,
        shouldPackage: false
      });
    });

    const versionLocked = getConfig().modules.filter(module => Lockfile.existsInModule(module));
    await walkDryLocalTreeFromMultipleRoots(versionLocked, async module => {
      const step = plan.find(step => step.module === module);
      if (step) {
        step.shouldPackage = true;
      }
    });

    console.log("synchronize plan: ", JSON.stringify(plan, undefined, 2));

    return plan;
  }


  public static async syncRoots(roots: LocalModule[], shouldBuild: boolean): Promise<void> {
    const syncResults = new Map<string, SyncResult>();

    const plan = await this.buildSynchronizePlan(roots);
    for (const step of plan) {
      const synchronizer = new ModuleSynchronizer(step.module);
      const result = await synchronizer.sync(shouldBuild, step.shouldPackage, syncResults);
      syncResults.set(step.module.checkedName.name, result);
    }
  }


  public async sync(shouldBuild: boolean, shouldPackage: boolean, childrenSyncResult: Map<string, SyncResult>): Promise<SyncResult> {
    if (Lockfile.existsInModule(this.module)) {
      await this.syncWithLockFile(childrenSyncResult);
    } else {
      await this.syncWithoutLockFile();
    }

    if (shouldBuild) {
      await buildModuleIfChanged(this.module);
    }

    if (shouldPackage) {
      await getPublisher().publish(this.module);

      return {
        actualIntegrity: getPublisher().getPublishedTarballIntegrity(this.module)
      };
    }

    return {};
  }


  private async syncWithLockFile(childrenSyncResult: Map<string, SyncResult>): Promise<void> {
    const brokenDeps: LocalModule[] = [];

    const lockfile = Lockfile.forModule(this.module);

    await walkDependencyTree(this.module, async module => {
      if (module === this.module) {
        return;
      }

      const syncResult = childrenSyncResult.get(module.checkedName.name);
      if (!syncResult) {
        throw new Error(`Error while syncing module "${ module.checkedName.name }" into "${ this.module.checkedName.name }": sync result not found`);
      }

      const lockFileIntegrity = await lockfile.getDepIntegrity(module.checkedName.name);
      if (lockFileIntegrity !== syncResult.actualIntegrity) {
        brokenDeps.push(module);
      }
    });

    if (!brokenDeps.length) {
      return;
    }

    const brokenDepsInfo = brokenDeps.map(dep => `"${ dep.name }"`).join(", ");
    console.log(`Detected broken dependencies of version-locked module "${ this.module.name }": ${ brokenDepsInfo }`);

    for (const dep of brokenDeps) {
      getRidOfIt(path.join(this.module.path, dep.checkedName.name));
    }

    await NpmRunner.install(this.module);
  }


  private async syncWithoutLockFile(): Promise<void> {
    await Promise.all(getDirectLocalDeps(this.module).map(dep => quickSync(dep, this.module)));
  }
}
