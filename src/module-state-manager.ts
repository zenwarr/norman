import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { LocalModule } from "./local-module";
import { ModuleSubset } from "./subsets/module-subset";
import { BuildDependenciesSubset } from "./subsets/build-dependencies-subset";
import { ServiceLocator } from "./locator";
import { PublishDependenciesSubset } from "./subsets/publish-dependencies-subset";
import { AllFilesSubset } from "./subsets/all-files-subset";


export type SubsetFilesState = { [path: string]: number };


export interface ModuleState {
  modulePath: string;
  ts: number;
  files: SubsetFilesState;
}


const STATE_DIR = path.join(os.homedir(), ".norman-state");


export class ModuleStateManager {
  /**
   * Calculates actual module state based on content of files currently on disc.
   * Module state is object that contains modification time for some subset of files inside a module.
   */
  public async getActualState(mod: LocalModule): Promise<ModuleState> {
    const resultFiles: SubsetFilesState = {};

    const subset = new AllFilesSubset(mod);
    await subset.walk(async (filename, stat) => {
      if (this.isInAnySubset(mod, filename)) {
        resultFiles[filename] = stat.mtime.valueOf();
      }
    });

    return {
      modulePath: mod.path,
      ts: (new Date()).valueOf(),
      files: resultFiles
    };
  }


  public getSavedState(module: LocalModule): ModuleState | null {
    const stateFilePath = this.getModuleStateFilePath(module);

    if (this._stateCache.has(stateFilePath)) {
      return this._stateCache.get(stateFilePath) || null;
    }

    let loadedState: any;
    try {
      loadedState = fs.readJSONSync(stateFilePath, {
        encoding: "utf-8"
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        this._stateCache.set(stateFilePath, null);
        return null;
      }
      throw error;
    }

    if (!loadedState) {
      throw new Error(`Invalid state file: ${ stateFilePath }`);
    }

    this._stateCache.set(stateFilePath, loadedState);
    return loadedState;
  }


  public saveState(module: LocalModule, state: ModuleState): void {
    let stateFilePath = this.getModuleStateFilePath(module);

    fs.outputJSONSync(stateFilePath, state, {
      encoding: "utf-8"
    });

    this._stateCache.set(stateFilePath, state);
  }


  public async isSubsetChanged(module: LocalModule, subset: ModuleSubset): Promise<boolean> {
    let savedState = this.getSavedState(module);
    if (!savedState) {
      return true;
    }

    let actualSubsetState = await this.getSubsetState(module, subset, await this.getActualState(module));
    const savedSubsetState = await this.getSubsetState(module, subset, savedState);

    if (savedSubsetState.length !== actualSubsetState.length) {
      return true;
    }

    for (let filename of Object.keys(savedSubsetState)) {
      if (!actualSubsetState[filename] || actualSubsetState[filename] > savedSubsetState[filename]) {
        return true;
      }
    }

    return false;
  }


  public async getSubsetState(module: LocalModule, subset: ModuleSubset, state: ModuleState): Promise<SubsetFilesState> {
    const result: SubsetFilesState = {};

    for (const filename in state.files) {
      if (await subset.isFileIncluded(filename)) {
        result[filename] = state.files[filename];
      }
    }

    return result;
  }


  public clearSavedState() {
    fs.removeSync(STATE_DIR);
  }


  public static init() {
    ServiceLocator.instance.initialize("stateManager", new ModuleStateManager());
  }


  private getModuleStateFilePath(module: LocalModule): string {
    let hash = crypto.createHash("sha256").update(module.path).digest("hex");
    return path.join(STATE_DIR, `state-${ hash }.json`);
  }


  private isInAnySubset(module: LocalModule, filename: string): boolean {
    const subsets = [
      new BuildDependenciesSubset(module),
      new PublishDependenciesSubset(module)
    ];

    return subsets.some(subset => subset.isFileIncluded(filename));
  }


  private _stateCache = new Map<string, ModuleState | null>();
}


export function getStateManager() {
  return ServiceLocator.instance.get<ModuleStateManager>("stateManager");
}
