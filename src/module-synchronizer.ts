import * as path from "path";
import { ModuleOperator } from "./base";
import { ModuleInfo } from "./module-info";
import { getDirectLocalDeps, walkDependencyTree, walkDryLocalTreeFromMultipleRoots } from "./dry-dependency-tree";
import { Lockfile } from "./lockfile";
import { getRidOfIt } from "./utils";
import { getPackager } from "./module-packager";
import { quickSync } from "./quick-sync";
import { NpmRunner } from "./module-npm-runner";
import { getConfig } from "./config";


export interface SyncResult {
  /**
   * Defined only if shouldPackage = true
   */
  actualIntegrity?: string;
}


export interface SyncStep {
  module: ModuleInfo;
  shouldPackage: boolean;
}


export class ModuleSynchronizer extends ModuleOperator {
  public static async buildSynchronizePlan(roots: ModuleInfo[]): Promise<SyncStep[]> {
    const plan: SyncStep[] = [];

    await walkDryLocalTreeFromMultipleRoots(roots, async module => {
      plan.push({
        module,
        shouldPackage: false
      });
    });

    const versionLocked = getConfig().modules.filter(module => module.hasLockFile());
    await walkDryLocalTreeFromMultipleRoots(versionLocked, async module => {
      const step = plan.find(step => step.module === module);
      if (step) {
        step.shouldPackage = true;
      }
    });

    return plan;
  }


  public static async syncRoots(roots: ModuleInfo[], shouldBuild: boolean): Promise<void> {
    const syncResults = new Map<string, SyncResult>();

    const plan = await this.buildSynchronizePlan(roots);

    for (const step of plan) {
      const synchronizer = new ModuleSynchronizer(step.module);
      const result = await synchronizer.sync(shouldBuild, step.shouldPackage, syncResults);
      syncResults.set(step.module.name, result);
    }
  }


  public async sync(shouldBuild: boolean, shouldPackage: boolean, childrenSyncResult: Map<string, SyncResult>): Promise<SyncResult> {
    if (this.module.hasLockFile()) {
      await this.syncWithLockFile(childrenSyncResult);
    } else {
      await this.syncWithoutLockFile();
    }

    if (shouldBuild) {
      await this.module.buildIfChanged();
    }

    if (shouldPackage) {
      await getPackager().pack(this.module);

      return {
        actualIntegrity: getPackager().getPrepackagedArchiveIntegrity(this.module)
      };
    }

    return {};
  }


  private async syncWithLockFile(childrenSyncResult: Map<string, SyncResult>): Promise<void> {
    const brokenDeps: ModuleInfo[] = [];

    const lockfile = Lockfile.forModule(this.module);

    await walkDependencyTree(this.module, async module => {
      const syncResult = childrenSyncResult.get(module.name);
      if (!syncResult) {
        throw new Error(`Error while syncing module "${ module.name }" into "${ this.module.name }": sync result not found`);
      }

      const lockFileIntegrity = await lockfile.getDepIntegrity(module.npmName.name);
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
      getRidOfIt(path.join(this.module.path, dep.npmName.name));
    }

    await NpmRunner.install(this.module);
  }


  private async syncWithoutLockFile(): Promise<void> {
    await Promise.all(getDirectLocalDeps(this.module).map(dep => quickSync(dep, this.module)));
  }
}
